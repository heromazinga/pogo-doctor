import { NextResponse } from "next/server";
import { getServiceClient } from "../../../../lib/supabaseServer";
import { rateLimit, clientIp } from "../../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../../lib/deviceServer";

export const dynamic = "force-dynamic";

// 4-B2: 연속 스캔 세션 측정값 저장 (앱 종료 시 대기열로 전송). 같은 세션은 갱신
export async function POST(req) {
  const rl = rateLimit(`device-scan-session:${clientIp(req)}`, { limit: 30, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  if (typeof b.session_id !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(b.session_id)) return NextResponse.json({ error: "session_id 는 4~40자 영숫자" }, { status: 400 });
  if (b.metrics != null && (typeof b.metrics !== "object" || JSON.stringify(b.metrics).length > 4000)) return NextResponse.json({ error: "metrics 는 4KB 이하 객체" }, { status: 400 });
  const toIso = (v) => (typeof v === "number" && v > 0 ? new Date(v).toISOString() : typeof v === "string" ? v : null);
  const row = { user_id: auth.userId, device_id: auth.deviceId, session_id: b.session_id, metrics: b.metrics || {}, started_at: toIso(b.started_at), ended_at: toIso(b.ended_at) };
  const { data, error } = await sb.from("scan_sessions").upsert(row, { onConflict: "user_id,session_id" }).select("*").single();
  if (error) return NextResponse.json({ error: `세션 저장 실패: ${error.message}` }, { status: 500 });
  return NextResponse.json({ session: data });
}
