import { NextResponse } from "next/server";
import { refreshOpenApiSource } from "@/lib/openapi-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { sourceId?: string };
    const sourceId = body.sourceId?.trim() || "dol_admin";
    const source = await refreshOpenApiSource(sourceId);
    return NextResponse.json({ ok: true, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : "새로고침 중 오류가 발생했어요.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
