// 4-C.2/4-C.3 스캔 기록 백필 (멱등, 규칙 버전당 사용자별 1회: user_settings.scan_backfill_version)
//   실DB 검증에서 기존 중복이 남아 있었다(insert 시점에만 대체 처리했기 때문). 과거 기록끼리도 정리한다.
//   대체(superseded) 규칙 — 같은 계열·폼·섀도·개체값(확정) 묶음 안에서:
//     ⓪ 종·CP·HP 까지 모두 같은 기록(재기록) → 오래된 쪽 대체 (뚜벅쵸 9/4/4 사례, CP 검증 불필요)
//     ① CP 가 없는 기록: 같은 종·HP 또는 같은 세션에 CP 있는 기록이 있으면 그쪽으로 대체 (리자몽·썬더·번치코 사례, 레벨 없어도)
//     ② CP 가 개체값·HP 와 맞지 않는 기록: 같은 HP·세션의 검증된 기록으로 대체 (괴력몬 2634 vs 263 사례)
//     ③ 검증된 기록끼리 시간순으로 규칙 ③(레벨/CP 비감소·포획일 호환) 재생 → 최신 유지. 서로 다른 과거 후보 2개 이상이면 건드리지 않는다
//   재확인(recheck) 규칙 — 같은 종·폼·섀도·CP·HP 인데 개체값이 다른 활성 기록(막대 오판독 의심): 둘 다 recheck + "재스캔 필요" (박사행·태그 묶음 제외)
import { RULES_VERSION } from "./verdictRules.js";
import { findPokemon } from "./pokemonData.js";
import { familyOfFactory, notDowngraded } from "./pokemonMatch.js";
import { cpConsistentLevel } from "./ivCalc.js";
import { loadUserSettings, saveBackfillVersion } from "./userSettings.js";
import { isTrustedVersion } from "./appVersion.js";

export const CONFLICT_REASON = "같은 CP·HP 다른 개체값 — 재스캔 필요";
// 4-C.4 과거 기록 의심 휴리스틱(앱 v0.1.30 이하: 라벨행 값 채택 경로가 방어·HP 를 약 절반으로 기록): 방어·HP 둘 다 ≤8 이고 공격 ≥ 방어+5
export const SUSPECT_REASON = "막대 오판독 의심(방어·HP ≤8, 공격 ≥ 방어+5) — 재스캔 필요";
export function isSuspectBars(r) { return hasIv(r) && r.def_iv <= 8 && r.sta_iv <= 8 && r.atk_iv >= r.def_iv + 5; }
// 4-D: 신뢰 기록(앱 ≥0.1.38)은 휴리스틱 대상에서 제외(라벨행 채택 경로가 없음)
export function planSuspects(items) { return items.filter((r) => !r.recheck && !isTrustedVersion(r.app_version) && isSuspectBars(r)).map((r) => r.id); }
const hasIv = (r) => [r.atk_iv, r.def_iv, r.sta_iv].every((v) => Number.isInteger(v));
const caughtOk = (a, b) => !a.caught_on || !b.caught_on || a.caught_on === b.caught_on;
const ivKey = (r) => `${r.atk_iv},${r.def_iv},${r.sta_iv}`;

// 순수 계산: items(활성 스캔 기록) → [{ id, superseded_by }] (대체될 기록). dataset 으로 CP 검증·계열 판단
export function planSupersede(items, dataset) {
  const familyOf = familyOfFactory(dataset?.pokemon || []);
  const rootOf = (id) => Math.min(...familyOf(id));
  const verified = (r) => {
    if (r.cp == null || !hasIv(r)) return false;
    const p = findPokemon(dataset, { id: r.species_id, form: r.form || "Normal" });
    if (!p) return true; // 데이터셋에 없으면 검증 불가 → 있는 값을 믿는다
    return cpConsistentLevel({ atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }, r.cp, r.hp, { atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv }) != null;
  };
  const groups = new Map();
  for (const r of items) {
    if (!hasIv(r)) continue;
    const k = `${rootOf(r.species_id)}|${r.form || "Normal"}|${r.is_shadow ? 1 : 0}|${ivKey(r)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const alive = new Set(list.map((r) => r.id));
    const byTime = [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const ver = new Map(list.map((r) => [r.id, verified(r)]));
    const drop = (r, winner) => { out.push({ id: r.id, superseded_by: winner.id }); alive.delete(r.id); };
    // ⓪ 종·CP·HP 모두 같은 재기록 → 최신만 남김 (검증 불필요)
    for (let i = 0; i < byTime.length; i++) {
      const r = byTime[i];
      if (!alive.has(r.id) || r.cp == null) continue;
      const later = byTime.slice(i + 1).filter((o) => alive.has(o.id) && o.species_id === r.species_id && o.cp === r.cp && o.hp === r.hp && caughtOk(o, r));
      if (later.length) drop(r, later[later.length - 1]);
    }
    // ① CP 없는 기록 → 같은 종·HP 또는 같은 세션의 CP 있는 기록(최신)으로 대체 (레벨·검증 여부 무관)
    for (const r of byTime) {
      if (!alive.has(r.id) || r.cp != null) continue;
      const winner = byTime.filter((o) => o.id !== r.id && alive.has(o.id) && o.cp != null && caughtOk(o, r) && ((r.hp != null && o.species_id === r.species_id && o.hp === r.hp) || o.session_id === r.session_id)).pop();
      if (winner) drop(r, winner);
    }
    // ② CP 불일치(미검증) 기록 → 같은 HP 또는 같은 세션의 검증된 기록으로 대체
    for (const r of byTime) {
      if (!alive.has(r.id) || r.cp == null || ver.get(r.id)) continue;
      const winner = byTime.filter((o) => o.id !== r.id && alive.has(o.id) && ver.get(o.id) && caughtOk(o, r) && ((r.hp != null && o.hp === r.hp) || o.session_id === r.session_id)).pop();
      if (winner) drop(r, winner);
    }
    // ②' (4-D) 신뢰 기록(앱 ≥0.1.38)이 있으면 같은 개체값의 미신뢰(구 앱) 이전 기록은 레벨·검증과 무관하게 최신 신뢰 기록으로 대체
    const trustedLatest = byTime.filter((o) => alive.has(o.id) && isTrustedVersion(o.app_version)).pop();
    if (trustedLatest) for (const r of byTime) if (alive.has(r.id) && r.id !== trustedLatest.id && !isTrustedVersion(r.app_version) && caughtOk(r, trustedLatest)) drop(r, trustedLatest);
    // ③ 검증된 기록끼리: 시간순으로 규칙 ③ 재생 (새 기록이 이전 기록을 대체). 서로 다른 이전 후보가 2개 이상이면 건드리지 않음
    for (let i = 0; i < byTime.length; i++) {
      const cur = byTime[i];
      if (!alive.has(cur.id) || !ver.get(cur.id)) continue;
      const prior = byTime.slice(0, i).filter((o) => alive.has(o.id) && ver.get(o.id) && caughtOk(o, cur) && notDowngraded(o, cur) === true);
      const distinct = new Set(prior.map((o) => `${o.species_id}|${o.cp ?? ""}|${o.hp ?? ""}|${o.level ?? ""}`));
      if (!prior.length || distinct.size > 1) continue;
      for (const o of prior) drop(o, cur);
    }
  }
  return out;
}

// 순수 계산: 같은 종·폼·섀도·CP·HP 인데 개체값이 다른 활성 기록 → { recheck: [id], supersede: [{id, superseded_by}] }
//   4-D: 그중 신뢰 기록(앱 ≥0.1.38)이 있으면 미신뢰 기록은 최신 신뢰 기록으로 대체하고, 남은 신뢰 기록끼리 개체값이 갈릴 때만 recheck
export function planConflicts(items) {
  const groups = new Map();
  for (const r of items) {
    if (!hasIv(r) || r.cp == null || r.hp == null) continue;
    const k = `${r.species_id}|${r.form || "Normal"}|${r.is_shadow ? 1 : 0}|${r.cp}|${r.hp}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const recheck = [], supersede = [];
  for (const list of groups.values()) {
    if (new Set(list.map(ivKey)).size < 2) continue;
    const trusted = list.filter((r) => isTrustedVersion(r.app_version)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const winner = trusted[trusted.length - 1];
    const rest = winner ? list.filter((r) => !isTrustedVersion(r.app_version)) : [];
    for (const r of rest) supersede.push({ id: r.id, superseded_by: winner.id });
    const remain = winner ? trusted : list;
    if (new Set(remain.map(ivKey)).size >= 2) for (const r of remain) recheck.push(r.id);
  }
  return { recheck, supersede };
}

// 조회 경로에서 호출: 버전 플래그가 현재와 다르면 1회 실행하고 저장. 반환 { ran, superseded, conflicts, version, changed, items(남은 활성 기록) }
export async function backfillSuperseded(sb, userId, items, ctx) {
  const version = RULES_VERSION;
  const settings = ctx?.settings !== undefined ? ctx.settings : await loadUserSettings(sb, userId);
  if (settings?.scan_backfill_version === version) return { ran: false, superseded: 0, conflicts: 0, suspects: 0, version, changed: false, items };
  const plan = planSupersede(items, ctx.dataset);
  let n = 0;
  for (const p of plan) {
    const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
    if (!error) n++; else console.warn(`[backfill] ${p.id}: ${error.message}`);
  }
  let gone = new Set(plan.map((p) => p.id));
  let remaining = items.filter((it) => !gone.has(it.id));
  const cplan = planConflicts(remaining);
  for (const p of cplan.supersede) {
    const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
    if (!error) { n++; gone.add(p.id); } else console.warn(`[backfill] conflict-supersede ${p.id}: ${error.message}`);
  }
  remaining = remaining.filter((it) => !gone.has(it.id));
  const conflicts = cplan.recheck.filter((id) => { const it = remaining.find((x) => x.id === id); return it && !(it.recheck && it.recheck_reason === CONFLICT_REASON); });
  let c = 0;
  for (const id of conflicts) {
    const { error } = await sb.from("scan_items").update({ recheck: true, recheck_reason: CONFLICT_REASON }).eq("user_id", userId).eq("id", id);
    if (!error) { c++; const it = remaining.find((x) => x.id === id); if (it) { it.recheck = true; it.recheck_reason = CONFLICT_REASON; } }
    else console.warn(`[backfill] recheck ${id}: ${error.message}`);
  }
  // 4-C.4 과거 기록 의심(휴리스틱) → recheck (박사행·태그 묶음 제외, population 에는 남김). 사용자 재스캔으로 해소
  let s = 0;
  for (const id of planSuspects(remaining)) {
    const { error } = await sb.from("scan_items").update({ recheck: true, recheck_reason: SUSPECT_REASON }).eq("user_id", userId).eq("id", id);
    if (!error) { s++; const it = remaining.find((x) => x.id === id); if (it) { it.recheck = true; it.recheck_reason = SUSPECT_REASON; } }
    else console.warn(`[backfill] suspect ${id}: ${error.message}`);
  }
  const saved = await saveBackfillVersion(sb, userId, version);
  console.log(`[backfill] ${userId} superseded ${n}/${plan.length}, conflicts ${c}, suspects ${s} (version ${version}, flag ${saved ? "saved" : "not saved"})`);
  return { ran: true, superseded: n, conflicts: c, suspects: s, version, changed: n > 0 || c > 0 || s > 0, items: remaining };
}
