import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { del, list, put } from "@vercel/blob";

const INDEX_BLOB_PATH = "openapi/index.json";
const DEFAULT_LOCAL_SOURCE_URL = "https://api.a.df.buttersoft.dev/v3/api-docs";
const LOCAL_PUBLIC_ROOT = path.join(process.cwd(), "public", "openapi");
const LOCAL_INDEX_PATH = path.join(LOCAL_PUBLIC_ROOT, "index.json");

function useLocalCache() {
  return process.env.NODE_ENV !== "production" && !process.env.BLOB_READ_WRITE_TOKEN;
}

type OpenApiSource = {
  id: string;
  label: string;
  url: string;
};

type BuildSourceEntry = {
  id: string;
  label: string;
  generatedAt: string;
  files: Array<{ path: string; lines: number; chars: number }>;
  version: string;
};

export type EndpointItem = {
  operation: string;
  method: string;
  url: string;
  domain: string;
  description: string;
  dataType: string;
  responseType: string;
};

function parseEnvSources(raw: string, legacyUrl: string): OpenApiSource[] {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const label = typeof item.label === "string" ? item.label : null;
            const url = typeof item.url === "string" ? item.url : null;
            const id = typeof item.id === "string" ? item.id : `env-${index}`;
            if (!label || !url) return null;
            return { id, label, url };
          })
          .filter((item): item is OpenApiSource => Boolean(item));
      }
    } catch {
      // ignore
    }
  }

  if (legacyUrl && legacyUrl.trim().length > 0) {
    return [{ id: "dol_admin", label: "DOL_ADMIN", url: legacyUrl.trim() }];
  }
  if (process.env.NODE_ENV !== "production") {
    return [{ id: "dol_admin", label: "DOL_ADMIN", url: DEFAULT_LOCAL_SOURCE_URL }];
  }
  return [];
}

function parseSpec(raw: string) {
  try {
    return { spec: JSON.parse(raw), isJson: true };
  } catch {
    return { spec: parseYaml(raw), isJson: false };
  }
}

function validateOpenApi(spec: unknown, raw: string) {
  const looksLikeHtml = /^\s*<!doctype\s+html|^\s*<html/i.test(raw);
  if (looksLikeHtml) {
    throw new Error("OpenAPI 스펙 대신 HTML이 내려왔어요.");
  }
  if (!spec || typeof spec !== "object" || (!("openapi" in spec) && !("swagger" in spec))) {
    throw new Error("입력한 문서가 OpenAPI 스펙 형식이 아니에요.");
  }
}

function getSpecVersion(spec: any) {
  return spec?.info?.version ?? "unknown";
}

async function downloadSpec(target: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(target, { signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`스펙 다운로드 실패 (${response.status})`);
  }
  return await response.text();
}

async function runGenerator(inputPath: string, outDir: string) {
  const { createClient } = await import("@hey-api/openapi-ts");
  await createClient({
    input: inputPath,
    output: {
      format: "prettier",
      lint: "eslint",
      path: outDir,
    },
    plugins: [
      { name: "@hey-api/schemas", type: "json" },
      "@hey-api/typescript",
      { name: "@hey-api/client-fetch" },
      {
        name: "valibot",
        "~resolvers": {
          string(ctx: any) {
            const { $, schema, symbols } = ctx;
            const { v } = symbols;
            if (schema.format === "binary") {
              return $(v).attr("file").call();
            }
          },
        },
      },
      { name: "@hey-api/sdk", validator: "valibot" },
      "@tanstack/react-query",
    ],
  } as any);
}

async function readFiles(dir: string, base = dir): Promise<Array<{ path: string; content: string }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readFiles(fullPath, base)));
    } else {
      const content = await fs.readFile(fullPath, "utf8");
      const relativePath = path.relative(base, fullPath);
      files.push({ path: relativePath, content });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function buildSource(source: OpenApiSource): Promise<BuildSourceEntry> {
  const raw = await downloadSpec(source.url);
  const { spec, isJson } = parseSpec(raw);
  validateOpenApi(spec, raw);
  const version = getSpecVersion(spec);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "openapi-build-"));
  try {
    const inputPath = path.join(workDir, isJson ? "openapi.json" : "openapi.yaml");
    const outDir = path.join(workDir, "out");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(inputPath, raw, "utf8");
    await runGenerator(inputPath, outDir);

    const files = await readFiles(outDir);
    const fileMeta = files.map((file) => ({
      path: file.path,
      lines: file.content.split("\n").length,
      chars: file.content.length,
    }));

    if (useLocalCache()) {
      const targetDir = path.join(LOCAL_PUBLIC_ROOT, source.id);
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(targetDir, { recursive: true });
      for (const file of files) {
        const fullPath = path.join(targetDir, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf8");
      }
    } else {
      const prefix = `openapi/${source.id}/`;
      const existing = await list({ prefix });
      if (existing.blobs.length > 0) {
        await del(existing.blobs.map((blob) => blob.url));
      }
      for (const file of files) {
        await put(`${prefix}${file.path}`, file.content, {
          access: "public",
          addRandomSuffix: false,
          contentType: "text/plain; charset=utf-8",
        });
      }
    }

    return {
      id: source.id,
      label: source.label,
      generatedAt: new Date().toISOString(),
      files: fileMeta,
      version,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function readBuildIndex(): Promise<BuildSourceEntry[]> {
  try {
    let raw = "";
    if (useLocalCache()) {
      raw = await fs.readFile(LOCAL_INDEX_PATH, "utf8");
    } else {
      const listed = await list({ prefix: INDEX_BLOB_PATH });
      const exact = listed.blobs.find((blob) => blob.pathname === INDEX_BLOB_PATH);
      if (!exact) return [];
      const response = await fetch(exact.url, { cache: "no-store" });
      if (!response.ok) return [];
      raw = await response.text();
    }
    const parsed = JSON.parse(raw) as { sources?: BuildSourceEntry[] };
    return parsed.sources ?? [];
  } catch {
    return [];
  }
}

async function writeBuildIndex(entries: BuildSourceEntry[]) {
  if (useLocalCache()) {
    await fs.mkdir(LOCAL_PUBLIC_ROOT, { recursive: true });
    await fs.writeFile(LOCAL_INDEX_PATH, JSON.stringify({ sources: entries }, null, 2), "utf8");
    return;
  }
  await put(INDEX_BLOB_PATH, JSON.stringify({ sources: entries }, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
}

async function loadDotEnv() {
  const candidates = [path.join(process.cwd(), ".env.local"), path.join(process.cwd(), ".env")];
  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        if (!line || line.trim().length === 0) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        if (!key || process.env[key] !== undefined) continue;
        let value = trimmed.slice(idx + 1).trim();
        if (
          (value.startsWith("\"") && value.endsWith("\"")) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      // ignore
    }
  }
}

export async function refreshOpenApiSource(sourceId: string) {
  await loadDotEnv();
  const sources = parseEnvSources(process.env.OPENAPI_SOURCES ?? "", process.env.DOL_ADMIN ?? "");
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    throw new Error(`source not found: ${sourceId}`);
  }

  const built = await buildSource(source);
  const existing = await readBuildIndex();
  const next = [...existing.filter((item) => item.id !== sourceId), built].sort((a, b) =>
    a.label.localeCompare(b.label)
  );
  await writeBuildIndex(next);

  return built;
}

export async function getOpenApiIndex() {
  await loadDotEnv();
  const configured = parseEnvSources(process.env.OPENAPI_SOURCES ?? "", process.env.DOL_ADMIN ?? "");
  const entries = await readBuildIndex();

  if (configured.length === 0) {
    return { sources: entries };
  }

  const merged = configured.map((source) => {
    const built = entries.find((item) => item.id === source.id);
    if (built) return built;
    return {
      id: source.id,
      label: source.label,
      generatedAt: undefined,
      files: [],
      version: "unknown",
    };
  });

  return { sources: merged };
}

export async function getOpenApiFile(sourceId: string, filePath: string) {
  if (useLocalCache()) {
    const localPath = path.join(LOCAL_PUBLIC_ROOT, sourceId, filePath);
    try {
      return await fs.readFile(localPath, "utf8");
    } catch {
      throw new Error("file not found");
    }
  }
  const pathname = `openapi/${sourceId}/${filePath}`;
  const listed = await list({ prefix: pathname });
  const exact = listed.blobs.find((blob) => blob.pathname === pathname);
  if (!exact) throw new Error("file not found");
  const response = await fetch(exact.url, { cache: "no-store" });
  if (!response.ok) throw new Error("failed to fetch blob content");
  return await response.text();
}

function parseComment(rawComment?: string): string {
  if (!rawComment) return "";
  return rawComment
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function parseSdkEndpoints(content: string): EndpointItem[] {
  const regex =
    /(?:\/\*\*([\s\S]*?)\*\/\s*)?export const\s+(\w+)\s*=([\s\S]*?)\(options\.client\s*\?\?\s*client\)\.(\w+)<([\s\S]*?)>\(\{([\s\S]*?)\}\);/g;

  const endpoints: EndpointItem[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const comment = parseComment(match[1]);
    const operation = match[2] ?? "";
    const signaturePart = match[3] ?? "";
    const clientMethod = (match[4] ?? "").toUpperCase();
    const genericPart = match[5] ?? "";
    const requestObject = match[6] ?? "";

    const urlMatch = requestObject.match(/url:\s*"([^"]+)"/);
    const dataTypeMatch = signaturePart.match(/options:\s*Options<([^,>]+)/);
    const responseTypeMatch = genericPart.match(/^\s*([^,>\s]+)/);
    if (!urlMatch?.[1]) continue;

    endpoints.push({
      operation,
      method: clientMethod,
      url: urlMatch[1],
      domain: getDomainFromUrl(urlMatch[1]),
      description: comment,
      dataType: dataTypeMatch?.[1]?.trim() ?? "-",
      responseType: responseTypeMatch?.[1]?.trim() ?? "-",
    });
  }
  return endpoints;
}

function getDomainFromUrl(url: string): string {
  const segments = url.split("/").filter(Boolean);
  if (segments.length === 0) return "others";
  if (segments[0] === "admin") {
    return segments[1] ?? "admin";
  }
  return segments[0];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchOpenApiEndpoints(sourceId: string, query: string) {
  const sdk = await getOpenApiFile(sourceId, "sdk.gen.ts");
  const endpoints = parseSdkEndpoints(sdk);
  const q = normalizeText(query);
  if (!q) return endpoints;
  const tokens = q.split(/\s+/).filter(Boolean);
  return endpoints.filter((endpoint) => {
    const haystack = normalizeText(
      [
      endpoint.operation,
      endpoint.method,
      endpoint.url,
      endpoint.domain,
      endpoint.description,
      endpoint.dataType,
      endpoint.responseType,
    ].join(" ")
    );
    return tokens.every((token) => haystack.includes(token));
  });
}
