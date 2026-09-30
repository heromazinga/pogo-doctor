// 4-B5 정리 도우미 검색어 생성: CNF 형식, 교차곱 충돌 시 분할, 예상 수, 제외 규칙
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroups, buildQuery, matches, classify, buildCleanup, PROTECT_SUFFIX } from "../app/lib/searchBuilder.js";

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

test("HP 없는 대상은 제외, 그림자·폼은 별도 묶음, 길이 상한 분할", () => {
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

test("4-C.2 B 박사행 보호 조건: 항상 '&!#&!색이 다른&!반짝반짝&!xxl&!배경' 추가(박사행만), 길이 상한에 포함, matches 부정 절", () => {
  const items = [{ id: "a", species_id: 700, hp: 154, verdict: { tier: "transfer", recommendedTags: [] } }, { id: "b", species_id: 381, hp: 118, verdict: { tier: "main", recommendedTags: ["슈퍼리그"] } }];
  const c = buildCleanup(items, items);
  const tr = c.find((x) => x.category === "transfer");
  assert.equal(PROTECT_SUFFIX, "&!#&!색이 다른&!반짝반짝&!xxl&!xxs&!배경&!특별&!다이맥스"); // 4-D2: 코스튬(!특별), 4-D3: xxs·다이맥스
  assert.equal(PROTECT_SUFFIX.length, 40, "글자 수(한글 1자 = 1)");
  assert.ok(matches("700&hp154" + PROTECT_SUFFIX, { species_id: 700, hp: 154 }), "!특별·!다이맥스 는 앱이 모르는 정보 → 잡힌다고 봄");
  assert.ok(matches("700&hp154&!거다이맥스", { species_id: 700, hp: 154 }), "거다이맥스 절도 인식(추가 예정)");
  assert.equal(tr.groups[0].query, "700&hp154" + PROTECT_SUFFIX); assert.equal(tr.protect, true);
  assert.equal(c.find((x) => x.category === "tag:슈퍼리그").groups[0].query, "381&hp118", "태그 묶음에는 붙이지 않음");
  assert.ok(matches("700&hp154" + PROTECT_SUFFIX, { species_id: 700, hp: 154, game_tags: [] }));
  assert.ok(!matches("700&hp154" + PROTECT_SUFFIX, { species_id: 700, hp: 154, game_tags: ["즐겨찾기"] }));
  assert.ok(!matches("700&hp154" + PROTECT_SUFFIX, { species_id: 700, hp: 154, is_shiny: true }));
  assert.ok(!matches("700&hp154" + PROTECT_SUFFIX, { species_id: 700, hp: 154, is_lucky: true }));
  // 길이 상한: 보호 조건(40자) 포함해 70자 이내로 쪼개짐
  const many = Array.from({ length: 6 }, (_, i) => t(`m${i}`, 100 + i, 100 + i));
  const r = buildGroups(many, many, { maxLen: 70, strict: true, suffix: PROTECT_SUFFIX });
  assert.ok(r.groups.length > 1 && r.groups.every((g) => g.query.length <= 70 && g.query.endsWith(PROTECT_SUFFIX)), r.groups.map((g) => g.query).join(" | "));
  assert.equal(r.groups.reduce((s, g) => s + g.expected, 0), 6);
});

test("4-D3 고개체 보류 개체는 박사행 대상 제외 + 같은 종·HP 박사행 묶음은 CP 로 좁혀 잡지 않음(strict)", () => {
  const hi = { id: "hi", species_id: 25, hp: 60, cp: 500, cpVerified: true, verdict: { tier: "hold", recommendedTags: ["수집"], collect: [{ reason: "고개체(14+/14+/14+)", collectTag: true, hold: true }] } };
  const lo = { id: "lo", species_id: 25, hp: 60, cp: 420, cpVerified: true, verdict: { tier: "transfer", recommendedTags: [] } };
  const c = buildCleanup([hi, lo], [hi, lo]);
  const tr = c.find((x) => x.category === "transfer");
  assert.deepEqual(tr.groups.map((g) => g.targetIds), [["lo"]], "고개체는 박사행 아님");
  assert.ok(!matches(tr.groups[0].query, hi), tr.groups[0].query);
  assert.ok(matches(tr.groups[0].query, lo));
  assert.equal(c.find((x) => x.category === "tag:수집").groups[0].targetIds[0], "hi");
});

test("4-C.2 C 수집: 'tag:수집' 묶음(등급 무관) + 이로치·배경·XXL 고정 검색어(예상 수 없음)", () => {
  const items = [{ id: "a", species_id: 999, hp: 50, verdict: { tier: "transfer", recommendedTags: ["수집"], collect: [{ reason: "개체값 100%" }] } }, { id: "b", species_id: 381, hp: 118, verdict: { tier: "main", recommendedTags: ["슈퍼리그"] } }];
  const c = buildCleanup(items, items);
  assert.equal(c.find((x) => x.category === "transfer"), undefined, "💎 수집 대상은 박사행 아님");
  assert.equal(c.find((x) => x.category === "tag:수집").groups[0].query, "999&hp50");
  const fixed = c.find((x) => x.category === "collect");
  assert.equal(fixed.fixed, true); assert.deepEqual(fixed.groups.map((g) => g.query), ["색이 다른", "배경", "xxl"]); assert.ok(fixed.groups.every((g) => g.expected === null));
});

test("4-C.3 재확인(recheck) 기록은 박사행·태그·수집 묶음 모두 제외", () => {
  const c = classify([
    { id: "1", species_id: 1, hp: 10, verdict: { tier: "transfer" }, recheck: true },
    { id: "2", species_id: 1, hp: 11, verdict: { tier: "main", recommendedTags: ["슈퍼리그"], collect: [{ reason: "개체값 100%" }] }, recheck: true },
    { id: "3", species_id: 1, hp: 12, verdict: { tier: "main", recommendedTags: ["슈퍼리그"] } },
  ]);
  assert.deepEqual(c.transfer, []); assert.deepEqual(c.tags.get("슈퍼리그").map((x) => x.id), ["3"]); assert.deepEqual(c.collect, []);
});

test("4-B6 게임 태그가 있는 개체는 박사행 대상 제외", () => {
  const c = classify([{ id: "1", species_id: 1, hp: 10, verdict: { tier: "transfer" }, game_tags: ["슈퍼리그"] }, { id: "2", species_id: 1, hp: 11, verdict: { tier: "transfer" }, game_tags: [] }]);
  assert.deepEqual(c.transfer.map((x) => x.id), ["2"]);
});
