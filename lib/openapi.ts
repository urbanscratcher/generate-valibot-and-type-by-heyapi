import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parse as parseYaml } from "yaml";

const SESSION_TTL_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_BASE = process.env.VERCEL ? os.tmpdir() : process.cwd();
const CACHE_ROOT = path.join(CACHE_BASE, ".cache", "openapi");

const sessions = new Map<string, { createdAt: number; baseDir: string }>();
const cache = new Map<
  string,
  {
    createdAt: number;
    files: { path: string; lines: number; chars: number }[];
    baseDir: string;
  }
>();
const urlCacheIndex = new Map<
  string,
  { cacheKey: string; createdAt: number; etag?: string; lastModified?: string }
>();

let cacheReady = false;

export type GeneratedFile = { path: string; lines: number; chars: number };

export type GenerateResult = {
  files: GeneratedFile[];
  sessionId: string;
  sourceUrl: string;
  generatedAt: string;
  cacheKey: string;
};

async function ensureCacheReady() {
  if (cacheReady) return;
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  await loadUrlIndex();
  cacheReady = true;
}

export async function generateFromUrl(url: string): Promise<GenerateResult> {
  await ensureCacheReady();
  const cachedEntry = getCachedEntryByUrl(url);
  const conditional = cachedEntry
    ? { etag: cachedEntry.etag, lastModified: cachedEntry.lastModified }
    : undefined;
  const download = await downloadSpec(url, conditional);
  if (download.status === 304 && cachedEntry) {
    const cached = getCache(cachedEntry.cacheKey);
    if (cached) {
      const sessionId = createSessionFromCache(cached);
      return {
        sourceUrl: url,
        generatedAt: new Date().toISOString(),
        sessionId,
        files: cached.files,
        cacheKey: cachedEntry.cacheKey,
      };
    }
    throw new Error("캐시가 만료되어 다시 생성이 필요해요.");
  }

  return handleGeneration(download.body, url, "url:" + url, download);
}

export async function generateFromFile(raw: string, name: string): Promise<GenerateResult> {
  await ensureCacheReady();
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return handleGeneration(raw, name, "file:" + hash);
}

export async function getFileContent(params: {
  sessionId?: string;
  cacheKey?: string;
  filePath: string;
}) {
  await ensureCacheReady();
  const normalized = path.posix.normalize(params.filePath.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("잘못된 경로예요.");
  }

  let baseDir: string | null = null;
  if (params.sessionId) {
    const session = sessions.get(params.sessionId);
    if (session) {
      baseDir = session.baseDir;
    }
  }
  if (!baseDir && params.cacheKey) {
    const cached = getCache(params.cacheKey);
    if (cached) {
      baseDir = cached.baseDir;
    } else {
      const disk = readCacheFromDisk(params.cacheKey);
      if (disk) {
        cache.set(params.cacheKey, disk);
        baseDir = disk.baseDir;
      }
    }
  }

  if (!baseDir) {
    throw new Error("세션이 만료되었어요. 다시 생성해 주세요.");
  }

  const target = path.join(baseDir, normalized);
  const content = await fs.readFile(target, "utf8");
  return { path: normalized, content };
}

async function handleGeneration(
  raw: string,
  sourceLabel: string,
  cacheKeyBase: string,
  downloadMeta?: { etag?: string; lastModified?: string }
): Promise<GenerateResult> {
  let workDir: string | null = null;
  let sessionId: string | null = null;
  try {
    if (raw.trim().length === 0) {
      throw new Error("스펙 응답이 비어 있어요.");
    }

    const { spec, isJson } = parseSpec(raw);
    validateOpenApi(spec, raw);
    const version = getSpecVersion(spec);
    const cacheKey = cacheKeyBase + "::" + version;
    const cached = getCache(cacheKey);
    if (cached) {
      const cachedSessionId = createSessionFromCache(cached);
      return {
        sourceUrl: sourceLabel,
        generatedAt: new Date().toISOString(),
        sessionId: cachedSessionId,
        files: cached.files,
        cacheKey,
      };
    }

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "openapi-gen-"));
    const inputPath = path.join(workDir, isJson ? "openapi.json" : "openapi.yaml");
    const outDir = path.join(workDir, "out");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(inputPath, raw, "utf8");

    await runGenerator(inputPath, outDir);

    const files = await readFiles(outDir);
    sessionId = crypto.randomUUID();
    sessions.set(sessionId, { createdAt: Date.now(), baseDir: outDir });
    scheduleCleanup(sessionId);

    const fileMeta = files.map((file) => ({
      path: file.path,
      lines: file.content.split("\n").length,
      chars: file.content.length,
    }));
    setCache(cacheKey, {
      createdAt: Date.now(),
      files: fileMeta,
      baseDir: outDir,
    });

    if (cacheKeyBase.startsWith("url:")) {
      const url = cacheKeyBase.slice(4);
      urlCacheIndex.set(url, {
        cacheKey,
        createdAt: Date.now(),
        etag: downloadMeta?.etag,
        lastModified: downloadMeta?.lastModified,
      });
      void saveUrlIndex();
    }

    return {
      sourceUrl: sourceLabel,
      generatedAt: new Date().toISOString(),
      sessionId,
      files: fileMeta,
      cacheKey,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    throw new Error(message);
  } finally {
    if (workDir && sessionId == null) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
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
  });
}

async function readFiles(dir: string, base = dir): Promise<{ path: string; content: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: { path: string; content: string }[] = [];

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

function scheduleCleanup(sessionId: string) {
  setTimeout(async () => {
    const session = sessions.get(sessionId);
    if (session == null) return;
    sessions.delete(sessionId);
    if (session.baseDir.startsWith(os.tmpdir()) && session.baseDir.includes("openapi-gen-")) {
      await fs.rm(path.dirname(session.baseDir), { recursive: true, force: true });
    }
  }, SESSION_TTL_MS);
}

async function downloadSpec(target: string, conditional?: { etag?: string; lastModified?: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const headers: Record<string, string> = {};
  if (conditional?.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional?.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
  const response = await fetch(target, { signal: controller.signal, headers });
  clearTimeout(timeout);

  if (response.status === 304) {
    return { status: 304 as const, body: "", etag: conditional?.etag, lastModified: conditional?.lastModified };
  }
  if (!response.ok) {
    throw new Error(`스펙 다운로드 실패 (${response.status})`);
  }
  const body = await response.text();
  return {
    status: response.status as 200,
    body,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  };
}

function parseSpec(raw: string) {
  const json = safeJsonParse(raw);
  if (json) return { spec: json, isJson: true };
  const yaml = parseYaml(raw);
  return { spec: yaml, isJson: false };
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validateOpenApi(spec: unknown, raw: string) {
  const looksLikeHtml = /^\s*<!doctype\s+html|^\s*<html/i.test(raw);
  if (looksLikeHtml) {
    throw new Error("OpenAPI 스펙 대신 HTML이 내려왔어요. JSON/YAML 스펙 URL을 확인해 주세요.");
  }
  const hasOpenApi = spec && typeof spec === "object" && ("openapi" in (spec as object) || "swagger" in (spec as object));
  if (!hasOpenApi) {
    throw new Error("입력한 문서가 OpenAPI 스펙 형식이 아니에요. JSON/YAML 스펙 URL을 확인해 주세요.");
  }
}

function getSpecVersion(spec: any) {
  return spec?.info?.version ?? "unknown";
}

function setCache(
  key: string,
  entry: {
    createdAt: number;
    files: { path: string; lines: number; chars: number }[];
    baseDir: string;
  }
) {
  cache.set(key, entry);
  void writeCacheToDisk(key, entry);
  setTimeout(() => {
    const cached = cache.get(key);
    if (cached == null) return;
    if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }, CACHE_TTL_MS);
}

function getCache(key: string) {
  const cached = cache.get(key);
  if (cached) {
    if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return cached;
  }
  const disk = readCacheFromDisk(key);
  if (disk) {
    cache.set(key, disk);
    return disk;
  }
  return null;
}

function getCachedEntryByUrl(url: string) {
  const entry = urlCacheIndex.get(url);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    urlCacheIndex.delete(url);
    void saveUrlIndex();
    return null;
  }
  return entry;
}

function createSessionFromCache(cached: {
  files: { path: string; lines: number; chars: number }[];
  baseDir: string;
}) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { createdAt: Date.now(), baseDir: cached.baseDir });
  scheduleCleanup(sessionId);
  return sessionId;
}

async function loadUrlIndex() {
  const indexPath = path.join(CACHE_ROOT, "url-index.json");
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const data = JSON.parse(raw) as Record<
      string,
      { cacheKey: string; createdAt: number; etag?: string; lastModified?: string }
    >;
    for (const [url, entry] of Object.entries(data)) {
      urlCacheIndex.set(url, entry);
    }
  } catch {
    // ignore
  }
}

async function saveUrlIndex() {
  const indexPath = path.join(CACHE_ROOT, "url-index.json");
  const data: Record<string, { cacheKey: string; createdAt: number; etag?: string; lastModified?: string }> =
    {};
  for (const [url, entry] of urlCacheIndex.entries()) {
    data[url] = entry;
  }
  await fs.writeFile(indexPath, JSON.stringify(data, null, 2), "utf8");
}

function cacheDirForKey(cacheKey: string) {
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(CACHE_ROOT, hash);
}

async function writeCacheToDisk(
  cacheKey: string,
  entry: {
    createdAt: number;
    files: { path: string; lines: number; chars: number }[];
    baseDir: string;
  }
) {
  const dir = cacheDirForKey(cacheKey);
  const filesDir = path.join(dir, "files");
  await fs.mkdir(filesDir, { recursive: true });
  const meta = {
    cacheKey,
    createdAt: entry.createdAt,
    files: entry.files,
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");

  await Promise.all(
    entry.files.map(async (file) => {
      const src = path.join(entry.baseDir, file.path);
      const dest = path.join(filesDir, file.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    })
  );
}

function readCacheFromDisk(cacheKey: string) {
  const dir = cacheDirForKey(cacheKey);
  const metaPath = path.join(dir, "meta.json");
  try {
    const raw = fsSync.readFileSync(metaPath, "utf8");
    const meta = JSON.parse(raw) as {
      createdAt: number;
      files: { path: string; lines: number; chars: number }[];
    };
    if (Date.now() - meta.createdAt > CACHE_TTL_MS) {
      return null;
    }
    return {
      createdAt: meta.createdAt,
      files: meta.files,
      baseDir: path.join(dir, "files"),
    };
  } catch {
    return null;
  }
}
