import { NextResponse } from "next/server";
import { getUserFromRequest, getServiceClient } from "../../../lib/supabaseServer";
import { generatePairCode, sha256Hex, CODE_TTL_MS, rateLimit } from "../../../lib/deviceAuth";

// 웹(로그인 세션) → 8자리 연결 코드 발급. 코드 원문은 응답에만 1회, DB 에는 해시만.
export async function POST(req) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "로그인 세션이 필요합니다" }, { status: 401 });
  const rl = rateLimit(`pair-code:${user.id}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: `코드 발급이 너무 잦습니다 (${rl.retryAfterSec}초 후 재시도)` }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정 (SUPABASE_SECRET_KEY)" }, { status: 503 });

  // 이 사용자의 미사용 코드는 무효화 (활성 코드는 항상 1개)
  await sb.from("device_pair_codes").delete().eq("user_id", user.id).is("used_at", null);

  const code = generatePairCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await sb.from("device_pair_codes").insert({ code_hash: sha256Hex(code), user_id: user.id, expires_at: expiresAt });
  if (error) {
    console.warn(`[device] 코드 발급 실패: ${error.message}`); // 코드 원문은 로그에 남기지 않음
    return NextResponse.json({ error: `코드 발급 실패: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ code, expiresAt, ttlSec: CODE_TTL_MS / 1000 });
}
