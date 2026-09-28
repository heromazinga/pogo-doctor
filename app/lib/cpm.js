// CP 배율(CPM) 표와 레벨 추정
// 출처: PokeMiners game master latest.json 의 PLAYER_LEVEL_SETTINGS.playerLevel.cpMultiplier (정수 레벨 1~51).
// 반 레벨(x.5)은 게임 공식 sqrt((cpm(L)^2 + cpm(L+1)^2) / 2) 로 계산한다.

export const CPM_INT = [0.094,0.16639787,0.21573247,0.25572005,0.29024988,0.3210876,0.34921268,0.3752356,0.39956728,0.4225,0.44310755,0.4627984,0.48168495,0.49985844,0.51739395,0.5343543,0.5507927,0.5667545,0.5822789,0.5974,0.6121573,0.6265671,0.64065295,0.65443563,0.667934,0.6811649,0.69414365,0.7068842,0.7193991,0.7317,0.7377695,0.74378943,0.74976104,0.7556855,0.76156384,0.76739717,0.7731865,0.77893275,0.784637,0.7903,0.7953,0.8003,0.8053,0.8103,0.8153,0.8203,0.8253,0.8303,0.8353,0.8403,0.8453];

export const MAX_LEVEL = 51;

// level: 1 ~ 51, 0.5 단위
export function cpmForLevel(level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(level * 2) / 2));
  const i = Math.floor(lv) - 1;
  if (Number.isInteger(lv)) return CPM_INT[i];
  const a = CPM_INT[i], b = CPM_INT[Math.min(i + 1, CPM_INT.length - 1)];
  return Math.sqrt((a * a + b * b) / 2);
}

export function levels() {
  const out = [];
  for (let l = 1; l <= MAX_LEVEL; l += 0.5) out.push(l);
  return out;
}

// CP = floor((Atk+atkIv) * sqrt(Def+defIv) * sqrt(Sta+staIv) * CPM^2 / 10), 최소 10
export function calcCP(base, ivs, level) {
  const cpm = cpmForLevel(level);
  const cp = Math.floor(((base.atk + ivs.atk) * Math.sqrt(base.def + ivs.def) * Math.sqrt(base.sta + ivs.sta) * cpm * cpm) / 10);
  return Math.max(10, cp);
}

// CP·개체값·종족값으로 레벨 추정. 정확히 일치하는 레벨이 있으면 exact=true, 없으면 가장 가까운 레벨(추정)
// 섀도 포켓몬도 CP 계산은 동일(공격 보정은 전투에서만 적용)
export function estimateLevel(cp, base, ivs) {
  if (!cp || !base) return { level: null, exact: false };
  let best = null;
  for (const l of levels()) {
    const c = calcCP(base, ivs, l);
    const diff = Math.abs(c - cp);
    if (!best || diff < best.diff) best = { level: l, diff, cp: c };
    if (diff === 0) break;
  }
  return { level: best.level, exact: best.diff === 0, calcCp: best.cp };
}
