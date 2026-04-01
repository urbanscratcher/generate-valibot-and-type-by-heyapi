import { NextResponse } from "next/server";
import { searchOpenApiEndpoints } from "@/lib/openapi-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId")?.trim() || "dol_admin";
    const q = searchParams.get("q")?.trim() || "";
    const items = await searchOpenApiEndpoints(sourceId, q);
    return NextResponse.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검색 중 오류가 발생했어요.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
