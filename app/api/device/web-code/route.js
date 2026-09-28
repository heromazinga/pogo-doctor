import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { generatePairCode, sha256Hex, CODE_TTL_MS, rateLimit, clientIp } from "../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../lib/deviceServer";

// 앱(기기 토큰) → 웹 로그인 코드 발급 (계정 복구): 8자리, 10분, 1회용, 해시 저장, kind='web'
export async function POST(req) {
  const rl = rateLimit(`web-code:${clientIp(req)}`, { limit: 30, windowMs: 10 * 60 * 1000 }); // 앱 내 웹 화면이 열릴 때마다 발급하므로 여유 있게
  if (!rl.ok) return NextResponse.json({ error: `요청이 너무 많습니다 (${rl.retryAfterSec}초 후 재시도)` }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다 — 앱에서 다시 연결하세요" }, { status: 401 });

  // 미사용 웹 코드를 지우지 않는다: 앱 내 웹 화면(4-0)이 열릴 때마다 발급하므로, 사용자가 PC 용으로 방금 받은 코드가 무효화되면 안 된다. 만료·사용 코드는 keep-alive 가 정리
  const code = generatePairCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await sb.from("device_pair_codes").insert({ code_hash: sha256Hex(code), user_id: auth.userId, expires_at: expiresAt, kind: "web" });
  if (error) {
    console.warn(`[device] 웹 로그인 코드 발급 실패: ${error.message}${/kind/.test(error.message) ? " (마이그레이션 0003 적용 여부 확인)" : ""}`);
    return NextResponse.json({ error: `코드 발급 실패: ${error.message}` }, { status: 500 });
  }
  // userId 는 비밀이 아님: 앱 내 WebView 가 이미 같은 계정이면 코드 교환을 건너뛰는 데 쓴다
  return NextResponse.json({ code, expiresAt, ttlSec: CODE_TTL_MS / 1000, userId: auth.userId });
}
