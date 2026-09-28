// 내 목록 기반 팀 추천 — 결정적 서버 계산 (AI 미사용)
//
// ── 가정과 수식 (README "팀 추천 계산" 과 동일하게 유지) ──
// 레벨 추정: CP·개체값·종족값·CPM 표로 0.5 단위 레벨. 개체값 미입력이면 10/10/10 가정("추정"). CP 없으면 레벨 40 가정.
// 실제 능력치: (종족값 + 개체값) × CPM. 섀도는 공격 ×1.2, 방어 ×0.833.
// 기술: 저장된 기술 사용. 미입력이면 그 종의 검증된 기술(일반/레거시/전용기) 중 대상에게 최적인 조합 가정("기술 미입력 — 최적 기술 가정").
// 피해 공식(GO): floor(0.5 × 위력 × 공격/방어 × 배율 × 자속) + 1   (배율: 타입 상성, 자속 1.2)
// 레이드 DPS: 빠른 기술 n회(차징 에너지를 채우는 횟수) + 차징 1회 사이클의 총 피해 / 사이클 시간(초). 보스 방어 = (종족값 방어 + 15) × CPM(L40).
// 생존력: 보스가 자기 타입 자속 기술(보스 기술 미상이면 위력 12/1초 빠른 + 100/3초 차징 가정)로 주는 피해로 계산한 버티기 시간 TTF = 내 HP / 받는 DPS.
// 레이드 점수 = DPS^0.775 × TDO^0.225 (TDO = DPS × TTF; 커뮤니티에서 쓰는 종합 지표 형태). 값이 클수록 좋음.
// 로켓단 점수(간이): 1:1·실드 전투이므로 DPS 대신
//   기술 점수 = 빠른 기술 초당 에너지 × 2 + 차징 기술 (위력 ÷ 에너지) × 20
//   점수 = 공격 × 기술 점수 × 상대 슬롯 후보들에 대한 평균 최대 배율 × 자속 ÷ 상대가 나에게 주는 평균 배율 × 내구 보정(√(방어×HP)/100)
// 제외: status = 'transfer'(박사에게 보낼 예정) 항목.

import { multiplier, TYPES, counterCandidates } from "./typeChart.js";
import { cpmForLevel, estimateLevel, MAX_LEVEL } from "./cpm.js";

const SHADOW_ATK = 1.2, SHADOW_DEF = 0.833;
const STAB = 1.2;
const DEFAULT_LEVEL = 40;
const ASSUMED_IV = { atk: 10, def: 10, sta: 10 };
const BOSS_CPM = cpmForLevel(40);
const BOSS_IV = 15;
// 보스 기술 미상 시 가정
const BOSS_FALLBACK_FAST = { power: 12, durationMs: 1000, energy: 10 };
const BOSS_FALLBACK_CHARGED = { power: 100, durationMs: 3000, energy: 50 };

function damage(power, atk, def, mult, stab) {
  return Math.floor(0.5 * power * (atk / def) * mult * stab) + 1;
}

// 사이클 피해/시간: 빠른 n회 + 차징 1회
function cycle(fast, charged, atk, def, multFast, multCharged, stabFast, stabCharged) {
  const gain = fast.energy > 0 ? fast.energy : 1;
  const n = Math.max(1, Math.ceil((charged.energy || 50) / gain));
  const dmg = damage(fast.power, atk, def, multFast, stabFast) * n + damage(charged.power, atk, def, multCharged, stabCharged);
  const sec = (fast.durationMs * n + charged.durationMs) / 1000;
  return { dps: dmg / sec, n, sec };
}

// ─── 내 포켓몬 → 계산용 능력치 ───
export function prepareMember(entry, species, { moveStats }) {
  // entry: my_pokemon 행(species_id, form, cp, atk_iv, def_iv, sta_iv, fast_move, charged_moves, is_shadow, status, ...)
  const base = { atk: species.baseAttack, def: species.baseDefense, sta: species.baseStamina };
  const hasIv = [entry.atk_iv, entry.def_iv, entry.sta_iv].every((v) => Number.isInteger(v));
  const ivs = hasIv ? { atk: entry.atk_iv, def: entry.def_iv, sta: entry.sta_iv } : ASSUMED_IV;
  let level = DEFAULT_LEVEL, levelExact = false, levelAssumed = true, cpOverMax = false;
  if (entry.cp) {
    const est = estimateLevel(entry.cp, base, ivs);
    if (est.level) { level = est.level; levelExact = est.exact; levelAssumed = false; }
    // 입력 CP가 해당 종·개체값의 최대 CP(L51)보다 크면 CP 또는 개체값 입력 오류 가능성
    if (est.level === MAX_LEVEL && est.calcCp < entry.cp) cpOverMax = true;
  }
  const cpm = cpmForLevel(level);
  const shadow = Boolean(entry.is_shadow);
  const atk = (base.atk + ivs.atk) * cpm * (shadow ? SHADOW_ATK : 1);
  const def = (base.def + ivs.def) * cpm * (shadow ? SHADOW_DEF : 1);
  const hp = Math.floor((base.sta + ivs.sta) * cpm);

  // 기술: 저장된 기술(수치가 있는 것만), 없으면 검증된 기술 전체를 후보로 두고 대상별 최적 선택
  const verifiedFast = [...(species.fast || []), ...(species.eliteFast || []), ...(species.signatureFast || [])];
  const verifiedCharged = [...(species.charged || []), ...(species.eliteCharged || []), ...(species.signatureCharged || [])];
  const savedFast = entry.fast_move && moveStats[entry.fast_move] ? [entry.fast_move] : [];
  const savedCharged = (entry.charged_moves || []).filter((m) => moveStats[m]);
  const movesAssumed = savedFast.length === 0 || savedCharged.length === 0;
  const fastPool = (savedFast.length ? savedFast : verifiedFast).filter((m) => moveStats[m]?.kind === "fast");
  const chargedPool = (savedCharged.length ? savedCharged : verifiedCharged).filter((m) => moveStats[m]?.kind === "charged");

  return {
    id: entry.id, speciesId: species.id, form: species.form, name: species.name, nameKr: species.nameKr, types: species.types || [],
    cp: entry.cp || null, level, levelExact, levelAssumed, cpOverMax, ivs, ivAssumed: !hasIv, shadow, shiny: Boolean(entry.is_shiny),
    status: entry.status, purposes: entry.purposes || [],
    atk, def, hp, fastPool, chargedPool, movesAssumed,
  };
}

// ─── 레이드 점수 ───
export function raidScore(member, boss, moveStats) {
  const bossTypes = (boss.types || []).filter((t) => TYPES.includes(t));
  const bossDef = ((boss.baseDefense || 200) + BOSS_IV) * BOSS_CPM;
  const bossAtk = ((boss.baseAttack || 200) + BOSS_IV) * BOSS_CPM;
  let best = null;
  for (const fn of member.fastPool) {
    const fs = moveStats[fn];
    for (const cn of member.chargedPool) {
      const cs = moveStats[cn];
      const mF = multiplier(fs.type, bossTypes), mC = multiplier(cs.type, bossTypes);
      const sF = member.types.includes(fs.type) ? STAB : 1, sC = member.types.includes(cs.type) ? STAB : 1;
      const c = cycle(fs, cs, member.atk, bossDef, mF, mC, sF, sC);
      if (!best || c.dps > best.dps) best = { fast: fn, charged: cn, dps: c.dps, multFast: Number(mF.toFixed(3)), multCharged: Number(mC.toFixed(3)), stab: sF > 1 || sC > 1 };
    }
  }
  if (!best) return null;
  // 생존력: 보스의 자속 기술(가정 또는 실제 최고 기술)이 나에게 주는 DPS
  let incoming = 0;
  const bossFast = (boss.fast || []).map((m) => moveStats[m]).filter((s) => s?.kind === "fast");
  const bossCharged = (boss.charged || []).map((m) => moveStats[m]).filter((s) => s?.kind === "charged");
  const fCands = bossFast.length ? bossFast : [{ ...BOSS_FALLBACK_FAST, type: bossTypes[0] }];
  const cCands = bossCharged.length ? bossCharged : [{ ...BOSS_FALLBACK_CHARGED, type: bossTypes[0] }];
  for (const f of fCands) for (const c of cCands) {
    const mF = multiplier(f.type, member.types), mC = multiplier(c.type, member.types);
    const sF = bossTypes.includes(f.type) ? STAB : 1, sC = bossTypes.includes(c.type) ? STAB : 1;
    const cyc = cycle(f, c, bossAtk, member.def, mF, mC, sF, sC);
    if (cyc.dps > incoming) incoming = cyc.dps;
  }
  const ttf = incoming > 0 ? member.hp / incoming : 999;
  const tdo = best.dps * ttf;
  const score = Math.pow(best.dps, 0.775) * Math.pow(tdo, 0.225);
  // 보스 타입 자속 공격에 대한 내 약점 배율(경고용)
  let vuln = 1;
  for (const t of bossTypes) vuln = Math.max(vuln, multiplier(t, member.types));
  return { ...best, dps: Number(best.dps.toFixed(1)), ttf: Number(ttf.toFixed(1)), tdo: Math.round(tdo), score: Math.round(score), vulnerable: vuln > 1, vulnMult: Number(vuln.toFixed(2)) };
}

// ─── 레이드 팀 (내 목록 상위 6, 부족분은 천적 후보) ───
export function buildRaidTeam(rows, boss, dataset, { size = 6 } = {}) {
  const moveStats = dataset.moveStats || {};
  const species = (r) => dataset.pokemon.find((p) => p.id === r.species_id && p.form === (r.form || "Normal")) || dataset.pokemon.find((p) => p.id === r.species_id);
  const scored = [];
  let excludedTransfer = 0, skipped = 0;
  for (const r of rows || []) {
    if (r.status === "transfer") { excludedTransfer++; continue; }
    const sp = species(r);
    if (!sp || !sp.baseAttack) { skipped++; continue; }
    const m = prepareMember(r, sp, { moveStats });
    const sc = raidScore(m, boss, moveStats);
    if (!sc) { skipped++; continue; }
    scored.push({ ...m, ...sc });
  }
  scored.sort((a, b) => b.score - a.score);
  const team = scored.slice(0, size); // 같은 종 중복 허용 (실제 개체별)
  const fill = team.length < size ? counterCandidates(dataset.pokemon, boss, size - team.length, moveStats) : [];
  const bossTypes = (boss.types || []).filter((t) => TYPES.includes(t));
  const vulnerableCount = team.filter((m) => m.vulnerable).length;
  const warnings = [];
  if (team.length && vulnerableCount >= Math.ceil(team.length / 2)) warnings.push(`팀 ${team.length}마리 중 ${vulnerableCount}마리가 보스(${bossTypes.join("/")}) 자속 기술에 약점입니다`);
  if (team.some((m) => m.ivAssumed)) warnings.push("개체값 미입력 항목은 10/10/10 으로 추정했습니다");
  if (team.some((m) => m.movesAssumed)) warnings.push("기술 미입력 항목은 최적 기술을 가정했습니다");
  return { boss: { id: boss.id, name: boss.name, nameKr: boss.nameKr, form: boss.form, types: bossTypes }, team, fill, warnings, excludedTransfer, skipped, candidates: scored.length };
}

// ─── 로켓단 (간이) ───
function rocketMemberScore(member, slotPokemon /* [{types}] */, moveStats) {
  if (!slotPokemon.length) return null;
  let best = null;
  for (const fn of member.fastPool) {
    const fs = moveStats[fn];
    const eps = fs.energy / (fs.durationMs / 1000);
    for (const cn of member.chargedPool) {
      const cs = moveStats[cn];
      const eff = cs.energy > 0 ? cs.power / cs.energy : cs.power / 50;
      const moveScore = eps * 2 + eff * 20;
      // 상대 후보들에 대한 평균 최대 배율(빠른/차징 중 큰 쪽)
      let offSum = 0;
      for (const opp of slotPokemon) {
        const mF = multiplier(fs.type, opp.types) * (member.types.includes(fs.type) ? STAB : 1);
        const mC = multiplier(cs.type, opp.types) * (member.types.includes(cs.type) ? STAB : 1);
        offSum += Math.max(mF, mC);
      }
      const off = offSum / slotPokemon.length;
      if (!best || moveScore * off > best.moveScore * best.off) best = { fast: fn, charged: cn, moveScore, off };
    }
  }
  if (!best) return null;
  // 상대가 나에게 주는 평균 배율(상대 타입 자속 가정)
  let defSum = 0;
  for (const opp of slotPokemon) {
    let m = 1;
    for (const t of opp.types || []) m = Math.max(m, multiplier(t, member.types));
    defSum += m;
  }
  const defMult = defSum / slotPokemon.length;
  const bulk = Math.sqrt(member.def * member.hp) / 100;
  const score = (member.atk * best.moveScore * best.off) / defMult * bulk / 100;
  return { fast: best.fast, charged: best.charged, offMult: Number(best.off.toFixed(2)), defMult: Number(defMult.toFixed(2)), score: Math.round(score) };
}

export function buildRocketTeam(rows, lineup, dataset) {
  const moveStats = dataset.moveStats || {};
  const slots = [lineup.firstPokemon || [], lineup.secondPokemon || [], lineup.thirdPokemon || []].map((arr) =>
    arr.map((p) => ({ name: p.name, types: (p.types || []).map((t) => String(t).toLowerCase()).filter((t) => TYPES.includes(t)) }))
  );
  const species = (r) => dataset.pokemon.find((p) => p.id === r.species_id && p.form === (r.form || "Normal")) || dataset.pokemon.find((p) => p.id === r.species_id);
  const members = [];
  let excludedTransfer = 0;
  for (const r of rows || []) {
    if (r.status === "transfer") { excludedTransfer++; continue; }
    const sp = species(r);
    if (!sp || !sp.baseAttack) continue;
    const m = prepareMember(r, sp, { moveStats });
    const perSlot = slots.map((sl) => rocketMemberScore(m, sl, moveStats));
    if (perSlot.every((s) => !s)) continue;
    members.push({ ...m, perSlot });
  }
  // 슬롯마다 가장 유리한 1마리(이미 뽑힌 개체 제외), 슬롯 1→2→3 순
  const team = [];
  const used = new Set();
  const rankBySlot = slots.map((_, si) => [...members].filter((m) => m.perSlot[si]).sort((a, b) => b.perSlot[si].score - a.perSlot[si].score));
  for (let si = 0; si < 3; si++) {
    const pick = rankBySlot[si].find((m) => !used.has(m.id));
    if (!pick) continue;
    used.add(pick.id);
    // 이 개체가 다른 슬롯에서도 상위 3위 안이면 "커버" 표시
    const covers = slots.map((_, sj) => rankBySlot[sj].slice(0, 3).some((m) => m.id === pick.id) ? sj + 1 : null).filter(Boolean);
    team.push({ ...pick, slot: si + 1, covers, chosen: pick.perSlot[si] });
  }
  const warnings = [];
  if (team.some((m) => m.ivAssumed)) warnings.push("개체값 미입력 항목은 10/10/10 으로 추정했습니다");
  if (team.some((m) => m.movesAssumed)) warnings.push("기술 미입력 항목은 최적 기술을 가정했습니다");
  if (team.length < 3) warnings.push(`내 목록에서 ${team.length}마리만 추천할 수 있습니다`);
  return { lineup: { name: lineup.name, title: lineup.title, type: lineup.type, slots }, team, warnings, excludedTransfer, candidates: members.length, note: "간이 추천: 실드·에너지 흐름을 단순화한 점수입니다" };
}
