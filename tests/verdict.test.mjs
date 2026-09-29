// 4-A 판정 엔진 단위 테스트 (외부 데이터 불필요: 합성 데이터셋 + PvPoke 순위·이벤트 주입)
//   npm test  (node --test tests/*.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict, leagueProductTable } from "../app/lib/verdict.js";
import { getRankings } from "../app/lib/speciesRankings.js";
import { extractEventTargets, matchEvents } from "../app/lib/eventTargets.js";
import { ivCandidates } from "../app/lib/ivCalc.js";
import { RULES, TAG, purposesFromTags } from "../app/lib/verdictRules.js";

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
    sp(129, "Magikarp", "잉어킹", ["water"], 29, 85, 85, [], []),
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
    ...fillers,
  ],
};
const mk = (entries) => { const m = new Map(); entries.forEach((id, i) => m.set(id, { rank: i + 1, score: 100 - i, name: id })); return m; };
const leagueRankings = { fetchedAt: "t", errors: {}, leagues: { great: mk(["azumarill", "cinderace"]), ultra: mk(["charizard"]), master: mk(["mewtwo"]) } };
const ctx = (over = {}) => ({ dataset, leagueRankings, eventTargets: [], myRows: [], storageMode: "normal", ...over });
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

test("기술 미입력 → '기술 확인 필요(최적 기술 가정)'", () => {
  const v = computeVerdict({ species_id: 815, ivs: { atk: 15, def: 14, sta: 14 }, level: 40 }, ctx());
  assert.ok(tagOf(v, TAG.raid("불꽃")).metrics.notes.includes("기술 확인 필요(최적 기술 가정)"));
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

test("약한 종 15/15/15 → 박사행 + 💎 수집 추천(100%)", () => {
  const v = computeVerdict({ species_id: 129, ivs: { atk: 15, def: 15, sta: 15 }, level: 10 }, ctx());
  assert.equal(v.tier, "transfer");
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
  assert.equal(v2.tier, "transfer");
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
