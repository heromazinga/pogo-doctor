import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { sha256Hex, generateDeviceToken, rateLimit, clientIp } from "../../../lib/deviceAuth";
import { consumePairCode } from "../../../lib/deviceServer";

// 앱 → { code, deviceName } → 장기 토큰 1회 반환. 코드는 kind='pair' 만 허용(웹 로그인 코드로는 기기 연결 불가), 1회용·10분·실패 5회 무효. IP 당 10분 10회.
export async function POST(req) {
  const ip = clientIp(req);
  const rl = rateLimit(`pair:${ip}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: `요청이 너무 많습니다 (${rl.retryAfterSec}초 후 재시도)` }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const deviceName = String(body?.deviceName || "기기").trim().slice(0, 40) || "기기";
  const v = await consumePairCode(sb, body?.code, "pair", ip);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });

  const token = generateDeviceToken();
  const { data: dev, error: e3 } = await sb.from("device_tokens").insert({ user_id: v.userId, name: deviceName, token_hash: sha256Hex(token) }).select("id,name,created_at").single();
  if (e3) return NextResponse.json({ error: `토큰 발급 실패: ${e3.message}` }, { status: 500 });
  console.log(`[device] 기기 연결 완료 device=${dev.id} name=${deviceName}`); // 토큰 원문은 로그에 남기지 않음
  return NextResponse.json({ token, deviceId: dev.id, name: dev.name, createdAt: dev.created_at });
}
