import { NextResponse } from "next/server";
import { generateFromUrl } from "@/lib/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string };
    if (!body.url || body.url.trim().length === 0) {
      return NextResponse.json({ message: "OpenAPI URL을 입력해 주세요." }, { status: 400 });
    }
    const result = await generateFromUrl(body.url.trim());
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
