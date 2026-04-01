import { NextResponse } from "next/server";
import { getOpenApiIndex } from "@/lib/openapi-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getOpenApiIndex();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "index 조회 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
