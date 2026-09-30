import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { resolveUser } from "../../../lib/verdictContext";
import { fetchActiveScanItems } from "../../../lib/scanQuery";
import { latestFullSyncSession, diagnoseSync } from "../../../lib/scanBackfill";

export const dynamic = "force-dynamic";

// 4-F.5 D 진단: GET /api/scan/diag[?session_id=…][&all=1] → 전체 동기화 세션 이전 활성 기록별 대체/숨김 판단 사유.
//   all=1 이면 dismissed·superseded 기록까지 포함(왜 활성이 아닌지 확인용). 인증 필수, 변경 없음
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  let session = null;
  if (sp.get("session_id")) { const { data } = await sb.from("scan_sessions").select("session_id,metrics,ended_at,created_at").eq("user_id", user.userId).eq("session_id", sp.get("session_id")).maybeSingle(); session = data; }
  else session = await latestFullSyncSession(sb, user.userId);
  let items;
  if (sp.get("all") === "1") {
    const { data, error } = await sb.from("scan_items").select("id,name_kr,species_id,form,is_shadow,is_purified,atk_iv,def_iv,sta_iv,cp,hp,session_id,created_at,dismissed,dismissed_reason,superseded,superseded_by").eq("user_id", user.userId).order("created_at", { ascending: false }).limit(3000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    items = data || [];
  } else {
    try { ({ items } = await fetchActiveScanItems(sb, user.userId)); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  }
  const d = diagnoseSync(items, session);
  const summary = {};
  for (const r of d.rows) { const k = r.why.split(":")[0]; summary[k] = (summary[k] || 0) + 1; }
  const sessions = {}; for (const r of d.rows) sessions[r.session_id] = (sessions[r.session_id] || 0) + 1;
  return NextResponse.json({ ...d, total: items.length, summary, bySession: sessions });
}
