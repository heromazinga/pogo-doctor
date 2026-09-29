package com.pogodoctor.core

// 4-B5 정리 도우미 검색어 생성 — 웹 app/lib/searchBuilder.js 와 같은 규칙 (단위 테스트로 동일성 유지)
// 형식: "{도감번호 OR}&{hp OR}[&cp OR]" (CNF: & 절마다 , 는 OR). 알려진 전체 개체에서 대상 외 개체가 잡히면 묶음을 쪼갠다.
object SearchBuilder {
    const val DEFAULT_MAX_LEN = 200
    data class Item(val id: String, val speciesId: Int, val hp: Int?, val cp: Int?, val cpVerified: Boolean, val isShadow: Boolean = false, val form: String = "Normal")
    data class Group(val query: String, val expected: Int, val targetIds: List<String>, val withCp: Boolean)
    data class Skipped(val id: String, val reason: String)
    data class Result(val groups: List<Group>, val skipped: List<Skipped>)

    fun matches(query: String, x: Item): Boolean = query.split("&").all { clause ->
        clause.split(",").any { term ->
            val t = term.trim()
            when {
                t.matches(Regex("\\d+")) -> x.speciesId.toString() == t
                t.matches(Regex("hp\\d+")) -> x.hp != null && "hp${x.hp}" == t
                else -> Regex("cp(\\d+)(?:-(\\d+))?").matchEntire(t)?.let { m -> val cp = x.cp ?: return@let false; val lo = m.groupValues[1].toInt(); val hi = m.groupValues[2].ifEmpty { m.groupValues[1] }.toInt(); cp in lo..hi } ?: false
            }
        }
    }

    fun buildQuery(members: List<Item>, withCp: Boolean = false): String {
        val dex = members.map { it.speciesId }.distinct().sorted().joinToString(",")
        val hps = members.mapNotNull { it.hp }.distinct().sorted().joinToString(",") { "hp$it" }
        var q = "$dex&$hps"
        if (withCp) q += "&" + members.mapNotNull { it.cp }.distinct().sorted().joinToString(",") { "cp$it" }
        return q
    }

    fun buildGroups(targets: List<Item>, population: List<Item>, maxLen: Int = DEFAULT_MAX_LEN): Result {
        val targetIds = targets.map { it.id }.toSet()
        val skipped = ArrayList<Skipped>()
        val usable = targets.filter { if (it.hp == null) { skipped.add(Skipped(it.id, "HP 없음")); false } else true }
        val nonTargets = population.filter { it.id !in targetIds }
        val groups = ArrayList<Group>()
        fun safe(members: List<Item>, withCp: Boolean): Boolean {
            if (withCp && members.any { it.cp == null || !it.cpVerified }) return false
            val q = buildQuery(members, withCp)
            if (q.length > maxLen) return false
            return nonTargets.none { matches(q, it) }
        }
        for (list in usable.groupBy { "${if (it.isShadow) 1 else 0}|${it.form}" }.values) {
            val sorted = list.sortedWith(compareBy({ it.speciesId }, { it.hp ?: 0 }))
            var cur = ArrayList<Item>()
            fun flush() { if (cur.isNotEmpty()) { val withCp = !safe(cur, false); groups.add(Group(buildQuery(cur, withCp), cur.size, cur.map { it.id }, withCp)); cur = ArrayList() } }
            for (t in sorted) {
                if (!safe(listOf(t), false) && !safe(listOf(t), true)) { skipped.add(Skipped(t.id, "같은 종·HP(·CP) 의 보관 개체와 구분 불가")); continue }
                val next = cur + t
                if (cur.isEmpty() || safe(next, false) || safe(next, true)) cur = ArrayList(next) else { flush(); cur = arrayListOf(t) }
            }
            flush()
        }
        return Result(groups, skipped)
    }
}
