package com.pogodoctor.core

// 평가(감정) 화면의 막대 3개(공격/방어/HP, 각 15칸) 판독 — 픽셀 접근은 앱이 함수로 넘긴다 (Android 의존 없음)
// 방법: "공격/방어/HP" 라벨 줄의 세로 중앙을 따라 라벨 오른쪽을 가로로 훑어, 채워진(채도 높은 주황/분홍) 픽셀과
//       비어 있는(회색) 픽셀을 구분해 채워진 비율 × 15 를 반올림한다. 막대 영역은 처음 만나는 막대 픽셀부터 마지막 막대 픽셀까지.
object BarReader {
    fun interface PixelSource { fun argb(x: Int, y: Int): Int }

    data class BarResult(val value: Int?, val filledPx: Int, val totalPx: Int)

    private fun rgb(c: Int) = Triple((c shr 16) and 255, (c shr 8) and 255, c and 255)
    private fun sat(r: Int, g: Int, b: Int): Double { val mx = maxOf(r, g, b); val mn = minOf(r, g, b); return if (mx == 0) 0.0 else (mx - mn).toDouble() / mx }
    private fun isFilled(c: Int): Boolean { val (r, g, b) = rgb(c); return sat(r, g, b) > 0.35 && r > 150 && r >= g } // 주황·분홍·빨강 계열
    private fun isEmpty(c: Int): Boolean { val (r, g, b) = rgb(c); val mx = maxOf(r, g, b); val mn = minOf(r, g, b); return mx - mn < 25 && mx in 150..235 } // 밝은 회색 칸

    // y 행에서 xStart..xEnd 구간을 훑어 막대 값을 구한다
    fun readRow(px: PixelSource, y: Int, xStart: Int, xEnd: Int): BarResult {
        var first = -1; var last = -1; var filled = 0; var total = 0
        for (x in xStart..xEnd) {
            val c = px.argb(x, y)
            val f = isFilled(c); val e = isEmpty(c)
            if (f || e) { if (first < 0) first = x; last = x }
        }
        if (first < 0) return BarResult(null, 0, 0)
        for (x in first..last) { val c = px.argb(x, y); if (isFilled(c)) { filled++; total++ } else if (isEmpty(c)) total++ }
        if (total < 30) return BarResult(null, filled, total)
        val v = Math.round(filled * 15.0 / total).toInt().coerceIn(0, 15)
        return BarResult(v, filled, total)
    }

    // 라벨 줄(공격/방어/HP) 위치로 세 막대 판독. 라벨 오른쪽부터 화면 오른쪽 여백까지 훑는다. 세로로 3줄(중앙±) 을 읽어 다수결
    fun readAppraisal(px: PixelSource, width: Int, labels: List<OcrLine>): Appraisal {
        fun read(keys: List<String>): Int? {
            val l = labels.firstOrNull { ln -> keys.any { ln.text.replace(" ", "").contains(it) } } ?: return null
            val xs = l.right + 4; val xe = width - 8
            val vals = listOf(l.centerY - l.height / 4, l.centerY, l.centerY + l.height / 4).mapNotNull { readRow(px, it, xs, xe).value }
            return vals.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
        }
        return Appraisal(read(listOf("공격")), read(listOf("방어")), read(listOf("HP", "체력")))
    }
}
