// 4-A 종족 순위 자동 산출 (손목록 금지) — 데이터셋(교차검증) 기준, generatedAt 별 메모
//  - 타입별 레이드 순위: 출시 확인된 종(released !== false), 메가 제외, L40·15/15/15 가정, 그 타입의 빠른+차징 기술만 사용,
//    중립 보스(타입 없음, RULES.RAID_BOSS, L40·15/15/15) 상대 raidScore = DPS^0.775 × TDO^0.225. 섀도(공격 ×1.2, 방어 ×0.833)는 별도 순위,
//    PvPoke gamemaster 의 tags "shadoweligible" 이 있는 종만(데이터셋 shadowEligible). 각 항목 pct = 그 타입 1위 대비 %.
//  - 체육관 방어 순위: 전설·환상·UB 제외, (방어+15)×(HP+15) 내구 순위(L40 기준 상수 배율은 순위에 영향 없음).
//  - 진화 계열: evolutions 를 따라 최종형(잎)까지. 분기 진화는 각각.
import { TYPES } from "./typeChart.js";
import { cpmForLevel } from "./cpm.js";
import { raidScore } from "./teamScore.js";
import { RULES } from "./verdictRules.js";

const SHADOW_ATK = 1.2, SHADOW_DEF = 0.833;
const isMega = (p) => /mega|primal/i.test(p.form || "");
const isReleased = (p) => p.released !== false && p.baseAttack > 0;
export const isLegendaryClass = (p) => ["legendary", "mythic", "ultra_beast"].includes(p.pokemonClass || "");

// 종 → 계산용 멤버 (L40, 15/15/15). 기술 풀은 호출측이 지정
export function memberFor(p, { shadow = false, level = RULES.RAID_MEMBER_LEVEL, ivs = { atk: 15, def: 15, sta: 15 }, fastPool, chargedPool }) {
  const cpm = cpmForLevel(level);
  return {
    id: `${p.id}:${p.form}`, speciesId: p.id, form: p.form, name: p.name, nameKr: p.nameKr, types: p.types || [],
    atk: (p.baseAttack + ivs.atk) * cpm * (shadow ? SHADOW_ATK : 1),
    def: (p.baseDefense + ivs.def) * cpm * (shadow ? SHADOW_DEF : 1),
    hp: Math.floor((p.baseStamina + ivs.sta) * cpm),
    fastPool, chargedPool, shadow,
  };
}

// 종의 검증 기술 전체 (일반+레거시+전용기). unverified 는 제외
export function verifiedMoves(p) {
  return {
    fast: [...(p.fast || []), ...(p.eliteFast || []), ...(p.signatureFast || [])],
    charged: [...(p.charged || []), ...(p.eliteCharged || []), ...(p.signatureCharged || [])],
    special: new Set([...(p.eliteFast || []), ...(p.eliteCharged || []), ...(p.signatureFast || []), ...(p.signatureCharged || [])]),
  };
}

export function raidScoreForType(p, type, moveStats, { shadow = false, fastOnly = null, chargedOnly = null } = {}) {
  const mv = verifiedMoves(p);
  const fastPool = (fastOnly || mv.fast).filter((m) => moveStats[m]?.kind === "fast" && moveStats[m].type === type);
  const chargedPool = (chargedOnly || mv.charged).filter((m) => moveStats[m]?.kind === "charged" && moveStats[m].type === type);
  if (!fastPool.length || !chargedPool.length) return null;
  const boss = { ...RULES.RAID_BOSS, types: [] };
  const sc = raidScore(memberFor(p, { shadow, fastPool, chargedPool }), boss, moveStats);
  return sc ? { ...sc, usesSpecial: mv.special.has(sc.fast) || mv.special.has(sc.charged) } : null;
}

const memo = new Map();
export function getRankings(dataset) {
  const key = dataset.generatedAt || "x";
  if (memo.has(key)) return memo.get(key);
  const moveStats = dataset.moveStats || {};
  // 같은 id·종족값·타입의 중복 폼(예: 표기만 다른 노말 폼)은 하나만 순위에 올린다
  const seenKey = new Set();
  const pool = dataset.pokemon.filter((p) => {
    if (!isReleased(p) || isMega(p)) return false;
    const k = `${p.id}:${p.baseAttack}:${p.baseDefense}:${p.baseStamina}:${(p.types || []).join(",")}`;
    if (seenKey.has(k)) return false; seenKey.add(k); return true;
  });
  const fine = (sc) => Math.pow(sc.dps, 0.775) * Math.pow(sc.tdo, 0.225); // 정수 반올림 전 점수(동률 방지)
  const raid = {}; // type → { normal: [...], shadow: [...] }
  for (const t of TYPES) {
    const normal = [], shadow = [];
    for (const p of pool) {
      const n = raidScoreForType(p, t, moveStats);
      if (n) normal.push({ id: p.id, form: p.form, name: p.name, nameKr: p.nameKr, score: Number(fine(n).toFixed(2)), fast: n.fast, charged: n.charged, usesSpecial: n.usesSpecial, legendary: isLegendaryClass(p) });
      const s = p.shadowEligible ? raidScoreForType(p, t, moveStats, { shadow: true }) : null; // 섀도 순위는 섀도 존재 종만(PvPoke shadoweligible)
      if (s) shadow.push({ id: p.id, form: p.form, name: p.name, nameKr: p.nameKr, score: Number(fine(s).toFixed(2)), fast: s.fast, charged: s.charged, usesSpecial: s.usesSpecial, legendary: isLegendaryClass(p) });
    }
    normal.sort((a, b) => b.score - a.score); shadow.sort((a, b) => b.score - a.score);
    // pct: 그 타입 1위(전설 포함 전체 1위) 대비 점수 비율 (4-A2 기준: 순위 AND 비율)
    const withPct = (list) => { const top = list[0]?.score || 0; return list.map((x, i) => ({ ...x, rank: i + 1, pct: top ? Math.round((x.score / top) * 100) : 0 })); };
    raid[t] = { normal: withPct(normal), shadow: withPct(shadow) };
  }
  const gym = pool.filter((p) => !isLegendaryClass(p)).map((p) => ({ id: p.id, form: p.form, name: p.name, nameKr: p.nameKr, bulk: (p.baseDefense + 15) * (p.baseStamina + 15) }))
    .sort((a, b) => b.bulk - a.bulk).map((x, i) => ({ ...x, rank: i + 1 }));
  const out = { generatedAt: dataset.generatedAt, raid, gym };
  memo.set(key, out);
  return out;
}

export function raidRankOf(rankings, type, id, form, shadow) {
  const list = rankings.raid[type]?.[shadow ? "shadow" : "normal"] || [];
  return list.find((x) => x.id === id && x.form === form) || list.find((x) => x.id === id && (form === "Normal" || x.form === "Normal")) || null;
}
export function gymRankOf(rankings, id, form) {
  return rankings.gym.find((x) => x.id === id && x.form === form) || rankings.gym.find((x) => x.id === id && (form === "Normal" || x.form === "Normal")) || null;
}

// 진화 최종형(잎) 목록. 자기 자신이 최종형이면 [] (진화 없음)
export function finalForms(dataset, p, depth = 0, seen = new Set()) {
  const evos = p.evolutions || [];
  if (!evos.length || depth > 4) return [];
  const out = [];
  for (const e of evos) {
    const k = `${e.id}:${e.form}`;
    if (seen.has(k)) continue; seen.add(k);
    const target = dataset.pokemon.find((x) => x.id === e.id && x.form === e.form) || dataset.pokemon.find((x) => x.id === e.id);
    if (!target) continue;
    const deeper = finalForms(dataset, target, depth + 1, seen);
    if (deeper.length) out.push(...deeper.map((d) => ({ ...d, candiesFromHere: (d.candiesFromHere || 0) + (e.candies || 0) })));
    else out.push({ species: target, candiesFromHere: e.candies || 0 });
  }
  return out;
}

// 진화 계열 전체(앞뒤 모두) id 집합 — 이벤트 대상 매칭용
export function familyIds(dataset, p) {
  const byId = new Map(); for (const x of dataset.pokemon) if (!byId.has(x.id)) byId.set(x.id, x);
  const parents = new Map(); for (const x of dataset.pokemon) for (const e of x.evolutions || []) if (!parents.has(e.id)) parents.set(e.id, x.id);
  const set = new Set([p.id]);
  let cur = p.id; for (let i = 0; i < 5 && parents.has(cur); i++) { cur = parents.get(cur); set.add(cur); }
  const stack = [...set];
  while (stack.length) { const id = stack.pop(); for (const e of byId.get(id)?.evolutions || []) if (!set.has(e.id)) { set.add(e.id); stack.push(e.id); } }
  return set;
}
