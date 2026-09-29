import { NextResponse } from "next/server";
import { getServiceClient } from "../../lib/supabaseServer";
import { rateLimit, clientIp } from "../../lib/deviceAuth";
import { resolveUser, buildVerdictContext } from "../../lib/verdictContext";
import { fillMissingVerdicts, isStaleVerdict } from "../../lib/scanVerdict";
import { backfillSuperseded } from "../../lib/scanBackfill";
import { upsertMyPokemon } from "../../lib/savePokemonServer";

export const dynamic = "force-dynamic";

// 4-B 스캔 기록 (웹·앱 공용, 인증: 웹 세션 또는 기기 토큰)
// GET → { items }   POST { action: "save"|"dismiss"|"clear", ids?: [], session_id?, status? } → 저장(추천대로: 태그·상태) / 숨김 / 세션 전체 삭제
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  // 4-C: 강화·진화로 대체된(superseded) 기록은 제외 (마이그레이션 0008)
  const { data, error } = await sb.from("scan_items").select("*").eq("user_id", user.userId).eq("dismissed", false).eq("superseded", false).order("created_at", { ascending: false }).limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let items = data || [];
  // 4-B2: 앱 기록 시점에 판정이 아직 없는 항목(after() 미완료·실패)은 여기서 한 번의 컨텍스트로 계산해 저장
  let filled = 0, backfill = null;
  // 4-B6.2: 규칙 버전이 다른(낡은) 판정도 다시 계산 (isStaleVerdict). 4-C.2: 그때 superseded 백필도 1회(버전 플래그)
  try {
    const { ctx } = await buildVerdictContext(req, { myRows: undefined });
    try { backfill = await backfillSuperseded(sb, user.userId, items, ctx); if (backfill.changed) items = backfill.items; } catch (e) { console.warn(`[scan] 백필 실패: ${e.message}`); }
    if (items.some((it) => isStaleVerdict(it.verdict))) filled = await fillMissingVerdicts(sb, items, ctx);
  } catch (e) { console.warn(`[scan] 판정 보충 실패: ${e.message}`); }
  const { data: sessions } = await sb.from("scan_sessions").select("session_id,metrics,started_at,ended_at,created_at").eq("user_id", user.userId).order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({ items, sessions: sessions || [], filled, backfill: backfill ? { ran: backfill.ran, superseded: backfill.superseded, version: backfill.version } : null });
}

export async function POST(req) {
  const rl = rateLimit(`scan-action:${clientIp(req)}`, { limit: 60, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 300) : [];

  if (b.action === "clear") {
    let q = sb.from("scan_items").delete().eq("user_id", user.userId);
    if (b.session_id) q = q.eq("session_id", String(b.session_id));
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "dismiss") {
    if (!ids.length) return NextResponse.json({ error: "ids 필요" }, { status: 400 });
    const { error } = await sb.from("scan_items").update({ dismissed: true }).eq("user_id", user.userId).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: ids.length });
  }
  if (b.action === "save") {
    if (!ids.length) return NextResponse.json({ error: "ids 필요" }, { status: 400 });
    const { data: items, error } = await sb.from("scan_items").select("*").eq("user_id", user.userId).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const results = [];
    for (const it of items || []) {
      const v = it.verdict || {};
      // status: 요청값(keep|transfer) 우선, 없으면 판정대로(박사행 → transfer, 그 외 keep). 태그는 추천 태그
      const status = ["keep", "transfer"].includes(b.status) ? b.status : (v.tier === "transfer" ? "transfer" : "keep");
      const tags = status === "keep" ? (v.recommendedTags || []).slice(0, 8) : [];
      const row = {
        species_id: it.species_id, form: it.form || "Normal", name_kr: it.name_kr, cp: it.cp, hp: it.hp,
        atk_iv: it.atk_iv, def_iv: it.def_iv, sta_iv: it.sta_iv, level: it.level != null ? Number(it.level) : null,
        fast_move: null, charged_moves: [], is_shadow: Boolean(it.is_shadow), is_purified: false, is_shiny: false, is_lucky: false,
        status, purposes: status === "keep" ? (v.purposes || []) : [], tags, caught_on: it.caught_on, game_tags: it.game_tags || [], memo: "연속 스캔", source: "overlay",
      };
      const r = await upsertMyPokemon(sb, user.userId, row);
      if (r.error) { results.push({ id: it.id, error: r.error }); continue; }
      await sb.from("scan_items").update({ saved_pokemon_id: r.row.id, dismissed: true }).eq("id", it.id);
      results.push({ id: it.id, pokemonId: r.row.id, updated: r.updated, rule: r.rule, status, tags });
    }
    return NextResponse.json({ ok: true, results });
  }
  return NextResponse.json({ error: "action 은 save|dismiss|clear" }, { status: 400 });
}
