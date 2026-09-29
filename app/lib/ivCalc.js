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
