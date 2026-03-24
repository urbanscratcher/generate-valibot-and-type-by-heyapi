import { NextResponse } from "next/server";
import { getFileContent } from "@/lib/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId") ?? undefined;
    const cacheKey = searchParams.get("cacheKey") ?? undefined;
    const filePath = searchParams.get("path");
    if (!filePath) {
      return NextResponse.json({ message: "파일 경로가 필요해요." }, { status: 400 });
    }

    const payload = await getFileContent({ sessionId, cacheKey, filePath });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
