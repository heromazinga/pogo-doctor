package com.pogodoctor.core

// 결과 카드 한줄평 (결정적 계산, AI 미사용). 웹앱의 리그 CP 계산과 같은 공식.
object Verdict {
    data class Line(val raid: String, val league: String)

    fun oneLiner(base: IvCalc.Base, s: IvCalc.Summary): Line {
        if (s.empty) return Line("개체값 후보 없음 — CP/HP 인식 확인", "")
        val c = s.candidates
        val atkMin = s.atkRange!!.first; val atkMax = s.atkRange.last
        val pctMin = s.percentRange!!.first; val pctMax = s.percentRange.last
        val raid = when {
            atkMin >= 14 && pctMin >= 91 -> "레이드: 공격 ${rng(s.atkRange)}·IV ${rng(s.percentRange)}% — 우수 (강화 추천)"
            atkMax >= 13 -> "레이드: 공격 ${rng(s.atkRange)}·IV ${rng(s.percentRange)}% — 쓸 만함"
            else -> "레이드: 공격 ${rng(s.atkRange)}·IV ${rng(s.percentRange)}% — 보통 이하"
        }
        // 리그: 대표 후보(첫 번째)로 1500/2500 도달 레벨
        val rep = c.first()
        fun maxLevelUnder(cap: Int): Double? = Cpm.levels().lastOrNull { Cpm.cp(base.atk, base.def, base.sta, rep.atk, rep.def, rep.sta, it) <= cap }
        val gl = maxLevelUnder(1500); val ul = maxLevelUnder(2500)
        val cpAt50 = Cpm.cp(base.atk, base.def, base.sta, rep.atk, rep.def, rep.sta, 50.0)
        val league = buildString {
            append("리그: ")
            if (cpAt50 < 1500) append("슈퍼리그 L50 CP$cpAt50 (상한 미달)")
            else if (gl != null) append("슈퍼 1500 → L${fmt(gl)}")
            if (cpAt50 >= 2500 && ul != null) append(" · 하이퍼 2500 → L${fmt(ul)}") else if (cpAt50 >= 1500) append(" · 하이퍼 L50 CP$cpAt50")
            if (rep.atk <= 5 && rep.def >= 12 && rep.sta >= 12) append(" · PvP 형 개체")
        }
        return Line(raid, league)
    }

    private fun rng(r: IntRange) = if (r.first == r.last) "${r.first}" else "${r.first}~${r.last}"
    private fun fmt(d: Double) = if (d == d.toInt().toDouble()) "${d.toInt()}" else "$d"
}
