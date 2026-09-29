package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

// 4-B4: 막대 판독은 비율(x 고정) 기본, 라벨은 y 만. 라벨 x 범위 확장 버그 재현. 게이트 재시도.
class Phase4b4Test {
    private val W = 1080; private val H = 2400   // 실기기 디버그 캡처 해상도 (막대 ~370px = 0.119~0.464W)
    private val ORANGE = 0xFFEEA74E.toInt(); private val RED = 0xFFDA7F7E.toInt(); private val GRAY = 0xFFE2E2E0.toInt(); private val WHITE = 0xFFFFFFFF.toInt()
    private val PANEL = 0xFFEDEDEB.toInt()   // 막대 오른쪽 패널 배경(무채색 밝은 회색 — isEmpty 를 통과해 라벨 방식 분모를 늘리던 원인)
    private val X0 = (W * 0.119).toInt(); private val X1 = (W * 0.464).toInt()
    private val ys = listOf((H * 0.719).toInt(), (H * 0.760).toInt(), (H * 0.801).toInt())
    private fun screen(atk: Int, def: Int, sta: Int) = BarReader.PixelSource { x, y ->
        for ((i, cy) in ys.withIndex()) {
            if (y in (cy - 10)..(cy + 10)) {
                if (x in X0..X1) { val v = listOf(atk, def, sta)[i]; val len = X1 - X0 + 1; val rel = x - X0
                    if (Math.abs(rel - len / 3) <= 1 || Math.abs(rel - 2 * len / 3) <= 1) return@PixelSource WHITE
                    return@PixelSource if (v == 15) RED else if (rel < (len * v / 15.0).toInt()) ORANGE else GRAY }
                if (x > X1 + 20 && x < W - 40) return@PixelSource PANEL   // 막대 오른쪽으로 패널 회색이 화면 끝까지 이어짐
            }
        }
        WHITE
    }
    private fun labels() = listOf(OcrLine("공격", 60, ys[0] - 45, 150, ys[0] - 15), OcrLine("방어", 60, ys[1] - 45, 150, ys[1] - 15), OcrLine("HP", 60, ys[2] - 45, 140, ys[2] - 15))

    // 사용자 디버그 24건 분석: ratio 값이 정답 (label 은 분모 ~2배로 오답)
    private val cases = listOf(
        Triple("에이스번", Triple(15, 14, 14), 0), Triple("마기라스", Triple(15, 15, 14), 0), Triple("가이오가", Triple(11, 12, 11), 0),
        Triple("전수목", Triple(12, 14, 13), 0), Triple("라티오스", Triple(15, 12, 8), 0), Triple("디안시", Triple(15, 15, 11), 0), Triple("님피아", Triple(11, 6, 11), 0),
    )

    @Test fun ratio_values_are_primary_7_of_7_even_with_labels() {
        for ((name, v, _) in cases) {
            val r = BarReader.readAppraisal(screen(v.first, v.second, v.third), W, H, labels())
            assertEquals(Appraisal(v.first, v.second, v.third), r.appraisal, "$name: ${r.detail}")
        }
    }

    @Test fun label_x_range_bug_is_fixed_label_uses_fixed_x() {
        // 라벨 y 행에서 판독해도 x 범위가 고정이므로 패널 회색이 분모에 들어가지 않는다
        val src = screen(15, 7, 8)
        val byLabel = BarReader.readForLabel(src, W, H, labels()[1])
        assertEquals(7, byLabel.value, "라벨 방식도 x 고정 → 정답 (이전: 분모 2배로 3~4)")
        assertTrue(byLabel.totalPx < (X1 - X0) + 20, "분모 ${byLabel.totalPx}px ≤ 막대 폭 ${X1 - X0}px")
        // 버그 재현: 화면 오른쪽 끝까지 훑으면 분모가 약 2배
        val wide = BarReader.readRow(src, ys[1], 0, W - 8)
        assertTrue(wide.totalPx > (X1 - X0) * 1.5, "옛 방식 분모 ${wide.totalPx}px (막대 ${X1 - X0}px)")
        assertTrue(wide.value!! < 7)
    }

    @Test fun mismatch_returns_ratio_primary_and_label_alt() {
        // 라벨 y 가 실제 막대와 어긋난 경우(라벨 박스가 다른 행을 가리킴): 비율 값 기본, 라벨 값은 alt
        val src = screen(15, 14, 14)
        val badLabels = listOf(OcrLine("공격", 60, ys[1] - 45, 150, ys[1] - 15), OcrLine("방어", 60, ys[2] - 45, 150, ys[2] - 15), OcrLine("HP", 60, ys[2] - 45, 140, ys[2] - 15))
        val r = BarReader.readAppraisal(src, W, H, badLabels)
        assertEquals(Appraisal(15, 14, 14), r.appraisal, r.detail)
        assertTrue(r.mismatch); assertNotNull(r.alt)
        assertEquals(14, r.alt!!.atk, "공격 라벨이 방어 행을 가리켜 alt=14")
        val ok = BarReader.readAppraisal(src, W, H, labels())
        assertFalse(ok.mismatch)
    }

    @Test fun gate_retries_twice_at_300ms_then_closes() {
        val g = ScanGate(400, maxAttempts = 3, retryGapMs = 300)
        val s = ScanGate.Signature(15, 14, 14, 5L)
        g.offer(s, 0); assertEquals(ScanGate.Reason.OPEN, g.offer(s, 400).reason); g.confirm(s, 400)      // 1차 시도(실패, close 안 함)
        assertEquals(ScanGate.Reason.SAME_AS_CONFIRMED, g.offer(s, 500).reason, "300ms 전에는 재시도 안 함")
        assertEquals(ScanGate.Reason.OPEN, g.offer(s, 700).reason); g.confirm(s, 700)                       // 2차
        assertEquals(ScanGate.Reason.OPEN, g.offer(s, 1000).reason); g.confirm(s, 1000)                     // 3차
        assertTrue(g.retriesExhausted); g.close()
        assertEquals(ScanGate.Reason.SAME_AS_CONFIRMED, g.offer(s, 2000).reason, "소진 후 닫힘")
        // 성공하면 즉시 닫힘
        val s2 = ScanGate.Signature(1, 2, 3, 6L)
        g.offer(s2, 2100); assertEquals(ScanGate.Reason.OPEN, g.offer(s2, 2500).reason); g.confirm(s2, 2500); g.close()
        assertEquals(ScanGate.Reason.SAME_AS_CONFIRMED, g.offer(s2, 3000).reason)
    }
}
