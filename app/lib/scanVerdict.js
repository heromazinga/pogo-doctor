// 스캔 항목 → 4-A 판정 요약 (서버 전용). /api/device/scan 의 after() 와 /api/scan 조회 시 비어 있는 항목 채우기에 공용
import { computeVerdict } from "./verdict.js";

export function verdictForItem(it, ctx, ivCandidates) {
  const anyIv = Number.isInteger(it.atk_iv);
  try {
    const v = computeVerdict({ species_id: it.species_id, form: it.form || "Normal", cp: it.cp, hp: it.hp, level: it.level != null ? Number(it.level) : null,
      ivs: anyIv ? { atk: it.atk_iv, def: it.def_iv, sta: it.sta_iv } : null, ivCandidates,
      is_shadow: Boolean(it.is_shadow), caught_on: it.caught_on, storageMode: ctx.storageMode }, ctx);
    return { tier: v.tier, summary: v.summary, recommendedTags: v.recommendedTags, purposes: v.purposes, collect: v.collect, event: v.event?.note || null, confident: v.confident, tags: v.tags.map((t) => ({ name: t.name, tier: t.tier, reason: t.reason })), at: new Date().toISOString() };
  } catch (e) { return { tier: "need_appraisal", summary: `판정 실패: ${e.message}`, recommendedTags: [], purposes: [], error: true }; }
}

// verdict 가 비어 있는 항목을 한 번의 컨텍스트로 채우고 저장 (웹 조회 시)
export async function fillMissingVerdicts(sb, items, ctx) {
  const missing = items.filter((it) => !it.verdict || it.verdict.error);
  for (const it of missing) {
    it.verdict = verdictForItem(it, ctx);
    if (!it.verdict.error) await sb.from("scan_items").update({ verdict: it.verdict }).eq("id", it.id);
  }
  return missing.length;
}
