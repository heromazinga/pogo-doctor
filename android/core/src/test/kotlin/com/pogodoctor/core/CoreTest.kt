package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreTest {
    private val mewtwo = IvCalc.Base(300, 182, 214)
    private val species = listOf(
        SpeciesRef(150, "Normal", "뮤츠", 300, 182, 214, listOf("염동력", "사이코브레이크", "섀도볼", "사이코커터")),
        SpeciesRef(448, "Normal", "루카리오", 236, 144, 172, listOf("카운터", "파동탄", "인파이트")),
        SpeciesRef(384, "Normal", "레쿠쟈", 284, 170, 213, listOf("용의숨결", "역린", "화룡점정")),
        SpeciesRef(6, "Normal", "리자몽", 223, 173, 186, listOf("불꽃세례", "블러스트번")),
    )
    private val parser = ScreenParser(species, species.flatMap { it.moveNamesKr })

    @Test fun cpm_matches_web() {
        assertEquals(0.7903, Cpm.forLevel(40.0)); assertEquals(0.8403, Cpm.forLevel(50.0))
        assertEquals(4178, Cpm.cp(300, 182, 214, 15, 15, 15, 40.0), "뮤츠 L40 100%")
        assertEquals(3835, Cpm.cp(284, 170, 213, 15, 15, 15, 40.0), "레쿠쟈")
        assertEquals(3792, Cpm.cp(263, 198, 209, 15, 15, 15, 40.0), "망나뇽")
    }

    @Test fun iv_candidates_from_cp_and_hp() {
        val cp = Cpm.cp(300, 182, 214, 15, 14, 13, 30.0); val hp = Cpm.hp(214, 13, 30.0)
        val cands = IvCalc.candidates(mewtwo, cp, hp)
        assertTrue(cands.any { it.level == 30.0 && it.atk == 15 && it.def == 14 && it.sta == 13 }, "정답 조합 포함")
        val s = IvCalc.summarize(cands)
        assertTrue(s.percentRange!!.contains(93))
        // 평가 막대로 확정
        val f = IvCalc.filterByAppraisal(cands, 15, 14, 13)
        assertTrue(f.all { it.atk == 15 && it.def == 14 && it.sta == 13 })
    }

    @Test fun fuzzy_corrects_ocr_noise() {
        assertEquals("루카리오", Fuzzy.best("루카리 오", listOf("루카리오", "리자몽"))!!.value)
        assertEquals("사이코브레이크", Fuzzy.best("사이코브레이그", listOf("사이코브레이크", "섀도볼"))!!.value)
        assertNull(Fuzzy.best("완전다른말", listOf("루카리오"), 0.6))
    }

    @Test fun parse_detail_screen() {
        val lines = listOf(
            OcrLine("CP 2345", 400, 100, 600, 160),
            OcrLine("루카리오", 380, 700, 620, 760),
            OcrLine("HP 120 / 120", 380, 800, 620, 850),
            OcrLine("체중 54.0kg", 200, 900, 400, 940),
            OcrLine("카운터", 100, 1300, 300, 1340),
            OcrLine("파동탄", 100, 1400, 300, 1440),
            OcrLine("포획 날짜 2026/09/01", 100, 1800, 500, 1840),
        )
        val info = parser.parse(lines)
        assertEquals(ScreenInfo.Kind.DETAIL, info.kind)
        assertEquals(2345, info.cp); assertEquals(120, info.hp)
        assertEquals(448, info.species?.id)
        assertEquals(listOf("카운터", "파동탄"), info.moves.map { it.nameKr })
    }

    @Test fun parse_cp_split_lines_and_nickname() {
        val lines = listOf(OcrLine("CP", 0, 0, 50, 30), OcrLine("1234", 60, 0, 120, 30), OcrLine("내최애", 0, 100, 100, 130), OcrLine("HP 80/80", 0, 200, 100, 230))
        val info = parser.parse(lines)
        assertEquals(1234, info.cp); assertEquals(80, info.hp)
        assertNull(info.species, "닉네임은 종으로 매칭되지 않음")
        assertTrue(info.warnings.any { it.contains("이름 인식 불확실") })
    }

    @Test fun parse_appraisal_screen() {
        val lines = listOf(OcrLine("이 포켓몬의 능력은 최고예요!", 0, 0, 500, 40), OcrLine("공격", 0, 100, 80, 130), OcrLine("방어", 0, 200, 80, 230), OcrLine("HP", 0, 300, 80, 330))
        val info = parser.parse(lines, Appraisal(15, 14, 13))
        assertEquals(ScreenInfo.Kind.APPRAISAL, info.kind)
        assertEquals(Appraisal(15, 14, 13), info.appraisal)
    }

    @Test fun bar_reader_counts_filled_ratio() {
        // 폭 300: 막대는 비율 x 범위(0.119~0.464W = 36~139) 안 x=40..135. 채워진 주황 60%, 나머지 회색 (4-B4: x 범위 고정)
        val src = BarReader.PixelSource { x, _ -> when { x in 40..96 -> 0xFFF07030.toInt(); x in 97..135 -> 0xFFC8C8C8.toInt(); else -> 0xFFFFFFFF.toInt() } }
        val r = BarReader.readRow(src, 10, 0, 299)
        assertEquals(9, r.value, "60% → 9칸")
        val ap = BarReader.readAppraisal(src, 300, 400, listOf(OcrLine("공격", 0, 0, 80, 20), OcrLine("방어", 0, 0, 80, 20), OcrLine("HP", 0, 0, 80, 20)))
        assertEquals(9, ap.appraisal.atk)
        val none = BarReader.readRow({ _, _ -> 0xFFFFFFFF.toInt() }, 0, 0, 100)
        assertNull(none.value)
    }

    @Test fun verdict_lines() {
        val s = IvCalc.summarize(listOf(IvCalc.Candidate(30.0, 15, 15, 15)))
        val v = Verdict.oneLiner(mewtwo, s)
        assertTrue(v.raid.contains("우수"), v.raid)
        assertTrue(v.league.contains("슈퍼 1500 → L"), v.league)
        assertNotNull(Verdict.oneLiner(mewtwo, IvCalc.summarize(emptyList())).raid)
    }
}
