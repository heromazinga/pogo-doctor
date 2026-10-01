// 4-C.2/4-C.3 스캔 기록 백필 (멱등, 규칙 버전당 사용자별 1회: user_settings.scan_backfill_version)
//   실DB 검증에서 기존 중복이 남아 있었다(insert 시점에만 대체 처리했기 때문). 과거 기록끼리도 정리한다.
//   대체(superseded) 규칙 — 같은 계열·폼·그림자·개체값(확정) 묶음 안에서:
//     ⓪ 종·CP·HP 까지 모두 같은 기록(재기록) → 오래된 쪽 대체 (뚜벅쵸 9/4/4 사례, CP 검증 불필요)
//     ① CP 가 없는 기록: 같은 종·HP 또는 같은 세션에 CP 있는 기록이 있으면 그쪽으로 대체 (리자몽·썬더·번치코 사례, 레벨 없어도)
//     ② CP 가 개체값·HP 와 맞지 않는 기록: 같은 HP·세션의 검증된 기록으로 대체 (괴력몬 2634 vs 263 사례)
//     ③ 검증된 기록끼리 시간순으로 규칙 ③(레벨/CP 비감소·포획일 호환) 재생 → 최신 유지. 서로 다른 과거 후보 2개 이상이면 건드리지 않는다
//   재확인(recheck) 규칙 — 같은 종·폼·그림자·CP·HP 인데 개체값이 다른 활성 기록(막대 오판독 의심): 둘 다 recheck + "재스캔 필요" (박사행·태그 묶음 제외)
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

// 4-D2 순수 계산: 스캔 모드(그림자/정화) 신뢰 기록이 같은 종·폼·CP·HP·개체값의 "일반 모드" 기록과 만나면 일반 기록을 대체(모드 기록이 정확한 속성).
//   반대 방향(일반이 그림자를 대체)은 하지 않는다. 실측: 그림자 모드 37건이 전날 일반 기록과 둘 다 활성 → population 508(실제 470)
//   4-D3: 한쪽 CP 가 null 이면 종·폼·HP·개체값 일치만으로 모드 기록이 우선 (실DB: CP 없는 그림자 기록 2건이 일반 기록과 중복으로 남음)
export function planModeSupersede(items) {
  const groups = new Map();
  for (const r of items) {
    if (!hasIv(r) || r.hp == null) continue;
    const k = `${r.species_id}|${r.form || "Normal"}|${r.hp}|${ivKey(r)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const list of groups.values()) {
    // 4-F.6 D: "보호" 모드 기록(is_protected)도 모드 기록으로 — 같은 개체의 일반 기록을 대체
    const modes = list.filter((r) => (r.is_shadow || r.is_purified || r.is_protected) && isTrustedVersion(r.app_version)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (!modes.length) continue;
    for (const r of list) {
      if (r.is_shadow || r.is_purified || r.is_protected) continue;
      const cand = modes.filter((m) => m.cp == null || r.cp == null || m.cp === r.cp);
      if (cand.length) out.push({ id: r.id, superseded_by: cand[cand.length - 1].id });
    }
  }
  return out;
}

// 순수 계산: 같은 종·폼·그림자·CP·HP 인데 개체값이 다른 활성 기록 → { recheck: [id], supersede: [{id, superseded_by}] }
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
  // 4-D2 모드 기록(그림자/정화)이 같은 종·CP·HP·개체값의 일반 기록을 대체
  for (const p of planModeSupersede(remaining)) {
    const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
    if (!error) { n++; gone.add(p.id); } else console.warn(`[backfill] mode-supersede ${p.id}: ${error.message}`);
  }
  remaining = remaining.filter((it) => !gone.has(it.id));
  // 4-F.4 F: 최근 전체 동기화 세션과 일치하는 이전 기록 대체(일회성 정리도 여기서). 실DB: 0.1.38 세션 25건이 동기화 후에도 활성으로 남음
  try {
    const sync = await latestFullSyncSession(sb, userId);
    for (const p of planSyncSupersede(remaining, sync)) {
      const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
      if (!error) { n++; gone.add(p.id); } else console.warn(`[backfill] sync-supersede ${p.id}: ${error.message}`);
    }
    remaining = remaining.filter((it) => !gone.has(it.id));
  } catch (e) { console.warn(`[backfill] sync-supersede 건너뜀: ${e.message}`); }
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

// 4-F.2 전체 동기화: 검색어 없이 보관함 전체를 넘긴 세션(metrics.fullSync, ended_at 있음)이 끝나면, 그 세션에서 다시 보이지 않은
//   이전 활성 기록(다른 세션, 세션 종료 전 기록)을 숨김 후보로. 순수 계산 → [id]. (같은 개체가 이번 세션에서 다시 기록되면 그 기록은 남고 옛 기록만 숨는다)
export const NOT_SEEN_REASON = "not_seen";
export function planNotSeen(items, session) {
  if (!session || !session.session_id || !session.ended_at || !session.metrics?.fullSync) return [];
  const end = new Date(session.ended_at).getTime();
  if (!Number.isFinite(end)) return [];
  return items.filter((it) => it.session_id !== session.session_id && !it.dismissed && !it.superseded && new Date(it.created_at).getTime() < end).map((it) => it.id);
}

// 4-F.4 F 전체 동기화 대체: 전체 동기화 세션(metrics.fullSync, 종료됨)의 기록과 종·폼·그림자·정화·개체값이 같고 CP·HP 가 같거나 한쪽이 없는
//   이전 활성 기록(다른 세션, 세션 종료 전)은 그 세션의 기록(최신)으로 superseded. 앱은 한 세션 안에서 같은 개체(종·CP·HP·개체값)를 한 번만 기록하므로
//   같은 새 기록에 이전 기록 여러 건이 대체될 수 있다. 순수 계산 → [{ id, superseded_by }]
export function planSyncSupersede(items, session) {
  if (!session || !session.session_id || !session.ended_at || !session.metrics?.fullSync) return [];
  const end = new Date(session.ended_at).getTime();
  if (!Number.isFinite(end)) return [];
  const key = (r) => `${r.species_id}|${r.form || "Normal"}|${r.is_shadow ? 1 : 0}|${r.is_purified ? 1 : 0}|${ivKey(r)}`;
  const fresh = new Map();
  for (const r of items) {
    if (r.session_id !== session.session_id || !hasIv(r) || r.dismissed || r.superseded) continue;
    const k = key(r); if (!fresh.has(k)) fresh.set(k, []); fresh.get(k).push(r);
  }
  const out = [];
  for (const r of items) {
    if (r.session_id === session.session_id || !hasIv(r) || r.dismissed || r.superseded) continue;
    if (!(new Date(r.created_at).getTime() < end)) continue;
    const cands = (fresh.get(key(r)) || []).filter((o) => (r.cp == null || o.cp == null || o.cp === r.cp) && (r.hp == null || o.hp == null || o.hp === r.hp))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (cands.length) out.push({ id: r.id, superseded_by: cands[cands.length - 1].id });
  }
  return out;
}
// 최근 전체 동기화 세션(종료됨) 하나
export async function latestFullSyncSession(sb, userId) {
  const { data } = await sb.from("scan_sessions").select("session_id,metrics,ended_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
  return (data || []).find((s) => s.metrics?.fullSync && s.ended_at) || null;
}

// 4-F.5 D: 최근 전체 동기화 세션 기준 대체를 매 조회마다 적용(멱등). 반환 { superseded, items(남은 활성), session }
export async function applySyncSupersede(sb, userId, items) {
  const session = await latestFullSyncSession(sb, userId);
  const plan = planSyncSupersede(items, session);
  let n = 0;
  for (const p of plan) {
    const { error } = await sb.from("scan_items").update({ superseded: true, superseded_by: p.superseded_by }).eq("user_id", userId).eq("id", p.id);
    if (!error) n++; else console.warn(`[sync-supersede] ${p.id}: ${error.message}`);
  }
  if (plan.length) console.log(`[sync-supersede] ${userId} session ${session?.session_id} plan ${plan.length} applied ${n}`);
  const gone = new Set(plan.filter((p) => p).map((p) => p.id));
  return { superseded: n, planned: plan.length, items: n ? items.filter((it) => !gone.has(it.id)) : items, session };
}
// 4-F.5 D 진단: 동기화 세션 이전의 활성 기록마다 왜 대체/숨김 후보가 아닌지 — [{ id, name, ivs, cp, hp, session_id, verdict: "supersede"|"not_seen"|사유 }]
export function diagnoseSync(items, session) {
  if (!session) return { error: "전체 동기화 세션 없음(metrics.fullSync·ended_at 필요)", rows: [] };
  const end = new Date(session.ended_at || "").getTime();
  const key = (r) => `${r.species_id}|${r.form || "Normal"}|${r.is_shadow ? 1 : 0}|${r.is_purified ? 1 : 0}|${ivKey(r)}`;
  const fresh = new Map();
  for (const r of items) if (r.session_id === session.session_id && hasIv(r)) { const k = key(r); if (!fresh.has(k)) fresh.set(k, []); fresh.get(k).push(r); }
  const rows = [];
  for (const r of items) {
    if (r.session_id === session.session_id) continue;
    let why;
    if (!hasIv(r)) why = "개체값 없음";
    else if (!(new Date(r.created_at).getTime() < end)) why = "세션 종료 후 기록";
    else {
      const c = fresh.get(key(r)) || [];
      if (!c.length) why = "not_seen: 새 세션에 같은 종·폼·그림자·정화·개체값 기록 없음";
      else if (!c.some((o) => (r.cp == null || o.cp == null || o.cp === r.cp))) why = `not_seen: CP 불일치(새 ${c.map((o) => o.cp).join("/")} vs ${r.cp})`;
      else if (!c.some((o) => (r.cp == null || o.cp == null || o.cp === r.cp) && (r.hp == null || o.hp == null || o.hp === r.hp))) why = `not_seen: HP 불일치(새 ${c.map((o) => o.hp).join("/")} vs ${r.hp})`;
      else why = "supersede";
    }
    rows.push({ id: r.id, name: r.name_kr, ivs: hasIv(r) ? ivKey(r) : null, cp: r.cp, hp: r.hp, session_id: r.session_id, dismissed: r.dismissed, superseded: r.superseded, why });
  }
  return { session: { session_id: session.session_id, ended_at: session.ended_at, fullSync: Boolean(session.metrics?.fullSync) }, rows };
}

// 4-F.5/4-F.6 C 재스캔 복구(순수 계산): 보냄/없음 처리로 숨긴 기록(dismissed=true, superseded=false) 중 새 스캔과 같은 개체(종·폼·그림자·개체값, CP·HP 같거나 한쪽 없음)는
//   새 기록으로 superseded → 새 기록이 활성으로 남는다(= 복구). "보냄" 상태는 scan_items.dismissed(+dismissed_reason null) 와 my_pokemon 행 삭제로만 저장되며 별도 플래그는 없다
export function planRescanRecovery(hidden, item) {
  return (hidden || []).filter((h) => h.dismissed && !h.superseded && h.species_id === item.species_id && (h.form || "Normal") === (item.form || "Normal") && Boolean(h.is_shadow) === Boolean(item.is_shadow)
    && h.atk_iv === item.atk_iv && h.def_iv === item.def_iv && h.sta_iv === item.sta_iv
    && (item.cp == null || h.cp == null || h.cp === item.cp) && (item.hp == null || h.hp == null || h.hp === item.hp)).map((h) => h.id);
}
