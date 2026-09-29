import { NextResponse } from "next/server";
import { getServiceClient } from "../../lib/supabaseServer";

// Supabase 무료 플랜 휴면(7일 비활성) 방지: Vercel Cron 이 하루 1회 호출 → DB 가벼운 조회 1건.
// Vercel 은 CRON_SECRET 환경변수가 있으면 Authorization: Bearer <CRON_SECRET> 를 붙여 호출한다.
export async function GET(req) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return NextResponse.json({ error: "CRON_SECRET 미설정" }, { status: 503 });
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const t0 = Date.now();
  const { error } = await sb.from("ai_usage").select("usage_date").limit(1);
  let cleaned = null, debugCleaned = null, scanCleaned = null;
  try { const r = await sb.rpc("cleanup_device_pair_codes"); cleaned = r.error ? null : r.data; } catch {}
  try { const r = await sb.rpc("cleanup_scan_items"); scanCleaned = r.error ? null : r.data; } catch {} // 4-B: 14일 지난 스캔 기록
  // 7일 지난 디버그 캡처: Storage 이미지 삭제 → 행 삭제 (마이그레이션 0003)
  try {
    const { data: rows } = await sb.rpc("expired_device_debug_logs");
    if (Array.isArray(rows) && rows.length) {
      const paths = rows.map((r) => r.image_path).filter(Boolean);
      if (paths.length) await sb.storage.from("debug-captures").remove(paths);
      const r2 = await sb.rpc("delete_device_debug_logs", { p_ids: rows.map((r) => r.id) });
      debugCleaned = r2.error ? null : r2.data;
    } else debugCleaned = 0;
  } catch {}
  if (error) {
    console.warn(`[keep-alive] 조회 실패: ${error.message}`);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  console.log(`[keep-alive] ok ${Date.now() - t0}ms cleanedCodes=${cleaned} cleanedDebug=${debugCleaned}`);
  return NextResponse.json({ ok: true, at: new Date().toISOString(), ms: Date.now() - t0, cleanedCodes: cleaned, cleanedDebug: debugCleaned, cleanedScan: scanCleaned });
}
