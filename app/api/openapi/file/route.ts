import { NextResponse } from "next/server";
import { getOpenApiFile } from "@/lib/openapi-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId")?.trim();
    const filePath = searchParams.get("path")?.trim();

    if (!sourceId || !filePath) {
      return NextResponse.json({ error: "sourceId와 path가 필요해요." }, { status: 400 });
    }

    const content = await getOpenApiFile(sourceId, filePath);
    return new NextResponse(content, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "파일 조회 실패";
    const status = message === "file not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
