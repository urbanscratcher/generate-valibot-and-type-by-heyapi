import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuildIndexEntry = {
  id: string;
  label: string;
  generatedAt: string;
  files: { path: string; lines: number; chars: number }[];
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    const indexPath = path.join(process.cwd(), "public", "openapi", "index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const data = JSON.parse(raw) as { sources?: BuildIndexEntry[] };
    const entries = data.sources ?? [];
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
