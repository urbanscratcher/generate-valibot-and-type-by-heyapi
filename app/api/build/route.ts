import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuildIndexEntry = {
  id: string;
  label: string;
  url: string;
  cacheKey: string;
  generatedAt: string;
  files: { path: string; lines: number; chars: number }[];
};

function getCacheRoot() {
  const base = process.env.OPENAPI_CACHE_BASE
    ? path.resolve(process.env.OPENAPI_CACHE_BASE)
    : process.env.VERCEL
      ? os.tmpdir()
      : process.cwd();
  const normalized = path.normalize(base);
  const cacheSuffix = path.join(".cache", "openapi");
  if (normalized.endsWith(cacheSuffix)) {
    return normalized;
  }
  if (path.basename(normalized) === ".cache") {
    return path.join(normalized, "openapi");
  }
  return path.join(normalized, ".cache", "openapi");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    const indexPath = path.join(getCacheRoot(), "build-index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const entries = JSON.parse(raw) as BuildIndexEntry[];
    if (!id) {
      return NextResponse.json({
        sources: entries.map((entry) => ({
          id: entry.id,
          label: entry.label,
          generatedAt: entry.generatedAt,
        })),
      });
    }

    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      return NextResponse.json({ message: "빌드된 결과를 찾지 못했어요." }, { status: 404 });
    }

    return NextResponse.json({
      files: entry.files,
      sourceUrl: entry.label,
      generatedAt: entry.generatedAt,
      sessionId: "",
      cacheKey: entry.cacheKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
