package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertNull

// 4-B5: 검색어 생성(웹 tests/search.test.mjs 와 같은 사례), CP 검증(이월 금지)
class Phase4b5Test {
    private fun t(id: String, sp: Int, hp: Int?, cp: Int? = null, shadow: Boolean = false, form: String = "Normal") = SearchBuilder.Item(id, sp, hp, cp, cp != null, shadow, form)

    @Test fun cnf_format_and_matching() {
        assertEquals("381,700&hp118,hp154", SearchBuilder.buildQuery(listOf(t("a", 700, 154), t("b", 381, 118), t("c", 700, 154))))
        assertTrue(SearchBuilder.matches("381,700&hp118,hp154", t("x", 700, 118)))
        assertFalse(SearchBuilder.matches("381,700&hp118,hp154", t("x", 700, 120)))
        assertTrue(SearchBuilder.matches("700&hp154&cp2100-2200", t("x", 700, 154, 2173)))
        assertFalse(SearchBuilder.matches("700&hp154&cp2100-2200", t("x", 700, 154, 2300)))
    }

    @Test fun cross_product_conflict_splits_groups() {
        val targets = listOf(t("a", 700, 154), t("b", 381, 118))
        val r = SearchBuilder.buildGroups(targets, targets + t("x", 700, 118))
        assertEquals(0, r.skipped.size); assertEquals(2, r.groups.size)
        assertEquals(listOf("381&hp118", "700&hp154"), r.groups.map { it.query }.sorted())
        assertTrue(r.groups.all { it.expected == 1 })
        val ok = SearchBuilder.buildGroups(listOf(t("a", 700, 154), t("b", 381, 118), t("c", 248, 176)), listOf(t("a", 700, 154), t("b", 381, 118), t("c", 248, 176), t("x", 6, 150)))
        assertEquals(1, ok.groups.size); assertEquals(3, ok.groups[0].expected); assertEquals("248,381,700&hp118,hp154,hp176", ok.groups[0].query)
    }

    @Test fun same_species_hp_uses_verified_cp_or_skips() {
        val a = t("a", 700, 154, 2173)
        val g1 = SearchBuilder.buildGroups(listOf(a), listOf(a, t("x", 700, 154, 1500)))
        assertEquals("700&hp154&cp2173", g1.groups[0].query); assertTrue(g1.groups[0].withCp)
        val g2 = SearchBuilder.buildGroups(listOf(t("a", 700, 154)), listOf(t("a", 700, 154), t("x", 700, 154, 1500)))
        assertEquals(0, g2.groups.size); assertEquals("같은 종·HP(·CP) 의 보관 개체와 구분 불가", g2.skipped[0].reason)
        assertEquals(0, SearchBuilder.buildGroups(listOf(a), listOf(a, t("x", 700, 154, 2173))).groups.size)
    }

    @Test fun no_hp_skipped_shadow_form_separated_maxlen_split() {
        val targets = listOf(t("a", 700, null), t("b", 700, 154, shadow = true), t("c", 381, 118), t("d", 26, 120, form = "Alolan"))
        val r = SearchBuilder.buildGroups(targets, targets)
        assertEquals("HP 없음", r.skipped[0].reason); assertEquals(3, r.groups.size)
        val many = (0 until 40).map { t("m$it", 100 + it, 100 + it) }
        val m = SearchBuilder.buildGroups(many, many, maxLen = 60)
        assertTrue(m.groups.size > 1 && m.groups.all { it.query.length <= 60 }); assertEquals(40, m.groups.sumOf { it.expected })
    }

    @Test fun cp_must_agree_with_bars_and_hp_else_null() {
        // 에이스번 15/14/14 HP161 → L40 CP3002. 직전 개체의 CP(2212)가 이월되면 막대+HP 레벨에서 나올 수 없는 값 → null, recheck 아님
        val base = IvCalc.Base(238, 163, 190)
        val bars = Appraisal(15, 14, 14)
        assertEquals(3002, IvCalc.validateCp(base, 3002, 161, bars))
        assertNull(IvCalc.validateCp(base, 2212, 161, bars))
        assertNull(IvCalc.validateCp(base, 221, 161, bars), "잘린 CP")
        assertEquals(3002, IvCalc.validateCp(base, 3002, null, bars))
        // 막대와 HP 가 모순(HP161 이 sta 14 로 안 나옴)일 때만 recheck 대상: candidatesWithoutCp 가 비어 있음
        assertTrue(IvCalc.candidatesWithoutCp(base, 161, Appraisal(15, 14, 0)).isEmpty())
    }
}

class Phase4b6Test {
    @Test fun game_tag_chips_from_ocr_text() {
        val lines = listOf(OcrLine("CP 2081", 0, 60, 100, 100), OcrLine("디안시", 0, 700, 100, 740), OcrLine("불꽃 레이드", 40, 820, 200, 850), OcrLine("슈퍼리그 · 교환용", 40, 860, 300, 890),
            OcrLine("HP 102 / 102", 0, 780, 100, 810), OcrLine("공격", 0, 1120, 80, 1140), OcrLine("내맘대로태그", 40, 900, 200, 930))
        assertEquals(listOf("불꽃 레이드", "슈퍼리그", "교환용"), GameTags.detect(lines))
        assertEquals(listOf("불꽃 레이드", "슈퍼리그", "교환용", "내맘대로태그"), GameTags.detect(lines, listOf("내맘대로태그")))
        assertTrue(GameTags.detect(listOf(OcrLine("공격", 0, 0, 10, 10), OcrLine("HP 10/10", 0, 0, 10, 10))).isEmpty())
        assertEquals(listOf("불꽃 레이드"), GameTags.detect(listOf(OcrLine("불꽃  레이드", 0, 0, 10, 10))), "공백 차이 무시")
    }

    @Test fun search_builder_loose_mode_reports_overlap_and_strict_splits() {
        val t = { id: String, sp: Int, hp: Int -> SearchBuilder.Item(id, sp, hp, null, false) }
        val targets = listOf(t("a", 700, 154), t("b", 381, 118))
        val population = targets + listOf(t("x", 700, 118), t("y", 700, 118))
        val loose = SearchBuilder.buildGroups(targets, population, strict = false)
        assertEquals(1, loose.groups.size); assertEquals(2, loose.groups[0].overlap); assertEquals(0, loose.skipped.size)
        val strict = SearchBuilder.buildGroups(targets, population, strict = true)
        assertEquals(2, strict.groups.size); assertTrue(strict.groups.all { it.overlap == 0 })
    }
}
