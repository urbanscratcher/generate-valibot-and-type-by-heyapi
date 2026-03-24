import { NextResponse } from "next/server";
import { generateFromFile } from "@/lib/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("spec");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ message: "스펙 파일을 업로드해 주세요." }, { status: 400 });
    }
    const raw = await file.text();
    const result = await generateFromFile(raw, file.name);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
