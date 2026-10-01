package com.pogodoctor.core

// 4-B5 정리 도우미 검색어 생성 — 웹 app/lib/searchBuilder.js 와 같은 규칙 (단위 테스트로 동일성 유지)
// 형식: "{도감번호 OR}&{hp OR}[&cp OR]" (CNF: & 절마다 , 는 OR). 알려진 전체 개체에서 대상 외 개체가 잡히면 묶음을 쪼갠다.
object SearchBuilder {
    const val DEFAULT_MAX_LEN = 200
    data class Item(val id: String, val speciesId: Int, val hp: Int?, val cp: Int?, val cpVerified: Boolean, val isShadow: Boolean = false, val form: String = "Normal", val gameTags: List<String> = emptyList(), val isShiny: Boolean = false, val isLucky: Boolean = false, val isProtected: Boolean = false)
    data class Group(val query: String, val expected: Int, val targetIds: List<String>, val withCp: Boolean, val overlap: Int = 0)
    data class Skipped(val id: String, val reason: String)
    data class Result(val groups: List<Group>, val skipped: List<Skipped>)

    // 4-C.2 박사행 보호 조건(항상 적용, 웹 searchBuilder.js PROTECT_SUFFIX 와 동일): 태그·이로치·반짝반짝·XXL·배경 제외. 길이 계산에 포함
    // 4-F.5: "!#"(태그 전체 제외) 폐지 → 사용자 고유 태그(앱 관리 태그 밖)마다 "!#태그명". 앱이 추천한 태그가 달린 박사행 개체는 묶음에 포함
    val PROTECT_CLAUSES = listOf("!색이 다른", "!반짝반짝", "!xxl", "!xxs", "!배경", "!특별", "!다이맥스") // 4-D2: !특별 = 코스튬, 4-D3: !xxs·!다이맥스
    val PROTECT_SUFFIX = "&" + PROTECT_CLAUSES.joinToString("&")
    const val NO_TAG_CLAUSE = "!#"
    private fun normTag(t: String) = t.replace(Regex("\\s+"), "").removePrefix("#")
    fun isAppTag(t: String) = GameTags.APP_MANAGED.any { normTag(it) == normTag(t) }
    fun userTagsOf(items: List<Item>): List<String> = items.flatMap { it.gameTags }.filter { !isAppTag(it) }.distinct().sorted()
    fun protectSuffix(userTags: List<String>) = (if (userTags.isEmpty()) "" else "&" + userTags.joinToString("&") { "!#$it" }) + PROTECT_SUFFIX
    fun withProtect(query: String, userTags: List<String> = emptyList()) = query + protectSuffix(userTags)

    // 4-F.6 D: 보호 모드 기록(isProtected)은 보호 절이 하나라도 있는 검색어에 잡히지 않는다 (웹 searchBuilder.js 와 동일)
    fun matches(query: String, x: Item): Boolean = (!x.isProtected || query.split("&").none { it.trim() in PROTECT_CLAUSES }) && query.split("&").all { clause ->
        clause.split(",").any { term ->
            val t = term.trim()
            when {
                t == NO_TAG_CLAUSE -> x.gameTags.isEmpty()
                t.startsWith("!#") -> { val n = normTag(t.substring(2)); x.gameTags.none { normTag(it) == n } }
                t == "!색이 다른" -> !x.isShiny
                t == "!반짝반짝" -> !x.isLucky
                t == "!xxl" || t == "!xxs" || t == "!배경" || t == "!특별" || t == "!다이맥스" || t == "!거다이맥스" -> true
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

    // strict=true(박사행): 충돌 묶음은 쪼개고 구분 불가 대상은 제외. strict=false(태그): 길이 상한만 지키고 overlap(잡히는 비대상 수)을 표기
    // suffix(4-C.2): 묶음 검색어 끝에 붙는 고정 절(박사행 보호 조건). 길이 상한 계산에 포함
    fun buildGroups(targets: List<Item>, population: List<Item>, maxLen: Int = DEFAULT_MAX_LEN, strict: Boolean = true, suffix: String = ""): Result {
        val targetIds = targets.map { it.id }.toSet()
        val skipped = ArrayList<Skipped>()
        val usable = targets.filter { if (it.hp == null) { skipped.add(Skipped(it.id, "HP 없음")); false } else true }
        val nonTargets = population.filter { it.id !in targetIds }
        val groups = ArrayList<Group>()
        fun safe(members: List<Item>, withCp: Boolean): Boolean {
            if (withCp && members.any { it.cp == null || !it.cpVerified }) return false
            val q = buildQuery(members, withCp) + suffix
            if (q.length > maxLen) return false
            return nonTargets.none { matches(q, it) }
        }
        fun overlapOf(members: List<Item>, withCp: Boolean) = nonTargets.count { matches(buildQuery(members, withCp) + suffix, it) }
        for (list in usable.groupBy { "${if (it.isShadow) 1 else 0}|${it.form}" }.values) {
            val sorted = list.sortedWith(compareBy({ it.speciesId }, { it.hp ?: 0 }))
            var cur = ArrayList<Item>()
            fun flush() {
                if (cur.isEmpty()) return
                val withCp = !safe(cur, false) && safe(cur, true)
                groups.add(Group(buildQuery(cur, withCp) + suffix, cur.size, cur.map { it.id }, withCp, if (strict) 0 else overlapOf(cur, withCp)))
                cur = ArrayList()
            }
            for (t in sorted) {
                if (strict) {
                    if (!safe(listOf(t), false) && !safe(listOf(t), true)) { skipped.add(Skipped(t.id, "같은 종·HP(·CP) 의 보관 개체와 구분 불가")); continue }
                    val next = cur + t
                    if (cur.isEmpty() || safe(next, false) || safe(next, true)) cur = ArrayList(next) else { flush(); cur = arrayListOf(t) }
                } else {
                    val next = cur + t
                    if (cur.isEmpty() || (buildQuery(next, false) + suffix).length <= maxLen) cur = ArrayList(next) else { flush(); cur = arrayListOf(t) }
                }
            }
            flush()
        }
        return Result(groups, skipped)
    }
}
