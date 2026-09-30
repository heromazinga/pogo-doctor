// 4-B 목록 매칭 규칙 (중복 저장 → 갱신, 재캡처 갱신, 사용자 편집 보존)
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMatch, mergePatch, scanKey, familyOfFactory, findSuperseded } from "../app/lib/pokemonMatch.js";

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
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 500, hp: 60, is_shadow: true }, familyOf), null, "그림자 여부 다르면 별개");
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

test("4-C ③ 강화: 같은 종·개체값, 레벨(CP) 증가 → 같은 개체로 갱신 (포획일 없음·CP/HP 달라도)", () => {
  const rows = [row({ caught_on: null, level: 20 })];
  const m = findMatch(rows, { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 25 }, familyOf);
  assert.equal(m?.rule, "iv+level"); assert.equal(m.row.id, "r1");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 300, hp: 40, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 15 }, familyOf), null, "레벨이 낮아지면 다른 개체");
  // 레벨이 없으면 CP 로 비교
  const noLevel = [row({ caught_on: null, level: null, cp: 500 })];
  assert.equal(findMatch(noLevel, { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13 }, familyOf)?.rule, "iv+level");
  assert.equal(findMatch(noLevel, { species_id: 4, form: "Normal", cp: 400, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13 }, familyOf), null);
  assert.equal(findMatch([row({ caught_on: null, level: null, cp: null })], { species_id: 4, form: "Normal", hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13 }, familyOf), null, "레벨·CP 둘 다 없으면 비교 불가 → 매칭 안 함");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 12, level: 25 }, familyOf), null, "개체값 다르면 별개");
  assert.equal(findMatch(rows, { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 25, is_shadow: true }, familyOf), null);
  assert.equal(findMatch([row({ level: 20 })], { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 25, caught_on: "2024-05-13" }, familyOf), null, "포획일이 둘 다 있고 다르면 다른 개체");
  const p = mergePatch(rows[0], { species_id: 4, form: "Normal", name_kr: "파이리", cp: 700, hp: 70, level: 25, atk_iv: 15, def_iv: 14, sta_iv: 13 });
  assert.equal(p.cp, 700); assert.equal(p.hp, 70); assert.equal(p.level, 25);
  for (const k of ["memo", "tags", "status", "purposes", "game_tags"]) assert.ok(!(k in p), `${k} 유지`);
});

test("4-C ③ 진화: 계열 내 종 변경 + 레벨 비감소 → 갱신(종·CP·HP·레벨 새 값)", () => {
  const rows = [row({ caught_on: null, level: 20 })];
  const m = findMatch(rows, { species_id: 6, form: "Normal", name_kr: "리자몽", cp: 1900, hp: 120, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 20 }, familyOf);
  assert.equal(m?.rule, "iv+level");
  assert.equal(mergePatch(m.row, { species_id: 6, form: "Normal", name_kr: "리자몽", cp: 1900, hp: 120, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 20 }).species_id, 6);
  assert.equal(findMatch(rows, { species_id: 129, form: "Normal", cp: 1900, hp: 120, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 20 }, familyOf), null, "다른 계열");
  assert.equal(findMatch(rows, { species_id: 6, form: "Normal", cp: 1900, hp: 120, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 20 }, null), null, "계열 정보 없으면 같은 종만");
});

test("4-C ③ 동일 개체값 2마리 충돌 → 병합하지 않고 ambiguous (재확인)", () => {
  const rows = [row({ id: "r1", caught_on: null, level: 20 }), row({ id: "r2", caught_on: null, level: 22, cp: 550 })];
  const m = findMatch(rows, { species_id: 4, form: "Normal", cp: 700, hp: 70, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 25 }, familyOf);
  assert.equal(m.ambiguous, true); assert.equal(m.row, null); assert.equal(m.candidates.length, 2);
  // 후보 중 하나만 레벨 조건을 만족하면 그 하나로 확정
  const one = findMatch(rows, { species_id: 4, form: "Normal", cp: 520, hp: 62, atk_iv: 15, def_iv: 14, sta_iv: 13, level: 21 }, familyOf);
  assert.equal(one?.row?.id, "r1");
});

test("4-C 스캔 기록 대체(findSuperseded): 다른 세션의 같은 개체 과거 기록 → superseded, 서로 다른 후보 2개 이상이면 ambiguous", () => {
  const prior = [
    { id: "s1", session_id: "a", species_id: 4, form: "Normal", cp: 500, hp: 60, level: 20, atk_iv: 15, def_iv: 14, sta_iv: 13, is_shadow: false },
    { id: "s2", session_id: "b", species_id: 4, form: "Normal", cp: 500, hp: 60, level: 20, atk_iv: 15, def_iv: 14, sta_iv: 13, is_shadow: false }, // 같은 값의 재기록(같은 개체)
    { id: "s3", session_id: "b", species_id: 4, form: "Normal", cp: 900, hp: 80, level: 30, atk_iv: 15, def_iv: 14, sta_iv: 13, is_shadow: false }, // 더 높은 레벨 → 대상 아님
  ];
  const incoming = { id: "new", species_id: 6, form: "Normal", cp: 1900, hp: 120, level: 25, atk_iv: 15, def_iv: 14, sta_iv: 13, is_shadow: false };
  const r = findSuperseded(prior, incoming, familyOf);
  assert.equal(r.ambiguous, false); assert.deepEqual(r.superseded.map((x) => x.id).sort(), ["s1", "s2"]);
  const r2 = findSuperseded([...prior, { id: "s4", session_id: "c", species_id: 5, form: "Normal", cp: 800, hp: 90, level: 22, atk_iv: 15, def_iv: 14, sta_iv: 13, is_shadow: false }], incoming, familyOf);
  assert.equal(r2.ambiguous, true); assert.equal(r2.superseded.length, 0, "서로 다른 과거 기록(L20 파이리, L22 리자드) → 구분 불가");
  assert.deepEqual(findSuperseded(prior, { ...incoming, atk_iv: null, def_iv: null, sta_iv: null }, familyOf), { superseded: [], ambiguous: false }, "개체값 미확정이면 대체 없음");
});

test("스캔 기록 중복 키·진화 계열", () => {
  assert.equal(scanKey({ species_id: 815, cp: 3002, hp: 161, atk_iv: 15, def_iv: 14, sta_iv: 14 }), "815|Normal|3002|161|15|14|14|0");
  assert.deepEqual([...familyOf(5)].sort(), [4, 5, 6]);
  assert.deepEqual([...familyOf(136)].sort(), [133, 134, 135, 136]);
  assert.deepEqual([...familyOf(999)], [999]);
});
