package com.pogodoctor.core

// 4-B3 종 이름 색인: 정규화·자모 분해를 사전 계산하고, 길이·공통 자모 필터로 후보를 줄인 뒤에만 편집 거리를 계산한다.
// (이전: 이름 후보 줄마다 1,430종 전체와 Levenshtein → 실기기 파싱 543ms)
class NameIndex(names: Collection<String>) {
    private class Entry(val name: String, val norm: String, val jamo: String, val bigrams: Set<String>)
    private val entries: List<Entry> = names.distinct().map { n -> val norm = Fuzzy.normalize(n); val j = jamo(norm); Entry(n, norm, j, bigrams(j)) }
    private val exact: Map<String, String> = entries.associate { it.norm to it.name }

    companion object {
        private const val BASE = 0xAC00
        private val CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
        private val JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
        private val JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"
        // 한글 음절 → 초성·중성·(종성) 문자열. 그 외 문자는 그대로
        fun jamo(s: String): String {
            val sb = StringBuilder()
            for (c in s) {
                val code = c.code - BASE
                if (code in 0 until 11172) { sb.append(CHO[code / 588]); sb.append(JUNG[(code % 588) / 28]); val jong = code % 28; if (jong > 0) sb.append(JONG[jong]) }
                else sb.append(c)
            }
            return sb.toString()
        }
        fun bigrams(s: String): Set<String> { if (s.length < 2) return setOf(s); val out = HashSet<String>(); for (i in 0 until s.length - 1) out.add(s.substring(i, i + 2)); return out }
    }

    val size: Int get() = entries.size

    // 상위 후보 (점수 내림차순). minScore 미만 제외. 길이 차 ≤ 3 이고 자모 바이그램을 하나 이상 공유하는 항목만 편집 거리 계산
    fun rank(query: String, minScore: Double = 0.4, limit: Int = 8): List<Fuzzy.Match> {
        val q = Fuzzy.normalize(query)
        if (q.isEmpty()) return emptyList()
        exact[q]?.let { return listOf(Fuzzy.Match(it, 1.0)) }
        val qj = jamo(q); val qb = bigrams(qj)
        val out = ArrayList<Fuzzy.Match>()
        for (e in entries) {
            if (Math.abs(e.norm.length - q.length) > 3) continue
            if (e.bigrams.none { it in qb }) continue
            val d = Fuzzy.levenshtein(q, e.norm)
            val s = 1.0 - d.toDouble() / maxOf(q.length, e.norm.length)
            if (s >= minScore) out.add(Fuzzy.Match(e.name, s))
        }
        out.sortByDescending { it.score }
        return out.take(limit)
    }
    fun best(query: String, minScore: Double = 0.0): Fuzzy.Match? = rank(query, minScore, 1).firstOrNull()
}
