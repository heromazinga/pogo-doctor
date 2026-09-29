package com.pogodoctor.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

// 4-B3: 새 개체 확정 게이트(막대값 + 이름 해시), 이름 색인
class Phase4b3Test {
    private fun sig(a: Int?, d: Int?, s: Int?, name: Long) = ScanGate.Signature(a, d, s, name)

    @Test fun gate_opens_once_when_only_model_region_changes() {
        // 막대값·이름은 그대로, 전체 화면(모델 애니메이션)은 매 프레임 달라도 게이트는 1회만 열린다
        val g = ScanGate(400)
        var opens = 0
        for (i in 0 until 20) { val d = g.offer(sig(15, 14, 13, 111L), i * 100L); if (d.reason == ScanGate.Reason.OPEN) { opens++; g.confirm(sig(15, 14, 13, 111L), i * 100L); g.close() } }
        assertEquals(1, opens)
        assertEquals(ScanGate.Reason.SAME_AS_CONFIRMED, g.offer(sig(15, 14, 13, 111L), 5000).reason)
    }

    @Test fun gate_requires_400ms_stability_and_reopens_on_new_bars() {
        val g = ScanGate(400)
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(15, 14, 13, 1L), 0).reason)
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(15, 14, 13, 1L), 300).reason)
        assertEquals(ScanGate.Reason.OPEN, g.offer(sig(15, 14, 13, 1L), 400).reason); g.confirm(sig(15, 14, 13, 1L), 400); g.close()
        // 넘김: 막대 애니메이션 중 값이 바뀌는 프레임들 → 불안정
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(3, 14, 13, 2L), 800).reason)
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(9, 14, 13, 2L), 900).reason)
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(12, 15, 10, 2L), 1000).reason)
        assertEquals(ScanGate.Reason.UNSTABLE, g.offer(sig(12, 15, 10, 2L), 1300).reason)
        assertEquals(ScanGate.Reason.OPEN, g.offer(sig(12, 15, 10, 2L), 1400).reason, "새 막대값 400ms 안정 → 새 개체 확정")
    }

    @Test fun gate_not_appraisal_when_bars_missing_and_same_bars_different_name_is_new() {
        val g = ScanGate(400)
        assertEquals(ScanGate.Reason.NOT_APPRAISAL, g.offer(sig(null, 14, 13, 1L), 0).reason)
        for (t in listOf(100L, 600L)) g.offer(sig(15, 15, 15, 7L), t)
        assertEquals(ScanGate.Reason.OPEN, g.offer(sig(15, 15, 15, 7L), 600).reason); g.confirm(sig(15, 15, 15, 7L), 600); g.close()
        // 같은 100% 막대지만 다른 이름(다른 개체) → 다시 열림
        g.offer(sig(15, 15, 15, 8L), 1000); assertEquals(ScanGate.Reason.OPEN, g.offer(sig(15, 15, 15, 8L), 1500).reason)
    }

    @Test fun gate_waiting_too_long_diagnostic() {
        val g = ScanGate(400)
        var t = 0L
        for (i in 0 until 30) { g.offer(sig(15, 14, i % 3, 1L), t); t += 100 } // 계속 바뀜
        assertTrue(g.waitingTooLong(t, 2000))
        g.offer(sig(1, 1, 1, 9L), t); g.offer(sig(1, 1, 1, 9L), t + 500); g.confirm(sig(1, 1, 1, 9L), t + 500); g.close()
        assertFalse(g.waitingTooLong(t + 500, 2000))
    }

    @Test fun name_index_matches_like_full_scan_but_prefiltered() {
        val names = listOf("에이스번", "마기라스", "루카리오", "리자몽", "리자드", "파이리", "뮤츠", "레쿠쟈", "님피아", "해피너스", "폴리곤Z", "가디안") + (1..1400).map { "더미종$it" }
        val idx = NameIndex(names)
        assertEquals("루카리오", idx.best("루카리 오")!!.value)
        assertEquals("마기라스", idx.best("마기라스")!!.value); assertEquals(1.0, idx.best("마기라스")!!.score)
        assertEquals("에이스번", idx.best("애이스번")!!.value, "모음 오인식은 자모 바이그램 공유로 통과")
        val r = idx.rank("리자", 0.4, 8).map { it.value }
        assertTrue(r.contains("리자몽") && r.contains("리자드"), r.toString())
        assertTrue(idx.rank("완전다른말", 0.6).isEmpty())
        // 전체 비교와 같은 답 (상위 1)
        val full = Fuzzy.best("루카리 오", names, 0.0)!!.value
        assertEquals(full, idx.best("루카리 오")!!.value)
        val t0 = System.nanoTime(); repeat(20) { idx.best("애이스번") }; val ms = (System.nanoTime() - t0) / 1e6 / 20
        assertTrue(ms < 20, "색인 조회 ${ms}ms (1,412종)")
    }
}
