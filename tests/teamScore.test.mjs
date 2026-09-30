// 2단계 단위 테스트 (외부 데이터 불필요, 합성 데이터셋)
//   npm test  (node --test tests/*.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcCP, estimateLevel, cpmForLevel } from "../app/lib/cpm.js";
import { buildRaidTeam, buildRocketTeam, prepareMember } from "../app/lib/teamScore.js";

// ── 합성 데이터셋: 종족값은 실제 값, 기술 수치는 PokeMiners PvE 값 근사 ──
const moveStats = {
  "Counter": { type: "fighting", kind: "fast", power: 8, durationMs: 900, energy: 7 },
  "Aura Sphere": { type: "fighting", kind: "charged", power: 90, durationMs: 1800, energy: 50 },
  "Dynamic Punch": { type: "fighting", kind: "charged", power: 90, durationMs: 2700, energy: 50 },
  "Dragon Tail": { type: "dragon", kind: "fast", power: 15, durationMs: 1100, energy: 9 },
  "Outrage": { type: "dragon", kind: "charged", power: 110, durationMs: 3900, energy: 50 },
  "Thunder Shock": { type: "electric", kind: "fast", power: 5, durationMs: 600, energy: 8 },
  "Wild Charge": { type: "electric", kind: "charged", power: 100, durationMs: 2600, energy: 50 },
  "Bite": { type: "dark", kind: "fast", power: 6, durationMs: 500, energy: 4 },
  "Crunch": { type: "dark", kind: "charged", power: 70, durationMs: 3200, energy: 33 },
  "Smack Down": { type: "rock", kind: "fast", power: 12, durationMs: 1200, energy: 8 },
  "Stone Edge": { type: "rock", kind: "charged", power: 100, durationMs: 2300, energy: 50 },
  "Fire Spin": { type: "fire", kind: "fast", power: 14, durationMs: 1100, energy: 10 },
  "Blast Burn": { type: "fire", kind: "charged", power: 110, durationMs: 3300, energy: 50 },
  "Fire Fang": { type: "fire", kind: "fast", power: 12, durationMs: 900, energy: 8 },
  "Fire Blast": { type: "fire", kind: "charged", power: 140, durationMs: 4200, energy: 100 },
};
const sp = (id, name, nameKr, types, atk, def, sta, fast, charged, extra = {}) => ({ id, form: "Normal", name, nameKr, types, baseAttack: atk, baseDefense: def, baseStamina: sta, fast, charged, eliteFast: [], eliteCharged: [], signatureFast: [], signatureCharged: [], released: true, ...extra });
const dataset = {
  moveStats,
  pokemon: [
    sp(248, "Tyranitar", "마기라스", ["rock", "dark"], 251, 207, 225, ["Bite", "Smack Down"], ["Crunch", "Stone Edge"]),
    sp(448, "Lucario", "루카리오", ["fighting", "steel"], 236, 144, 172, ["Counter"], ["Aura Sphere"]),
    sp(68, "Machamp", "괴력몬", ["fighting"], 234, 159, 207, ["Counter"], ["Dynamic Punch"]),
    sp(384, "Rayquaza", "레쿠쟈", ["dragon", "flying"], 284, 170, 213, ["Dragon Tail"], ["Outrage"]),
    sp(6, "Charizard", "리자몽", ["fire", "flying"], 223, 173, 186, ["Fire Spin", "Dragon Tail"], ["Blast Burn", "Fire Blast"]),
    sp(25, "Pikachu", "피카츄", ["electric"], 112, 96, 111, ["Thunder Shock"], ["Wild Charge"]),
    sp(257, "Blaziken", "번치코", ["fire", "fighting"], 240, 141, 190, ["Counter", "Fire Spin"], ["Blast Burn"]),
    sp(229, "Houndoom", "헬가", ["dark", "fire"], 224, 144, 181, ["Fire Fang"], ["Fire Blast"]),
  ],
};
const rows = [
  { id: "a", species_id: 448, form: "Normal", cp: 3000, atk_iv: 15, def_iv: 14, sta_iv: 15, fast_move: "Counter", charged_moves: ["Aura Sphere"], is_shadow: false, status: "keep" },
  { id: "b", species_id: 68, form: "Normal", cp: 3000, atk_iv: 15, def_iv: 15, sta_iv: 15, fast_move: "Counter", charged_moves: ["Dynamic Punch"], is_shadow: true, status: "keep" },
  { id: "c", species_id: 384, form: "Normal", cp: 3800, atk_iv: 15, def_iv: 15, sta_iv: 15, fast_move: "Dragon Tail", charged_moves: ["Outrage"], is_shadow: false, status: "keep" },
  { id: "d", species_id: 6, form: "Normal", cp: 2900, atk_iv: null, def_iv: null, sta_iv: null, fast_move: null, charged_moves: [], is_shadow: false, status: "keep" }, // 개체값·기술 미입력
  { id: "e", species_id: 384, form: "Normal", cp: 3700, atk_iv: 15, def_iv: 15, sta_iv: 15, fast_move: "Dragon Tail", charged_moves: ["Outrage"], is_shadow: false, status: "transfer" }, // 박사행 → 제외
  { id: "f", species_id: 25, form: "Normal", cp: 500, atk_iv: 10, def_iv: 10, sta_iv: 10, fast_move: "Thunder Shock", charged_moves: ["Wild Charge"], is_shadow: false, status: "keep" },
];

test("레벨 추정: 알려진 CP/개체값 조합 3건 (L40 100%)", () => {
  assert.equal(cpmForLevel(40), 0.7903);
  assert.equal(cpmForLevel(50), 0.8403);
  const iv100 = { atk: 15, def: 15, sta: 15 };
  const cases = [
    [{ atk: 300, def: 182, sta: 214 }, 4178, "뮤츠"],
    [{ atk: 284, def: 170, sta: 213 }, 3835, "레쿠쟈"],
    [{ atk: 263, def: 198, sta: 209 }, 3792, "망나뇽"],
  ];
  for (const [base, cp, name] of cases) {
    assert.equal(calcCP(base, iv100, 40), cp, `${name} L40 100% CP`);
    const est = estimateLevel(cp, base, iv100);
    assert.equal(est.level, 40, `${name} 레벨 복원`);
    assert.equal(est.exact, true);
  }
});

test("레벨 추정: 반 레벨(25.5) 왕복", () => {
  const base = { atk: 300, def: 182, sta: 214 }, ivs = { atk: 10, def: 10, sta: 10 };
  const cp = calcCP(base, ivs, 25.5);
  assert.equal(estimateLevel(cp, base, ivs).level, 25.5);
});

test("prepareMember: 개체값·기술 미입력 → 추정 플래그, 그림자 보정", () => {
  const m = prepareMember(rows[3], dataset.pokemon.find((p) => p.id === 6), { moveStats });
  assert.equal(m.ivAssumed, true);
  assert.equal(m.movesAssumed, true);
  assert.deepEqual(m.ivs, { atk: 10, def: 10, sta: 10 });
  assert.ok(m.fastPool.length >= 2 && m.chargedPool.length >= 2, "미입력이면 종의 검증 기술 전체가 후보");
  const shadow = prepareMember(rows[1], dataset.pokemon.find((p) => p.id === 68), { moveStats });
  const normal = prepareMember({ ...rows[1], is_shadow: false }, dataset.pokemon.find((p) => p.id === 68), { moveStats });
  assert.ok(Math.abs(shadow.atk / normal.atk - 1.2) < 1e-9, "그림자 공격 ×1.2");
  assert.ok(Math.abs(shadow.def / normal.def - 0.833) < 1e-9, "그림자 방어 ×0.833");
});

test("레이드 팀: 마기라스 보스 → 격투 타입 상위, 박사행 제외, 부족분 채움", () => {
  const boss = dataset.pokemon.find((p) => p.id === 248);
  const r = buildRaidTeam(rows, boss, dataset);
  assert.equal(r.excludedTransfer, 1);
  assert.ok(!r.team.some((m) => m.id === "e"), "박사행 제외");
  assert.ok(["a", "b"].includes(r.team[0].id) && ["a", "b"].includes(r.team[1].id), "격투 타입(루카리오·괴력몬)이 1·2위");
  assert.equal(r.team[0].multCharged, 2.56, "격투 차징기 ×2.56 (바위/악 이중 약점)");
  const chz = r.team.find((m) => m.id === "d");
  assert.ok(chz.ivAssumed && chz.movesAssumed, "미입력 항목은 추정 표시");
  assert.equal(r.team.length + r.fill.length, 6, "6마리(부족분은 천적 후보)");
  assert.ok(r.fill.every((c) => !["a", "b", "c", "d", "f"].includes(c.id)), "fill 은 후보 종");
  assert.ok(r.warnings.some((w) => w.includes("10/10/10")) && r.warnings.some((w) => w.includes("기술 미입력")));
});

test("로켓단 팀: 악 타입 조무래기 → 3마리, 슬롯 커버 표시, 격투 포함", () => {
  const lineup = {
    name: "Dark-type Grunt", title: "Team GO Rocket Grunt", type: "dark",
    firstPokemon: [{ name: "Carvanha", types: ["water", "dark"] }, { name: "Poochyena", types: ["dark"] }],
    secondPokemon: [{ name: "Houndour", types: ["dark", "fire"] }, { name: "Absol", types: ["dark"] }],
    thirdPokemon: [{ name: "Hydreigon", types: ["dark", "dragon"] }],
  };
  const r = buildRocketTeam(rows, lineup, dataset);
  assert.equal(r.team.length, 3);
  assert.equal(new Set(r.team.map((m) => m.id)).size, 3, "같은 개체 중복 없음");
  assert.deepEqual(r.team.map((m) => m.slot), [1, 2, 3]);
  assert.ok(r.team.every((m) => m.covers.includes(m.slot)), "선정 슬롯은 커버 목록에 포함");
  assert.ok(!r.team.some((m) => m.id === "e"), "박사행 제외");
  assert.ok(r.team.some((m) => ["a", "b"].includes(m.id)), "악 타입 상대 → 격투 타입 포함");
  assert.ok(r.note.includes("간이"));
});
