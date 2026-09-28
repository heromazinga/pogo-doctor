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

    data class Constrained(val candidates: List<Candidate>, val barsUncertain: Boolean, val starsUncertain: Boolean, val levelUncertain: Boolean)

    // 제약을 순서대로 적용하되, 어떤 제약이 CP/HP 후보와 모순되면(결과 0개) 그 제약은 버리고 "불확실" 로 표시한다.
    //  - bars: 평가 막대 값, stars: 별 개수(합계 범위), levels: 강화 비용으로 좁힌 레벨 목록
    fun constrain(cands: List<Candidate>, bars: Appraisal?, stars: Int?, levels: List<Double>?): Constrained {
        var cur = cands
        var barsUnc = false; var starsUnc = false; var levelUnc = false
        if (levels != null && levels.isNotEmpty()) {
            val f = cur.filter { it.level in levels }
            if (f.isEmpty()) levelUnc = true else cur = f
        }
        if (stars != null) {
            val range = BarReader.starsToSumRange(stars)
            val f = cur.filter { (it.atk + it.def + it.sta) in range }
            if (f.isEmpty()) starsUnc = true else cur = f
        }
        if (bars != null && (bars.atk != null || bars.def != null || bars.sta != null)) {
            val f = filterByAppraisal(cur, bars.atk, bars.def, bars.sta)
            if (f.isEmpty()) {
                // 막대 하나씩 완화: 일치하는 축만 적용
                var partial = cur; var applied = false
                for ((k, v) in listOf("atk" to bars.atk, "def" to bars.def, "sta" to bars.sta)) {
                    if (v == null) continue
                    val g = partial.filter { c -> when (k) { "atk" -> c.atk == v; "def" -> c.def == v; else -> c.sta == v } }
                    if (g.isNotEmpty()) { partial = g; applied = true }
                }
                barsUnc = true
                if (applied) cur = partial
            } else cur = f
        }
        return Constrained(cur, barsUnc, starsUnc, levelUnc)
    }
}
