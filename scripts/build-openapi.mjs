import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "openapi");
const BUILD_INDEX_PATH = path.join(PUBLIC_ROOT, "index.json");
const DEFAULT_LOCAL_SOURCE_URL = "https://api.a.df.buttersoft.dev/v3/api-docs";

function parseEnvSources(raw, legacyUrl) {
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
          .filter(Boolean);
      }
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
          .map(([label, value], index) => {
            if (typeof value !== "string") return null;
            return { id: `env-${index}`, label, url: value };
          })
          .filter(Boolean);
      }
    } catch {
      // Fall through to string parsing
    }

    return trimmed
      .split(/[\n,]+/)
      .map((entry, index) => {
        const [label, url] = entry.split("|").map((part) => part.trim());
        if (!label || !url) return null;
        return { id: `env-${index}`, label, url };
      })
      .filter(Boolean);
  }

  if (legacyUrl && legacyUrl.trim().length > 0) {
    return [{ id: "dol_admin", label: "DOL_ADMIN", url: legacyUrl.trim() }];
  }
  if (process.env.NODE_ENV !== "production") {
    return [{ id: "dol_admin", label: "DOL_ADMIN", url: DEFAULT_LOCAL_SOURCE_URL }];
  }
  return [];
}

function parseSpec(raw) {
  try {
    return { spec: JSON.parse(raw), isJson: true };
  } catch {
    return { spec: parseYaml(raw), isJson: false };
  }
}

function validateOpenApi(spec, raw) {
  const looksLikeHtml = /^\s*<!doctype\s+html|^\s*<html/i.test(raw);
  if (looksLikeHtml) {
    throw new Error("OpenAPI 스펙 대신 HTML이 내려왔어요.");
  }
  const hasOpenApi =
    spec && typeof spec === "object" && ("openapi" in spec || "swagger" in spec);
  if (!hasOpenApi) {
    throw new Error("입력한 문서가 OpenAPI 스펙 형식이 아니에요.");
  }
}

function getSpecVersion(spec) {
  return spec?.info?.version ?? "unknown";
}

async function downloadSpec(target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const response = await fetch(target, { signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`스펙 다운로드 실패 (${response.status})`);
  }
  return await response.text();
}

async function runGenerator(inputPath, outDir) {
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
          string(ctx) {
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
  });
}

async function readFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

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

async function buildSource(source) {
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

    const targetDir = path.join(PUBLIC_ROOT, source.id);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.cp(outDir, targetDir, { recursive: true });

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

async function main() {
  await loadDotEnv();
  const sources = parseEnvSources(
    process.env.OPENAPI_SOURCES ?? "",
    process.env.DOL_ADMIN ?? ""
  );

  await fs.mkdir(PUBLIC_ROOT, { recursive: true });

  if (sources.length === 0) {
    await fs.writeFile(BUILD_INDEX_PATH, JSON.stringify({ sources: [] }, null, 2), "utf8");
    console.log("No OpenAPI sources configured for build.");
    return;
  }

  const entries = [];
  for (const source of sources) {
    console.log(`Generating OpenAPI for ${source.label}...`);
    const entry = await buildSource(source);
    entries.push(entry);
  }

  await fs.writeFile(BUILD_INDEX_PATH, JSON.stringify({ sources: entries }, null, 2), "utf8");
  console.log(`OpenAPI build complete. (${entries.length} sources)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
      // ignore missing env files
    }
  }
}
