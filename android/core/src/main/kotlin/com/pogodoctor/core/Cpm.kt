package com.pogodoctor.core

// CP 배율표 — 웹앱 app/lib/cpm.js 와 동일 (PokeMiners PLAYER_LEVEL_SETTINGS, 정수 레벨 1~51, 반 레벨은 제곱평균)
object Cpm {
    val INT = doubleArrayOf(0.094,0.16639787,0.21573247,0.25572005,0.29024988,0.3210876,0.34921268,0.3752356,0.39956728,0.4225,0.44310755,0.4627984,0.48168495,0.49985844,0.51739395,0.5343543,0.5507927,0.5667545,0.5822789,0.5974,0.6121573,0.6265671,0.64065295,0.65443563,0.667934,0.6811649,0.69414365,0.7068842,0.7193991,0.7317,0.7377695,0.74378943,0.74976104,0.7556855,0.76156384,0.76739717,0.7731865,0.77893275,0.784637,0.7903,0.7953,0.8003,0.8053,0.8103,0.8153,0.8203,0.8253,0.8303,0.8353,0.8403,0.8453)
    const val MAX_LEVEL = 51.0
    fun forLevel(level: Double): Double {
        val lv = (Math.round(level * 2) / 2.0).coerceIn(1.0, MAX_LEVEL)
        val i = lv.toInt() - 1
        if (lv == lv.toInt().toDouble()) return INT[i]
        val a = INT[i]; val b = INT[minOf(i + 1, INT.size - 1)]
        return Math.sqrt((a * a + b * b) / 2)
    }
    fun levels(): List<Double> = generateSequence(1.0) { it + 0.5 }.takeWhile { it <= MAX_LEVEL }.toList()
    fun cp(atk: Int, def: Int, sta: Int, ivA: Int, ivD: Int, ivS: Int, level: Double): Int {
        val m = forLevel(level)
        val v = Math.floor((atk + ivA) * Math.sqrt((def + ivD).toDouble()) * Math.sqrt((sta + ivS).toDouble()) * m * m / 10).toInt()
        return maxOf(10, v)
    }
    fun hp(sta: Int, ivS: Int, level: Double): Int = maxOf(10, Math.floor((sta + ivS) * forLevel(level)).toInt())
}
