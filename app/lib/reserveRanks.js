// 4-F 초보자 기준 판정 — "내 보관함" 안의 상대 순위 (레이드 예비·리그 예비·종 대표). 보관함 "여유"·"보통"에만 적용(종 대표는 "여유"만), "빠듯"은 현행.
//  - 레이드 예비: 타입마다 보관함(활성 스캔 기록 + 내 목록) 안에서 개체 레이드 점수 상위 N(=RULES.RESERVE_RAID_TOP_N) 마리(공격 IV ≥ RAID_MIN_ATK_IV).
//    개체 점수 = 그 타입 종 점수(L40·15/15/15 기준, speciesRankings) × (공격 종족값+공격 IV)×CPM(레벨) / ((종족값+15)×CPM(40)) — 공격·레벨 보정
//    4-F.2 하한: 개체 점수 < 가성비 풀 그 타입 1위 점수 × RESERVE_RAID_MIN_PCT% 이면 제외
//  - 리그 예비: 종 PvPoke 순위와 무관하게, 리그 상한 도달 가능(L50 이하에서 CP ≥ 상한×0.97) AND 스탯곱 순위 ≤ LEAGUE_RESERVE_PRODUCT_RANK 이면
//    종·리그별 최상위 1마리(스탯곱 순위 최소)만.
//  - 4-F.2 종 대표: 같은 종·폼(섀도·정화·지역 폼 각각 별개)에서 개체값 합 최고 1마리(동률이면 CP 높은 쪽). 귀한 계열(3단 진화·최종 사탕 100, 사탕 400)은 사유에 표기
// 키: 개체 id("scan:<id>" / "row:<id>") 우선, 없으면 서명(종:폼:섀도:개체값:레벨). 결과는 ctx.reserve 로 computeVerdict 에 전달
import { TYPES } from "./typeChart.js";
import { cpmForLevel, estimateLevel } from "./cpm.js";
import { findPokemon } from "./pokemonData.js";
import { RULES } from "./verdictRules.js";
import { getRankings, raidRankOf, familyIds } from "./speciesRankings.js";
import { leagueProductTable } from "./verdict.js";

export const sigOf = (speciesId, form, shadow, ivs, level) => `sig:${speciesId}:${form || "Normal"}:${shadow ? 1 : 0}:${ivs.atk}/${ivs.def}/${ivs.sta}:${level ?? ""}`;
export const speciesKeyOf = (p, shadow, purified) => `${p.id}:${p.form}:${shadow ? 1 : 0}:${purified ? 1 : 0}`;

function entryOf(kind, r, dataset) {
  if (!Number.isInteger(r.atk_iv) || !Number.isInteger(r.def_iv) || !Number.isInteger(r.sta_iv)) return null;
  const p = findPokemon(dataset, { id: r.species_id, form: r.form || "Normal" });
  if (!p) return null;
  const ivs = { atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv };
  let level = r.level != null ? Number(r.level) : null;
  if (level == null && r.cp) level = estimateLevel(r.cp, { atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }, ivs).level || null;
  return { key: `${kind}:${r.id}`, sig: sigOf(p.id, p.form, Boolean(r.is_shadow), ivs, level), p, ivs, level, cp: r.cp ?? null, shadow: Boolean(r.is_shadow), purified: Boolean(r.is_purified) };
}

// 4-F.2 귀한 계열 판정: 계열(앞뒤 전체)의 진화 단계가 3단이면서 어떤 진화 단계 사탕이 RARE_FAMILY_FINAL_CANDY(100) 이거나, 사탕 ≥ RARE_FAMILY_CANDY(400) 진화가 있는 계열
const rareMemo = new WeakMap();
export function rareFamilyNote(dataset, p, rules = RULES) {
  let m = rareMemo.get(dataset); if (!m) { m = new Map(); rareMemo.set(dataset, m); }
  const k = `${p.id}:${p.form}`;
  if (m.has(k)) return m.get(k);
  const ids = familyIds(dataset, p);
  const members = [...ids].map((id) => findPokemon(dataset, { id })).filter(Boolean);
  const evos = members.flatMap((x) => (x.evolutions || []).map((e) => e.candies || 0));
  // 단계 수: 부모가 없는 뿌리에서 잎까지 가장 긴 경로
  const byId = new Map(members.map((x) => [x.id, x]));
  const parents = new Set(members.flatMap((x) => (x.evolutions || []).map((e) => e.id)));
  const roots = members.filter((x) => !parents.has(x.id));
  const depth = (x, d = 1, seen = new Set()) => { if (seen.has(x.id) || d > 5) return d; seen.add(x.id); const kids = (x.evolutions || []).map((e) => byId.get(e.id)).filter(Boolean); return kids.length ? Math.max(...kids.map((c) => depth(c, d + 1, seen))) : d; };
  const stages = roots.length ? Math.max(...roots.map((r) => depth(r))) : 1;
  let note = null;
  if (evos.some((c) => c >= rules.RARE_FAMILY_CANDY)) note = `사탕 ${rules.RARE_FAMILY_CANDY} 계열`;
  else if (stages >= 3 && evos.some((c) => c === rules.RARE_FAMILY_FINAL_CANDY)) note = `3단 진화·사탕 ${rules.RARE_FAMILY_FINAL_CANDY} 계열`;
  m.set(k, note);
  return note;
}

// 반환 { raid: { [type]: Map<key|sig, rank> }, league: { great|ultra: Map<speciesKey, { key, sig, productRank }> }, rep: Map<speciesKey, { key, sig, ivs, cp, ivSum }>, size }
export function buildReserveRanks(dataset, rows = [], scans = [], { rules = RULES, maxLeagueLevel = RULES.LEAGUE_MAX_LEVEL } = {}) {
  const rankings = getRankings(dataset);
  const entries = [...scans.map((r) => entryOf("scan", r, dataset)), ...rows.map((r) => entryOf("row", r, dataset))].filter(Boolean);
  const topN = rules.RESERVE_RAID_TOP_N, minAtk = rules.RAID_MIN_ATK_IV, reserveRank = rules.LEAGUE_RESERVE_PRODUCT_RANK, reachPct = rules.LEAGUE_CAP_REACH_PCT, minPct = rules.RESERVE_RAID_MIN_PCT ?? 0;
  const cpm40 = cpmForLevel(RULES.RAID_MEMBER_LEVEL);
  const raid = {};
  for (const t of TYPES) {
    const scored = [];
    const budgetTop = rankings.raid[t]?.budget?.[0]?.score || 0;
    for (const e of entries) {
      if (e.ivs.atk < minAtk) continue;
      const sp = raidRankOf(rankings, t, e.p.id, e.p.form, e.shadow);
      if (!sp) continue;
      const lv = e.level || RULES.RAID_MEMBER_LEVEL;
      const score = sp.score * ((e.p.baseAttack + e.ivs.atk) * cpmForLevel(lv)) / ((e.p.baseAttack + 15) * cpm40);
      if (budgetTop && score < budgetTop * minPct / 100) continue; // 4-F.2 하한
      scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const m = new Map();
    scored.slice(0, topN).forEach((x, i) => { m.set(x.e.key, i + 1); if (!m.has(x.e.sig)) m.set(x.e.sig, i + 1); });
    raid[t] = m;
  }
  const league = {};
  for (const lg of ["great", "ultra"]) {
    const cap = RULES.LEAGUE_CAPS[lg];
    const best = new Map(); // speciesKey → { key, sig, productRank }
    for (const e of entries) {
      const table = leagueProductTable(e.p, cap, maxLeagueLevel);
      const me = table.rank.get(`${e.ivs.atk},${e.ivs.def},${e.ivs.sta}`);
      if (!me || me.level == null) continue;
      const capReached = me.level < RULES.LEAGUE_MAX_LEVEL && me.cp >= cap * reachPct;
      if (!capReached || me.rank > reserveRank) continue;
      const sk = `${e.p.id}:${e.p.form}:${e.shadow ? 1 : 0}`;
      const cur = best.get(sk);
      if (!cur || me.rank < cur.productRank) best.set(sk, { key: e.key, sig: e.sig, productRank: me.rank });
    }
    league[lg] = best;
  }
  // 4-F.2 종 대표: 종·폼·섀도·정화별 개체값 합 최고(동률 CP 높은 쪽, 그다음 먼저 온 것)
  const rep = new Map();
  for (const e of entries) {
    const sk = speciesKeyOf(e.p, e.shadow, e.purified);
    const ivSum = e.ivs.atk + e.ivs.def + e.ivs.sta;
    const cur = rep.get(sk);
    if (!cur || ivSum > cur.ivSum || (ivSum === cur.ivSum && (e.cp || 0) > (cur.cp || 0))) rep.set(sk, { key: e.key, sig: e.sig, ivs: e.ivs, cp: e.cp, ivSum });
  }
  return { raid, league, rep, size: entries.length };
}

const keysOf = (input) => [input.reserveKey, input.id != null ? `scan:${input.id}` : null, input.id != null ? `row:${input.id}` : null].filter(Boolean);
// computeVerdict 입력의 키·서명 (id 는 "scan:"/"row:" 접두사 없이 올 수 있어 둘 다 시도)
export function reserveRaidRank(reserve, type, input, p, cand) {
  const m = reserve?.raid?.[type]; if (!m) return null;
  for (const k of keysOf(input)) if (m.has(k)) return m.get(k);
  const sig = sigOf(p.id, p.form, Boolean(input.is_shadow), cand, cand.level);
  return m.has(sig) ? m.get(sig) : null;
}
export function reserveLeagueBest(reserve, league, input, p, cand) {
  const m = reserve?.league?.[league]; if (!m) return null;
  const b = m.get(`${p.id}:${p.form}:${input.is_shadow ? 1 : 0}`); if (!b) return null;
  const sig = sigOf(p.id, p.form, Boolean(input.is_shadow), cand, cand.level);
  return keysOf(input).includes(b.key) || b.sig === sig ? b : { ...b, other: true };
}
// 4-F.2 종 대표: 이 개체가 대표면 { ...rep }, 다른 개체가 대표면 { ...rep, other: true }, 정보 없으면 null
export function reserveRepresentative(reserve, input, p, cand) {
  const m = reserve?.rep; if (!m) return null;
  const b = m.get(speciesKeyOf(p, Boolean(input.is_shadow), Boolean(input.is_purified))); if (!b) return null;
  const sig = cand ? sigOf(p.id, p.form, Boolean(input.is_shadow), cand, cand.level) : null;
  return keysOf(input).includes(b.key) || (sig && b.sig === sig) ? b : { ...b, other: true };
}
