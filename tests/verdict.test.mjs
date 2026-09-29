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
};
const sp = (id, name, nameKr, types, atk, def, sta, fast, charged, extra = {}) => ({
  id, form: "Normal", name, nameKr, types, baseAttack: atk, baseDefense: def, baseStamina: sta, fast, charged,
  eliteFast: [], eliteCharged: [], signatureFast: [], signatureCharged: [], released: true, pokemonClass: null, evolutions: [], pvpokeId: name.toLowerCase(), ...extra,
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

test("전설 상위종(뮤츠) 5/7/3 → 에스퍼 레이드(종족 우선) + 💎 보관 권장, 마스터리그는 % 미달", () => {
  const v = computeVerdict({ species_id: 150, ivs: { atk: 5, def: 7, sta: 3 }, level: 30 }, ctx());
  assert.equal(tagOf(v, TAG.raid("에스퍼")).tier, "main");
  assert.equal(tagOf(v, TAG.master), undefined);
  assert.ok(v.collect.some((c) => c.reason.includes("보관 권장")));
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

test("태그 → purposes 파생, 럭키 교환 연도는 비활성", () => {
  assert.deepEqual(purposesFromTags(["불꽃 레이드", "슈퍼리그", "체육관 방어", "마스터리그"]), ["raid", "great", "master"]);
  assert.equal(RULES.LUCKY_TRADE_YEAR, null);
  assert.ok(computeVerdict({ species_id: 129, ivs: { atk: 1, def: 1, sta: 1 }, level: 5 }, ctx()).disabled.includes("lucky_trade_year"));
});

test("이로치·럭키 → 💎, 데이터 없는 리그는 경고만", () => {
  const v = computeVerdict({ species_id: 129, ivs: { atk: 1, def: 1, sta: 1 }, level: 5, is_shiny: true, is_lucky: true }, ctx({ leagueRankings: { leagues: {} } }));
  assert.deepEqual(v.collect.map((c) => c.reason), ["이로치", "반짝반짝(럭키)"]);
  assert.ok(v.warnings.some((w) => w.includes("데이터 없음")));
});
