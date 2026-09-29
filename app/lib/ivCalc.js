// CP·HP → 개체값 후보 (안드로이드 core/IvCalc.kt 와 같은 공식)
//   CP = floor((Atk+atkIv) × sqrt(Def+defIv) × sqrt(Sta+staIv) × CPM² / 10), 최소 10
//   HP = floor((Sta+staIv) × CPM), 최소 10
import { cpmForLevel, levels, calcCP } from "./cpm.js";

export function calcHP(baseSta, staIv, level) {
  return Math.max(10, Math.floor((baseSta + staIv) * cpmForLevel(level)));
}

// 반환: [{ level, atk, def, sta }] — 레벨 1~maxLevel(0.5) × 16³ 전수 조사
export function ivCandidates(base, cp, hp, { maxLevel = 51, levelHint = null } = {}) {
  const out = [];
  if (!base || !cp) return out;
  const lvs = levelHint != null ? [levelHint] : levels().filter((l) => l <= maxLevel);
  for (const lv of lvs) {
    const staIvs = [];
    for (let s = 0; s <= 15; s++) if (hp == null || calcHP(base.sta, s, lv) === hp) staIvs.push(s);
    if (!staIvs.length) continue;
    for (const s of staIvs) for (let a = 0; a <= 15; a++) for (let d = 0; d <= 15; d++) {
      if (calcCP(base, { atk: a, def: d, sta: s }, lv) === cp) out.push({ level: lv, atk: a, def: d, sta: s });
    }
  }
  return out;
}

export const ivPercent = (c) => Math.round(((c.atk + c.def + c.sta) / 45) * 100);

// 4-C.2 CP 검증: 개체값(3개 확정)·HP 로 가능한 레벨(1~51, 0.5 단위)에서 계산한 CP 와 일치하면 그 레벨을, 아니면 null.
//   자리수 누락 오판독(예: 2634 → 263)을 저장 전에 걸러낸다. HP 가 없으면 레벨 전 범위, 있으면 HP 가 맞는 레벨만.
export function cpConsistentLevel(base, cp, hp, ivs, { maxLevel = 51 } = {}) {
  if (!base || !cp || !ivs || ![ivs.atk, ivs.def, ivs.sta].every((v) => Number.isInteger(v))) return null;
  for (const lv of levels().filter((l) => l <= maxLevel)) {
    if (hp != null && calcHP(base.sta, ivs.sta, lv) !== hp) continue;
    if (calcCP(base, ivs, lv) === cp) return lv;
  }
  return null;
}
