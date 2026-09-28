package com.pogodoctor.core

// 평가(감정) 화면의 막대 3개(공격/방어/HP, 각 15칸) 판독 — 픽셀 접근은 앱이 함수로 넘긴다 (Android 의존 없음)
// 방법(실기기 보정 후):
//  - 막대 위치는 OCR 로 찾은 "공격/방어/HP" 라벨의 상대 좌표로 잡는다: 라벨 바로 아래 좁은 띠(라벨 높이의 0.3~1.6배 아래)와
//    라벨 오른쪽 같은 높이 띠를 모두 훑어, 막대 픽셀(채움색 또는 빈 회색)이 가장 많은 행을 채택한다.
//  - 채움색: 주황(공격·방어 일부 채움), 빨강(가득 참 = 15). 빈 칸: 밝은 회색. 트레이너 그림이 겹쳐도 띠가 좁아 영향이 적다.
//  - 값 = round(채움 픽셀 / (채움+빈) × 15). 행 전체가 빨강 계열이면 15 로 확정.
//  - 별 개수(0~3)는 라벨 위 영역의 노란 별 덩어리 수로 세어 합계 범위 제약에 쓴다(실패 시 null).
object BarReader {
    fun interface PixelSource { fun argb(x: Int, y: Int): Int }

    data class BarResult(val value: Int?, val filledPx: Int, val totalPx: Int, val red: Boolean)
    data class Reading(val appraisal: Appraisal, val stars: Int?, val detail: String)

    private fun r(c: Int) = (c shr 16) and 255
    private fun g(c: Int) = (c shr 8) and 255
    private fun b(c: Int) = c and 255
    private fun sat(c: Int): Double { val mx = maxOf(r(c), g(c), b(c)); val mn = minOf(r(c), g(c), b(c)); return if (mx == 0) 0.0 else (mx - mn).toDouble() / mx }
    fun isRed(c: Int) = r(c) > 180 && g(c) < 110 && b(c) < 110 && sat(c) > 0.5
    fun isOrange(c: Int) = r(c) > 200 && g(c) in 90..200 && b(c) < 120 && sat(c) > 0.4
    fun isFilled(c: Int) = isRed(c) || isOrange(c)
    fun isEmpty(c: Int): Boolean { val mx = maxOf(r(c), g(c), b(c)); val mn = minOf(r(c), g(c), b(c)); return mx - mn < 22 && mx in 165..240 } // 밝은 회색 칸
    fun isStarYellow(c: Int) = r(c) > 215 && g(c) > 170 && b(c) < 110 && sat(c) > 0.5

    // y 행에서 xStart..xEnd 구간을 훑어 막대 값을 구한다
    fun readRow(px: PixelSource, y: Int, xStart: Int, xEnd: Int): BarResult {
        var first = -1; var last = -1
        for (x in xStart..xEnd) { val c = px.argb(x, y); if (isFilled(c) || isEmpty(c)) { if (first < 0) first = x; last = x } }
        if (first < 0) return BarResult(null, 0, 0, false)
        var filled = 0; var total = 0; var red = 0
        for (x in first..last) { val c = px.argb(x, y); if (isFilled(c)) { filled++; total++; if (isRed(c)) red++ } else if (isEmpty(c)) total++ }
        if (total < 30) return BarResult(null, filled, total, false)
        val isRedBar = red > filled * 0.6 && filled > total * 0.9
        val v = if (isRedBar) 15 else Math.round(filled * 15.0 / total).toInt().coerceIn(0, 15)
        return BarResult(v, filled, total, isRedBar)
    }

    // 라벨 하나에 대해 후보 행(아래 띠 + 오른쪽 같은 높이)을 훑어 막대 픽셀이 가장 많은 행의 값을 택한다
    fun readForLabel(px: PixelSource, width: Int, height: Int, label: OcrLine): BarResult {
        val h = maxOf(8, label.height)
        val rows = ArrayList<Int>()
        // 라벨 아래 좁은 띠
        var y = label.bottom + (h * 0.3).toInt(); val yEnd = minOf(height - 1, label.bottom + (h * 1.6).toInt())
        while (y <= yEnd) { rows.add(y); y += maxOf(1, h / 6) }
        // 라벨 오른쪽 같은 높이
        for (dy in listOf(-h / 4, 0, h / 4)) rows.add((label.centerY + dy).coerceIn(0, height - 1))
        var best: BarResult? = null
        for (yy in rows) {
            val xs = if (yy > label.bottom) maxOf(0, label.left - h) else label.right + 4
            val res = readRow(px, yy, xs, width - 8)
            if (res.value != null && (best == null || res.totalPx > best.totalPx)) best = res
        }
        return best ?: BarResult(null, 0, 0, false)
    }

    // 별 개수: 첫 라벨 위쪽 영역(라벨 높이 1~5배 위)에서 노란 덩어리(run) 수의 최댓값(0~3)
    fun countStars(px: PixelSource, width: Int, firstLabel: OcrLine): Int? {
        val h = maxOf(8, firstLabel.height)
        var best = 0; var any = false
        var y = maxOf(0, firstLabel.top - h * 5)
        while (y < firstLabel.top - h) {
            var runs = 0; var inRun = false; var runLen = 0
            for (x in 0 until width) {
                val yel = isStarYellow(px.argb(x, y))
                if (yel) { runLen++; if (!inRun) { inRun = true } } else { if (inRun && runLen >= h / 3) runs++; inRun = false; runLen = 0 }
            }
            if (inRun && runLen >= h / 3) runs++
            if (runs > 0) any = true
            best = maxOf(best, runs)
            y += maxOf(1, h / 4)
        }
        return if (!any) null else minOf(3, best)
    }

    fun readAppraisal(px: PixelSource, width: Int, height: Int, labels: List<OcrLine>): Reading {
        fun find(keys: List<String>) = labels.firstOrNull { ln -> keys.any { ln.text.replace(" ", "").contains(it) } }
        val la = find(listOf("공격")); val ld = find(listOf("방어")); val ls = find(listOf("HP", "체력"))
        val ra = la?.let { readForLabel(px, width, height, it) }; val rd = ld?.let { readForLabel(px, width, height, it) }; val rs = ls?.let { readForLabel(px, width, height, it) }
        val first = listOfNotNull(la, ld, ls).minByOrNull { it.top }
        val stars = first?.let { countStars(px, width, it) }
        val detail = "공:${ra?.value}(${ra?.filledPx}/${ra?.totalPx}${if (ra?.red == true) " 빨강" else ""}) 방:${rd?.value}(${rd?.filledPx}/${rd?.totalPx}${if (rd?.red == true) " 빨강" else ""}) HP:${rs?.value}(${rs?.filledPx}/${rs?.totalPx}${if (rs?.red == true) " 빨강" else ""}) 별:${stars ?: "?"}"
        return Reading(Appraisal(ra?.value, rd?.value, rs?.value), stars, detail)
    }

    // 별 개수 → 개체값 합계 범위 (0~45). 3별 82%+ (37~45), 2별 67~80% (30~36), 1별 51~64% (23~29), 0별 ≤50% (0~22)
    fun starsToSumRange(stars: Int): IntRange = when (stars) { 3 -> 37..45; 2 -> 30..36; 1 -> 23..29; else -> 0..22 }
}
