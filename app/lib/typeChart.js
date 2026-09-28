// 포켓몬GO 타입 상성표 (공격 타입 → 방어 타입)
// 배율(포켓몬GO 기준): 약점 1.6 / 이중 약점 2.56 / 반감 0.625 / 이중 반감 0.390625 (본가의 "무효"는 GO 에서 이중 반감)

export const TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground",
  "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

export const TYPE_NAMES_KR = {
  normal: "노말", fire: "불꽃", water: "물", electric: "전기", grass: "풀", ice: "얼음",
  fighting: "격투", poison: "독", ground: "땅", flying: "비행", psychic: "에스퍼", bug: "벌레",
  rock: "바위", ghost: "고스트", dragon: "드래곤", dark: "악", steel: "강철", fairy: "페어리",
};

const SE = 1.6;
const NVE = 0.625;
const IMMUNE = 0.390625;

// [공격 타입]: { se: [...], nve: [...], immune: [...] }
const CHART = {
  normal:   { se: [], nve: ["rock", "steel"], immune: ["ghost"] },
  fire:     { se: ["grass", "ice", "bug", "steel"], nve: ["fire", "water", "rock", "dragon"], immune: [] },
  water:    { se: ["fire", "ground", "rock"], nve: ["water", "grass", "dragon"], immune: [] },
  electric: { se: ["water", "flying"], nve: ["electric", "grass", "dragon"], immune: ["ground"] },
  grass:    { se: ["water", "ground", "rock"], nve: ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"], immune: [] },
  ice:      { se: ["grass", "ground", "flying", "dragon"], nve: ["fire", "water", "ice", "steel"], immune: [] },
  fighting: { se: ["normal", "ice", "rock", "dark", "steel"], nve: ["poison", "flying", "psychic", "bug", "fairy"], immune: ["ghost"] },
  poison:   { se: ["grass", "fairy"], nve: ["poison", "ground", "rock", "ghost"], immune: ["steel"] },
  ground:   { se: ["fire", "electric", "poison", "rock", "steel"], nve: ["grass", "bug"], immune: ["flying"] },
  flying:   { se: ["grass", "fighting", "bug"], nve: ["electric", "rock", "steel"], immune: [] },
  psychic:  { se: ["fighting", "poison"], nve: ["psychic", "steel"], immune: ["dark"] },
  bug:      { se: ["grass", "psychic", "dark"], nve: ["fire", "fighting", "poison", "flying", "ghost", "steel", "fairy"], immune: [] },
  rock:     { se: ["fire", "ice", "flying", "bug"], nve: ["fighting", "ground", "steel"], immune: [] },
  ghost:    { se: ["psychic", "ghost"], nve: ["dark"], immune: ["normal"] },
  dragon:   { se: ["dragon"], nve: ["steel"], immune: ["fairy"] },
  dark:     { se: ["psychic", "ghost"], nve: ["fighting", "dark", "fairy"], immune: [] },
  steel:    { se: ["ice", "rock", "fairy"], nve: ["fire", "water", "electric", "steel"], immune: [] },
  fairy:    { se: ["fighting", "dragon", "dark"], nve: ["fire", "poison", "steel"], immune: [] },
};

export function multiplier(attackType, defenderTypes) {
  const row = CHART[attackType];
  if (!row) return 1;
  let m = 1;
  for (const d of defenderTypes || []) {
    if (row.se.includes(d)) m *= SE;
    else if (row.nve.includes(d)) m *= NVE;
    else if (row.immune.includes(d)) m *= IMMUNE;
  }
  return m;
}

// 포켓몬GO 에서 나올 수 있는 방어 배율 (단일/이중 타입 조합의 곱)
export const MULTIPLIER_LABELS = {
  "2.56": "이중 약점",
  "1.6": "약점",
  "1": "보통",
  "0.625": "반감",
  "0.39": "이중 반감",
  "0.244": "이중 반감+반감",
  "0.153": "이중 반감×2",
};
export function labelMultiplier(m) {
  const r = Number(m.toFixed(3));
  const key = r === 0.391 ? "0.39" : String(Number(r.toFixed(3)));
  return MULTIPLIER_LABELS[key] || MULTIPLIER_LABELS[String(Number(m.toFixed(2)))] || "";
}

// 방어 배율표: 18개 공격 타입 전부 (AI 가 직접 계산하지 않도록 프롬프트에 그대로 넘긴다)
export function defenseTable(defenderTypes) {
  const types = (defenderTypes || []).filter((t) => TYPES.includes(t));
  if (types.length === 0) return null;
  return TYPES.map((atk) => {
    const m = multiplier(atk, types);
    const shown = Number(m.toFixed(3));
    return { type: atk, kr: TYPE_NAMES_KR[atk], mult: shown, label: labelMultiplier(m) };
  }).sort((a, b) => b.mult - a.mult);
}

// 간이 사이클 DPS: 빠른 기술 n회(차징 에너지를 채우는 횟수) + 차징 1회의 위력 합 / 소요 시간
function cycleDps(fast, charged) {
  const gain = fast.energy > 0 ? fast.energy : 1;
  const n = Math.max(1, Math.ceil((charged.energy || 50) / gain));
  const totalMs = fast.durationMs * n + charged.durationMs;
  if (!totalMs) return 0;
  return (fast.power * n + charged.power) / (totalMs / 1000);
}

// 천적 후보: 대상 포켓몬의 약점 타입 빠른+차징 기술을 실제로 보유한 "출시된" 포켓몬을
// 간이 화력 점수(공격 종족값 × 사이클 DPS × 자속 1.2 × 상성 배율) 순으로 뽑는다
const COUNTER_FORMS = new Set(["Normal", "Alola", "Galarian", "Hisuian", "Paldea"]);
export function counterCandidates(pokemonList, target, limit = 8, moveStats = {}) {
  const tTypes = (target?.types || []).filter((t) => TYPES.includes(t));
  if (!tTypes.length || !Array.isArray(pokemonList)) return [];
  const weakTypes = TYPES.filter((atk) => multiplier(atk, tTypes) > 1);
  if (!weakTypes.length) return [];
  const scored = [];
  for (const p of pokemonList) {
    if (!p?.types?.length || !p.baseAttack) continue;
    if (!COUNTER_FORMS.has(p.form)) continue;
    if (p.id === target.id && p.form === target.form) continue;
    if (p.released === false) continue; // 미출시(PvPoke released:false 또는 자리표시 기술뿐) 제외. null 은 "출시 미확인"으로 포함
    // 검증된 기술만 (미검증 제외)
    const fastAll = [...(p.fast || []), ...(p.eliteFast || []), ...(p.signatureFast || [])];
    const chargedAll = [...(p.charged || []), ...(p.eliteCharged || []), ...(p.signatureCharged || [])];
    let best = null;
    for (const w of weakTypes) {
      const mult = multiplier(w, tTypes);
      const fasts = fastAll.map((n) => [n, moveStats[n]]).filter(([, s]) => s && s.type === w && s.kind === "fast");
      const chargeds = chargedAll.map((n) => [n, moveStats[n]]).filter(([, s]) => s && s.type === w && s.kind === "charged");
      if (!fasts.length || !chargeds.length) continue;
      const stab = p.types.includes(w) ? 1.2 : 1;
      for (const [fn, fs] of fasts) for (const [cn, cs] of chargeds) {
        const dps = cycleDps(fs, cs);
        const score = p.baseAttack * dps * stab * mult;
        if (!best || score > best.score) best = { type: w, mult, stab, fast: fn, charged: cn, dps, score };
      }
    }
    if (!best) continue;
    // 대상이 후보에게 주는 피해 (후보의 내구 관점, 참고용)
    let incoming = 1;
    for (const t of tTypes) incoming = Math.max(incoming, multiplier(t, p.types));
    scored.push({
      id: p.id, form: p.form, name: p.name, nameKr: p.nameKr, types: p.types,
      baseAttack: p.baseAttack, attackType: best.type, mult: Number(best.mult.toFixed(2)), stab: best.stab,
      fastMove: best.fast, chargedMove: best.charged, dps: Number(best.dps.toFixed(1)),
      score: Math.round(best.score), incoming: Number(incoming.toFixed(2)),
      releasedUnknown: p.released !== true,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.baseAttack - a.baseAttack);
  // 같은 종은 하나만
  const seen = new Set();
  return scored.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).slice(0, limit);
}

// 방어 측 타입 조합에 대한 약점/저항 정리
export function analyzeDefender(defenderTypes) {
  const types = (defenderTypes || []).filter((t) => TYPES.includes(t));
  if (types.length === 0) return null;
  const rows = TYPES.map((atk) => ({ type: atk, mult: Number(multiplier(atk, types).toFixed(4)) }));
  const weak = rows.filter((r) => r.mult > 1).sort((a, b) => b.mult - a.mult);
  const resist = rows.filter((r) => r.mult < 1).sort((a, b) => a.mult - b.mult);
  const fmt = (r) => `${TYPE_NAMES_KR[r.type]}(${r.type}) x${r.mult}`;
  return {
    types,
    weaknesses: weak.map(fmt),
    resistances: resist.map(fmt),
  };
}
