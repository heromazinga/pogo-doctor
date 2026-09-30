// 4-A 용도별 보관 판정 엔진 — 결정적 계산(AI 미사용), 저장하지 않고 볼 때마다 계산
// 입력(computeVerdict 의 input): { species_id, form, ivs?{atk,def,sta}, ivCandidates?[{level,atk,def,sta}], level?, levelRange?[lo,hi],
//   cp, hp, fast_move, charged_moves[], is_shadow, is_purified, is_shiny, is_lucky, candy?, storageMode?, id? }
// 컨텍스트(ctx): { dataset, leagueRankings(getLeagueRankings 결과), eventTargets(extractEventTargets 결과), myRows(내 목록 행), storageMode, now, maxLeagueLevel }
// 출력: { tier, tags:[{name,tier,reason,metrics}], collect:[{reason}], event?, confident, basis:"server", summary, candidates, warnings, disabled }
import { TYPES, TYPE_NAMES_KR } from "./typeChart.js";
import { cpmForLevel, levels, calcCP, estimateLevel } from "./cpm.js";
import { findPokemon } from "./pokemonData.js";
import { RULES, TAG, TIER_LABEL, EVOLVE_PREFIX, purposesFromTags } from "./verdictRules.js";
import { getRankings, raidRankOf, budgetRankOf, gymRankOf, raidScoreForType, finalForms, familyIds, isLegendaryClass } from "./speciesRankings.js";
import { reserveRaidRank, reserveLeagueBest, reserveRepresentative, rareFamilyNote, reserveMega, reserveFingerprint } from "./reserveRanks.js";
import { leagueRankOf } from "./pvpokeRankings.js";
import { ivCandidates, ivPercent, calcHP } from "./ivCalc.js";
import { matchEvents } from "./eventTargets.js";

const TIER_ORDER = { main: 3, hold: 2, transfer: 1, need_appraisal: 0 };
// 기준값 조회: ctx.rulesOverride 로 일부 상수를 덮어쓸 수 있다 (수정 전후 분포 비교용 /api/verdict/stats)
const rule = (ctx, k) => (ctx?.rulesOverride && ctx.rulesOverride[k] != null ? ctx.rulesOverride[k] : RULES[k]);
const better = (a, b) => (TIER_ORDER[a] >= TIER_ORDER[b] ? a : b);

// ─── 리그 스탯곱 순위 (종·리그·레벨 상한별 4096 조합, 메모) ───
const productMemo = new Map();
export function leagueProductTable(p, cap, maxLevel) {
  const key = `${p.id}:${p.form}:${cap}:${maxLevel}`;
  if (productMemo.has(key)) return productMemo.get(key);
  const base = { atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina };
  const lvs = levels().filter((l) => l <= maxLevel);
  const rows = [];
  for (let a = 0; a <= 15; a++) for (let d = 0; d <= 15; d++) for (let s = 0; s <= 15; s++) {
    const ivs = { atk: a, def: d, sta: s };
    // CP ≤ cap 인 최고 레벨 (레벨에 대해 CP 단조 증가 → 이분 탐색)
    let lo = 0, hi = lvs.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (calcCP(base, ivs, lvs[mid]) <= cap) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    if (best < 0) { rows.push({ a, d, s, level: null, cp: null, product: 0 }); continue; }
    const lv = lvs[best], cpm = cpmForLevel(lv);
    const product = (base.atk + a) * cpm * (base.def + d) * cpm * Math.floor((base.sta + s) * cpm);
    rows.push({ a, d, s, level: lv, cp: calcCP(base, ivs, lv), product });
  }
  rows.sort((x, y) => y.product - x.product);
  const rank = new Map();
  rows.forEach((r, i) => rank.set(`${r.a},${r.d},${r.s}`, { rank: i + 1, level: r.level, cp: r.cp, product: r.product }));
  const out = { rank, top: rows[0] };
  productMemo.set(key, out);
  return out;
}

// ─── 개체값 후보 정규화 ───
function normalizeCandidates(input, p) {
  const base = { atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina };
  const clampL = (l) => Math.max(1, Math.min(51, Math.round(l * 2) / 2));
  if (Array.isArray(input.ivCandidates) && input.ivCandidates.length) {
    return input.ivCandidates
      .filter((c) => [c.atk, c.def, c.sta].every((v) => Number.isInteger(v) && v >= 0 && v <= 15))
      .map((c) => ({ atk: c.atk, def: c.def, sta: c.sta, level: c.level != null ? clampL(c.level) : (input.cp ? estimateLevel(input.cp, base, c).level : (input.level || RULES.RAID_MEMBER_LEVEL)) }))
      .slice(0, 4096);
  }
  const ivs = input.ivs || (Number.isInteger(input.atk_iv) ? { atk: input.atk_iv, def: input.def_iv, sta: input.sta_iv } : null);
  if (ivs && [ivs.atk, ivs.def, ivs.sta].every((v) => Number.isInteger(v) && v >= 0 && v <= 15)) {
    let level = input.level != null ? clampL(input.level) : null;
    if (level == null && input.cp) level = estimateLevel(input.cp, base, ivs).level;
    // 4-C.3: CP·레벨이 없어도 HP 가 있으면 HP 로 가능한 레벨들을 후보로 (실DB 결함: 찌르꼬 0/15/14 L2 CP null 이 L40 으로 가정돼 리그 상한 초과 → 박사행)
    if (level == null && input.hp) {
      const lvs = levels().filter((lv) => calcHP(base.sta, ivs.sta, lv) === input.hp);
      if (lvs.length) return lvs.map((lv) => ({ ...ivs, level: lv }));
    }
    if (level == null) level = RULES.RAID_MEMBER_LEVEL;
    return [{ ...ivs, level }];
  }
  if (input.cp) {
    const maxLevel = Array.isArray(input.levelRange) && input.levelRange[1] ? clampL(input.levelRange[1]) : 51;
    const minLevel = Array.isArray(input.levelRange) && input.levelRange[0] ? clampL(input.levelRange[0]) : 1;
    const cands = ivCandidates(base, input.cp, input.hp || null, { maxLevel }).filter((c) => c.level >= minLevel);
    return cands.length ? cands : [];
  }
  return [];
}

// ─── 내 목록 안 개체 순위 ───
function rowsOfSpecies(myRows, p, shadow, selfId) {
  return (myRows || []).filter((r) => r.species_id === p.id && (r.form || "Normal") === p.form && Boolean(r.is_shadow) === shadow && r.id !== selfId && r.status !== "transfer");
}
function rowLevel(r, p) {
  if (r.level) return r.level;
  if (r.cp && Number.isInteger(r.atk_iv)) return estimateLevel(r.cp, { atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }, { atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv }).level || 0;
  return 0;
}
// 공격 IV 우선, 동률 시 레벨 — 나보다 앞서는 행 수 + 1
function indivRankBy(rows, p, keyFn, mine) {
  let ahead = 0;
  for (const r of rows) {
    const k = keyFn(r);
    if (k.primary > mine.primary || (k.primary === mine.primary && k.level > mine.level)) ahead++;
  }
  return ahead + 1;
}

// ─── 한 후보(개체값·레벨 확정)에 대한 태그 평가 ───
function evaluateCandidate(p, cand, input, ctx, rankings, { forEvolve = false } = {}) {
  const tags = [];
  const warnings = [];
  const transferNotes = []; // 4-F.3 박사행 사유(탈락 기준, 순서대로: 리그 비교 → 종 대표)
  const shadow = Boolean(input.is_shadow);
  const moveStats = ctx.dataset.moveStats || {};
  const myRows = ctx.myRows || [];
  const sameSpecies = rowsOfSpecies(myRows, p, shadow, input.id);
  const pct = ivPercent(cand);
  const hasMoves = Boolean(input.fast_move) || (Array.isArray(input.charged_moves) && input.charged_moves.length > 0);

  // 4-F 초보자 기준: 보관함 여유·보통에만 (빠듯은 현행). rulesOverride BEGINNER_RULES=0 으로 끔(전후 비교)
  const beginner = Number(rule(ctx, "BEGINNER_RULES")) !== 0 && (input.storageMode || ctx.storageMode) !== "tight";
  // 1) 타입별 레이드
  for (const t of TYPES) {
    const sp = raidRankOf(rankings, t, p.id, p.form, shadow);
    if (!sp) continue;
    // 4-A2: 순위 AND 타입 1위 대비 점수 비율 (상위 ≤12 & ≥75%, 중위 ≤30 & ≥65%)
    const top = sp.rank <= RULES.RAID_TOP_RANK && sp.pct >= RULES.RAID_TOP_SCORE_PCT;
    const mid = sp.rank <= RULES.RAID_MID_RANK && sp.pct >= RULES.RAID_MID_SCORE_PCT;
    // 4-B6: 공격 IV 하한 (레이드 대미지는 공격에 비례). 미만이면 태그 없음, 주력은 별도 하한
    const minAtk = rule(ctx, "RAID_MIN_ATK_IV"), mainMinAtk = rule(ctx, "RAID_MAIN_MIN_ATK_IV");
    const kr = TYPE_NAMES_KR[t];
    if (!top && !mid) {
      if (!beginner || cand.atk < minAtk) continue;
      // 4-F ① 가성비 상위종: 전설·환상·UB·메가·그림자 제외 풀에서 ≤12위 (일반 개체만) → 보류
      const bg = !shadow ? budgetRankOf(rankings, t, p.id, p.form) : null;
      const budgetTop = Boolean(bg) && bg.budgetRank <= rule(ctx, "BUDGET_RAID_TOP_RANK");
      // 4-F ② 레이드 예비: 내 보관함 안 이 타입 개체 점수 상위 N (종 순위 무관)
      const rr = forEvolve ? null : reserveRaidRank(ctx.reserve, t, input, p, cand);
      if (!budgetTop && rr == null) continue;
      const moves = recommendedMoves(ctx.dataset, p, sp.fast, sp.charged);
      const why = [budgetTop ? `가성비 ${bg.budgetRank}위(전설·그림자 제외 풀, 전체 ${sp.rank}위·1위 대비 ${sp.pct}%)` : null, rr != null ? `내 보관함 ${kr} ${rr}위(레이드 예비)` : null].filter(Boolean).join(" · ");
      tags.push({ name: TAG.raid(kr), tier: "hold", reason: `${why}·공격 ${cand.atk} · ${moveLine(moves)}`, moves, metrics: { type: t, speciesRank: sp.rank, speciesPct: sp.pct, top: false, budgetRank: bg?.budgetRank ?? null, reserveRank: rr, atkIv: cand.atk, level: cand.level, beginner: true, bestMoves: [sp.fast, sp.charged], usesSpecial: sp.usesSpecial } });
      continue;
    }
    if (cand.atk < minAtk) continue;
    const indiv = indivRankBy(sameSpecies, p, (r) => ({ primary: Number.isInteger(r.atk_iv) ? r.atk_iv : -1, level: rowLevel(r, p) }), { primary: cand.atk, level: cand.level });
    let tier = top && indiv <= RULES.RAID_MAIN_INDIV_RANK && cand.atk >= mainMinAtk ? "main" : "hold";
    const notes = [];
    // 4-F.4 C①: 주력은 내 보관함 전체의 같은 타입 공격수 중 상위(레이드 예비 순위 ≤ RESERVE_RAID_TOP_N)일 때만 — 같은 종 1~2마리면 "내 종 중 1위" 가 항상 통과하던 결함(번치코 51% 불꽃 주력)
    //   보관함 밖 개체(웹 분석 입력 등, reserveKey 없음)는 순위를 알 수 없어 현행 유지
    const rr = forEvolve ? null : reserveRaidRank(ctx.reserve, t, input, p, cand);
    if (tier === "main" && ctx.reserve && input.reserveKey) {
      if (rr == null || rr > rule(ctx, "RESERVE_RAID_TOP_N")) { tier = "hold"; notes.push(`상위종 · 내 보관함 ${kr} 타입 ${rule(ctx, "RESERVE_RAID_TOP_N") + 1}위 이하`); }
      else notes.push(`내 보관함 ${kr} ${rr}위`);
    }
    // 4-F.5 C: 최적 기술이 특수 기술머신(레거시·전용기)을 필요로 하는데 현재 기술을 모르면(스캔 기록은 기술을 읽지 않음) 주력 → 보류 (번치코 12/2/9 불꽃 6위 사례)
    if (tier === "main" && sp.usesSpecial && !hasMoves && !forEvolve) { tier = "hold"; notes.push("특수 기술 보유 여부 확인 필요"); }
    let myScore = null;
    if (hasMoves && !forEvolve) {
      const mine = raidScoreForType(p, t, moveStats, { shadow, fastOnly: input.fast_move ? [input.fast_move] : null, chargedOnly: input.charged_moves?.length ? input.charged_moves : null });
      let mismatch = false;
      if (mine) {
        myScore = mine.score;
        if (sp.usesSpecial && (mine.fast !== sp.fast || mine.charged !== sp.charged)) { mismatch = true; notes.push(`특수 기술머신 필요(${moveName(ctx.dataset, sp.fast)}/${moveName(ctx.dataset, sp.charged)})`); }
      } else {
        mismatch = sp.usesSpecial;
        notes.push(sp.usesSpecial ? `특수 기술머신 필요(${moveName(ctx.dataset, sp.charged)})` : `${kr} 기술로 변경 필요`);
      }
      // 4-F.4 C②: 핵심 특수 기술이 필요한데 현재 기술이 아니면 주력 → 보류
      if (mismatch && tier === "main") { tier = "hold"; notes.push("특수 기술 미보유 → 보류"); }
    }
    // 4-C: 기술은 캡처하지 않는다(기술머신·이벤트로 바꾸므로). 태그마다 추천 기술(종 최적 조합)을 표시하고, 특수 기술머신이 필요하면 ⚠ 표기
    const moves = recommendedMoves(ctx.dataset, p, sp.fast, sp.charged);
    const reason = `${kr} ${sp.rank}위(1위 대비 ${sp.pct}%)${shadow ? "(그림자)" : ""}·공격 ${cand.atk}, 내 ${p.nameKr} 중 ${indiv}위 · ${moveLine(moves)}${notes.length ? " · " + notes.join(", ") : ""}`;
    tags.push({ name: TAG.raid(kr), tier, reason, moves, metrics: { type: t, speciesRank: sp.rank, speciesPct: sp.pct, top, indivRank: indiv, atkIv: cand.atk, level: cand.level, speciesScore: sp.score, myScore, bestMoves: [sp.fast, sp.charged], usesSpecial: sp.usesSpecial, notes } });
  }

  // 4-F.5 B② 메가 진화용: 메가진화 가능 종은 레이드 기준(공격 우선) 1마리를 보류해 사용자가 묶음에서 수동으로 뺄 일이 없게 (독침붕 770 12/12/15 사례). 그림자는 제외(메가진화 불가 가정 — 확인 필요)
  if (!forEvolve && p.hasMega) {
    const mg = reserveMega(ctx.reserve, input, p, cand);
    if (mg && !mg.other) tags.push({ name: TAG.mega, tier: "hold", reason: `메가진화 가능 종 — 내 ${p.nameKr} 중 레이드 기준(공격 ${cand.atk}) 1마리 보류`, metrics: { mega: true, atkIv: cand.atk } });
  }

  // 2) 체육관 방어
  const gym = !isLegendaryClass(p) ? gymRankOf(rankings, p.id, p.form) : null;
  if (gym && gym.rank <= RULES.GYM_TOP_RANK) {
    const indiv = indivRankBy(sameSpecies, p, (r) => ({ primary: Number.isInteger(r.def_iv) ? r.def_iv + r.sta_iv : -1, level: rowLevel(r, p) }), { primary: cand.def + cand.sta, level: cand.level });
    const tier = indiv <= RULES.GYM_MAIN_INDIV_RANK ? "main" : "hold";
    tags.push({ name: TAG.gym, tier, reason: `내구 ${gym.rank}위·방어 ${cand.def}/HP ${cand.sta}, 내 ${p.nameKr} 중 ${indiv}위`, metrics: { speciesRank: gym.rank, indivRank: indiv } });
  }

  // 3) 슈퍼리그 / 하이퍼리그
  for (const league of ["great", "ultra"]) {
    const lr = ctx.leagueRankings?.leagues?.[league];
    if (!lr) { warnings.push(`${TAG[league]}: 데이터 없음(PvPoke 순위 미수신)`); continue; }
    const sp = leagueRankOf(ctx.leagueRankings, league, p.pvpokeId, shadow);
    const ranked = Boolean(sp) && sp.rank <= RULES.LEAGUE_MID_RANK;
    const cap = RULES.LEAGUE_CAPS[league];
    const table = leagueProductTable(p, cap, ctx.maxLeagueLevel || RULES.LEAGUE_MAX_LEVEL);
    const me = table.rank.get(`${cand.atk},${cand.def},${cand.sta}`);
    if (!me || me.level == null) continue;
    // 4-C.2 리그 후보: 스탯곱 순위 ≤41(상위 1%)이면 종 PvPoke 순위(200위 안팎)와 무관하게 보류 (사례: 찌르꼬 0/15/14 → 찌르호크 하이퍼 4위·슈퍼 115위)
    //   단, PvPoke 순위 파일에 아예 없는 종(리그에서 쓸 수 없는 약한 종)은 제외 — 그런 종은 스탯곱 1위라도 의미가 없다
    const candidateRank = rule(ctx, "LEAGUE_CANDIDATE_PRODUCT_RANK");
    // 4-D: 상한 도달 = 상한 레벨 < 50 AND 상한 레벨 CP ≥ 상한×0.97. 미도달(약한 종은 L50 에도 상한 아래 → 고개체가 스탯곱 1위)은 리그 후보·보류에서 제외
    const capReached = me.level < RULES.LEAGUE_MAX_LEVEL && me.cp >= cap * rule(ctx, "LEAGUE_CAP_REACH_PCT");
    const candidate = Boolean(sp) && sp.rank <= rule(ctx, "LEAGUE_CANDIDATE_SPECIES_RANK") && me.rank <= candidateRank && capReached;
    // 4-F ③ 리그 예비(컵 리그용): 종 PvPoke 순위 무관, 상한 도달 가능 AND 스탯곱 ≤500 → 내 보관함 안 종·리그별 최상위 1마리
    //   4-F.3: 종·리그별 상위 n(여유 2 / 보통 1). 밀린 개체는 박사행 사유에 "슈퍼리그: 같은 종 더 좋은 개체 있음(…)" 로 남긴다
    const rb = beginner && !forEvolve && capReached && me.rank <= rule(ctx, "LEAGUE_RESERVE_PRODUCT_RANK") ? reserveLeagueBest(ctx.reserve, league, input, p, cand) : null;
    const perSpecies = (input.storageMode || ctx.storageMode) === "relaxed" ? rule(ctx, "RESERVE_LEAGUE_PER_SPECIES_RELAXED") : rule(ctx, "RESERVE_LEAGUE_PER_SPECIES_NORMAL");
    const reserve = Boolean(rb) && rb.pos <= perSpecies;
    if (rb && !reserve) {
      const slots = rb.better.slice(0, perSpecies);
      transferNotes.push(`${TAG[league]}: 같은 종 더 좋은 개체 있음(${slots.map((b) => `${b.ivs.atk}/${b.ivs.def}/${b.ivs.sta} · ${b.productRank}위`).join(", ")} vs 이 개체 ${me.rank}위)`);
    }
    if (!ranked && !candidate && !reserve) continue;
    const top = ranked && sp.rank <= RULES.LEAGUE_TOP_RANK;
    const currentCp = input.cp && !forEvolve ? input.cp : calcCP({ atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }, cand, cand.level);
    if (currentCp > cap || cand.level > me.level) {
      tags.push({ name: TAG[league], tier: "none", reason: `현재 CP ${currentCp} > 상한 ${cap} → 불가`, metrics: { speciesRank: sp?.rank ?? null, productRank: me.rank, over: true } });
      continue;
    }
    let tier = null;
    // 4-B6.2: 보류 기준은 보관함 여유에 따라. 빠듯 = 500/100(기존), 그 외 = 800/200 (rulesOverride 로 비교 가능)
    const tight = (input.storageMode || ctx.storageMode) === "tight";
    const holdRank = tight ? rule(ctx, "LEAGUE_HOLD_PRODUCT_RANK_TIGHT") : rule(ctx, "LEAGUE_HOLD_PRODUCT_RANK");
    const midHoldRank = tight ? rule(ctx, "LEAGUE_MID_HOLD_PRODUCT_RANK_TIGHT") : rule(ctx, "LEAGUE_MID_HOLD_PRODUCT_RANK");
    const normalHold = ranked && capReached && ((top && me.rank <= holdRank) || (!top && me.rank <= midHoldRank)); // 4-D: 일반 보류도 상한 도달 개체만
    if (top && me.rank <= rule(ctx, "LEAGUE_MAIN_PRODUCT_RANK")) tier = "main";
    else if (normalHold) tier = "hold";
    else if (candidate) tier = "hold";
    else if (reserve) tier = "hold";
    if (!tier) continue;
    const moves = movesFromPvpoke(ctx.dataset, p, sp?.moveset);
    const rankTxt = ranked ? `PvPoke ${sp.rank}위` : sp ? `PvPoke ${sp.rank}위(200위 밖)` : "PvPoke 순위 없음";
    const candTxt = candidate && (!ranked || (!top && me.rank <= candidateRank && me.rank > midHoldRank)) ? ` · 리그 후보(스탯곱 상위 ${candidateRank}위 이내)` : "";
    const reserveTxt = reserve && tier === "hold" && !normalHold && !candidate ? ` · 리그 예비(컵 리그용, 내 ${p.nameKr} 중 ${rb.pos}위)` : "";
    tags.push({ name: TAG[league], tier, reason: `${rankTxt}·스탯곱 ${me.rank}/4096위 (L${me.level} CP${me.cp})${candTxt}${reserveTxt}${moves ? " · " + moveLine(moves) : ""}`, moves, metrics: { speciesRank: sp?.rank ?? null, top, productRank: me.rank, levelAtCap: me.level, cpAtCap: me.cp, capReached, candidate: candidate && (!ranked || (!top && me.rank <= candidateRank)), reserve: Boolean(reserveTxt) } });
  }

  // 4) 마스터리그
  {
    const lr = ctx.leagueRankings?.leagues?.master;
    if (!lr) warnings.push(`${TAG.master}: 데이터 없음(PvPoke 순위 미수신)`);
    else {
      const sp = leagueRankOf(ctx.leagueRankings, "master", p.pvpokeId, shadow);
      if (sp && sp.rank <= RULES.MASTER_TOP_RANK) {
        const tier = pct >= RULES.MASTER_MAIN_PCT ? "main" : pct >= RULES.MASTER_HOLD_PCT ? "hold" : null;
        const moves = movesFromPvpoke(ctx.dataset, p, sp.moveset);
        if (tier) tags.push({ name: TAG.master, tier, reason: `PvPoke ${sp.rank}위·개체값 ${pct}%${moves ? " · " + moveLine(moves) : ""}`, moves, metrics: { speciesRank: sp.rank, pct } });
      }
    }
  }

  // 5) 진화 대기(→최종형): 최종형 기준으로 위 태그 평가(후보 동일, 기술은 미정)
  // 4-D: 태그는 "진화 후보" 하나로 단일화(진화형·사탕은 사유에). 최종형이 여럿(이브이 등)이면 등급 높은 것 → 사탕 적은 것 하나만
  const evolveOptions = [];
  if (!forEvolve) {
    for (const f of finalForms(ctx.dataset, p)) {
      const sub = evaluateCandidate(f.species, cand, { ...input, cp: null, fast_move: null, charged_moves: [] }, ctx, rankings, { forEvolve: true });
      // 4-A2: 최종형이 "주력"일 때만 진화 대기 부여 (보류급이면 박사행)
      // 4-A2: 최종형이 "주력"일 때 진화 후보(주력). 4-C.4: 최종형의 "리그 후보" 보류(스탯곱 ≤41, D)도 진화 후보(보류)로 이어진다
      //   (실DB 결함: 찌르꼬 0/15/14 → 찌르호크 하이퍼 스탯곱 4위가 종 순위 200위 밖이라 D 보류였는데, 주력만 세어 진화 후보가 없었고 박사행이 됐다)
      const mains = sub.tags.filter((t) => t.tier === "main");
      // 4-F.4: 최종형이 레이드 상위종(top)인 보류(공격 IV·보관함 순위로 주력이 못 된 것)도 진화 후보(보류)로 잇는다 — 그림자 코일 → 그림자 자포코일(전기 상위)이 보호되지 않던 문제
      const candHolds = sub.tags.filter((t) => t.tier === "hold" && (t.metrics?.candidate || (t.metrics?.top && t.metrics?.type)));
      const useful = mains.length ? mains : candHolds;
      if (!useful.length) continue;
      // 4-C.2: 필요 사탕 ≥200(예: 잉어킹 400)이면 등급 상한 보류 — 진화까지 멀어 주력으로 세지 않는다
      const candyHold = f.candiesFromHere >= rule(ctx, "EVOLVE_CANDY_HOLD");
      const tier = candyHold || !mains.length ? "hold" : "main";
      const candy = (Number.isInteger(input.candy) ? (input.candy >= f.candiesFromHere ? `진화 가능(사탕 ${input.candy}/${f.candiesFromHere})` : `사탕 ${input.candy}/${f.candiesFromHere}`) : `사탕 ${f.candiesFromHere}개 필요`) + (candyHold ? ` · 사탕 ${rule(ctx, "EVOLVE_CANDY_HOLD")}개 이상 → 보류` : "");
      // 4-C: 최종형의 추천 기술(첫 주력 태그 기준)을 함께 표시. 30일 내 이벤트 대상이면 computeVerdict 에서 "📅 이벤트 때 진화" 를 붙인다
      const moves = useful.find((t) => t.moves)?.moves || null;
      evolveOptions.push({ name: TAG.evolve(), tier, reason: `→${f.species.nameKr} 기준: ${useful.map((t) => `${t.name} ${TIER_LABEL[t.tier]}`).join(", ")} · ${candy}${moves ? " · " + moveLine(moves) : ""}`, moves, metrics: { finalId: f.species.id, finalForm: f.species.form, finalKr: f.species.nameKr, candiesNeeded: f.candiesFromHere, candy: input.candy ?? null, finalTags: useful.map((t) => ({ name: t.name, tier: t.tier, moves: t.moves || null })) } });
    }
    if (evolveOptions.length) {
      evolveOptions.sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || a.metrics.candiesNeeded - b.metrics.candiesNeeded);
      const best = evolveOptions[0];
      if (evolveOptions.length > 1) { best.reason += ` (다른 진화형 ${evolveOptions.length - 1}: ${evolveOptions.slice(1).map((o) => o.metrics.finalKr).join(", ")})`; best.metrics.alternatives = evolveOptions.slice(1).map((o) => ({ finalId: o.metrics.finalId, finalKr: o.metrics.finalKr, tier: o.tier })); }
      tags.push(best);
    }
  }
  return { tags, warnings, pct, transferNotes };
}

function moveName(dataset, m) { return dataset.moveNamesKr?.[m] || m; }

// ─── 4-C 추천 기술 (기술 캡처 없음: 기술머신·이벤트로 바꾸므로 종 최적 조합을 안내) ───
// 반환 { fast, charged:[…], fastKr, chargedKr:[…], special:boolean(특수 기술머신 필요: 레거시·전용기) }
function specialSet(p) { return new Set([...(p.eliteFast || []), ...(p.eliteCharged || []), ...(p.signatureFast || []), ...(p.signatureCharged || [])]); }
export function recommendedMoves(dataset, p, fast, charged) {
  if (!fast && !charged) return null;
  const chargedList = (Array.isArray(charged) ? charged : [charged]).filter(Boolean);
  const sp = specialSet(p);
  return { fast: fast || null, charged: chargedList, fastKr: fast ? moveName(dataset, fast) : null, chargedKr: chargedList.map((m) => moveName(dataset, m)), special: [fast, ...chargedList].some((m) => m && sp.has(m)) };
}
// PvPoke moveset ID("FIRE_SPIN", "X_SCISSOR") → 데이터셋 기술명("Fire Spin", "X-Scissor"): 영숫자만 남겨 비교. 못 찾으면 ID 를 보기 좋게
const moveIndexMemo = new WeakMap();
function moveIndex(dataset) {
  if (moveIndexMemo.has(dataset)) return moveIndexMemo.get(dataset);
  const idx = new Map();
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const k of [...Object.keys(dataset.moveStats || {}), ...Object.keys(dataset.moveNamesKr || {})]) if (!idx.has(norm(k))) idx.set(norm(k), k);
  const out = { idx, norm };
  moveIndexMemo.set(dataset, out);
  return out;
}
export function pvpokeMoveToName(dataset, id) {
  if (!id) return null;
  const { idx, norm } = moveIndex(dataset);
  return idx.get(norm(id)) || String(id).toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function movesFromPvpoke(dataset, p, moveset) {
  if (!Array.isArray(moveset) || !moveset.length) return null;
  const names = moveset.map((m) => pvpokeMoveToName(dataset, m));
  return recommendedMoves(dataset, p, names[0], names.slice(1, 3));
}
// 표시용 한 줄: "추천 기술: 불꽃회오리/블라스트번 ⚠ 특수 기술머신"
export function moveLine(m) {
  if (!m) return "";
  const parts = [m.fastKr || m.fast, ...(m.chargedKr?.length ? m.chargedKr : m.charged || [])].filter(Boolean);
  return `추천 기술: ${parts.join("/")}${m.special ? " ⚠ 특수 기술머신" : ""}`;
}

// ─── 보관함 여유 적용 ───
function applyStorage(tags, p, input, ctx) {
  const mode = RULES.STORAGE_HOLD_LIMIT[input.storageMode || ctx.storageMode] !== undefined ? (input.storageMode || ctx.storageMode) : RULES.STORAGE_DEFAULT;
  const limit = RULES.STORAGE_HOLD_LIMIT[mode];
  const shadow = Boolean(input.is_shadow);
  const same = rowsOfSpecies(ctx.myRows, p, shadow, input.id);
  return tags.map((t) => {
    if (t.tier !== "hold") return t;
    if (limit === Infinity) return t;
    if (limit === 0) return { ...t, tier: "transfer", reason: `${t.reason} · 보관함 빠듯: 보류는 박사행 권장` };
    const held = same.filter((r) => Array.isArray(r.tags) && r.tags.includes(t.name)).length;
    if (held >= limit) return { ...t, tier: "transfer", reason: `${t.reason} · 보관함 보통: 같은 종·태그 이미 ${held}마리 → 박사행 권장` };
    return t;
  });
}

// ─── 메인 ───
export function computeVerdict(input, ctx) {
  const dataset = ctx.dataset;
  const p = findPokemon(dataset, { id: input.species_id, form: input.form || "Normal" });
  if (!p) return { tier: "need_appraisal", tags: [], collect: [], confident: false, basis: "server", summary: "❔ 종을 찾지 못했습니다", warnings: ["species_id 가 데이터셋에 없음"], disabled: [] };
  const rankings = getRankings(dataset);
  const cands = normalizeCandidates(input, p);
  const disabled = RULES.LUCKY_TRADE_YEAR == null ? ["lucky_trade_year"] : [];
  input = { ...input, caught_on: normalizeDate(input.caught_on) };
  const shadow = Boolean(input.is_shadow);

  if (!cands.length) {
    return { tier: "need_appraisal", tags: [], collect: collectFor(p, input, null, false), confident: false, basis: "server", species: { id: p.id, form: p.form, nameKr: p.nameKr },
      summary: `${TIER_LABEL.need_appraisal}: 개체값·CP 를 읽지 못했습니다`, candidates: 0, warnings: ["개체값 후보 없음"], disabled };
  }

  // 후보별 평가 → 태그별 단계 비교
  const evals = cands.map((c) => ({ cand: c, ...evaluateCandidate(p, c, input, ctx, rankings) }));
  const byName = new Map();
  for (const e of evals) {
    e.tags = applyStorage(e.tags, p, input, ctx);
    for (const t of e.tags) { if (!byName.has(t.name)) byName.set(t.name, []); byName.get(t.name).push(t); }
  }
  let confident = true;
  const tags = [];
  for (const [name, list] of byName) {
    const tiers = new Set(list.map((t) => t.tier));
    if (list.length < evals.length) tiers.add("none");
    const best = list.reduce((a, t) => (TIER_ORDER[t.tier] > TIER_ORDER[a.tier] ? t : a), list[0]);
    if (tiers.size > 1 && (tiers.has("main") || tiers.has("hold"))) { confident = false; tags.push({ ...best, tier: "need_appraisal", reason: `${best.reason} (후보 ${evals.length}개 중 판정 불일치: ${[...tiers].join("/")})` }); }
    else if (best.tier === "none") continue;
    else tags.push(best);
  }
  const overallOf = (list) => list.reduce((a, t) => (t.tier === "main" || t.tier === "hold" ? better(a, t.tier) : a), "transfer");
  const overallSet = new Set(evals.map((e) => overallOf(e.tags)));
  if (overallSet.size > 1) confident = false;
  let tier = confident ? overallOf(tags) : "need_appraisal";
  const warnings = [...new Set(evals.flatMap((e) => e.warnings))];

  // 이벤트 연동: 박사행 → 보류 상향
  let event = null;
  if (ctx.eventTargets?.length) {
    const fam = [...familyIds(dataset, p)].map((id) => findPokemon(dataset, { id })?.name).filter(Boolean);
    const hits = matchEvents(ctx.eventTargets, p.name, fam);
    if (hits.length) {
      const h = hits.sort((a, b) => a.start - b.start)[0];
      const date = new Date(h.start).toISOString().slice(0, 10);
      event = { name: h.name, label: h.label, type: h.type, date, start: h.start, end: h.end, link: h.link, note: `📅 ${date} ${h.label} 대상 — 박사행 보류(이벤트 때 진화하면 전용 기술)` };
      if (tier === "transfer") tier = "hold";
      // 4-C: 진화 대기 태그에 "📅 이벤트 때 진화" (이벤트 진화로 전용 기술을 얻으면 특수 기술머신 불필요)
      for (const t of tags) if (t.name.startsWith(EVOLVE_PREFIX)) { t.evolveAtEvent = `📅 이벤트 때 진화(${date} ${h.label})`; t.reason += ` · ${t.evolveAtEvent}`; }
    }
  }

  // 전설·환상·UB: 개체 무관 보관 권장(낮은 개체는 교환용) → 박사행이면 보류로 상향. 보관함 "빠듯"이면 박사행 권장 유지(💎 표시는 남김)
  let legendaryHold = false;
  const storageMode = (input.storageMode || ctx.storageMode) in RULES.STORAGE_HOLD_LIMIT ? (input.storageMode || ctx.storageMode) : RULES.STORAGE_DEFAULT;
  if (tier === "transfer" && isLegendaryClass(p) && storageMode !== "tight") { tier = "hold"; legendaryHold = true; }

  const allSame = evals.every((e) => e.cand.atk === evals[0].cand.atk && e.cand.def === evals[0].cand.def && e.cand.sta === evals[0].cand.sta);
  const collect = collectFor(p, input, allSame ? evals[0].cand : null, !legendaryHold && (tier === "main" || tier === "hold"));
  // 4-C.2 "수집" 태그: 100%·0%·반짝반짝·오래 전 포획(교환 시 반짝반짝). 이로치·배경·XXL 은 게임 검색어로 묶는다(정리 도우미)
  // 4-D3: 고개체(14+/14+/14+·100%)는 종과 무관하게 박사행 → 보류(수집). 실측: 피카츄 15/14/14 가 박사행 묶음에 들어가 수동 해제가 필요했음
  let collectHold = false;
  if (tier === "transfer" && collect.some((c) => c.hold)) { tier = "hold"; collectHold = true; }
  // 4-F.2 수집 관점(보관함 "여유"만): 같은 종·폼(그림자·정화·지역 폼 별개) 중 개체값 합 최고 1마리는 보류 "수집(종 대표)". 박사행은 "같은 종 더 좋은 개체 있음(…)" 으로 비교 대상 표기
  let repHold = false, repNote = "";
  // 4-F.4 A 불변: 종·폼·그림자·정화별 대표 1마리는 보관함 여유·보통·빠듯 모두 절대 박사행이 되지 않는다 (실DB: 그림자 코일 2마리가 모두 박사행 → 종 전체 소실)
  const rep = Number(rule(ctx, "COLLECT_REPRESENTATIVE")) !== 0 ? reserveRepresentative(ctx.reserve, input, p, allSame ? evals[0].cand : null) : null;
  if (rep && !rep.other) {
    const rare = rareFamilyNote(dataset, p);
    collect.push({ reason: `종 대표(내 ${p.nameKr}${shadow ? "(그림자)" : input.is_purified ? "(정화)" : ""} 중 ${rep.tie ? `동점 → ${rep.basis}` : "개체값 합 최고"}${rare ? " · 귀한 계열: " + rare : ""})`, rep: true, hold: true });
    if (tier === "transfer") { tier = "hold"; repHold = true; }
  }
  // 4-F.4 B 안농(201): 글자 폼을 구분하지 못해 전부 Normal 로 기록됨 → 글자 인식 전까지 박사행 제외·보류
  let formUnknownHold = false;
  if (tier === "transfer" && (rule(ctx, "FORM_UNKNOWN_HOLD_SPECIES") || []).includes(p.id)) { tier = "hold"; formUnknownHold = true; collect.push({ reason: "글자 구분 불가 — 수집 판단 보류", hold: true }); }
  // 4-F.3 박사행 사유: 탈락한 기준을 순서대로 — 리그 스탯곱 ≤500 개체는 리그 비교 먼저, 그다음 종 대표 (실측: 라이츄 1/13/15 가 종 대표와만 비교돼 표시됨)
  if (tier === "transfer") {
    const notes = [...new Set(evals.flatMap((e) => e.transferNotes || []))];
    if (rep?.other) notes.push(`종 대표: ${rep.ivs.atk}/${rep.ivs.def}/${rep.ivs.sta} CP${rep.cp ?? "?"}`);
    if (notes.length) repNote = " · " + notes.join(" · ");
  }
  const collectTag = collect.some((c) => c.collectTag);
  const summary = buildSummary(tier, tags, collect, event, evals[0].cand, allSame, legendaryHold || collectHold || repHold || formUnknownHold, collectHold, repHold, formUnknownHold) + repNote;
  // 4-C.2 맥스배틀 종(공개 데이터로 확인된 목록만): 판정 대신 "다이맥스 태그 권장" 안내
  const dynamax = isMaxBattleSpecies(ctx, p);
  const keptTags = tags.filter((t) => t.tier === "main" || t.tier === "hold").map((t) => t.name);
  const recommendedTags = dynamax ? [TAG.dynamax] : [...keptTags, ...(collectTag ? [TAG.collect] : []), ...(collect.some((c) => c.rep) ? [TAG.collectRep] : [])];
  return {
    tier: dynamax ? "hold" : tier, tags, collect, event, confident, basis: "server", disabled, warnings,
    summary: dynamax ? `🟡 보류: 맥스배틀 종 — "${TAG.dynamax}" 태그 권장(판정 대신 안내)${allSame ? ` [${evals[0].cand.atk}/${evals[0].cand.def}/${evals[0].cand.sta} L${evals[0].cand.level}]` : ""}` : summary,
    dynamax,
    species: { id: p.id, form: p.form, name: p.name, nameKr: p.nameKr, legendary: isLegendaryClass(p), pokemonClass: p.pokemonClass || null },
    candidates: evals.length,
    ivs: allSame ? { ...evals[0].cand, pct: evals[0].pct } : null,
    levelRange: [Math.min(...evals.map((e) => e.cand.level)), Math.max(...evals.map((e) => e.cand.level))],
    recommendedTags,
    purposes: purposesFromTags(keptTags),
    // 4-C: 보관(주력/보류) 태그별 추천 기술 { 태그명: {fast, charged, fastKr, chargedKr, special} }
    recommendedMoves: Object.fromEntries(tags.filter((t) => (t.tier === "main" || t.tier === "hold") && t.moves).map((t) => [t.name, t.moves])),
  };
}

function collectFor(p, input, cand, kept) {
  const out = [];
  if (input.is_shiny) out.push({ reason: "이로치" });
  if (input.is_lucky) out.push({ reason: "반짝반짝(럭키)", collectTag: true });
  if (cand) {
    const pct = ivPercent(cand);
    if (pct >= RULES.COLLECT_HUNDO_PCT) out.push({ reason: "개체값 100%", collectTag: true });
    if (cand.atk + cand.def + cand.sta === RULES.COLLECT_NUNDO_SUM) out.push({ reason: "개체값 0%(0/0/0)", collectTag: true });
    // 4-D3 고개체: 세 값 모두 ≥14 → 수집 보류(100% 는 위에서 이미 표기). 사용자 규칙: 박사행 대상에서 제외, 게임에서 "수집" 태그로 관리
    const m = RULES.COLLECT_HIGH_IV_MIN;
    if (m != null && cand.atk >= m && cand.def >= m && cand.sta >= m) {
      const hundo = out.find((c) => c.reason === "개체값 100%");
      if (hundo) hundo.hold = true; else out.push({ reason: `고개체(${m}+/${m}+/${m}+)`, collectTag: true, hold: true });
    }
  }
  if (isLegendaryClass(p)) {
    if (input.is_shadow || input.is_purified) out.push({ reason: `${input.is_shadow ? "그림자" : "정화"} 전설·환상 — 보관 권장` });
    else if (kept) out.push({ reason: "전설·환상 — 보관 권장" });
    else out.push({ reason: "교환용(전설·환상, 교환 시 개체값 재설정)" });
  }
  // 4-A2 교환 시 반짝반짝: 포획일 기준 (기기에서 읽은 날짜, 장소 없음). 이미 럭키면 해당 없음
  const lucky = luckyTradeReason(input.caught_on);
  if (lucky && !input.is_lucky) out.push({ reason: lucky, collectTag: true }); // 오래 전 포획(교환 시 반짝반짝)
  return out;
}

// 4-C.2 맥스배틀 종 판별: ctx.maxBattleSpecies(Set<"id:form"> 또는 Set<id>) — 공개 데이터로 확인된 목록만 (app/lib/maxBattleSpecies.js)
function isMaxBattleSpecies(ctx, p) {
  const set = ctx.maxBattleSpecies;
  if (!set || typeof set.has !== "function") return false;
  return set.has(`${p.id}:${p.form}`) || set.has(p.id);
}

const normalizeDate = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
export function luckyTradeReason(caughtOn) {
  const d = normalizeDate(caughtOn);
  if (!d) return null;
  const g = RULES.LUCKY_TRADE_GUARANTEED;
  if (g && d >= g.from && d <= g.to) return `교환 시 반짝반짝 확정(조건부: 2016-07~08 포획, 반짝반짝 보유 10마리 미만) — 포획 ${d}`;
  if (RULES.LUCKY_TRADE_YEAR != null && Number(d.slice(0, 4)) < RULES.LUCKY_TRADE_YEAR) return `교환 시 반짝반짝 확률↑(공식, 수치 비공개) — 포획 ${d}`;
  return null;
}

function buildSummary(tier, tags, collect, event, cand, allSame, legendaryHold, collectHold = false, repHold = false, formUnknownHold = false) {
  const kept = tags.filter((t) => t.tier === tier && (tier === "main" || tier === "hold"));
  let s;
  if (tier === "need_appraisal") s = `${TIER_LABEL.need_appraisal}${tags.length ? ": " + tags.map((t) => t.name).join(", ") : ""}`;
  else if (tier === "transfer") s = TIER_LABEL.transfer;
  else if (kept.length) s = `${TIER_LABEL[tier]}: ${kept[0].name} (${kept[0].reason})${kept.length > 1 ? " 외 " + (kept.length - 1) : ""}`;
  else s = `${TIER_LABEL[tier]}`;
  if (event && tier === "hold" && !kept.length) s = `${TIER_LABEL.hold}: ${event.note}`;
  else if (collectHold && !kept.length) s = `${TIER_LABEL.hold}: 고개체 수집(용도 태그 없음)`;
  else if (repHold && !kept.length) s = `${TIER_LABEL.hold}: 종 대표 수집(용도 태그 없음)`;
  else if (formUnknownHold && !kept.length) s = `${TIER_LABEL.hold}: 글자 구분 불가 — 수집 판단 보류`;
  else if (legendaryHold && !kept.length) s = `${TIER_LABEL.hold}: 전설·환상(용도 태그 없음)`;
  if (collect.length) s += ` → 💎 수집 추천: ${collect.map((c) => c.reason).join(", ")}`;
  if (cand && allSame) s += ` [${cand.atk}/${cand.def}/${cand.sta} L${cand.level}]`;
  return s;
}

// my_pokemon 행 → 입력
export function inputFromRow(r, storageMode) {
  return {
    id: r.id, reserveKey: `row:${r.id}`, species_id: r.species_id, form: r.form || "Normal", cp: r.cp || null, hp: r.hp || null, level: r.level || null,
    ivs: Number.isInteger(r.atk_iv) ? { atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv } : null,
    fast_move: r.fast_move || null, charged_moves: r.charged_moves || [],
    is_shadow: Boolean(r.is_shadow), is_purified: Boolean(r.is_purified), is_shiny: Boolean(r.is_shiny), is_lucky: Boolean(r.is_lucky),
    caught_on: r.caught_on || null,
    storageMode,
  };
}

// 입력 검증 (API 공용)
export function validateVerdictInput(b) {
  const errors = [];
  if (!b || typeof b !== "object") return { errors: ["본문이 객체가 아닙니다"] };
  if (!Number.isInteger(b.species_id) || b.species_id < 1 || b.species_id > 2000) errors.push("species_id 는 1~2000 정수");
  if (b.cp != null && !(Number.isInteger(b.cp) && b.cp >= 10 && b.cp <= 9999)) errors.push("cp 는 10~9999 정수");
  if (b.hp != null && !(Number.isInteger(b.hp) && b.hp >= 10 && b.hp <= 999)) errors.push("hp 는 10~999 정수");
  if (b.ivCandidates != null && !(Array.isArray(b.ivCandidates) && b.ivCandidates.length <= 4096)) errors.push("ivCandidates 는 배열(≤4096)");
  if (b.storageMode != null && !(b.storageMode in RULES.STORAGE_HOLD_LIMIT)) errors.push("storageMode 는 relaxed|normal|tight");
  if (b.candy != null && !(Number.isInteger(b.candy) && b.candy >= 0 && b.candy <= 99999)) errors.push("candy 는 0~99999 정수");
  if (b.caught_on != null && !(typeof b.caught_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.caught_on))) errors.push("caught_on 은 YYYY-MM-DD");
  return { errors };
}

export { calcHP };
