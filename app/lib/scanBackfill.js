// 4-C.2 스캔 기록 superseded 백필 (멱등, 규칙 버전당 사용자별 1회: user_settings.scan_backfill_version)
//   실DB 검증에서 기존 중복 6쌍이 남아 있었다(insert 시점에만 대체 처리했기 때문). 과거 기록끼리도 규칙 ③ 으로 대체한다.
//   규칙: 같은 계열·폼·섀도·개체값(확정) 묶음 안에서
//     ① CP 검증(cp 가 개체값·HP 와 맞음)된 기록 > CP 없음/불일치 기록  — 같은 개체(같은 HP 또는 같은 세션)면 검증된 쪽을 남긴다
//     ② 둘 다 검증됐으면 규칙 ③(레벨/CP 비감소·포획일 호환) → 최신 기록을 남긴다. 서로 다른 후보 2개 이상이면 건드리지 않는다
import { RULES_VERSION } from "./verdictRules.js";
import { findPokemon } from "./pokemonData.js";
import { familyOfFactory, notDowngraded } from "./pokemonMatch.js";
import { cpConsistentLevel } from "./ivCalc.js";
import { loadUserSettings, saveBackfillVersion } from "./userSettings.js";

const hasIv = (r) => [r.atk_iv, r.def_iv, r.sta_iv].every((v) => Number.isInteger(v));
const caughtOk = (a, b) => !a.caught_on || !b.caught_on || a.caught_on === b.caught_on;

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
    const k = `${rootOf(r.species_id)}|${r.form || "Normal"}|${r.is_shadow ? 1 : 0}|${r.atk_iv},${r.def_iv},${r.sta_iv}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const alive = new Set(list.map((r) => r.id));
    const byTime = [...list].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const ver = new Map(list.map((r) => [r.id, verified(r)]));
    // ① 미검증(CP 없음·불일치) 기록: 같은 HP 또는 같은 세션의 검증된 기록이 있으면 그쪽으로 대체
    for (const r of byTime) {
      if (ver.get(r.id)) continue;
      const winner = byTime.filter((o) => o.id !== r.id && alive.has(o.id) && ver.get(o.id) && caughtOk(o, r) && ((r.hp != null && o.hp === r.hp) || o.session_id === r.session_id)).pop();
      if (winner) { out.push({ id: r.id, superseded_by: winner.id }); alive.delete(r.id); }
    }
    // ② 검증된 기록끼리: 시간순으로 규칙 ③ 재생 (새 기록이 이전 기록을 대체). 서로 다른 이전 후보가 2개 이상이면 건드리지 않음
    for (let i = 0; i < byTime.length; i++) {
      const cur = byTime[i];
      if (!alive.has(cur.id) || !ver.get(cur.id)) continue;
      const prior = byTime.slice(0, i).filter((o) => alive.has(o.id) && ver.get(o.id) && caughtOk(o, cur) && notDowngraded(o, cur) === true);
      const distinct = new Set(prior.map((o) => `${o.species_id}|${o.cp ?? ""}|${o.hp ?? ""}|${o.level ?? ""}`));
      if (!prior.length || distinct.size > 1) continue;
      for (const o of prior) { out.push({ id: o.id, superseded_by: cur.id }); alive.delete(o.id); }
    }
  }
  return out;
}

// 조회 경로에서 호출: 버전 플래그가 현재와 다르면 1회 실행하고 저장. 반환 { ran, superseded, version, changed, items(남은 활성 기록) }
export async function backfillSuperseded(sb, userId, items, ctx) {
  const version = RULES_VERSION;
  const settings = ctx?.settings !== undefined ? ctx.settings : await loadUserSettings(sb, userId);
  if (settings?.scan_backfill_version === version) return { ran: false, superseded: 0, version, changed: false, items };
  const plan = planSupersede(items, ctx.dataset);
  let n = 0;
  for (const p of plan) {
    const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
    if (!error) n++; else console.warn(`[backfill] ${p.id}: ${error.message}`);
  }
  const saved = await saveBackfillVersion(sb, userId, version);
  const gone = new Set(plan.map((p) => p.id));
  console.log(`[backfill] ${userId} superseded ${n}/${plan.length} (version ${version}, flag ${saved ? "saved" : "not saved"})`);
  return { ran: true, superseded: n, version, changed: n > 0, items: items.filter((it) => !gone.has(it.id)) };
}
