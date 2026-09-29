package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 4-A: 막대 판독 보정(사용자 캡처 16장 근거), 화면 분류, OCR 정규화, CP 없는 경로, 종 보정
class Phase4aTest {
    // A90 캡처 720×1600 기준 합성 평가 화면: 막대 y 1150/1216/1282(두께 15), x 86~334, 3구간 사이 흰 틈 2px, 분홍 테두리
    private val W = 720; private val H = 1600
    private val ORANGE = 0xFFEEA74E.toInt() // (238,167,78)
    private val RED = 0xFFDA7F7E.toInt()    // (218,127,126)
    private val GRAY = 0xFFE2E2E0.toInt()   // (226,226,224)
    private val PINK = 0xFFE8B6B5.toInt()   // (232,182,181)
    private val WHITE = 0xFFFFFFFF.toInt()
    private val X0 = 86; private val X1 = 334

    private fun screen(atk: Int, def: Int, sta: Int): BarReader.PixelSource {
        val bars = listOf(1150 to atk, 1216 to def, 1282 to sta)
        return BarReader.PixelSource { x, y ->
            // 분홍 패널 테두리 (막대 왼쪽·오른쪽 세로선)
            if ((x in 60..63 || x in 660..663) && y in 1000..1400) return@PixelSource PINK
            for ((cy, v) in bars) {
                if (y in (cy - 7)..(cy + 7) && x in X0..X1) {
                    val rel = x - X0; val len = X1 - X0 + 1
                    // 5칸 단위 구간 사이 흰 틈 (rel = len/3, 2len/3 근처 2px)
                    if (Math.abs(rel - len / 3) <= 1 || Math.abs(rel - 2 * len / 3) <= 1) return@PixelSource WHITE
                    val filledPx = (len * v / 15.0).toInt()
                    return@PixelSource if (v == 15) RED else if (rel < filledPx) ORANGE else GRAY
                }
            }
            WHITE
        }
    }
    private val labels = listOf(OcrLine("공격", 40, 1120, 100, 1140), OcrLine("방어", 40, 1186, 100, 1206), OcrLine("HP", 40, 1252, 90, 1272))

    // 사용자가 CP/HP 역산으로 확정한 9건 (종, CP, HP, 막대 공/방/HP, 레벨)
    data class Case(val name: String, val base: IvCalc.Base, val cp: Int, val hp: Int, val atk: Int, val def: Int, val sta: Int, val level: Double)
    private val cases = listOf(
        Case("마기라스", IvCalc.Base(251, 207, 225), 3335, 176, 15, 15, 14, 31.0),
        Case("디안시", IvCalc.Base(190, 285, 137), 2081, 102, 15, 15, 11, 27.0),
        Case("라티오스", IvCalc.Base(268, 212, 190), 2127, 118, 15, 12, 8, 20.0),
        Case("루카리오", IvCalc.Base(236, 144, 172), 2006, 125, 15, 13, 10, 26.5),
        Case("블레이범", IvCalc.Base(223, 173, 186), 2117, 136, 13, 13, 15, 26.0),
        Case("전수목", IvCalc.Base(330, 144, 195), 2212, 124, 12, 14, 13, 20.0),
        Case("가이오가", IvCalc.Base(270, 228, 205), 2283, 129, 11, 12, 11, 20.0),
        Case("님피아", IvCalc.Base(203, 205, 216), 2173, 154, 11, 6, 11, 26.0),
        Case("라티아스", IvCalc.Base(228, 246, 190), 1901, 121, 7, 6, 14, 20.0),
    )

    @Test fun colors_from_real_captures() {
        assertTrue(BarReader.isOrange(ORANGE)); assertFalse(BarReader.isRed(ORANGE))
        assertTrue(BarReader.isRed(RED)); assertTrue(BarReader.isFilled(RED))
        assertTrue(BarReader.isEmpty(GRAY)); assertFalse(BarReader.isFilled(GRAY))
        assertFalse(BarReader.isFilled(PINK), "분홍 테두리는 막대 아님"); assertFalse(BarReader.isEmpty(PINK)); assertTrue(BarReader.isPinkBorder(PINK))
        assertFalse(BarReader.isFilled(WHITE)); assertFalse(BarReader.isEmpty(WHITE), "흰 틈 제외")
    }

    @Test fun bars_by_label_match_user_cases_9_of_9() {
        for (c in cases) {
            val src = screen(c.atk, c.def, c.sta)
            val r = BarReader.readAppraisal(src, W, H, labels)
            assertEquals(Appraisal(c.atk, c.def, c.sta), r.appraisal, "${c.name} 라벨 기준: ${r.detail}")
            assertFalse(r.mismatch, "라벨 y 판독과 비율 판독이 일치 (4-B4: 비율이 기본값)")
        }
    }

    @Test fun bars_by_ratio_fallback_when_labels_missing() {
        for (c in cases) {
            val src = screen(c.atk, c.def, c.sta)
            val r = BarReader.readAppraisal(src, W, H, emptyList())
            assertEquals(Appraisal(c.atk, c.def, c.sta), r.appraisal, "${c.name} 비율 기준: ${r.detail}")
            assertTrue(r.fromRatio)
        }
        // 라벨 하나만 빠져도 그 축은 비율로
        val src = screen(15, 13, 10)
        val r = BarReader.readAppraisal(src, W, H, labels.filter { it.text != "방어" })
        assertEquals(Appraisal(15, 13, 10), r.appraisal, r.detail)
        assertTrue(r.detail.contains("방:13(") && r.detail.contains("ratio"))
    }

    @Test fun bars_plus_cp_hp_agree_with_user_cases() {
        for (c in cases) {
            val cands = IvCalc.candidates(c.base, c.cp, c.hp)
            val f = IvCalc.filterByAppraisal(cands, c.atk, c.def, c.sta)
            assertTrue(f.any { it.level == c.level }, "${c.name}: 막대 ${c.atk}/${c.def}/${c.sta} 가 CP${c.cp} HP${c.hp} 후보에 있어야 함 (${cands.size}건)")
        }
    }

    @Test fun classify_by_labels_and_skip_moves_on_appraisal() {
        val species = listOf(SpeciesRef(248, "Normal", "마기라스", 251, 207, 225, listOf("깨물기", "스톤에지")))
        val parser = ScreenParser(species, listOf("깨물기", "스톤에지"))
        val lines = listOf(OcrLine("CP 3335", 300, 60, 420, 100), OcrLine("마기라스", 300, 700, 420, 740), OcrLine("HP 176 / 176", 300, 780, 420, 810),
            OcrLine("공격", 40, 1120, 100, 1140), OcrLine("방어", 40, 1186, 100, 1206), OcrLine("HP", 40, 1252, 90, 1272), OcrLine("강화", 100, 1500, 200, 1540), OcrLine("7", 250, 1500, 300, 1540))
        val info = parser.parse(lines)
        assertEquals(ScreenInfo.Kind.APPRAISAL, info.kind, "공격+방어+HP 라벨 → 평가 화면 (문구 없이도)")
        assertEquals(3335, info.cp); assertEquals(176, info.hp); assertEquals(248, info.species?.id)
        assertTrue(info.moves.isEmpty(), "평가 화면에서는 기술 매칭 안 함")
        val detail = parser.parse(lines.filter { !ScreenParser.isLabelLine(it) })
        assertEquals(ScreenInfo.Kind.DETAIL, detail.kind)
    }

    @Test fun ocr_normalization_cp_hp() {
        assertEquals("150", ScreenParser.fixDigits("15O")); assertEquals("2081", ScreenParser.fixDigits("2O81")); assertEquals("HP 15O/15O".let { ScreenParser.fixDigits(it) }, "HP 150/150")
        val species = listOf(SpeciesRef(719, "Normal", "디안시", 190, 285, 137, emptyList()))
        val parser = ScreenParser(species, emptyList())
        val a = parser.parse(listOf(OcrLine("cp 2O81", 0, 0, 100, 40), OcrLine("디안시", 0, 100, 100, 140), OcrLine("HP 1O2/1O2", 0, 200, 100, 240)))
        assertEquals(2081, a.cp); assertEquals(102, a.hp)
        // 잘림: "CP16" → 자릿수 비정상 → null + 경고, 화면은 상세로 유지
        val t = parser.parse(listOf(OcrLine("CP16", 0, 0, 100, 40), OcrLine("디안시", 0, 100, 100, 140), OcrLine("HP 102/102", 0, 200, 100, 240)))
        assertNull(t.cp); assertTrue(t.cpTruncated); assertTrue(t.warnings.any { it.contains("잘림") })
        assertEquals(ScreenInfo.Kind.DETAIL, t.kind)
    }

    @Test fun candidates_without_cp_from_bars_and_hp() {
        val diancie = IvCalc.Base(190, 285, 137)
        val c = IvCalc.candidatesWithoutCp(diancie, 102, Appraisal(15, 15, 11))
        assertTrue(c.isNotEmpty()); assertTrue(c.any { it.level == 27.0 }); assertTrue(c.all { it.atk == 15 && it.def == 15 && it.sta == 11 })
        assertTrue(IvCalc.candidatesWithoutCp(diancie, 102, Appraisal(15, null, 11)).isEmpty(), "막대 하나라도 없으면 계산 불가")
        assertTrue(IvCalc.candidatesWithoutCp(diancie, null, Appraisal(15, 15, 11)).size > c.size, "HP 도 없으면 레벨 전체")
    }

    @Test fun species_constrained_by_cp_hp() {
        val species = listOf(
            SpeciesRef(5, "Normal", "리자드", 158, 126, 151, emptyList()),
            SpeciesRef(6, "Normal", "리자몽", 223, 173, 186, emptyList()),
            SpeciesRef(4, "Normal", "파이리", 116, 93, 118, emptyList()),
        )
        val parser = ScreenParser(species, emptyList())
        // "리자" + CP2376: 리자드는 L51 최대 CP 로도 불가 → 리자몽으로 보정
        val cp = Cpm.cp(223, 173, 186, 15, 14, 14, 40.0); val hp = Cpm.hp(186, 14, 40.0)
        val info = parser.parse(listOf(OcrLine("CP $cp", 0, 0, 100, 40), OcrLine("리자", 0, 100, 100, 140), OcrLine("HP $hp/$hp", 0, 200, 100, 240)))
        assertEquals(6, info.species?.id, info.warnings.joinToString())
        assertTrue(info.warnings.any { it.contains("보정") })
        // CP 가 낮으면 여러 종 성립 가능 → 후보 목록 제공
        val low = parser.parse(listOf(OcrLine("CP 300", 0, 0, 100, 40), OcrLine("리자", 0, 100, 100, 140)))
        assertTrue(low.speciesCandidates.size >= 2, "후보 ${low.speciesCandidates.map { it.nameKr }}")
        assertNull(low.species, "여러 종 성립 + 이름 불확실 → 선택 요청")
    }

    @Test fun caught_line_detection_and_date_only() {
        val l1 = OcrLine("서울특별시 강남구에서 잡았다", 0, 1500, 500, 1540)
        val l2 = OcrLine("2024. 5. 12", 0, 1550, 300, 1590)
        val l3 = OcrLine("HP 102/102", 0, 200, 100, 240)
        assertTrue(ScreenParser.isCaughtLine(l1)); assertTrue(ScreenParser.isCaughtLine(l2)); assertFalse(ScreenParser.isCaughtLine(l3))
        assertEquals("2024-05-12", ScreenParser.parseCaughtOn(listOf(l1, l2, l3)))
        assertNull(ScreenParser.parseCaughtOn(listOf(l1, l3)))
        // 장소 문자열은 ScreenInfo 에 남지 않는다 (날짜만)
        val parser = ScreenParser(listOf(SpeciesRef(719, "Normal", "디안시", 190, 285, 137, emptyList())), emptyList())
        val info = parser.parse(listOf(OcrLine("CP 2081", 0, 0, 100, 40), OcrLine("디안시", 0, 100, 100, 140), l3, l1, l2))
        assertEquals("2024-05-12", info.caughtOn); assertNotNull(info.species)
        assertFalse(info.toString().contains("강남구"))
    }
}
