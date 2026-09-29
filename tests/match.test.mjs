// 4-B 목록 매칭 규칙 (중복 저장 → 갱신, 재캡처 갱신, 사용자 편집 보존)
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatch, mergePatch, scanKey, familyOfFactory } from "../app/lib/pokemonMatch.js";

const pokemon = [
  { id: 4, evolutions: [{ id: 5, form: "Normal", candies: 25 }] }, { id: 5, evolutions: [{ id: 6, form: "Normal", candies: 100 }] }, { id: 6, evolutions: [] },
  { id: 133, evolutions: [{ id: 134 }, { id: 135 }, { id: 136 }] }, { id: 134 }, { id: 135 }, { id: 136 }, { id: 129, evolutions: [{ id: 130 }] }, { id: 130 },
];
const familyOf = familyOfFactory(pokemon);
const row = (o) => ({ id: "r1", species_id: 4, form: "Normal", name_kr: "파이리", cp: 500, hp: 60, atk_iv: 15, def_iv: 14, sta_iv: 13, caught_on: "2024-05-12", is_shadow: false, memo: "내 메모", tags: ["불꽃 레이드"], status: "keep", purposes: ["raid"], fast_move: "Ember", charged_moves: ["Flamethrower"], ...o });

test("① 종 계열·폼·개체값·포획일 일치 → 갱신 (진화 후 재캡처도 같은 개체)", () => {
  const rows = [row()];
  const evolved = { species_id: 6, form: "Normal", name_kr: "리자몽", cp: 1900, hp: 120, atk_iv: 15, def_iv: 14, sta_iv: 13, caught_on: "2024-05-12" };
  const m = findMatch(rows, evolved, familyOf);
  assert.equal(m?.rule, "iv+caught_on"); assert.equal(m.row.id, "r1");
  assert.equal(findMatch(rows, evolved, null), null, "계열 정보 없으면 같은 종만");
  assert.equal(findMatch(rows, { ...evolved, caught_on: "2024-05-13" }, familyOf), null, "포획일 다르면 다른 개체");
  assert.equal(findMatch(rows, { ...evolved, sta_iv: 12 }, familyOf), null);
});

test("② 종·폼·CP·HP 일치 → 갱신 (개체값 미확정·포획일 없음)", () => {
  const rows = [row({ atk_iv: null, def_iv: null, sta_iv: null, caught_on: null })];
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 500, hp: 60 }, familyOf)?.rule, "cp+hp");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 500, hp: 61 }, familyOf), null);
  assert.equal(findMatch(rows, { species_id: 5, form: "Normal", cp: 500, hp: 60 }, familyOf), null, "②는 계열 확장 없음");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 500, hp: 60, is_shadow: true }, familyOf), null, "섀도 여부 다르면 별개");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 500 }, familyOf), null, "HP 없으면 ② 불가");
});

test("갱신 패치: CP·HP·레벨·기술·종은 새 값, memo·tags·status·purposes 는 건드리지 않음, null 은 기존 유지", () => {
  const ex = row();
  const p = mergePatch(ex, { species_id: 6, form: "Normal", name_kr: "리자몽", cp: 1900, hp: 120, level: 20, atk_iv: 15, def_iv: 14, sta_iv: 13, fast_move: null, charged_moves: [], caught_on: "2024-05-12", is_shiny: true, source: "overlay" });
  assert.equal(p.species_id, 6); assert.equal(p.cp, 1900); assert.equal(p.level, 20);
  assert.equal(p.fast_move, "Ember", "기술 미인식이면 기존 유지"); assert.deepEqual(p.charged_moves, ["Flamethrower"]);
  assert.equal(p.is_shiny, true); assert.equal(p.source, "overlay");
  for (const k of ["memo", "tags", "status", "purposes"]) assert.ok(!(k in p), `${k} 는 패치에 없어야 함`);
});

test("스캔 기록 중복 키·진화 계열", () => {
  assert.equal(scanKey({ species_id: 815, cp: 3002, hp: 161, atk_iv: 15, def_iv: 14, sta_iv: 14 }), "815|Normal|3002|161|15|14|14|0");
  assert.deepEqual([...familyOf(5)].sort(), [4, 5, 6]);
  assert.deepEqual([...familyOf(136)].sort(), [133, 134, 135, 136]);
  assert.deepEqual([...familyOf(999)], [999]);
});
