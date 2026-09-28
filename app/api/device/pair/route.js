import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { normalizePairCode, isValidPairCodeFormat, sha256Hex, generateDeviceToken, rateLimit, clientIp, MAX_CODE_ATTEMPTS } from "../../../lib/deviceAuth";

// 앱 → { code, deviceName } → 장기 토큰 1회 반환. 코드는 1회용·10분·실패 5회 무효. IP 당 10분 10회.
export async function POST(req) {
  const ip = clientIp(req);
  const rl = rateLimit(`pair:${ip}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: `요청이 너무 많습니다 (${rl.retryAfterSec}초 후 재시도)` }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const code = normalizePairCode(body?.code);
  const deviceName = String(body?.deviceName || "기기").trim().slice(0, 40) || "기기";
  const nowIso = new Date().toISOString();

  // 실패 시: 활성 코드 전체의 attempts +1 (사용자는 1명 전제, IP 제한과 함께 무차별 대입 방지)
  const fail = async (msg, status = 400) => {
    const { data } = await sb.from("device_pair_codes").select("code_hash,attempts").is("used_at", null).gt("expires_at", nowIso);
    for (const r of data || []) await sb.from("device_pair_codes").update({ attempts: (r.attempts || 0) + 1 }).eq("code_hash", r.code_hash);
    console.warn(`[device] 연결 실패 (${msg}) ip=${ip}`);
    return NextResponse.json({ error: msg }, { status });
  };

  if (!isValidPairCodeFormat(code)) return fail("코드 형식이 올바르지 않습니다 (8자리, O/0/1/I/L 없음)");
  const { data: row, error } = await sb.from("device_pair_codes").select("code_hash,user_id,expires_at,attempts,used_at").eq("code_hash", sha256Hex(code)).maybeSingle();
  if (error) return NextResponse.json({ error: `조회 실패: ${error.message}` }, { status: 500 });
  if (!row) return fail("코드가 없거나 틀렸습니다");
  if (row.used_at) return fail("이미 사용된 코드입니다 — 웹에서 새 코드를 발급하세요");
  if (new Date(row.expires_at).getTime() < Date.now()) return fail("만료된 코드입니다 — 웹에서 새 코드를 발급하세요");
  if ((row.attempts || 0) >= MAX_CODE_ATTEMPTS) return fail("실패가 누적되어 무효화된 코드입니다 — 웹에서 새 코드를 발급하세요");

  // 1회용: 먼저 used_at 를 조건부 갱신해 동시 요청을 막는다
  const { data: claimed, error: e2 } = await sb.from("device_pair_codes").update({ used_at: nowIso }).eq("code_hash", row.code_hash).is("used_at", null).select("code_hash");
  if (e2 || !claimed?.length) return fail("코드를 사용할 수 없습니다 (동시 요청)", 409);

  const token = generateDeviceToken();
  const { data: dev, error: e3 } = await sb.from("device_tokens").insert({ user_id: row.user_id, name: deviceName, token_hash: sha256Hex(token) }).select("id,name,created_at").single();
  if (e3) return NextResponse.json({ error: `토큰 발급 실패: ${e3.message}` }, { status: 500 });
  console.log(`[device] 기기 연결 완료 device=${dev.id} name=${deviceName}`); // 토큰 원문은 로그에 남기지 않음
  return NextResponse.json({ token, deviceId: dev.id, name: dev.name, createdAt: dev.created_at });
}
