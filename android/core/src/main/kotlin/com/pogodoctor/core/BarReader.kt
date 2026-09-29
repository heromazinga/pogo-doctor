package com.pogodoctor.core

// 평가(감정) 화면의 막대 3개(공격/방어/HP, 각 15칸) 판독 — 픽셀 접근은 앱이 함수로 넘긴다 (Android 의존 없음)
// 보정 근거: 사용자 디버그 캡처 16장(Galaxy A90 5G, 720×1600) 분석 (docs/PHASE4.md 4-A, PR 보고서)
//  - 막대 중심 y: 공격 0.719H, 방어 0.760H, HP 0.801H (두께 약 15px). x 범위 0.119W~0.464W.
//  - 채움 주황 ≈ (238,167,78), 가득(15) 빨강 ≈ (218,127,126), 빈칸 회색 ≈ (226,226,224).
//  - 패널 테두리 분홍 (232,182,181) 은 막대가 아니다. 3구간 사이 흰 틈은 제외한다.
//  - 값 = round(채움 비율 × 15) → 사용자 캡처 9장에서 CP/HP 역산과 9/9 일치.
//  - 막대 위치는 OCR 라벨("공격/방어/HP") 박스로 찾고, 위 비율은 검증·대체(라벨 미인식 시)용이다.
object BarReader {
    fun interface PixelSource { fun argb(x: Int, y: Int): Int }

    data class BarResult(val value: Int?, val filledPx: Int, val totalPx: Int, val red: Boolean, val source: String = "")
    data class Reading(val appraisal: Appraisal, val stars: Int?, val detail: String, val fromRatio: Boolean = false)

    // 비율 상수 (검증·대체용)
    const val Y_ATK = 0.719; const val Y_DEF = 0.760; const val Y_STA = 0.801
    const val X_START = 0.119; const val X_END = 0.464
    private const val MIN_TOTAL = 30

    private fun r(c: Int) = (c shr 16) and 255
    private fun g(c: Int) = (c shr 8) and 255
    private fun b(c: Int) = c and 255

    // 가득 찬 막대 빨강 ≈ (218,127,126): 붉은 기, g·b 는 중간. 분홍 테두리(232,182,181)는 g>150 이라 제외
    fun isRed(c: Int): Boolean { val rr = r(c); val gg = g(c); val bb = b(c); return rr >= 190 && gg <= 155 && bb <= 155 && rr - gg >= 60 && Math.abs(gg - bb) <= 40 }
    // 채움 주황 ≈ (238,167,78): b 가 낮다. 분홍 테두리는 b=181 이라 제외
    fun isOrange(c: Int): Boolean { val rr = r(c); val gg = g(c); val bb = b(c); return rr >= 205 && gg in 90..200 && bb <= 115 && rr - bb >= 90 }
    fun isFilled(c: Int) = isRed(c) || isOrange(c)
    // 빈 칸 회색 ≈ (226,226,224): 무채색, 흰색(≥245)은 틈이므로 제외
    fun isEmpty(c: Int): Boolean { val mx = maxOf(r(c), g(c), b(c)); val mn = minOf(r(c), g(c), b(c)); return mx - mn < 22 && mx in 165..240 }
    fun isPinkBorder(c: Int): Boolean { val rr = r(c); val gg = g(c); val bb = b(c); return rr in 215..245 && gg in 165..200 && bb in 165..200 && rr - gg in 35..70 }
    fun isStarYellow(c: Int) = r(c) > 215 && g(c) > 170 && b(c) < 110 && (r(c) - b(c)) > 100

    // y 행에서 xStart..xEnd 구간을 훑어 막대 값을 구한다 (흰 틈·분홍 테두리는 무시)
    fun readRow(px: PixelSource, y: Int, xStart: Int, xEnd: Int, source: String = ""): BarResult {
        var first = -1; var last = -1
        for (x in xStart..xEnd) { val c = px.argb(x, y); if (isFilled(c) || isEmpty(c)) { if (first < 0) first = x; last = x } }
        if (first < 0) return BarResult(null, 0, 0, false, source)
        var filled = 0; var total = 0; var red = 0
        for (x in first..last) { val c = px.argb(x, y); if (isFilled(c)) { filled++; total++; if (isRed(c)) red++ } else if (isEmpty(c)) total++ }
        if (total < MIN_TOTAL) return BarResult(null, filled, total, false, source)
        val isRedBar = red > filled * 0.6 && filled > total * 0.9
        val v = if (isRedBar) 15 else Math.round(filled * 15.0 / total).toInt().coerceIn(0, 15)
        return BarResult(v, filled, total, isRedBar, source)
    }

    // 라벨 하나에 대해 후보 행(아래 띠 + 오른쪽 같은 높이)을 훑어 막대 픽셀이 가장 많은 행의 값을 택한다
    fun readForLabel(px: PixelSource, width: Int, height: Int, label: OcrLine): BarResult {
        val h = maxOf(8, label.height)
        val rows = ArrayList<Int>()
        var y = label.bottom + (h * 0.3).toInt(); val yEnd = minOf(height - 1, label.bottom + (h * 1.6).toInt())
        while (y <= yEnd) { rows.add(y); y += maxOf(1, h / 6) }
        for (dy in listOf(-h / 4, 0, h / 4)) rows.add((label.centerY + dy).coerceIn(0, height - 1))
        var best: BarResult? = null
        for (yy in rows) {
            val xs = if (yy > label.bottom) maxOf(0, label.left - h) else label.right + 4
            val res = readRow(px, yy, xs, width - 8, "label")
            if (res.value != null && (best == null || res.totalPx > best.totalPx)) best = res
        }
        return best ?: BarResult(null, 0, 0, false, "label")
    }

    // 비율 위치로 판독: 중심 행 ±6px 중 막대 픽셀이 가장 많은 행
    fun readByRatio(px: PixelSource, width: Int, height: Int, yRatio: Double): BarResult {
        val cy = (height * yRatio).toInt()
        val xs = (width * X_START).toInt() - 6; val xe = (width * X_END).toInt() + 6
        var best: BarResult? = null
        for (dy in -6..6) {
            val yy = (cy + dy).coerceIn(0, height - 1)
            val res = readRow(px, yy, maxOf(0, xs), minOf(width - 1, xe), "ratio")
            if (res.value != null && (best == null || res.totalPx > best.totalPx)) best = res
        }
        return best ?: BarResult(null, 0, 0, false, "ratio")
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

    // 라벨 우선, 라벨이 없거나 판독 실패하면 비율 위치. 둘 다 있고 값이 다르면 detail 에 표기(라벨 값 채택)
    fun readAppraisal(px: PixelSource, width: Int, height: Int, labels: List<OcrLine>): Reading {
        fun find(keys: List<String>) = labels.firstOrNull { ln -> keys.any { ln.text.replace(" ", "").contains(it) } }
        val la = find(listOf("공격")); val ld = find(listOf("방어")); val ls = find(listOf("HP", "체력"))
        fun pick(label: OcrLine?, yRatio: Double): BarResult {
            val byLabel = label?.let { readForLabel(px, width, height, it) }
            val byRatio = readByRatio(px, width, height, yRatio)
            return when {
                byLabel?.value != null && byRatio.value != null && byLabel.value != byRatio.value -> byLabel.copy(source = "label≠ratio(${byRatio.value})")
                byLabel?.value != null -> byLabel
                else -> byRatio
            }
        }
        val ra = pick(la, Y_ATK); val rd = pick(ld, Y_DEF); val rs = pick(ls, Y_STA)
        val first = listOfNotNull(la, ld, ls).minByOrNull { it.top }
        val stars = first?.let { countStars(px, width, it) }
        fun d(x: BarResult) = "${x.value}(${x.filledPx}/${x.totalPx}${if (x.red) " 빨강" else ""} ${x.source})"
        val detail = "공:${d(ra)} 방:${d(rd)} HP:${d(rs)} 별:${stars ?: "?"}"
        val fromRatio = listOf(ra, rd, rs).all { it.source == "ratio" }
        return Reading(Appraisal(ra.value, rd.value, rs.value), stars, detail, fromRatio)
    }

    // 별 개수 → 개체값 합계 범위 (0~45). 3별 82%+ (37~45), 2별 67~80% (30~36), 1별 51~64% (23~29), 0별 ≤50% (0~22)
    fun starsToSumRange(stars: Int): IntRange = when (stars) { 3 -> 37..45; 2 -> 30..36; 1 -> 23..29; else -> 0..22 }
}
