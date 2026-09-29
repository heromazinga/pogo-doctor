// 4-B5 정리 도우미 검색어 생성: CNF 형식, 교차곱 충돌 시 분할, 예상 수, 제외 규칙
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroups, buildQuery, matches, classify, buildCleanup } from "../app/lib/searchBuilder.js";

const t = (id, species_id, hp, cp = null, extra = {}) => ({ id, species_id, hp, cp, cpVerified: cp != null, is_shadow: false, form: "Normal", ...extra });

test("형식: 도감번호 OR & hp OR (CNF), 정렬·중복 제거", () => {
  assert.equal(buildQuery([t("a", 700, 154), t("b", 381, 118), t("c", 700, 154)]), "381,700&hp118,hp154");
  assert.ok(matches("381,700&hp118,hp154", { species_id: 700, hp: 118 }), "교차곱: 님피아 hp118 도 잡힘");
  assert.ok(!matches("381,700&hp118,hp154", { species_id: 700, hp: 120 }));
  assert.ok(matches("700&hp154&cp2100-2200", { species_id: 700, hp: 154, cp: 2173 }));
  assert.ok(!matches("700&hp154&cp2100-2200", { species_id: 700, hp: 154, cp: 2300 }));
});

test("교차곱 충돌: 비대상 개체가 잡히면 묶음을 쪼갠다", () => {
  const targets = [t("a", 700, 154), t("b", 381, 118)];
  const population = [...targets, t("x", 700, 118)]; // 보관 중인 님피아 hp118 → "381,700&hp118,hp154" 가 잡음
  const { groups, skipped } = buildGroups(targets, population);
  assert.equal(skipped.length, 0);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.query).sort(), ["381&hp118", "700&hp154"]);
  assert.ok(groups.every((g) => g.expected === 1));
});

test("충돌 없으면 한 묶음, 예상 수 = 대상 수", () => {
  const targets = [t("a", 700, 154), t("b", 381, 118), t("c", 248, 176)];
  const { groups } = buildGroups(targets, [...targets, t("x", 6, 150)]);
  assert.equal(groups.length, 1); assert.equal(groups[0].expected, 3); assert.equal(groups[0].query, "248,381,700&hp118,hp154,hp176");
});

test("같은 종·HP 의 보관 개체: 검증된 CP 로 좁히고, CP 도 같으면 제외", () => {
  const targets = [t("a", 700, 154, 2173)];
  const g1 = buildGroups(targets, [...targets, t("x", 700, 154, 1500)]);
  assert.equal(g1.groups.length, 1); assert.ok(g1.groups[0].withCp); assert.equal(g1.groups[0].query, "700&hp154&cp2173");
  const g2 = buildGroups([t("a", 700, 154, null)], [t("a", 700, 154, null), t("x", 700, 154, 1500)]);
  assert.equal(g2.groups.length, 0); assert.equal(g2.skipped[0].reason, "같은 종·HP(·CP) 의 보관 개체와 구분 불가");
  const g3 = buildGroups(targets, [...targets, t("x", 700, 154, 2173)]);
  assert.equal(g3.groups.length, 0, "CP 까지 같으면 안전한 검색식 없음");
});

test("HP 없는 대상은 제외, 섀도·폼은 별도 묶음, 길이 상한 분할", () => {
  const targets = [t("a", 700, null), t("b", 700, 154, null, { is_shadow: true }), t("c", 381, 118), t("d", 26, 120, null, { form: "Alolan" })];
  const { groups, skipped } = buildGroups(targets, targets);
  assert.equal(skipped[0].reason, "HP 없음");
  assert.equal(groups.length, 3, groups.map((g) => g.query).join(" | "));
  const many = Array.from({ length: 40 }, (_, i) => t(`m${i}`, 100 + i, 100 + i));
  const r = buildGroups(many, many, { maxLen: 60 });
  assert.ok(r.groups.length > 1 && r.groups.every((g) => g.query.length <= 60));
  assert.equal(r.groups.reduce((s, g) => s + g.expected, 0), 40);
});

test("분류: 박사행은 recheck·💎·이로치·럭키·전설 제외, 태그별, 수집", () => {
  const mk = (id, tier, extra = {}) => ({ id, species_id: 1, hp: 10, verdict: { tier, recommendedTags: extra.tags || [], collect: extra.collect || [] }, ...extra });
  const items = [mk("1", "transfer"), mk("2", "transfer", { recheck: true }), mk("3", "transfer", { collect: [{ reason: "이로치" }] }), mk("4", "transfer", { is_lucky: true }), mk("5", "transfer", { legendary: true }),
    mk("6", "main", { tags: ["불꽃 레이드", "슈퍼리그"] }), mk("7", "hold", { tags: ["불꽃 레이드"] }), mk("8", "need_appraisal")];
  const c = classify(items);
  assert.deepEqual(c.transfer.map((x) => x.id), ["1"]);
  assert.deepEqual([...c.tags.keys()], ["불꽃 레이드", "슈퍼리그"]); assert.equal(c.tags.get("불꽃 레이드").length, 2);
  assert.deepEqual(c.collect.map((x) => x.id), ["3"]);
  const all = buildCleanup(items, items);
  assert.equal(all[0].category, "transfer"); assert.ok(all.some((x) => x.category === "tag:불꽃 레이드"));
});

test("4-B6 strict=false(태그): 충돌이 있어도 묶음 생성 + overlap 표기, strict(박사행)는 쪼갬", () => {
  const targets = [t("a", 700, 154), t("b", 381, 118)];
  const population = [...targets, t("x", 700, 118), t("y", 700, 118)];
  const loose = buildGroups(targets, population, { strict: false });
  assert.equal(loose.groups.length, 1); assert.equal(loose.groups[0].overlap, 2, "다른 개체 최대 2마리 포함 가능"); assert.equal(loose.skipped.length, 0);
  const strict = buildGroups(targets, population, { strict: true });
  assert.equal(strict.groups.length, 2); assert.ok(strict.groups.every((g) => g.overlap === 0));
  const c = buildCleanup([{ id: "a", species_id: 700, hp: 154, verdict: { tier: "main", recommendedTags: ["페어리 레이드"] } }, { id: "x", species_id: 700, hp: 154, verdict: { tier: "transfer", recommendedTags: [] } }], []);
  assert.equal(c.find((x) => x.category.startsWith("tag:")).strict, false); assert.equal(c.find((x) => x.category === "transfer").strict, true);
});

test("4-B6 게임 태그가 있는 개체는 박사행 대상 제외", () => {
  const c = classify([{ id: "1", species_id: 1, hp: 10, verdict: { tier: "transfer" }, game_tags: ["슈퍼리그"] }, { id: "2", species_id: 1, hp: 11, verdict: { tier: "transfer" }, game_tags: [] }]);
  assert.deepEqual(c.transfer.map((x) => x.id), ["2"]);
});
