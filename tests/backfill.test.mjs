// 4-C.2 스캔 기록 superseded 백필(planSupersede) + CP 검증(cpConsistentLevel)
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSupersede } from "../app/lib/scanBackfill.js";
import { cpConsistentLevel } from "../app/lib/ivCalc.js";
import { calcCP } from "../app/lib/cpm.js";
import { calcHP } from "../app/lib/ivCalc.js";

// 파이리(116/93/118) → 리자드(158/126/151) → 리자몽(223/173/186)
const dataset = { pokemon: [
  { id: 4, form: "Normal", baseAttack: 116, baseDefense: 93, baseStamina: 118, evolutions: [{ id: 5, form: "Normal", candies: 25 }] },
  { id: 5, form: "Normal", baseAttack: 158, baseDefense: 126, baseStamina: 151, evolutions: [{ id: 6, form: "Normal", candies: 100 }] },
  { id: 6, form: "Normal", baseAttack: 223, baseDefense: 173, baseStamina: 186, evolutions: [] },
  { id: 68, form: "Normal", baseAttack: 234, baseDefense: 159, baseStamina: 207, evolutions: [] }, // 괴력몬
] };
const base = (id) => { const p = dataset.pokemon.find((x) => x.id === id); return { atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }; };
let seq = 0;
const item = (id, species, ivs, level, o = {}) => {
  const b = base(species); const iv = { atk: ivs[0], def: ivs[1], sta: ivs[2] };
  return { id, species_id: species, form: "Normal", is_shadow: false, atk_iv: iv.atk, def_iv: iv.def, sta_iv: iv.sta, level, cp: level ? calcCP(b, iv, level) : null, hp: level ? calcHP(b.sta, iv.sta, level) : null,
    session_id: "s1", created_at: `2026-09-2${1 + Math.floor(seq / 10)}T00:00:${String(seq++ % 60).padStart(2, "0")}Z`, caught_on: null, ...o };
};

test("cpConsistentLevel: 개체값·HP 와 맞는 CP 만 레벨을 돌려주고, 자리수 누락(2634 → 263)은 null", () => {
  const b = base(68); const iv = { atk: 15, def: 12, sta: 14 };
  const cp = calcCP(b, iv, 30), hp = calcHP(b.sta, 14, 30);
  assert.equal(cpConsistentLevel(b, cp, hp, iv), 30);
  assert.equal(cpConsistentLevel(b, cp, null, iv), 30, "HP 없어도 레벨 전 범위에서 찾음");
  assert.equal(cpConsistentLevel(b, Math.floor(cp / 10), hp, iv), null, "자리수 누락");
  assert.equal(cpConsistentLevel(b, cp, hp + 3, iv), null, "HP 불일치");
  assert.equal(cpConsistentLevel(b, cp, hp, { atk: 15, def: 12, sta: null }), null);
});

test("백필 ①: 다른 세션의 같은 개체(CP·HP·개체값 동일) → 오래된 기록 superseded (뚜벅쵸·두랄루돈 사례)", () => {
  const a = item("old", 4, [9, 4, 4], 20, { session_id: "s1" }), b = item("new", 4, [9, 4, 4], 20, { session_id: "s2" });
  const plan = planSupersede([a, b], dataset);
  assert.deepEqual(plan, [{ id: "old", superseded_by: "new" }]);
  assert.deepEqual(planSupersede([b], dataset), [], "멱등: 남은 기록만으로 다시 돌리면 변화 없음");
});

test("백필 ②: 같은 세션에서 한쪽 CP null(같은 HP) → CP 검증된 기록을 남김 (리자몽·썬더·번치코 사례)", () => {
  const full = item("full", 6, [15, 7, 7], 25), noCp = { ...item("nocp", 6, [15, 7, 7], 25), cp: null, level: null };
  assert.deepEqual(planSupersede([full, noCp], dataset), [{ id: "nocp", superseded_by: "full" }], "CP 없는 쪽이 나중이어도 검증된 쪽이 남음");
  assert.deepEqual(planSupersede([noCp, full], dataset), [{ id: "nocp", superseded_by: "full" }]);
});

test("백필 ③: CP 가 개체값·HP 와 맞지 않는 기록(괴력몬 2634 vs 263) → 검증된 기록으로 대체", () => {
  const good = item("good", 68, [15, 12, 14], 30);
  const bad = { ...item("bad", 68, [15, 12, 14], 30), cp: Math.floor(good.cp / 10), level: null };
  assert.deepEqual(planSupersede([bad, good], dataset), [{ id: "bad", superseded_by: "good" }]);
});

test("백필 ④: 진화·강화(레벨 비감소) → 최신 기록 유지, 서로 다른 과거 후보 2개는 건드리지 않음, 포획일 다르면 별개", () => {
  const c1 = item("c1", 4, [15, 14, 13], 20), c2 = item("c2", 5, [15, 14, 13], 22), c3 = item("c3", 6, [15, 14, 13], 25);
  assert.deepEqual(planSupersede([c1, c2, c3], dataset).sort((x, y) => x.id.localeCompare(y.id)), [{ id: "c1", superseded_by: "c2" }, { id: "c2", superseded_by: "c3" }]);
  // 같은 개체값 파이리 2마리(L22 먼저, L20 나중 → 서로 대체 아님)가 있고 리자몽 L25 가 들어오면 → 과거 후보 2개 → 구분 불가 → 대체 없음
  const p2 = item("p2", 4, [15, 14, 13], 22), p1 = item("p1", 4, [15, 14, 13], 20), z = item("z", 6, [15, 14, 13], 25);
  assert.deepEqual(planSupersede([p2, p1, z], dataset), []);
  // 같은 개체값 파이리가 L20 → L22 순서로 기록되면 강화로 보고 최신을 남긴다(insert 시점 규칙 ③ 과 동일)
  const q1 = item("q1", 4, [15, 14, 13], 20), q2 = item("q2", 4, [15, 14, 13], 22);
  assert.deepEqual(planSupersede([q1, q2], dataset), [{ id: "q1", superseded_by: "q2" }]);
  const d1 = item("d1", 4, [15, 14, 13], 20, { caught_on: "2024-01-01" }), d2 = item("d2", 6, [15, 14, 13], 25, { caught_on: "2024-02-02" });
  assert.deepEqual(planSupersede([d1, d2], dataset), [], "포획일이 둘 다 있고 다르면 다른 개체");
  const lower = item("lo", 4, [15, 14, 13], 20), later = item("hi", 4, [15, 14, 13], 15);
  assert.deepEqual(planSupersede([lower, later], dataset), [], "나중 기록의 레벨이 낮으면(다른 개체) 대체 없음");
});
