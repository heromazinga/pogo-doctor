package com.pogodoctor.core

// 한국어 이름·기술명 유사도 매칭 (OCR 오인식 보정). 서버 데이터의 한국어 목록만 대상으로 한다.
object Fuzzy {
    fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    // 0~1 (1 = 동일)
    fun similarity(a: String, b: String): Double {
        val n = normalize(a); val m = normalize(b)
        if (n.isEmpty() || m.isEmpty()) return 0.0
        val d = levenshtein(n, m)
        return 1.0 - d.toDouble() / maxOf(n.length, m.length)
    }

    // 공백·구두점 제거, 소문자
    fun normalize(s: String): String = s.lowercase().replace(Regex("[\\s\\p{Punct}·•‧・]"), "")

    data class Match(val value: String, val score: Double)

    // 후보 목록 중 최고 유사도. minScore 미만이면 null
    fun best(query: String, candidates: Collection<String>, minScore: Double = 0.6): Match? {
        val q = normalize(query)
        if (q.isEmpty()) return null
        var best: Match? = null
        for (c in candidates) {
            val s = similarity(q, c)
            if (best == null || s > best.score) best = Match(c, s)
            if (s >= 1.0) break
        }
        return best?.takeIf { it.score >= minScore }
    }
}
