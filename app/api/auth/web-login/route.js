import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "../../../lib/supabaseServer";
import { rateLimit, clientIp } from "../../../lib/deviceAuth";
import { consumePairCode } from "../../../lib/deviceServer";

// 웹 "앱 코드로 로그인": 앱이 발급한 8자리 코드 → 해당 user_id 의 웹 세션.
// 이메일 발송 없이 동작하는 방식:
//  1) 사용자에게 이메일이 없으면(익명) 내부용 주소 u-<user_id>@app-login.pogo-doctor.invalid 를 admin API 로 설정 (email_confirm, 메일 발송 없음.
//     .invalid 는 RFC 2606 예약 TLD 라 실제 수신 불가)
//  2) admin.generateLink({ type: "magiclink" }) 로 hashed_token 을 받아(메일 발송 없음) 클라이언트가 verifyOtp({ token_hash, type: "magiclink" }) 로 세션 생성
//  3) generateLink 가 실패하면 대체: 임의 비밀번호 설정 → 서버가 signInWithPassword 로 세션 발급 → 즉시 비밀번호를 다른 난수로 재회전
// 보안: 코드는 8자리(32^8)·10분·1회용·실패 5회 무효·IP 제한, 토큰/비밀번호는 응답 1회, 비밀번호는 즉시 회전되어 재사용 불가.
export async function POST(req) {
  const ip = clientIp(req);
  const rl = rateLimit(`web-login:${ip}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: `요청이 너무 많습니다 (${rl.retryAfterSec}초 후 재시도)` }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }

  const v = await consumePairCode(sb, body?.code, "web", ip);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const userId = v.userId;

  // 1) 내부용 이메일 보장
  const { data: got, error: e1 } = await sb.auth.admin.getUserById(userId);
  if (e1 || !got?.user) return NextResponse.json({ error: `사용자 조회 실패: ${e1?.message || "없음"}` }, { status: 500 });
  let email = got.user.email;
  if (!email) {
    email = `u-${userId}@app-login.pogo-doctor.invalid`;
    const { error: e2 } = await sb.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (e2) return NextResponse.json({ error: `내부 이메일 설정 실패: ${e2.message}` }, { status: 500 });
  }

  // 2) 매직링크 토큰 (메일 발송 없음)
  const { data: link, error: e3 } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (!e3 && hashed) {
    console.log(`[web-login] magiclink 발급 user=${userId} ip=${ip}`);
    return NextResponse.json({ method: "magiclink", tokenHash: hashed, userId });
  }
  console.warn(`[web-login] generateLink 실패(${e3?.message || "hashed_token 없음"}) → 비밀번호 대체 방식`);

  // 3) 대체: 임시 비밀번호로 서버 측 로그인 후 즉시 회전
  const tmp = randomBytes(32).toString("base64url");
  const { error: e4 } = await sb.auth.admin.updateUserById(userId, { password: tmp });
  if (e4) return NextResponse.json({ error: `임시 비밀번호 설정 실패: ${e4.message}` }, { status: 500 });
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signed, error: e5 } = await pub.auth.signInWithPassword({ email, password: tmp });
  await sb.auth.admin.updateUserById(userId, { password: randomBytes(32).toString("base64url") }); // 회전 (실패해도 tmp 는 응답에 없음)
  if (e5 || !signed?.session) return NextResponse.json({ error: `세션 발급 실패: ${e5?.message || "세션 없음"}` }, { status: 500 });
  console.log(`[web-login] password 대체 방식 세션 발급 user=${userId} ip=${ip}`);
  return NextResponse.json({ method: "session", accessToken: signed.session.access_token, refreshToken: signed.session.refresh_token, userId });
}
