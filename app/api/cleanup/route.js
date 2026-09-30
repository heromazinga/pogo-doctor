import { NextResponse } from "next/server";
import { getServiceClient } from "../../lib/supabaseServer";
import { rateLimit, clientIp } from "../../lib/deviceAuth";
import { resolveUser, buildVerdictContext } from "../../lib/verdictContext";
import { fillMissingVerdicts } from "../../lib/scanVerdict";
import { backfillSuperseded } from "../../lib/scanBackfill";
import { fetchActiveScanItems } from "../../lib/scanQuery";
import { buildCleanup, DEFAULT_MAX_LEN, EXPECTED_LIMIT_NOTE, protectNote, protectSuffix, userTagsOf } from "../../lib/searchBuilder";
import { applySyncSupersede, NOT_SEEN_REASON } from "../../lib/scanBackfill";
import { invalidateReserveCache } from "../../lib/verdictContext";
import { computeVerdict, inputFromRow } from "../../lib/verdict";
import { isLegendaryClass } from "../../lib/speciesRankings";
import { findPokemon } from "../../lib/pokemonData";

export const dynamic = "force-dynamic";

// 4-B5 정리 도우미: 스캔 기록(미처리) + 내 목록 → 분류별 검색어 묶음. 인증: 웹 세션 또는 기기 토큰.
// GET ?maxLen=200 → { categories:[{category,label,count,groups:[{query,expected,targetIds,withCp}],skipped}], population, at }
// POST { action:"done", targetIds:[] } → 스캔 기록 dismissed, 내 목록 항목 삭제(웹에서 확인창 후 호출)
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const maxLen = Math.min(400, Math.max(60, Number(sp.get("maxLen")) || DEFAULT_MAX_LEN));
  // 4-D: 활성 기록 전부(페이지네이션, ≤3000) — 상한 300 이 population 을 잘라 예상 수·보호 판단을 틀리게 했다
  let items, truncated = false;
  try { ({ items, truncated } = await fetchActiveScanItems(sb, user.userId)); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  // 4-F.5 D: 최근 전체 동기화 세션과 일치하는 이전 기록 대체(멱등)
  try { const r = await applySyncSupersede(sb, user.userId, items); if (r.superseded) items = r.items; } catch (e) { console.warn(`[cleanup] 동기화 대체 실패: ${e.message}`); }
  const { ctx } = await buildVerdictContext(req, { scanItems: items }); // 4-F: 예비 순위는 이 조회의 활성 기록으로
  // 4-C.2 스캔 기록 백필(멱등, 규칙 버전당 1회): 과거 기록끼리도 규칙 ③ 으로 superseded 처리
  let backfill = null;
  try { backfill = await backfillSuperseded(sb, user.userId, items, ctx); if (backfill.changed) items = backfill.items; } catch (e) { console.warn(`[cleanup] 백필 실패: ${e.message}`); }
  // 4-D2: 판정 재계산은 청크(100건·15s)만. 남은 항목은 저장된(옛 규칙) 판정으로 분류하고 pending 으로 알린다 → 다음 조회가 이어서 처리
  let fill = { filled: 0, pending: 0 };
  try { fill = await fillMissingVerdicts(sb, items, ctx); } catch {}
  const rows = ctx.myRows || [];
  const legendaryOf = (r) => { const p = findPokemon(ctx.dataset, { id: r.species_id, form: r.form || "Normal" }); return p ? isLegendaryClass(p) : false; };
  // 대상: 스캔 항목(판정 있음) + 내 목록(판정은 여기서 계산; 박사행은 status=transfer 또는 판정 transfer)
  const scanTargets = items.map((it) => ({ id: `scan:${it.id}`, species_id: it.species_id, hp: it.hp, cp: it.cp, cpVerified: it.cp != null && !it.recheck, is_shadow: Boolean(it.is_shadow), form: it.form || "Normal",
    verdict: it.verdict || {}, recheck: Boolean(it.recheck) || it.verdict?.tier === "need_appraisal", legendary: legendaryOf(it), name_kr: it.name_kr, game_tags: it.game_tags || [] }));
  const rowTargets = rows.map((r) => {
    let v = null; try { v = computeVerdict(inputFromRow(r, ctx.storageMode), ctx); } catch { v = null; }
    const verdict = r.status === "transfer" ? { tier: "transfer", recommendedTags: [], collect: v?.collect || [] } : (v ? { tier: v.tier, recommendedTags: r.tags?.length ? r.tags : v.recommendedTags, collect: v.collect } : {});
    return { id: `row:${r.id}`, species_id: r.species_id, hp: r.hp, cp: r.cp, cpVerified: r.cp != null, is_shadow: Boolean(r.is_shadow), form: r.form || "Normal",
      verdict, recheck: v ? !v.confident : true, is_shiny: Boolean(r.is_shiny), is_lucky: Boolean(r.is_lucky), legendary: legendaryOf(r), name_kr: r.name_kr, game_tags: [...new Set([...(r.game_tags || []), ...(r.tags || [])])] };
  });
  const all = [...scanTargets, ...rowTargets];
  const categories = buildCleanup(all, all, { maxLen });
  // 4-D2: 판정 재계산이 남아 있으면(pending) 박사행 묶음은 잠금 — 되돌릴 수 없으므로 옛 규칙 판정으로 보내지 않게. 태그·수집은 유지(되돌릴 수 있음)
  for (const cat of categories) if (cat.category === "transfer" && fill.pending > 0) { cat.locked = true; cat.lockReason = `판정 재계산 중 ${fill.pending}건 — 잠시 후 다시 열기`; }
  const names = Object.fromEntries(all.map((x) => [x.id, x.name_kr]));
  // 4-E.2 묶음 "포함 포켓몬 보기" 용 개체 요약 (이름·폼·CP·HP·개체값·레벨·그림자/정화)
  const members = {};
  for (const it of items) members[`scan:${it.id}`] = { name: it.name_kr, form: it.form || "Normal", cp: it.cp, hp: it.hp, atk: it.atk_iv, def: it.def_iv, sta: it.sta_iv, level: it.level, is_shadow: Boolean(it.is_shadow), is_purified: Boolean(it.is_purified) };
  for (const r of rows) members[`row:${r.id}`] = { name: r.name_kr, form: r.form || "Normal", cp: r.cp, hp: r.hp, atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv, level: r.level, is_shadow: Boolean(r.is_shadow), is_purified: Boolean(r.is_purified) };
  const gameTagged = all.filter((x) => (x.game_tags || []).length).length;
  const userTags = userTagsOf(all); // 4-F.5 관측된 사용자 고유 태그(앱 관리 태그 밖) — 보호 절·안내
  const userTagged = all.filter((x) => x.verdict?.tier === "transfer" && (x.game_tags || []).some((t) => userTags.includes(t))).length;
  return NextResponse.json({ categories, names, members, population: all.length, scans: items.length, truncated, filled: fill.filled, pending: fill.pending, gameTagged, userTags, userTagged, maxLen, protect: protectSuffix(userTags), note: EXPECTED_LIMIT_NOTE, protectNote: protectNote(userTags), backfill: backfill ? { ran: backfill.ran, superseded: backfill.superseded, conflicts: backfill.conflicts, suspects: backfill.suspects, version: backfill.version } : null, at: new Date().toISOString() });
}

export async function POST(req) {
  const rl = rateLimit(`cleanup:${clientIp(req)}`, { limit: 30, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  if (!["done", "not_seen"].includes(b.action) || !Array.isArray(b.targetIds)) return NextResponse.json({ error: "action=done|not_seen, targetIds[] 필요" }, { status: 400 });
  const scanIds = b.targetIds.filter((x) => typeof x === "string" && x.startsWith("scan:")).map((x) => x.slice(5)).slice(0, 300);
  const rowIds = b.targetIds.filter((x) => typeof x === "string" && x.startsWith("row:")).map((x) => x.slice(4)).slice(0, 300);
  let dismissed = 0, deleted = 0;
  // 4-F.5 B: 게임 결과 0마리 → "이미 없음": 스캔 기록을 dismissed_reason 'not_seen' 으로 숨김(복구 가능). 내 목록 행은 건드리지 않는다
  if (b.action === "not_seen") {
    if (scanIds.length) { const { error } = await sb.from("scan_items").update({ dismissed: true, dismissed_reason: NOT_SEEN_REASON }).eq("user_id", user.userId).in("id", scanIds); if (error) return NextResponse.json({ error: error.message }, { status: 500 }); dismissed = scanIds.length; }
    invalidateReserveCache(user.userId);
    console.log(`[cleanup] not_seen ${user.userId} scan ${dismissed}`);
    return NextResponse.json({ ok: true, dismissed, rows: rowIds.length });
  }
  if (scanIds.length) { const { error } = await sb.from("scan_items").update({ dismissed: true }).eq("user_id", user.userId).in("id", scanIds); if (error) return NextResponse.json({ error: error.message }, { status: 500 }); dismissed = scanIds.length; }
  if (rowIds.length && b.deleteRows) { const { error } = await sb.from("my_pokemon").delete().eq("user_id", user.userId).in("id", rowIds); if (error) return NextResponse.json({ error: error.message }, { status: 500 }); deleted = rowIds.length; }
  invalidateReserveCache(user.userId);
  console.log(`[cleanup] done ${user.userId} scan ${dismissed} rows ${deleted} (targets ${b.targetIds.length})`); // 4-F.5 B 보냄 기록 추적용 로그
  return NextResponse.json({ ok: true, dismissed, deleted });
}
