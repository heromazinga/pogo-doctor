// 4-A 판정 엔진 단위 테스트 (외부 데이터 불필요: 합성 데이터셋 + PvPoke 순위·이벤트 주입)
//   npm test  (node --test tests/*.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict, leagueProductTable, pvpokeMoveToName } from "../app/lib/verdict.js";
import { getRankings } from "../app/lib/speciesRankings.js";
import { extractEventTargets, matchEvents } from "../app/lib/eventTargets.js";
import { ivCandidates } from "../app/lib/ivCalc.js";
import { RULES, RULES_VERSION, TAG, purposesFromTags } from "../app/lib/verdictRules.js";
import { fillMissingVerdicts, isStaleVerdict, verdictForItem } from "../app/lib/scanVerdict.js";
import { buildReserveRanks } from "../app/lib/reserveRanks.js";
import { getRankings as getRankings2, budgetRankOf } from "../app/lib/speciesRankings.js";
import { calcHP } from "../app/lib/ivCalc.js";

// ── 합성 데이터셋 ──
const moveStats = {
  "Fire Spin": { type: "fire", kind: "fast", power: 14, durationMs: 1100, energy: 10 },
  "Tackle": { type: "normal", kind: "fast", power: 5, durationMs: 500, energy: 5 },
  "Blast Burn": { type: "fire", kind: "charged", power: 120, durationMs: 3500, energy: 50 },
  "Flamethrower": { type: "fire", kind: "charged", power: 70, durationMs: 2200, energy: 50 },
  "Ember": { type: "fire", kind: "fast", power: 10, durationMs: 1000, energy: 10 },
  "Bubble": { type: "water", kind: "fast", power: 12, durationMs: 1200, energy: 14 },
  "Hydro Pump": { type: "water", kind: "charged", power: 130, durationMs: 3300, energy: 100 },
  "Confusion": { type: "psychic", kind: "fast", power: 20, durationMs: 1600, energy: 15 },
  "Psystrike": { type: "psychic", kind: "charged", power: 90, durationMs: 2300, energy: 50 },
  "Lock-On": { type: "normal", kind: "fast", power: 1, durationMs: 300, energy: 5 },
  "Hyper Beam": { type: "normal", kind: "charged", power: 150, durationMs: 3800, energy: 100 },
  "Pound": { type: "normal", kind: "fast", power: 7, durationMs: 600, energy: 6 },
  "Quick Attack": { type: "normal", kind: "fast", power: 8, durationMs: 800, energy: 10 },
  "Air Slash": { type: "flying", kind: "fast", power: 14, durationMs: 1200, energy: 10 },
  "Hurricane": { type: "flying", kind: "charged", power: 110, durationMs: 2700, energy: 100 },
  "Charm": { type: "fairy", kind: "fast", power: 20, durationMs: 1500, energy: 11 },
  "Moonblast": { type: "fairy", kind: "charged", power: 130, durationMs: 3900, energy: 100 },
  "Gust": { type: "flying", kind: "fast", power: 25, durationMs: 2000, energy: 20 },
  "Hidden Power": { type: "normal", kind: "fast", power: 15, durationMs: 1500, energy: 15 },
  "Thunder Shock": { type: "electric", kind: "fast", power: 5, durationMs: 600, energy: 8 },
  "Thunderbolt": { type: "electric", kind: "charged", power: 80, durationMs: 2500, energy: 50 },
  "Giga Impact": { type: "normal", kind: "charged", power: 200, durationMs: 4700, energy: 100 },
};
const sp = (id, name, nameKr, types, atk, def, sta, fast, charged, extra = {}) => ({
  id, form: "Normal", name, nameKr, types, baseAttack: atk, baseDefense: def, baseStamina: sta, fast, charged,
  eliteFast: [], eliteCharged: [], signatureFast: [], signatureCharged: [], released: true, pokemonClass: null, evolutions: [], pvpokeId: name.toLowerCase(), shadowEligible: true, ...extra,
});
// 체육관 상위 20 을 채우는 내구형 더미(기술 없음 → 레이드 순위에 안 오름)
const fillers = Array.from({ length: 25 }, (_, i) => sp(900 + i, `Filler${i}`, `더미${i}`, ["normal"], 100, 250 + i, 250, [], []));
const dataset = {
  generatedAt: "test",
  moveStats,
  moveNamesKr: { "Blast Burn": "블라스트번", "Fire Spin": "불꽃회오리" },
  pokemon: [
    sp(815, "Cinderace", "에이스번", ["fire"], 238, 163, 190, ["Tackle", "Fire Spin"], ["Flamethrower"], { eliteCharged: ["Blast Burn"] }),
    sp(6, "Charizard", "리자몽", ["fire", "flying"], 223, 173, 186, ["Fire Spin"], ["Blast Burn"]),
    sp(4, "Charmander", "파이리", ["fire"], 116, 93, 118, ["Ember"], ["Flamethrower"], { evolutions: [{ id: 5, form: "Normal", candies: 25 }] }),
    sp(5, "Charmeleon", "리자드", ["fire"], 158, 126, 151, ["Ember"], ["Flamethrower"], { evolutions: [{ id: 6, form: "Normal", candies: 100 }] }),
    sp(184, "Azumarill", "마릴리", ["water", "fairy"], 112, 152, 225, ["Bubble"], ["Hydro Pump"]),
    sp(129, "Magikarp", "잉어킹", ["water"], 29, 85, 85, [], [], { evolutions: [{ id: 130, form: "Normal", candies: 400 }] }),
    sp(130, "Gyarados", "갸라도스", ["water", "flying"], 237, 186, 216, ["Bubble"], ["Hydro Pump"]),
    // 4-C.3 실DB 사례: 찌르꼬 0/15/14 L2 CP null HP22 → 찌르호크(하이퍼 상위종) 기준 진화 후보
    sp(396, "Starly", "찌르꼬", ["normal", "flying"], 101, 58, 120, ["Tackle"], ["Hyper Beam"], { evolutions: [{ id: 397, form: "Normal", candies: 25 }] }),
    sp(397, "Staravia", "찌르버드", ["normal", "flying"], 142, 94, 146, ["Tackle"], ["Hyper Beam"], { evolutions: [{ id: 398, form: "Normal", candies: 100 }] }),
    sp(398, "Staraptor", "찌르호크", ["normal", "flying"], 234, 140, 198, ["Quick Attack"], ["Hyper Beam"]),
    // 4-D 실DB 사례: 도치마론(PvPoke 슈퍼 1080위, L50 에도 1500 미도달) 15/15/12 가 스탯곱 상위로 보류되던 것 → 제외
    sp(650, "Chespin", "도치마론", ["grass"], 110, 106, 148, [], []),
    // 4-D3 실DB 사례: 피카츄 15/14/14 가 박사행 → 고개체 수집 보류 (진화형은 테스트에 불필요)
    sp(25, "Pikachu", "피카츄", ["electric"], 112, 96, 111, ["Thunder Shock"], ["Thunderbolt"]),
    // 4-F 실DB 사례: 라이츄(관동) 3/13/13 CP1480 슈퍼리그 스탯곱 391위(PvPoke 순위 밖)가 박사행 → 리그 예비 보류
    sp(26, "Raichu", "라이츄", ["electric"], 193, 151, 155, ["Thunder Shock"], ["Thunderbolt"]),
    // 4-F 가성비 풀 검증용 전설 전기(라이츄가 전체 1위 대비 <65% 가 되도록 종족값 과장)
    sp(644, "Zekrom", "제크로무", ["dragon", "electric"], 400, 300, 300, ["Thunder Shock"], ["Thunderbolt"], { pokemonClass: "legendary", shadowEligible: false }),
    sp(150, "Mewtwo", "뮤츠", ["psychic"], 300, 182, 214, ["Confusion"], ["Psystrike"], { pokemonClass: "legendary" }),
    sp(999, "Weakmon", "약한몬", ["normal"], 50, 50, 50, [], [], { pokemonClass: "legendary" }),
    // 4-A2: 타입 1위 대비 비율 검증용. 노말 1위 폴리곤Z, 비행 1위 레쿠쟈(전설), 페어리는 님피아뿐
    sp(486, "Regigigas", "레지기가스", ["normal"], 287, 210, 221, ["Hidden Power"], ["Giga Impact"], { pokemonClass: "legendary", shadowEligible: false }),
    sp(474, "Porygon-Z", "폴리곤Z", ["normal"], 264, 150, 198, ["Lock-On", "Hidden Power"], ["Hyper Beam"], { shadowEligible: false }),
    sp(384, "Rayquaza", "레쿠쟈", ["dragon", "flying"], 284, 170, 213, ["Air Slash"], ["Hurricane"], { pokemonClass: "legendary", shadowEligible: false }),
    sp(16, "Pidgey", "구구", ["normal", "flying"], 85, 73, 120, ["Tackle", "Quick Attack"], ["Hyper Beam"], { evolutions: [{ id: 17, form: "Normal", candies: 12 }] }),
    sp(17, "Pidgeotto", "피죤", ["normal", "flying"], 117, 105, 160, ["Tackle"], ["Hyper Beam"], { evolutions: [{ id: 18, form: "Normal", candies: 50 }] }),
    sp(18, "Pidgeot", "피죤투", ["normal", "flying"], 166, 154, 195, ["Gust", "Air Slash"], ["Hurricane", "Hyper Beam"]),
    sp(242, "Blissey", "해피너스", ["normal"], 129, 169, 496, ["Pound"], ["Hyper Beam"]),
    sp(700, "Sylveon", "님피아", ["fairy"], 203, 205, 216, ["Charm", "Quick Attack"], ["Moonblast", "Hyper Beam"]),
    // 4-B6.2: 실DB 사례(저승갓숭 0/11/14 L28.5 CP2461, 하이퍼 스탯곱 594위). 기술 없음 → 레이드 순위 없음, 리그만 검증
    sp(979, "Annihilape", "저승갓숭", ["fighting", "ghost"], 220, 178, 242, [], []),
    ...fillers,
  ],
};
const mk = (entries) => { const m = new Map(); entries.forEach((id, i) => m.set(id, { rank: i + 1, score: 100 - i, name: id })); return m; };
const leagueRankings = { fetchedAt: "t", errors: {}, leagues: { great: mk(["azumarill", "cinderace"]), ultra: mk(["charizard", "annihilape", "staraptor"]), master: mk(["mewtwo"]) } };
// 4-F: 테스트 데이터셋은 종이 적어 가성비 순위가 항상 ≤12 이므로 기본 ctx 는 초보자 기준을 끈다(BEGINNER_RULES 0). 4-F 테스트만 켠다
const ctx = (over = {}) => ({ dataset, leagueRankings, eventTargets: [], myRows: [], storageMode: "normal", rulesOverride: { BEGINNER_RULES: 0 }, ...over });
const tagOf = (v, name) => v.tags.find((t) => t.name === name);

test("에이스번 15/14/14 L40 + 블라스트번 → 불꽃 레이드 주력", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40, fast_move: "Fire Spin", charged_moves: ["Blast Burn"] }, ctx());
  assert.equal(v.tier, "main");
  const t = tagOf(v, TAG.raid("불꽃"));
  assert.equal(t.tier, "main");
  assert.ok(t.metrics.speciesRank <= RULES.RAID_TOP_RANK);
  assert.equal(t.metrics.notes.length, 0, "전용기 보유 → 특수 기술머신 안내 없음");
  assert.ok(v.confident);
  assert.deepEqual(v.purposes, ["raid"]);
});

test("에이스번에 블라스트번이 없으면 '특수 기술머신 필요' 표기, 종 순위는 최적 기술 기준 유지", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40, fast_move: "Fire Spin", charged_moves: ["Flamethrower"] }, ctx());
  const t = tagOf(v, TAG.raid("불꽃"));
  assert.ok(t.metrics.notes.some((n) => n.includes("특수 기술머신 필요")), t.metrics.notes.join());
  assert.equal(t.metrics.speciesRank, tagOf(computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx()), TAG.raid("불꽃")).metrics.speciesRank);
});

test("4-C 추천 기술: 기술 미입력이어도 경고 없이 태그별 추천 기술(종 최적 조합)·특수 기술머신 표기, recommendedMoves, 리그는 PvPoke moveset", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx());
  const t = tagOf(v, TAG.raid("불꽃"));
  assert.ok(!t.reason.includes("기술 확인 필요"), t.reason);
  assert.deepEqual(t.moves, { fast: "Fire Spin", charged: ["Blast Burn"], fastKr: "불꽃회오리", chargedKr: ["블라스트번"], special: true });
  assert.ok(t.reason.includes("추천 기술: 불꽃회오리/블라스트번 ⚠ 특수 기술머신"), t.reason);
  assert.deepEqual(v.recommendedMoves[TAG.raid("불꽃")], t.moves);
  // 리자몽: 블라스트번이 일반 기술 → 특수 기술머신 아님
  const c = tagOf(computeVerdict({ species_id: 6, ivs: { atk: 15, def: 15, sta: 15 }, level: 40 }, ctx()), TAG.raid("불꽃"));
  assert.equal(c.moves.special, false); assert.ok(!c.reason.includes("⚠ 특수 기술머신"));
  // 리그: PvPoke moveset ID → 데이터셋 기술명·한국어명
  const lr = { ...leagueRankings, leagues: { ...leagueRankings.leagues, great: new Map([["azumarill", { rank: 1, score: 100, moveset: ["BUBBLE", "HYDRO_PUMP"] }]]) } };
  const a = tagOf(computeVerdict({ species_id: 184, ivs: { atk: 0, def: 15, sta: 15 }, level: 20 }, ctx({ leagueRankings: lr })), TAG.great);
  assert.deepEqual(a.moves, { fast: "Bubble", charged: ["Hydro Pump"], fastKr: "Bubble", chargedKr: ["Hydro Pump"], special: false });
  assert.equal(pvpokeMoveToName(dataset, "X_SCISSOR"), "X Scissor", "데이터셋에 없으면 보기 좋게");
  // 진화 대기: 최종형 추천 기술 + 30일 내 이벤트면 "📅 이벤트 때 진화"
  const now = Date.now();
  const targets = extractEventTargets([{ name: "Charmander Community Day", eventType: "community-day", start: new Date(now + 5 * 86400000).toISOString(), end: new Date(now + 5 * 86400000 + 3600000).toISOString(), extraData: { communityday: { spawns: [{ name: "Charmander" }] } } }], now);
  const ev = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx({ eventTargets: targets }));
  const e = tagOf(ev, TAG.evolve("리자몽"));
  assert.ok(e, ev.tags.map((x) => x.name).join());
  assert.equal(e.moves?.fast, "Fire Spin");
  assert.ok(e.evolveAtEvent?.startsWith("📅 이벤트 때 진화"), e.reason);
});

test("기술 미입력 → 경고 대신 추천 기술 (4-C 이전 '기술 확인 필요' 문구 폐지)", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx());
  const t = tagOf(v, TAG.raid("불꽃"));
  assert.equal(t.metrics.notes.length, 0, "경고 없음");
  assert.ok(t.moves && t.reason.includes("추천 기술:"));
});

test("내 목록 같은 종 안에서 공격 IV 순위 7위 이상이면 보류", () => {
  const myRows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, species_id: 815, form: "Normal", atk_iv: 15, def_iv: 15, sta_iv: 15, level: 50, is_shadow: false, status: "keep", tags: [] }));
  const v = computeVerdict({ species_id: 815, ivs: { atk: 14, def: 14, sta: 14 }, level: 40 }, ctx({ myRows }));
  const t = tagOf(v, TAG.raid("불꽃"));
  assert.equal(t.metrics.indivRank, 7);
  assert.equal(t.tier, "hold");
  assert.equal(v.tier, "hold");
});

test("슈퍼리그 상위종 마릴리 0/15/15 → 슈퍼리그 주력 (%는 67 이지만 스탯곱 1위)", () => {
  const v = computeVerdict({ species_id: 184, ivs: { atk: 0, def: 15, sta: 15 }, level: 20, cp: 900 }, ctx());
  const t = tagOf(v, TAG.great);
  assert.equal(t.tier, "main");
  assert.equal(t.metrics.productRank, 1);
  assert.equal(leagueProductTable(dataset.pokemon.find((p) => p.id === 184), 1500, 50).top.a, 0);
});

test("현재 CP 가 리그 상한 초과면 해당 리그 불가", () => {
  const v = computeVerdict({ species_id: 184, ivs: { atk: 0, def: 15, sta: 15 }, level: 50, cp: 1600 }, ctx());
  assert.equal(tagOf(v, TAG.great), undefined);
  assert.ok(!v.recommendedTags.includes(TAG.great));
});

test("약한 종 15/15/15 → 💎 수집 추천(100%) (4-C.2: 잉어킹은 진화 후보(→갸라도스) 사탕 400 → 보류, 진화 없는 약한 종은 박사행)", () => {
  const v = computeVerdict({ species_id: 129, ivs: { atk: 15, def: 15, sta: 15 }, level: 10 }, ctx());
  assert.equal(v.tier, "hold"); assert.equal(tagOf(v, TAG.evolve("갸라도스"))?.tier, "hold");
  assert.ok(v.recommendedTags.includes(TAG.collect));
  const w = computeVerdict({ species_id: 129, ivs: { atk: 15, def: 15, sta: 15 }, level: 10 }, ctx({ dataset: { ...dataset, pokemon: dataset.pokemon.map((p) => (p.id === 129 ? { ...p, evolutions: [] } : p)) } }));
  assert.equal(w.tier, "hold", "4-D3: 100% 도 고개체 규칙(14+/14+/14+)으로 보류");
  assert.ok(v.collect.some((c) => c.reason === "개체값 100%"));
  assert.ok(v.summary.includes("💎"));
});

test("0/0/0 → 💎 수집 추천(0%)", () => {
  const v = computeVerdict({ species_id: 129, ivs: { atk: 0, def: 0, sta: 0 }, level: 10 }, ctx());
  assert.ok(v.collect.some((c) => c.reason.includes("0%")));
});

test("전설 5/7/3 (용도 없음) → 박사행 아님(보류) + 💎 교환용", () => {
  const v = computeVerdict({ species_id: 999, ivs: { atk: 5, def: 7, sta: 3 }, level: 20 }, ctx());
  assert.notEqual(v.tier, "transfer");
  assert.equal(v.tier, "hold");
  assert.ok(v.collect.some((c) => c.reason.startsWith("교환용")));
  assert.equal(tagOf(v, TAG.gym), undefined, "전설은 체육관 방어 태그 없음");
});

test("전설 상위종(뮤츠) 5/7/3 → 공격 IV 하한 미달로 레이드 태그 없음(4-B6), 보류 + 💎 교환용, 마스터리그는 % 미달", () => {
  const v = computeVerdict({ species_id: 150, ivs: { atk: 5, def: 7, sta: 3 }, level: 30 }, ctx());
  assert.equal(tagOf(v, TAG.raid("에스퍼")), undefined);
  assert.equal(tagOf(v, TAG.master), undefined);
  assert.equal(v.tier, "hold");
  assert.ok(v.collect.some((c) => c.reason.startsWith("교환용")));
  const v2 = computeVerdict({ species_id: 150, ivs: { atk: 12, def: 7, sta: 3 }, level: 30 }, ctx());
  assert.equal(tagOf(v2, TAG.raid("에스퍼")).tier, "main");
});

test("4-B6 레이드 공격 IV 하한: 0/15/15 → 레이드 태그 없음, 10~11 → 보류(주력 불가), 12+ → 주력. 섀도도 동일. 기준 덮어쓰기(rulesOverride)", () => {
  const none = computeVerdict({ species_id: 815, ivs: { atk: 0, def: 15, sta: 15 }, level: 40 }, ctx());
  assert.equal(tagOf(none, TAG.raid("불꽃")), undefined, "저승갓숭 사례: 공격 0 은 레이드 묶음에 들어가면 안 됨");
  assert.equal(tagOf(computeVerdict({ species_id: 815, ivs: { atk: 9, def: 15, sta: 15 }, level: 40 }, ctx()), TAG.raid("불꽃")), undefined);
  assert.equal(tagOf(computeVerdict({ species_id: 815, ivs: { atk: 11, def: 15, sta: 15 }, level: 40 }, ctx()), TAG.raid("불꽃")).tier, "hold");
  assert.equal(tagOf(computeVerdict({ species_id: 815, ivs: { atk: 12, def: 15, sta: 15 }, level: 40 }, ctx()), TAG.raid("불꽃")).tier, "main");
  assert.equal(tagOf(computeVerdict({ species_id: 815, ivs: { atk: 11, def: 15, sta: 15 }, level: 40, is_shadow: true }, ctx()), TAG.raid("불꽃")).tier, "hold");
  assert.equal(RULES.RAID_MIN_ATK_IV, 10); assert.equal(RULES.RAID_MAIN_MIN_ATK_IV, 12);
  const before = computeVerdict({ species_id: 815, ivs: { atk: 0, def: 15, sta: 15 }, level: 40 }, ctx({ rulesOverride: { RAID_MIN_ATK_IV: 0, RAID_MAIN_MIN_ATK_IV: 0 } }));
  assert.equal(tagOf(before, TAG.raid("불꽃")).tier, "main", "수정 전 기준 재현");
});

test("4-B6.2 리그 보류 완화: 저승갓숭 0/11/14 L28.5 CP2461(하이퍼 스탯곱 594위) → 보통/여유 보류(≤800), 빠듯은 기존 500 유지 → 태그 없음·박사행", () => {
  const p = dataset.pokemon.find((x) => x.id === 979);
  const me = leagueProductTable(p, 2500, 50).rank.get("0,11,14");
  assert.ok(me.rank > 500 && me.rank <= 800, `스탯곱 순위 ${me.rank} (실DB explain: 594)`);
  const input = { species_id: 979, ivs: { atk: 0, def: 11, sta: 14 }, level: 28.5, cp: 2461 };
  const normal = computeVerdict(input, ctx());
  assert.equal(tagOf(normal, TAG.ultra).tier, "hold");
  assert.equal(normal.tier, "hold");
  assert.equal(tagOf(computeVerdict(input, ctx({ storageMode: "relaxed" })), TAG.ultra).tier, "hold");
  const tight = computeVerdict(input, ctx({ storageMode: "tight" }));
  assert.equal(tagOf(tight, TAG.ultra), undefined, "빠듯: 500 기준 유지");
  assert.equal(tight.tier, "transfer");
  const before = computeVerdict(input, ctx({ rulesOverride: { LEAGUE_HOLD_PRODUCT_RANK: 500, LEAGUE_MID_HOLD_PRODUCT_RANK: 100 } }));
  assert.equal(tagOf(before, TAG.ultra), undefined, "완화 전 기준 재현(stats 비교용)");
  assert.equal(RULES.LEAGUE_HOLD_PRODUCT_RANK, 800); assert.equal(RULES.LEAGUE_MID_HOLD_PRODUCT_RANK, 200);
  assert.equal(RULES.LEAGUE_HOLD_PRODUCT_RANK_TIGHT, 500); assert.equal(RULES.LEAGUE_MID_HOLD_PRODUCT_RANK_TIGHT, 100);
});

test("4-B6.2 판정 최신화: 저장된 판정의 rulesVersion 이 다르면 다시 계산·저장, 같으면 유지", async () => {
  const updates = [];
  const sb = { from: () => ({ update: (patch) => ({ eq: async (_k, id) => { updates.push({ id, patch }); return {}; } }) }) };
  const base = { species_id: 979, form: "Normal", atk_iv: 0, def_iv: 11, sta_iv: 14, level: 28.5, cp: 2461, hp: 150 };
  const items = [
    { id: "a", ...base, verdict: null },
    { id: "b", ...base, verdict: { tier: "transfer", recommendedTags: [], tags: [], rulesVersion: "old" } },
    { id: "c", ...base, verdict: { tier: "hold", recommendedTags: [TAG.ultra], tags: [], rulesVersion: RULES_VERSION } },
    { id: "d", ...base, verdict: { tier: "need_appraisal", error: true } },
  ];
  const r = await fillMissingVerdicts(sb, items, ctx());
  assert.equal(r.filled, 3); assert.equal(r.pending, 0); assert.equal(r.stale, 3);
  assert.deepEqual(updates.map((u) => u.id), ["a", "b", "d"]);
  // 4-D2 청크: limit 2 → 2건만 처리, 1건 pending. 다음 호출이 이어서 처리
  const items2 = [{ id: "x", ...base, verdict: null }, { id: "y", ...base, verdict: null }, { id: "z", ...base, verdict: null }];
  const r2 = await fillMissingVerdicts(sb, items2, ctx(), { limit: 2 });
  assert.equal(r2.filled, 2); assert.equal(r2.pending, 1); assert.equal(items2[2].verdict, null);
  const r3 = await fillMissingVerdicts(sb, items2, ctx(), { limit: 2 });
  assert.equal(r3.filled, 1); assert.equal(r3.pending, 0);
  // 시간 예산 0ms → 첫 항목도 처리 전에 중단? (예산 검사는 항목 시작 전) → 0건, 전부 pending
  const items3 = [{ id: "p", ...base, verdict: null }];
  const r4 = await fillMissingVerdicts(sb, items3, ctx(), { budgetMs: -1 });
  assert.equal(r4.filled, 0); assert.equal(r4.pending, 1);
  assert.equal(items[1].verdict.tier, "hold", "옛 규칙(박사행)으로 저장된 판정이 새 규칙(보류)으로 갱신됨");
  assert.equal(items[1].verdict.rulesVersion, RULES_VERSION);
  assert.equal(items[2].verdict.rulesVersion, RULES_VERSION);
  assert.ok(isStaleVerdict(undefined) && isStaleVerdict({ error: true }) && isStaleVerdict({ rulesVersion: "x" }) && !isStaleVerdict({ rulesVersion: RULES_VERSION }));
});

test("4-C.2 E 진화 후보: 이름 '진화 후보(→X)', 필요 사탕 ≥200(잉어킹 400)이면 등급 상한 보류, 125(파이리)는 주력 유지", () => {
  assert.equal(TAG.evolve("갸라도스"), "진화 후보"); // 4-D: 단일 태그, 진화형은 사유에
  const karp = computeVerdict({ species_id: 129, ivs: { atk: 15, def: 12, sta: 11 }, level: 20 }, ctx());
  const t = tagOf(karp, TAG.evolve("갸라도스"));
  assert.ok(t, karp.tags.map((x) => x.name).join());
  assert.equal(t.tier, "hold"); assert.ok(t.reason.includes("사탕 200개 이상 → 보류"), t.reason);
  assert.equal(karp.tier, "hold", "잉어킹 15/12/11 사탕 400 → 현재 주력이 아니라 보류");
  assert.equal(tagOf(computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx()), TAG.evolve("리자몽")).tier, "main");
  assert.equal(RULES.EVOLVE_CANDY_HOLD, 200);
});

test("4-C.2 D 리그 후보: 스탯곱 순위 ≤41 이면 PvPoke 200위 밖 종도 보류, 순위 파일에 없는 종·스탯곱 순위 밖 개체는 태그 없음", () => {
  const p = dataset.pokemon.find((x) => x.id === 700); // 님피아: 슈퍼 300위(200위 밖)로 주입
  const great = new Map([...leagueRankings.leagues.great, ["sylveon", { rank: 300, score: 60, name: "Sylveon" }]]);
  const lr = { ...leagueRankings, leagues: { ...leagueRankings.leagues, great } };
  const table = leagueProductTable(p, 1500, 50);
  const best = [...table.rank.entries()].find(([, v]) => v.rank === 1)[0].split(",").map(Number);
  const v = computeVerdict({ species_id: 700, ivs: { atk: best[0], def: best[1], sta: best[2] }, level: 15 }, ctx({ leagueRankings: lr }));
  const t = tagOf(v, TAG.great);
  assert.ok(t, v.tags.map((x) => x.name).join()); assert.equal(t.tier, "hold"); assert.equal(t.metrics.candidate, true); assert.ok(t.reason.includes("리그 후보") && t.reason.includes("200위 밖"), t.reason);
  const worst = [...table.rank.entries()].find(([, v]) => v.rank === 3000)[0].split(",").map(Number);
  assert.equal(tagOf(computeVerdict({ species_id: 700, ivs: { atk: worst[0], def: worst[1], sta: worst[2] }, level: 15 }, ctx({ leagueRankings: lr })), TAG.great), undefined, "스탯곱 3000위 → 없음");
  assert.equal(tagOf(computeVerdict({ species_id: 700, ivs: { atk: best[0], def: best[1], sta: best[2] }, level: 15 }, ctx()), TAG.great), undefined, "순위 파일에 없는 종 → 없음");
  assert.equal(RULES.LEAGUE_CANDIDATE_PRODUCT_RANK, 41);
});

test("4-C.3 결함 1: 찌르꼬 0/15/14 L2 CP null HP22 → CP 없어도 HP 로 레벨 후보(L40 가정 금지) → 진화 후보(→찌르호크) 하이퍼 주력, 박사행 아님", () => {
  const base = { atk: 101, def: 58, sta: 120 };
  const hp = calcHP(base.sta, 14, 2);
  const v = computeVerdict({ species_id: 396, ivs: { atk: 0, def: 15, sta: 14 }, level: null, cp: null, hp }, ctx());
  assert.ok(v.levelRange[1] <= 5, `HP ${hp} 로 레벨 후보 ${v.levelRange.join("~")} (L40 가정이면 실패)`);
  const t = tagOf(v, TAG.evolve("찌르호크"));
  assert.ok(t, v.tags.map((x) => x.name).join());
  assert.equal(t.tier, "main"); assert.ok(t.metrics.finalTags.some((x) => x.name === TAG.ultra), JSON.stringify(t.metrics.finalTags));
  assert.notEqual(v.tier, "transfer");
  // 스캔 기록 재계산 경로(verdictForItem: level null, ivCandidates 없음)도 동일
  const s = verdictForItem({ species_id: 396, form: "Normal", atk_iv: 0, def_iv: 15, sta_iv: 14, level: null, cp: null, hp }, ctx());
  assert.notEqual(s.tier, "transfer"); assert.ok(s.recommendedTags.includes(TAG.evolve("찌르호크")));
});

test("4-C.4 결함 3: 최종형이 리그 후보(D, 종 PvPoke 200위 밖·스탯곱 ≤41) 보류면 진화 후보(보류)로 이어진다 — 찌르꼬 0/15/14 HP22, 찌르호크 하이퍼 300위 가정", () => {
  const ultra = new Map([...leagueRankings.leagues.ultra].filter(([k]) => k !== "staraptor").concat([["staraptor", { rank: 300, score: 50, name: "Staraptor" }]]));
  const lr = { ...leagueRankings, leagues: { ...leagueRankings.leagues, ultra } };
  const hp = calcHP(120, 14, 2);
  const v = computeVerdict({ species_id: 396, ivs: { atk: 0, def: 15, sta: 14 }, level: null, cp: null, hp }, ctx({ leagueRankings: lr }));
  const t = tagOf(v, TAG.evolve("찌르호크"));
  assert.ok(t, v.tags.map((x) => x.name).join());
  assert.equal(t.tier, "hold"); assert.ok(t.metrics.finalTags.some((x) => x.name === TAG.ultra && x.tier === "hold"), JSON.stringify(t.metrics.finalTags));
  assert.equal(v.tier, "hold"); assert.ok(v.recommendedTags.includes(TAG.evolve("찌르호크")));
  // 찌르호크가 PvPoke 파일에 아예 없으면(D 제외 규칙) 진화 후보 없음 → 박사행 (실DB explain 으로 확인할 지점)
  const none = { ...leagueRankings, leagues: { ...leagueRankings.leagues, ultra: new Map([...leagueRankings.leagues.ultra].filter(([k]) => k !== "staraptor")) } };
  assert.equal(computeVerdict({ species_id: 396, ivs: { atk: 0, def: 15, sta: 14 }, level: null, cp: null, hp }, ctx({ leagueRankings: none })).tier, "transfer");
});

test("4-D 리그 후보 축소: PvPoke ≤300 AND 상한 도달(레벨<50, CP ≥ 상한×0.97)만. 도치마론 15/15/12(슈퍼 1080위·미도달) 제외, 찌르꼬(찌르호크 하이퍼 L36 CP2497) 유지, 일반 보류도 미도달 제외", () => {
  const great = new Map([...leagueRankings.leagues.great, ["chespin", { rank: 1080, score: 40, name: "Chespin" }]]);
  const ultra = new Map([...leagueRankings.leagues.ultra].filter(([k]) => k !== "staraptor").concat([["staraptor", { rank: 250, score: 60, name: "Staraptor" }]]));
  const lr = { ...leagueRankings, leagues: { ...leagueRankings.leagues, great, ultra } };
  const ches = computeVerdict({ species_id: 650, ivs: { atk: 15, def: 15, sta: 12 }, level: 30 }, ctx({ leagueRankings: lr }));
  assert.equal(tagOf(ches, TAG.great), undefined, ches.tags.map((t) => `${t.name}:${t.tier}`).join());
  const hp = calcHP(120, 14, 2);
  const star = computeVerdict({ species_id: 396, ivs: { atk: 0, def: 15, sta: 14 }, level: null, cp: null, hp }, ctx({ leagueRankings: lr }));
  const t = tagOf(star, TAG.evolve());
  assert.ok(t && t.tier === "hold", star.tags.map((x) => `${x.name}:${x.tier}`).join());
  assert.ok(t.metrics.finalTags.some((x) => x.name === TAG.ultra), "찌르호크 하이퍼 상한 도달(L36 CP≈2497 ≥ 2425)");
  // PvPoke 301위면 리그 후보 아님
  const far = { ...lr, leagues: { ...lr.leagues, ultra: new Map([...ultra].filter(([k]) => k !== "staraptor").concat([["staraptor", { rank: 301, score: 60, name: "Staraptor" }]])) } };
  assert.equal(computeVerdict({ species_id: 396, ivs: { atk: 0, def: 15, sta: 14 }, level: null, cp: null, hp }, ctx({ leagueRankings: far })).tier, "transfer");
  // 일반 보류(상위종)도 상한 미도달이면 제외: 리자몽 슈퍼 1위로 주입, 0/0/0 은 L50 에 1500 도달 → 보류 여부는 스탯곱 순위로만; 도치마론을 상위종(1위)으로 주입해도 미도달이면 없음
  const great2 = new Map([["chespin", { rank: 1, score: 100, name: "Chespin" }], ...leagueRankings.leagues.great]);
  const ches2 = computeVerdict({ species_id: 650, ivs: { atk: 5, def: 15, sta: 15 }, level: 30 }, ctx({ leagueRankings: { ...lr, leagues: { ...lr.leagues, great: great2 } } }));
  const g2 = tagOf(ches2, TAG.great);
  assert.ok(!g2 || g2.tier === "main", `미도달 상위종은 보류 없음(주력은 스탯곱 ≤100 기준 그대로): ${g2?.tier}`);
  assert.equal(RULES.LEAGUE_CANDIDATE_SPECIES_RANK, 300); assert.equal(RULES.LEAGUE_CAP_REACH_PCT, 0.97);
});

test("4-D 진화 후보 단일 태그: 이름은 '진화 후보' 하나, 진화형·사탕은 사유에. 최종형 여럿이면 등급→사탕 순 하나만(다른 진화형 표기)", () => {
  assert.equal(TAG.evolve("아무개"), "진화 후보");
  const v = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx());
  const ev = v.tags.filter((t) => t.name === "진화 후보");
  assert.equal(ev.length, 1); assert.ok(ev[0].reason.startsWith("→리자몽 기준:"), ev[0].reason); assert.equal(ev[0].metrics.finalKr, "리자몽");
  // 최종형 2개(합성: 파이리 → 리자몽 / 갸라도스 로 갈라지는 가짜 계열)
  const ds = { ...dataset, generatedAt: "test-multi", pokemon: dataset.pokemon.map((p) => (p.id === 5 ? { ...p, evolutions: [{ id: 6, form: "Normal", candies: 100 }, { id: 130, form: "Normal", candies: 400 }] } : p)) };
  const m = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx({ dataset: ds }));
  const ev2 = m.tags.filter((t) => t.name === "진화 후보");
  assert.equal(ev2.length, 1, "태그 하나로 합침"); assert.ok(m.confident, "같은 이름 태그 여러 개로 need_appraisal 이 되면 안 됨");
  assert.ok(ev2[0].reason.includes("다른 진화형 1"), ev2[0].reason); assert.equal(ev2[0].metrics.alternatives.length, 1);
});

test("4-D3 고개체 수집 보류: 피카츄 15/14/14·14/14/14 → 보류 + '수집' 태그(종 무관), 14/14/13 은 기존 판정(박사행)", () => {
  for (const ivs of [{ atk: 15, def: 14, sta: 14 }, { atk: 14, def: 14, sta: 14 }, { atk: 14, def: 15, sta: 14 }]) {
    const v = computeVerdict({ species_id: 25, ivs, level: 20 }, ctx());
    assert.equal(v.tier, "hold", JSON.stringify(ivs));
    assert.ok(v.recommendedTags.includes(TAG.collect), "수집 태그");
    assert.ok(v.collect.some((c) => c.reason === "고개체(14+/14+/14+)" && c.hold), JSON.stringify(v.collect));
    assert.ok(v.summary.includes("고개체 수집"), v.summary);
  }
  const w = computeVerdict({ species_id: 25, ivs: { atk: 14, def: 14, sta: 13 }, level: 20 }, ctx());
  assert.equal(w.tier, "transfer"); assert.equal(w.collect.length, 0); assert.ok(!w.recommendedTags.includes(TAG.collect));
  const h = computeVerdict({ species_id: 25, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx());
  assert.equal(h.tier, "hold"); assert.equal(h.collect.filter((c) => c.collectTag).length, 1, "100% 는 한 항목(고개체 중복 표기 없음)");
  assert.equal(RULES.COLLECT_HIGH_IV_MIN, 14);
});

test("4-C.2 C 수집 태그: 100%·0%·반짝반짝·오래 전 포획 → recommendedTags 에 '수집'(등급 무관), 이로치만으로는 아님", () => {
  assert.ok(computeVerdict({ species_id: 999, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx()).recommendedTags.includes(TAG.collect), "100%");
  assert.ok(computeVerdict({ species_id: 999, ivs: { atk: 0, def: 0, sta: 0 }, level: 20 }, ctx()).recommendedTags.includes(TAG.collect), "0%");
  assert.ok(computeVerdict({ species_id: 999, ivs: { atk: 5, def: 5, sta: 5 }, level: 20, is_lucky: true }, ctx()).recommendedTags.includes(TAG.collect), "반짝반짝");
  assert.ok(computeVerdict({ species_id: 999, ivs: { atk: 5, def: 5, sta: 5 }, level: 20, caught_on: "2017-03-01" }, ctx()).recommendedTags.includes(TAG.collect), "오래 전 포획");
  assert.ok(!computeVerdict({ species_id: 999, ivs: { atk: 5, def: 5, sta: 5 }, level: 20, is_shiny: true }, ctx()).recommendedTags.includes(TAG.collect), "이로치는 게임 검색어(색이 다른)로");
  assert.ok(!computeVerdict({ species_id: 999, ivs: { atk: 5, def: 5, sta: 5 }, level: 20 }, ctx()).recommendedTags.includes(TAG.collect));
});

test("4-C.2 G 맥스배틀 종: 판정 대신 '다이맥스' 태그 권장 안내(보류), 목록에 없으면 일반 판정", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx({ maxBattleSpecies: new Set([815]) }));
  assert.equal(v.dynamax, true); assert.equal(v.tier, "hold"); assert.deepEqual(v.recommendedTags, [TAG.dynamax]); assert.ok(v.summary.includes("다이맥스"), v.summary);
  const v0 = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx({ maxBattleSpecies: new Set([1]) }));
  assert.equal(v0.dynamax, false); assert.equal(v0.tier, "main");
});

test("마스터리그: 뮤츠 96% → 주력, 93% → 보류", () => {
  assert.equal(tagOf(computeVerdict({ species_id: 150, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx()), TAG.master).tier, "main");
  assert.equal(tagOf(computeVerdict({ species_id: 150, ivs: { atk: 14, def: 14, sta: 14 }, level: 40 }, ctx()), TAG.master).tier, "hold");
});

test("1단계 종(파이리) → 진화 대기(→리자몽), 사탕 125 필요·진화 가능 표기", () => {
  const v = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20, candy: 130 }, ctx());
  const t = tagOf(v, TAG.evolve("리자몽"));
  assert.ok(t, v.tags.map((x) => x.name).join());
  assert.equal(t.metrics.candiesNeeded, 125);
  assert.ok(t.reason.includes("진화 가능(사탕 130/125)"));
  assert.ok(["main", "hold"].includes(t.tier));
  const v2 = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20, candy: 30 }, ctx());
  assert.ok(tagOf(v2, TAG.evolve("리자몽")).reason.includes("사탕 30/125"));
});

test("개체값 후보가 판정을 가르면 need_appraisal", () => {
  const v = computeVerdict({ species_id: 184, ivCandidates: [{ level: 20, atk: 0, def: 15, sta: 15 }, { level: 20, atk: 15, def: 0, sta: 0 }], cp: 900 }, ctx());
  assert.equal(v.tier, "need_appraisal");
  assert.equal(v.confident, false);
  assert.equal(v.candidates, 2);
});

test("개체값 후보가 여러 개여도 판정이 같으면 확정", () => {
  const v = computeVerdict({ species_id: 815, ivCandidates: [{ level: 40, atk: 15, def: 14, sta: 14 }, { level: 40, atk: 15, def: 13, sta: 15 }] }, ctx());
  assert.equal(v.tier, "main");
  assert.ok(v.confident);
});

test("CP·HP 만으로 후보 산출 (CP 가림 대응은 hp 없이도 동작)", () => {
  const base = { atk: 251, def: 207, sta: 225 }; // 마기라스
  const withHp = ivCandidates(base, 3335, 176);
  assert.ok(withHp.some((c) => c.atk === 15 && c.def === 15 && c.sta === 14 && c.level === 31));
  assert.ok(ivCandidates(base, 3335, null).length > withHp.length);
});

test("사용자 캡처 9건: CP/HP → 막대 개체값·레벨이 후보에 포함 (막대 판독 기대값 고정)", () => {
  const cases = [
    ["마기라스", [251, 207, 225], 3335, 176, [15, 15, 14, 31]],
    ["디안시", [190, 285, 137], 2081, 102, [15, 15, 11, 27]],
    ["라티오스", [268, 212, 190], 2127, 118, [15, 12, 8, 20]],
    ["루카리오", [236, 144, 172], 2006, 125, [15, 13, 10, 26.5]],
    ["블레이범", [223, 173, 186], 2117, 136, [13, 13, 15, 26]],
    ["전수목", [330, 144, 195], 2212, 124, [12, 14, 13, 20]],
    ["가이오가", [270, 228, 205], 2283, 129, [11, 12, 11, 20]],
    ["님피아", [203, 205, 216], 2173, 154, [11, 6, 11, 26]],
    ["라티아스", [228, 246, 190], 1901, 121, [7, 6, 14, 20]],
  ];
  for (const [name, [atk, def, sta], cp, hp, [a, d, s, l]] of cases) {
    const c = ivCandidates({ atk, def, sta }, cp, hp);
    assert.ok(c.some((x) => x.atk === a && x.def === d && x.sta === s && x.level === l), `${name} ${a}/${d}/${s} L${l} 가 후보에 없음 (${c.length}건)`);
  }
});

test("보관함 여유 3단계: 보류 처리 차이", () => {
  const held = [0, 1].map((i) => ({ id: `h${i}`, species_id: 815, form: "Normal", atk_iv: 15, def_iv: 15, sta_iv: 15, level: 50, is_shadow: false, status: "keep", tags: [TAG.raid("불꽃")] }));
  const more = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, species_id: 815, form: "Normal", atk_iv: 15, def_iv: 15, sta_iv: 15, level: 50, is_shadow: false, status: "keep", tags: [] }));
  const input = { species_id: 815, ivs: { atk: 10, def: 10, sta: 10 }, level: 20 }; // 순위 8 → 보류
  const relaxed = computeVerdict({ ...input, storageMode: "relaxed" }, ctx({ myRows: [...held, ...more] }));
  const normal = computeVerdict({ ...input, storageMode: "normal" }, ctx({ myRows: [...held, ...more] }));
  const normal1 = computeVerdict({ ...input, storageMode: "normal" }, ctx({ myRows: [held[0], ...more] }));
  const tight = computeVerdict({ ...input, storageMode: "tight" }, ctx({ myRows: [...held, ...more] }));
  assert.equal(relaxed.tier, "hold");
  assert.equal(normal.tier, "transfer", "보통: 같은 종·태그 2마리 초과 → 박사행 권장");
  assert.equal(normal1.tier, "hold", "보통: 1마리만 보관 중 → 보류 유지");
  assert.equal(tight.tier, "transfer");
});

test("이벤트 대상 추출: 커뮤니티 데이 spawns / 이름 패턴 / 스포트라이트 아워, 30일 창", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const day = 86400000;
  const iso = (d) => new Date(d).toISOString();
  const events = [
    { name: "Zorua Community Day", eventType: "community-day", start: iso(now + 5 * day), end: iso(now + 5 * day + 3 * 3600000), extraData: { communityday: { spawns: [{ name: "Zorua" }] } } },
    { name: "Charmander Community Day Classic", eventType: "community-day", start: iso(now + 20 * day), end: iso(now + 20 * day + 3 * 3600000) },
    { name: "Seedot Spotlight Hour", eventType: "pokemon-spotlight-hour", start: iso(now + 2 * day), end: iso(now + 2 * day + 3600000) },
    { name: "Magikarp Community Day", eventType: "community-day", start: iso(now + 40 * day), end: iso(now + 40 * day + 3600000) },
    { name: "Old Community Day", eventType: "community-day", start: iso(now - 10 * day), end: iso(now - 9 * day), extraData: { communityday: { spawns: [{ name: "Eevee" }] } } },
    { name: "Raid Day", eventType: "raid-day", start: iso(now + 1 * day), end: iso(now + 2 * day) },
  ];
  const targets = extractEventTargets(events, now);
  assert.deepEqual(targets.map((t) => t.targets), [["zorua"], ["charmander"], ["seedot"]]);
  assert.equal(matchEvents(targets, "Charizard", ["Charmander", "Charmeleon", "Charizard"]).length, 1);
  assert.equal(matchEvents(targets, "Magikarp").length, 0, "30일 밖은 제외");
});

test("30일 내 커뮤니티 데이 대상 종(진화 계열 포함) → 박사행이 보류로 상향", () => {
  const now = Date.now();
  const targets = extractEventTargets([{ name: "Magikarp Community Day", eventType: "community-day", start: new Date(now + 3 * 86400000).toISOString(), end: new Date(now + 3 * 86400000 + 3600000).toISOString(), extraData: { communityday: { spawns: [{ name: "Magikarp" }] } } }], now);
  const v = computeVerdict({ species_id: 129, ivs: { atk: 5, def: 5, sta: 5 }, level: 10 }, ctx({ eventTargets: targets }));
  assert.equal(v.tier, "hold");
  assert.ok(v.event?.note.startsWith("📅"));
  assert.ok(v.event.note.includes("커뮤니티 데이 대상"));
  const v0 = computeVerdict({ species_id: 129, ivs: { atk: 5, def: 5, sta: 5 }, level: 10 }, ctx());
  assert.equal(v0.tier, "transfer");
});

test("종족 순위: 메가 제외·중복 폼 제거·섀도 별도, 체육관은 전설 제외", () => {
  const r = getRankings(dataset);
  assert.ok(r.raid.fire.normal.length >= 3);
  assert.ok(!r.gym.some((g) => g.id === 150), "전설 뮤츠는 체육관 순위 제외");
  assert.ok(r.raid.fire.shadow.find((x) => x.id === 815).score > r.raid.fire.normal.find((x) => x.id === 815).score, "섀도 점수 > 일반");
});

test("태그 → purposes 파생", () => {
  assert.deepEqual(purposesFromTags(["불꽃 레이드", "슈퍼리그", "체육관 방어", "마스터리그"]), ["raid", "great", "master"]);
});

test("4-A2 교환 시 반짝반짝: 2016-07~08 확정(조건부), 2019 이전 확률↑, 그 외 없음, 이미 럭키면 없음", () => {
  const base = { species_id: 129, ivs: { atk: 1, def: 1, sta: 1 }, level: 5 };
  assert.ok(computeVerdict({ ...base, caught_on: "2016-08-15" }, ctx()).collect.some((c) => c.reason.startsWith("교환 시 반짝반짝 확정")));
  assert.ok(computeVerdict({ ...base, caught_on: "2018-03-01" }, ctx()).collect.some((c) => c.reason.startsWith("교환 시 반짝반짝 확률↑")));
  assert.ok(!computeVerdict({ ...base, caught_on: "2019-01-01" }, ctx()).collect.some((c) => c.reason.includes("반짝반짝")));
  assert.ok(!computeVerdict({ ...base, caught_on: "2017-01-01", is_lucky: true }, ctx()).collect.some((c) => c.reason.includes("교환 시")));
  assert.equal(computeVerdict(base, ctx()).disabled.length, 0);
  assert.equal(RULES.LUCKY_TRADE_YEAR, 2019);
});

test("4-A2 보관함 빠듯: 전설도 박사행 권장, 💎 교환용은 유지", () => {
  const v = computeVerdict({ species_id: 999, ivs: { atk: 5, def: 7, sta: 3 }, level: 20, storageMode: "tight" }, ctx());
  assert.equal(v.tier, "transfer");
  assert.ok(v.collect.some((c) => c.reason.startsWith("교환용")));
  assert.equal(computeVerdict({ species_id: 999, ivs: { atk: 5, def: 7, sta: 3 }, level: 20, storageMode: "normal" }, ctx()).tier, "hold");
});

test("4-A2 레이드 비율 기준: 구구 5/8/3 → 박사행(피죤투는 노말·비행 1위 대비 75% 미만이라 진화 대기 없음)", () => {
  const v = computeVerdict({ species_id: 16, ivs: { atk: 5, def: 8, sta: 3 }, level: 15 }, ctx());
  assert.equal(v.tier, "transfer", v.tags.map((t) => `${t.name}:${t.tier}:${t.reason}`).join(" | "));
  assert.equal(tagOf(v, TAG.evolve("피죤투")), undefined);
  const r = getRankings(dataset);
  const pid = r.raid.flying.normal.find((x) => x.id === 18);
  assert.ok(pid && pid.pct < RULES.RAID_MID_SCORE_PCT, `피죤투 비행 ${pid?.pct}% (1위 ${r.raid.flying.normal[0].nameKr})`);
});

test("4-A2 해피너스 → 노말 레이드 태그 없음, 체육관 방어 주력", () => {
  const v = computeVerdict({ species_id: 242, ivs: { atk: 10, def: 15, sta: 15 }, level: 40 }, ctx());
  assert.equal(tagOf(v, TAG.raid("노말")), undefined, v.tags.map((t) => t.name).join());
  assert.equal(tagOf(v, TAG.gym)?.tier, "main");
});

test("4-A2 님피아 → 페어리 레이드만 (노말은 1위 대비 비율 미달)", () => {
  const v = computeVerdict({ species_id: 700, ivs: { atk: 15, def: 15, sta: 15 }, level: 40 }, ctx());
  assert.equal(tagOf(v, TAG.raid("페어리"))?.tier, "main");
  assert.equal(tagOf(v, TAG.raid("노말")), undefined, v.tags.map((t) => `${t.name}:${t.reason}`).join(" | "));
});

test("4-A2 진화 대기는 최종형이 주력일 때만: 리자몽 주력이면 파이리 부여, 최종형 보류급이면 없음", () => {
  const v = computeVerdict({ species_id: 4, ivs: { atk: 15, def: 15, sta: 15 }, level: 20 }, ctx());
  assert.equal(tagOf(v, TAG.evolve("리자몽"))?.tier, "main");
  // 내 목록에 리자몽 15/15/15 가 6마리 → 최종형 기준 순위 7 = 보류 → 진화 대기 없음
  const myRows = Array.from({ length: 6 }, (_, i) => ({ id: `z${i}`, species_id: 6, form: "Normal", atk_iv: 15, def_iv: 15, sta_iv: 15, level: 50, is_shadow: false, status: "keep", tags: [] }));
  const v2 = computeVerdict({ species_id: 4, ivs: { atk: 14, def: 15, sta: 15 }, level: 20 }, ctx({ myRows }));
  assert.equal(tagOf(v2, TAG.evolve("리자몽")), undefined);
  assert.equal(v2.tier, "hold", "4-D3: 14/15/15 는 고개체 수집 보류(진화 대기 태그는 없음)");
  const v3 = computeVerdict({ species_id: 4, ivs: { atk: 13, def: 15, sta: 15 }, level: 20 }, ctx({ myRows }));
  assert.equal(tagOf(v3, TAG.evolve("리자몽")), undefined); assert.equal(v3.tier, "transfer");
});

test("4-A2 섀도 순위는 PvPoke shadoweligible 종만", () => {
  const r = getRankings(dataset);
  assert.ok(!r.raid.normal.shadow.some((x) => x.id === 474), "폴리곤Z(shadowEligible:false) 는 섀도 순위 제외");
  assert.ok(r.raid.fire.shadow.some((x) => x.id === 815));
  assert.equal(r.raid.fire.normal[0].pct, 100);
});

test("이로치·럭키 → 💎, 데이터 없는 리그는 경고만", () => {
  const v = computeVerdict({ species_id: 129, ivs: { atk: 1, def: 1, sta: 1 }, level: 5, is_shiny: true, is_lucky: true }, ctx({ leagueRankings: { leagues: {} } }));
  assert.deepEqual(v.collect.map((c) => c.reason), ["이로치", "반짝반짝(럭키)"]);
  assert.ok(v.warnings.some((w) => w.includes("데이터 없음")));
});

// ─── 4-F 초보자 기준 판정 (보관함 여유·보통만) ───
const beginnerCtx = (over = {}) => ({ dataset, leagueRankings, eventTargets: [], myRows: [], storageMode: "normal", rulesOverride: {}, ...over });
const scanRow = (id, species_id, ivs, level, extra = {}) => ({ id, species_id, form: "Normal", atk_iv: ivs[0], def_iv: ivs[1], sta_iv: ivs[2], level, cp: null, hp: null, is_shadow: false, ...extra });

test("4-F ③ 리그 예비: 라이츄 3/13/13(슈퍼 스탯곱 391위, CP1480 상한 도달, PvPoke 순위 없음) → 보류 '슈퍼리그' 리그 예비, 같은 종 더 나쁜 1/13/15(450위)는 박사행", () => {
  const a = scanRow("a", 26, [3, 13, 13], 25.5), b = scanRow("b", 26, [1, 13, 15], 25.5);
  const reserve = buildReserveRanks(dataset, [], [a, b]);
  assert.equal(reserve.league.great.get("26:Normal:0")?.key, "scan:a", "종·리그별 최상위 1마리 = 391위");
  const ctx1 = beginnerCtx({ reserve });
  const va = verdictForItem(a, ctx1), vb = verdictForItem(b, ctx1);
  assert.equal(va.tier, "hold", va.summary);
  const tg = va.tags.find((t) => t.name === TAG.great);
  assert.ok(tg && tg.tier === "hold" && tg.reason.includes("리그 예비") && tg.reason.includes("391/4096"), JSON.stringify(tg));
  assert.equal(vb.tier, "transfer", vb.summary);
  // 빠듯이면 현행(박사행)
  assert.equal(verdictForItem(a, beginnerCtx({ reserve, storageMode: "tight" })).tier, "transfer");
  // BEGINNER_RULES=0 이면 적용 전(박사행)
  assert.equal(verdictForItem(a, beginnerCtx({ reserve, rulesOverride: { BEGINNER_RULES: 0 } })).tier, "transfer");
  // 스탯곱 500위 밖(15/15/15 = 742위)은 예비 아님
  const c = scanRow("c", 26, [15, 15, 15], 24);
  assert.equal(buildReserveRanks(dataset, [], [c]).league.great.size, 0);
});

test("4-F ① 가성비 상위종: 전설·섀도 제외 풀 ≤12위 → 보류 '○○ 레이드'(공격 IV ≥10), 섀도 개체·공격 9 는 제외", () => {
  const r = getRankings2(dataset);
  const bg = budgetRankOf(r, "electric", 26, "Normal");
  assert.ok(bg && bg.budgetRank <= 12 && !bg.legendary, JSON.stringify(bg));
  assert.ok(!r.raid.normal?.some?.((x) => x.legendary), "budget 목록에 전설 없음");
  for (const t of Object.keys(r.raid)) assert.ok(r.raid[t].budget.every((x) => !x.legendary), t);
  const v = computeVerdict({ species_id: 26, ivs: { atk: 12, def: 5, sta: 5 }, level: 30 }, beginnerCtx());
  const tag = v.tags.find((x) => x.name === TAG.raid("전기"));
  assert.ok(tag && tag.tier === "hold" && tag.reason.includes("가성비") && tag.metrics.beginner, JSON.stringify(tag));
  assert.equal(v.tier, "hold");
  assert.equal(computeVerdict({ species_id: 26, ivs: { atk: 9, def: 5, sta: 5 }, level: 30 }, beginnerCtx()).tags.find((x) => x.name === TAG.raid("전기")), undefined, "공격 IV 하한 10");
  assert.equal(computeVerdict({ species_id: 26, ivs: { atk: 12, def: 5, sta: 5 }, level: 30, is_shadow: true }, beginnerCtx()).tags.find((x) => x.name === TAG.raid("전기") && x.metrics.budgetRank), undefined, "섀도는 가성비 풀 제외");
  assert.equal(computeVerdict({ species_id: 26, ivs: { atk: 12, def: 5, sta: 5 }, level: 30 }, ctx()).tier, "transfer", "초보자 기준 끄면 현행");
});

test("4-F ② 레이드 예비: 타입마다 내 보관함 개체 점수 상위 6(공격 ≥10) 보류, 7번째·공격 9 는 아님, 사유에 '내 보관함 ○○ n위'", () => {
  // 전기 타입: 라이츄 8마리(공격 15..8), 레벨 같음 → 공격 순 상위 6 (공격 ≥10 → 15..10)
  const rows = Array.from({ length: 8 }, (_, i) => scanRow(`e${i}`, 26, [15 - i, 5, 5], 20));
  const reserve = buildReserveRanks(dataset, [], rows);
  const m = reserve.raid.electric;
  assert.equal(m.get("scan:e0"), 1); assert.equal(m.get("scan:e5"), 6); assert.equal(m.get("scan:e6"), undefined); assert.equal(m.get("scan:e7"), undefined);
  // 가성비 영향을 없애기 위해 BUDGET_RAID_TOP_RANK=0 → 레이드 예비만으로 보류
  const c2 = beginnerCtx({ reserve, rulesOverride: { BUDGET_RAID_TOP_RANK: 0 } });
  const inp = (r) => ({ id: r.id, reserveKey: `scan:${r.id}`, species_id: 26, ivs: { atk: r.atk_iv, def: r.def_iv, sta: r.sta_iv }, level: r.level });
  const v = computeVerdict(inp(rows[5]), c2);
  const tag = v.tags.find((x) => x.name === TAG.raid("전기"));
  assert.ok(tag && tag.tier === "hold" && tag.reason.includes("내 보관함 전기 6위") && tag.metrics.reserveRank === 6, JSON.stringify(tag));
  assert.equal(v.tier, "hold");
  assert.equal(computeVerdict(inp(rows[6]), c2).tags.find((x) => x.name === TAG.raid("전기")), undefined, "7번째는 예비 아님");
  // id 없이 같은 개체(서명 일치)로 물어봐도 예비 순위를 찾는다 (/api/verdict 단건)
  assert.equal(computeVerdict({ species_id: 26, ivs: { atk: 10, def: 5, sta: 5 }, level: 20 }, c2).tags.find((x) => x.name === TAG.raid("전기"))?.metrics.reserveRank, 6);
  // 레벨 보정: 같은 공격 IV 라도 레벨이 높으면 앞선다
  const hi = scanRow("h", 26, [12, 5, 5], 40), lo = scanRow("l", 26, [12, 5, 5], 20);
  const r2 = buildReserveRanks(dataset, [], [lo, hi]).raid.electric;
  assert.equal(r2.get("scan:h"), 1); assert.equal(r2.get("scan:l"), 2);
});
