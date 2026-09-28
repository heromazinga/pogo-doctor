// 포켓몬GO 타입 상성표 (공격 타입 → 방어 타입)
// 배율: 효과 굉장함 1.6 / 효과 별로 0.625 / 무효(본가 기준) 0.390625

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
