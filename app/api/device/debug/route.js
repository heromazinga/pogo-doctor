import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServiceClient } from "../../../lib/supabaseServer";
import { rateLimit, clientIp } from "../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../lib/deviceServer";

export const maxDuration = 30;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const KINDS = ["detail", "appraisal", "unknown", "blocked", "error", "merged"];

// 앱(디버그 모드) → 캡처(JPEG base64, 상태바·트레이너 영역 가림) + OCR 원문 + 판독값 업로드. 7일 후 keep-alive 가 삭제.
export async function POST(req) {
  const rl = rateLimit(`device-debug:${clientIp(req)}`, { limit: 60, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const kind = KINDS.includes(body?.kind) ? body.kind : "detail";
  const ocr = Array.isArray(body?.ocr) ? body.ocr.slice(0, 200).map((s) => String(s).slice(0, 200)) : [];
  const result = body?.result ? String(body.result).slice(0, 2000) : null;

  const id = randomUUID();
  let imagePath = null;
  if (typeof body?.imageBase64 === "string" && body.imageBase64.length > 0) {
    const buf = Buffer.from(body.imageBase64, "base64");
    if (buf.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: `이미지가 큽니다 (${buf.length} bytes > ${MAX_IMAGE_BYTES})` }, { status: 413 });
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return NextResponse.json({ error: "JPEG 만 허용" }, { status: 415 });
    imagePath = `${auth.userId}/${id}.jpg`;
    const { error: e1 } = await sb.storage.from("debug-captures").upload(imagePath, buf, { contentType: "image/jpeg", upsert: false });
    if (e1) {
      console.warn(`[device-debug] 이미지 업로드 실패: ${e1.message}${/bucket/i.test(e1.message) ? " (마이그레이션 0003 의 storage 버킷 생성 확인)" : ""}`);
      imagePath = null; // 이미지 없이 행만 기록
    }
  }
  const { data, error } = await sb.from("device_debug_logs").insert({ id, user_id: auth.userId, device_id: auth.deviceId, kind, ocr, result, image_path: imagePath }).select("id,created_at").single();
  if (error) return NextResponse.json({ error: `기록 실패: ${error.message}` }, { status: 500 });
  return NextResponse.json({ id: data.id, createdAt: data.created_at, imageStored: Boolean(imagePath) });
}
