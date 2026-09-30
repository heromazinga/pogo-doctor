import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { resolveUser } from "../../../lib/verdictContext";
import { fetchActiveScanItems } from "../../../lib/scanQuery";
import { latestFullSyncSession, diagnoseSync, planSyncSupersede } from "../../../lib/scanBackfill";
import { invalidateReserveCache } from "../../../lib/verdictContext";

export const dynamic = "force-dynamic";

// 4-F.5 D 진단: GET /api/scan/diag[?session_id=…][&all=1] → 전체 동기화 세션 이전 활성 기록별 대체/숨김 판단 사유.
//   all=1 이면 dismissed·superseded 기록까지 포함(왜 활성이 아닌지 확인용). 인증 필수, 변경 없음
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  // 4-F.6 C: ?species_id=15 → 그 종의 모든 기록(활성·숨김·대체) 상태 사슬 — "보냄" 이후 어디에 남았는지 추적
  if (sp.get("species_id")) {
    const sid = Number(sp.get("species_id"));
    const { data, error } = await sb.from("scan_items").select("id,name_kr,species_id,form,is_shadow,is_purified,atk_iv,def_iv,sta_iv,cp,hp,level,session_id,app_version,created_at,dismissed,dismissed_reason,superseded,superseded_by,recheck,recheck_reason,saved_pokemon_id").eq("user_id", user.userId).eq("species_id", sid).order("created_at", { ascending: true }).limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: rows } = await sb.from("my_pokemon").select("id,species_id,form,cp,hp,atk_iv,def_iv,sta_iv,status,tags,memo,created_at,updated_at,hidden_reason").eq("user_id", user.userId).eq("species_id", sid).limit(200);
    const state = (r) => (r.superseded ? `superseded_by ${r.superseded_by}` : r.dismissed ? `dismissed(${r.dismissed_reason || "사유 없음: 저장·보냄 처리·숨김 버튼"})` : "active");
    return NextResponse.json({ species_id: sid, scans: (data || []).map((r) => ({ ...r, state: state(r) })), rows: rows || [] });
  }
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
  // 4-F.6 B: ?apply=1 → 대체 계획을 지금 DB 에 적용하고 행별 결과(오류 메시지 포함)를 돌려준다
  let applied = null;
  if (sp.get("apply") === "1" && session) {
    const plan = planSyncSupersede(items, session);
    applied = { planned: plan.length, ok: 0, errors: [] };
    for (const p of plan) {
      const { data: upd, error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", user.userId).eq("id", p.id).select("id,superseded");
      if (error) applied.errors.push({ id: p.id, error: error.message });
      else if (!upd?.length) applied.errors.push({ id: p.id, error: "0 rows updated (user_id/id 불일치 또는 RLS)" });
      else applied.ok++;
    }
    invalidateReserveCache(user.userId);
  }
  const summary = {};
  for (const r of d.rows) { const k = r.why.split(":")[0]; summary[k] = (summary[k] || 0) + 1; }
  const sessions = {}; for (const r of d.rows) sessions[r.session_id] = (sessions[r.session_id] || 0) + 1;
  return NextResponse.json({ ...d, total: items.length, summary, bySession: sessions, applied });
}
