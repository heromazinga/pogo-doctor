package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 3-1c: 병합 규칙, 막대 비율→값, 강화 비용→레벨, 제약 모순 처리
class Phase31cTest {
    private val cinderace = IvCalc.Base(238, 163, 190) // 에이스번

    @Test fun powerup_tables_match_game_master_shape() {
        assertEquals(49, PowerUp.STARDUST.size); assertEquals(50, PowerUp.CANDY.size); assertEquals(10, PowerUp.XL_CANDY.size)
        // 표 해석: 인덱스 = floor(레벨)-1 (같은 정수 레벨의 두 반레벨 강화 비용이 같다). Bulbapedia 표와 일치:
        // 39-40.5: 10000, 41-42.5: 11000, 43-44.5: 12000, 45-46.5: 13000, 47-48.5: 14000, 49-49.5: 15000; 사탕 39: 15, 40+: 0; XL 40-41: 10, 42-43: 12 …
        assertEquals(PowerUp.Cost(10000, 15, 0), PowerUp.costAt(39.0))
        assertEquals(PowerUp.Cost(10000, 0, 10), PowerUp.costAt(40.0))
        assertEquals(PowerUp.Cost(9000, 12, 0), PowerUp.costAt(38.5))
        assertEquals(PowerUp.Cost(11000, 0, 10), PowerUp.costAt(41.0))
        assertEquals(PowerUp.Cost(11000, 0, 12), PowerUp.costAt(42.5))
        assertEquals(PowerUp.Cost(12000, 0, 12), PowerUp.costAt(43.0))
        assertNull(PowerUp.costAt(50.0), "L50 은 더 강화 불가")
    }

    @Test fun powerup_cost_to_levels() {
        assertEquals(listOf(40.0, 40.5), PowerUp.levelsForCost(10000, null, 10), "10000 + 10XL → L40/40.5")
        assertEquals(listOf(39.0, 39.5), PowerUp.levelsForCost(10000, 15, null), "10000 + 15사탕 → L39/39.5")
        assertEquals(listOf(37.0, 37.5, 38.0, 38.5), PowerUp.levelsForCost(9000, 12, null), "9000·12사탕은 L37~38.5")
        assertEquals(listOf(39.0, 39.5, 40.0, 40.5), PowerUp.levelsForCost(10000, null, null))
        assertEquals(listOf(43.0, 43.5), PowerUp.levelsForCost(12000, null, 12))
        assertTrue(PowerUp.levelsForCost(3600, null, null).contains(21.0), "그림자 ×1.2 (3000→3600)")
        assertTrue(PowerUp.levelsForCost(123, null, null).isEmpty())
    }

    @Test fun powerup_parse_bottom_numbers() {
        val lines = listOf(OcrLine("CP 3002", 0, 100, 200, 140), OcrLine("에이스번", 0, 700, 200, 740), OcrLine("HP 161 / 161", 0, 800, 200, 840),
            OcrLine("강화", 100, 1700, 200, 1740), OcrLine("10,000", 250, 1700, 400, 1740), OcrLine("10", 450, 1700, 500, 1740), OcrLine("XL", 520, 1700, 600, 1740))
        val p = PowerUp.parse(lines, 1900)
        assertEquals(10000, p.stardust); assertNull(p.candy); assertEquals(10, p.xlCandy)
        val p2 = PowerUp.parse(listOf(OcrLine("강화", 100, 1700, 200, 1740), OcrLine("9,000", 250, 1700, 400, 1740), OcrLine("12", 450, 1700, 500, 1740)), 1900)
        assertEquals(9000, p2.stardust); assertEquals(12, p2.candy); assertNull(p2.xlCandy)
        val none = PowerUp.parse(listOf(OcrLine("CP 3002", 0, 100, 200, 140)), 1900)
        assertNull(none.stardust)
    }

    @Test fun bar_ratio_to_value_and_red_full() {
        val orange = 0xFFF5A030.toInt(); val red = 0xFFE83030.toInt(); val gray = 0xFFDCDCDC.toInt(); val white = 0xFFFFFFFF.toInt()
        // 60% 주황 → 9
        val src = BarReader.PixelSource { x, _ -> when { x in 100..189 -> orange; x in 190..250 -> gray; else -> white } }
        assertEquals(9, BarReader.readRow(src, 10, 0, 299).value)
        // 전부 빨강 → 15 (가득 참)
        val full = BarReader.PixelSource { x, _ -> if (x in 100..250) red else white }
        val r = BarReader.readRow(full, 10, 0, 299); assertEquals(15, r.value); assertTrue(r.red)
        // 14/15 주황 → 14
        val near = BarReader.PixelSource { x, _ -> when { x in 100..239 -> orange; x in 240..249 -> gray; else -> white } }
        assertEquals(14, BarReader.readRow(near, 10, 0, 299).value)
        // 라벨 아래 띠 샘플링: 라벨 y 0..20, 막대는 y 30 행에만 있음
        val below = BarReader.PixelSource { x, y -> if (y in 26..34 && x in 40..190) red else white }
        val res = BarReader.readForLabel(below, 300, 400, OcrLine("공격", 40, 0, 100, 20))
        assertEquals(15, res.value)
        assertEquals(37..45, BarReader.starsToSumRange(3)); assertEquals(0..22, BarReader.starsToSumRange(0))
    }

    @Test fun constrain_keeps_candidates_when_bars_contradict() {
        // 실기기 사례: 에이스번 CP3002 HP161 → L40 15/14/14 가 정확히 일치. 막대 판독이 틀려도 후보를 0 으로 만들지 않는다
        val cp = Cpm.cp(238, 163, 190, 15, 14, 14, 40.0); val hp = Cpm.hp(190, 14, 40.0)
        val cands = IvCalc.candidates(cinderace, cp, hp)
        assertTrue(cands.any { it.level == 40.0 && it.atk == 15 && it.def == 14 && it.sta == 14 })
        val wrong = IvCalc.constrain(cands, Appraisal(15, 15, 15), 3, null)
        assertTrue(wrong.candidates.isNotEmpty(), "모순 시 후보 유지"); assertTrue(wrong.barsUncertain)
        assertTrue(wrong.candidates.all { it.atk == 15 }, "일치하는 축(공격 15)만 적용")
        val right = IvCalc.constrain(cands, Appraisal(15, 14, null), 3, listOf(40.0, 40.5))
        assertFalse(right.barsUncertain); assertFalse(right.levelUncertain)
        assertTrue(right.candidates.all { it.atk == 15 && it.def == 14 && it.level in listOf(40.0, 40.5) })
        val badLevel = IvCalc.constrain(cands, null, null, listOf(20.0))
        assertTrue(badLevel.levelUncertain); assertEquals(cands.size, badLevel.candidates.size)
        val badStars = IvCalc.constrain(listOf(cands.first { it.level == 40.0 }), null, 0, null)
        assertTrue(badStars.starsUncertain); assertEquals(1, badStars.candidates.size)
    }

    @Test fun merge_rule_detail_plus_appraisal() {
        val sp = SpeciesRef(815, "Normal", "에이스번", 238, 163, 190, listOf("회오리불꽃", "블라스트번"))
        val detail = ScreenInfo(ScreenInfo.Kind.DETAIL, 3002, 161, "에이스번", sp, 1.0, listOf(MoveMatch("회오리불꽃", "회오리불꽃", 1.0)), null, emptyList())
        val appraisal = ScreenInfo(ScreenInfo.Kind.APPRAISAL, 3002, null, "에이스번", sp, 1.0, emptyList(), Appraisal(15, 14, null), emptyList())
        assertTrue(Merge.canMerge(detail, 1000, appraisal, 1000 + 60_000))
        assertFalse(Merge.canMerge(detail, 1000, appraisal, 1000 + 4 * 60_000), "3분 초과")
        assertFalse(Merge.canMerge(detail, 1000, appraisal.copy(cp = 2999), 2000), "CP 다름")
        assertFalse(Merge.canMerge(detail, 1000, appraisal.copy(species = null, nameRaw = "리자몽"), 2000), "이름 다름")
        assertTrue(Merge.canMerge(detail, 1000, appraisal.copy(species = null, nameRaw = null), 2000), "평가 화면에 이름 없으면 CP 만으로")
        assertFalse(Merge.canMerge(null, 1000, appraisal, 2000))
    }
}
