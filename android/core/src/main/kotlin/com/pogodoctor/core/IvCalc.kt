package com.pogodoctor.core

// CP·HP 로 개체값 후보 계산 (웹앱 cpm.js 와 같은 공식)
//   CP = floor((Atk+atkIv) × sqrt(Def+defIv) × sqrt(Sta+staIv) × CPM² / 10), 최소 10
//   HP = floor((Sta+staIv) × CPM), 최소 10
// 레벨 1~51(0.5 단위) × 개체값 16³ 을 전수 조사해 CP·HP 가 모두 일치하는 조합만 남긴다.
object IvCalc {
    data class Base(val atk: Int, val def: Int, val sta: Int)
    data class Candidate(val level: Double, val atk: Int, val def: Int, val sta: Int) {
        val percent: Int get() = Math.round((atk + def + sta) * 100.0 / 45).toInt()
    }
    data class Summary(
        val candidates: List<Candidate>,
        val atkRange: IntRange?, val defRange: IntRange?, val staRange: IntRange?,
        val percentRange: IntRange?, val levelRange: ClosedFloatingPointRange<Double>?,
    ) {
        val exact: Boolean get() = candidates.size == 1
        val empty: Boolean get() = candidates.isEmpty()
    }

    fun candidates(base: Base, cp: Int, hp: Int?, levelHint: Double? = null, maxLevel: Double = Cpm.MAX_LEVEL): List<Candidate> {
        val out = ArrayList<Candidate>()
        val levels = if (levelHint != null) listOf(levelHint) else Cpm.levels().filter { it <= maxLevel }
        for (lv in levels) {
            val m = Cpm.forLevel(lv)
            // HP 로 sta 개체값을 먼저 좁힌다
            val staIvs = (0..15).filter { hp == null || Cpm.hp(base.sta, it, lv) == hp }
            if (staIvs.isEmpty()) continue
            for (s in staIvs) {
                val sq = Math.sqrt((base.sta + s).toDouble())
                for (a in 0..15) {
                    val atkPart = (base.atk + a) * m * m / 10
                    for (d in 0..15) {
                        val v = Math.floor(atkPart * Math.sqrt((base.def + d).toDouble()) * sq).toInt()
                        if (maxOf(10, v) == cp) out.add(Candidate(lv, a, d, s))
                    }
                }
            }
        }
        return out
    }

    fun summarize(cands: List<Candidate>): Summary {
        if (cands.isEmpty()) return Summary(cands, null, null, null, null, null)
        fun r(f: (Candidate) -> Int) = cands.minOf(f)..cands.maxOf(f)
        return Summary(cands, r { it.atk }, r { it.def }, r { it.sta }, r { it.percent }, cands.minOf { it.level }..cands.maxOf { it.level })
    }

    // 평가 화면 막대(공/방/HP 0~15)가 있으면 그 값으로 후보를 걸러 레벨만 확정
    fun filterByAppraisal(cands: List<Candidate>, atk: Int?, def: Int?, sta: Int?): List<Candidate> =
        cands.filter { (atk == null || it.atk == atk) && (def == null || it.def == def) && (sta == null || it.sta == sta) }
}
