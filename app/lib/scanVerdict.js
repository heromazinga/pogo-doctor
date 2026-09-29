// 스캔 항목 → 4-A 판정 요약 (서버 전용). /api/device/scan 의 after() 와 /api/scan·/api/cleanup 조회 시 비어 있거나 낡은 항목 채우기에 공용
import { computeVerdict } from "./verdict.js";
import { RULES_VERSION } from "./verdictRules.js";

export function verdictForItem(it, ctx, ivCandidates) {
  const anyIv = Number.isInteger(it.atk_iv);
  try {
    const v = computeVerdict({ species_id: it.species_id, form: it.form || "Normal", cp: it.cp, hp: it.hp, level: it.level != null ? Number(it.level) : null,
      ivs: anyIv ? { atk: it.atk_iv, def: it.def_iv, sta: it.sta_iv } : null, ivCandidates,
      is_shadow: Boolean(it.is_shadow), caught_on: it.caught_on, storageMode: ctx.storageMode }, ctx);
    // 4-C: 태그별 추천 기술(moves)·진화 대기의 이벤트 힌트도 저장 (웹 스캔 기록 표시)
    return { tier: v.tier, summary: v.summary, recommendedTags: v.recommendedTags, purposes: v.purposes, collect: v.collect, event: v.event?.note || null, confident: v.confident, dynamax: Boolean(v.dynamax),
      tags: v.tags.map((t) => ({ name: t.name, tier: t.tier, reason: t.reason, moves: t.moves || null, evolveAtEvent: t.evolveAtEvent || null })), recommendedMoves: v.recommendedMoves || {}, rulesVersion: RULES_VERSION, at: new Date().toISOString() };
  } catch (e) { return { tier: "need_appraisal", summary: `판정 실패: ${e.message}`, recommendedTags: [], purposes: [], error: true }; }
}

// 4-B6.2: 저장된 판정이 없거나, 실패했거나, 규칙 버전(RULES_VERSION)이 다르면 다시 계산해야 한다
export function isStaleVerdict(v) { return !v || Boolean(v.error) || v.rulesVersion !== RULES_VERSION; }

// verdict 가 비어 있거나 낡은 항목을 한 번의 컨텍스트로 다시 계산하고 저장 (웹·정리 도우미 조회 시).
// 4-D2: 청크(limit)·시간 예산(budgetMs) 안에서만 처리하고 나머지는 pending 으로 돌려준다(첫 /api/scan 27.6s → 함수 시간 제한 위험). 남은 건 다음 조회가 이어서 처리
// 반환 { filled, pending, stale }
export const FILL_CHUNK = 100;
export const FILL_BUDGET_MS = 15000;
export async function fillMissingVerdicts(sb, items, ctx, { limit = FILL_CHUNK, budgetMs = FILL_BUDGET_MS } = {}) {
  const stale = items.filter((it) => isStaleVerdict(it.verdict));
  const started = Date.now();
  let filled = 0;
  for (const it of stale) {
    if (filled >= limit || Date.now() - started > budgetMs) break;
    it.verdict = verdictForItem(it, ctx);
    filled++;
    if (!it.verdict.error) await sb.from("scan_items").update({ verdict: it.verdict }).eq("id", it.id);
  }
  return { filled, pending: stale.length - filled, stale: stale.length };
}
