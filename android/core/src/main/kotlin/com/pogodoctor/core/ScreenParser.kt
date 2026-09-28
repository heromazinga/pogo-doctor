package com.pogodoctor.core

// OCR 줄(텍스트 + 화면 좌표) → 포켓몬 상세/평가 화면 정보
// 포켓몬GO 상세 화면: 상단 "CP 1234", 이름(닉네임일 수 있음), "HP 123 / 123", 기술 이름 2~3개, 하단 "포획 날짜/장소"
data class OcrLine(val text: String, val left: Int = 0, val top: Int = 0, val right: Int = 0, val bottom: Int = 0) {
    val centerY: Int get() = (top + bottom) / 2
    val height: Int get() = bottom - top
}

data class SpeciesRef(val id: Int, val form: String, val nameKr: String, val atk: Int, val def: Int, val sta: Int, val moveNamesKr: List<String>)

data class ScreenInfo(
    val kind: Kind,
    val cp: Int?,
    val hp: Int?,                 // 최대 HP
    val nameRaw: String?,         // 화면에 보인 이름(닉네임 가능)
    val species: SpeciesRef?,     // 유사도 매칭된 종
    val nameScore: Double,
    val moves: List<MoveMatch>,   // 인식된 기술 (한국어명)
    val appraisal: Appraisal?,    // 평가 화면이면 막대 값
    val warnings: List<String>,
) {
    enum class Kind { DETAIL, APPRAISAL, UNKNOWN }
}

data class MoveMatch(val nameKr: String, val raw: String, val score: Double)
data class Appraisal(val atk: Int?, val def: Int?, val sta: Int?)

class ScreenParser(private val species: List<SpeciesRef>, private val allMoveNamesKr: Collection<String>) {
    private val speciesByName: Map<String, SpeciesRef> = species.associateBy { Fuzzy.normalize(it.nameKr) }
    private val speciesNames: List<String> = species.map { it.nameKr }.distinct()

    companion object {
        val CP_RE = Regex("(?:CP|cp|ＣＰ)\\s*([0-9]{2,4})")
        val CP_ONLY_DIGITS = Regex("^\\s*([0-9]{2,4})\\s*$")
        val HP_RE = Regex("(?:HP|hp|ＨＰ)\\s*([0-9]{1,3})\\s*/\\s*([0-9]{1,3})")
        val HP_RE2 = Regex("([0-9]{1,3})\\s*/\\s*([0-9]{1,3})")
        val APPRAISAL_HINTS = listOf("최고예요", "훌륭해요", "괜찮아요", "그럭저럭", "평가", "이 포켓몬의")
        val NOISE = listOf("포획", "날짜", "장소", "km", "사탕", "강화", "진화", "송신", "즐겨찾기", "체중", "신장", "kg", "m")
    }

    fun parse(lines: List<OcrLine>, appraisalBars: Appraisal? = null): ScreenInfo {
        val warnings = ArrayList<String>()
        val texts = lines.map { it.text.trim() }.filter { it.isNotEmpty() }

        // CP
        var cp: Int? = null
        for (t in texts) { CP_RE.find(t)?.let { cp = it.groupValues[1].toInt() }; if (cp != null) break }
        if (cp == null) {
            // "CP" 와 숫자가 다른 줄로 잘린 경우: CP 줄 바로 다음의 숫자 줄
            val idx = texts.indexOfFirst { it.equals("CP", true) || it == "ＣＰ" }
            if (idx >= 0 && idx + 1 < texts.size) CP_ONLY_DIGITS.find(texts[idx + 1])?.let { cp = it.groupValues[1].toInt() }
        }
        if (cp != null && cp!! < 10) cp = null

        // HP (최대치)
        var hp: Int? = null
        for (t in texts) { HP_RE.find(t)?.let { hp = it.groupValues[2].toInt() }; if (hp != null) break }
        if (hp == null) for (t in texts) { HP_RE2.find(t)?.let { hp = it.groupValues[2].toInt() }; if (hp != null) break }
        if (hp != null && hp!! < 10) hp = null

        // 이름: CP 줄 아래 ~ HP 줄 위의 한글 줄 중 종 이름과 가장 유사한 것
        val cpLine = lines.firstOrNull { CP_RE.containsMatchIn(it.text) }
        val hpLine = lines.firstOrNull { HP_RE.containsMatchIn(it.text) || HP_RE2.containsMatchIn(it.text) }
        val nameCands = lines.filter { l ->
            val t = l.text.trim()
            t.length in 2..12 && t.any { it in '가'..'힣' } && NOISE.none { t.contains(it) } && !CP_RE.containsMatchIn(t) && !HP_RE2.containsMatchIn(t) &&
                (cpLine == null || l.centerY > cpLine.centerY) && (hpLine == null || l.centerY < hpLine.centerY)
        }.ifEmpty { lines.filter { l -> val t = l.text.trim(); t.length in 2..12 && t.any { it in '가'..'힣' } && NOISE.none { t.contains(it) } } }
        var bestName: Fuzzy.Match? = null; var nameRaw: String? = null
        for (l in nameCands) {
            val m = Fuzzy.best(l.text, speciesNames, 0.0) ?: continue
            if (bestName == null || m.score > bestName!!.score) { bestName = m; nameRaw = l.text.trim() }
        }
        val sp = bestName?.takeIf { it.score >= 0.6 }?.let { speciesByName[Fuzzy.normalize(it.value)] }
        if (bestName != null && bestName!!.score < 0.6) warnings.add("이름 인식 불확실: \"$nameRaw\" (유사 ${bestName!!.value} ${(bestName!!.score * 100).toInt()}%) — 닉네임이면 종을 직접 선택")

        // 기술: 종의 기술 목록 우선, 없으면 전체 기술명. HP 줄 아래에서 찾는다
        val movePool = sp?.moveNamesKr?.takeIf { it.isNotEmpty() } ?: allMoveNamesKr
        val moves = ArrayList<MoveMatch>()
        val moveLines = lines.filter { l -> hpLine == null || l.centerY > hpLine.centerY }
        for (l in moveLines) {
            val t = l.text.trim()
            if (t.length < 2 || t.length > 14 || NOISE.any { t.contains(it) }) continue
            val m = Fuzzy.best(t, movePool, 0.7) ?: continue
            if (moves.none { it.nameKr == m.value }) moves.add(MoveMatch(m.value, t, m.score))
            if (moves.size >= 3) break
        }

        val isAppraisal = texts.any { t -> APPRAISAL_HINTS.any { t.contains(it) } } || appraisalBars != null
        val kind = when {
            isAppraisal -> ScreenInfo.Kind.APPRAISAL
            cp != null || sp != null -> ScreenInfo.Kind.DETAIL
            else -> ScreenInfo.Kind.UNKNOWN
        }
        if (cp == null) warnings.add("CP 를 찾지 못했습니다")
        if (hp == null) warnings.add("HP 를 찾지 못했습니다 (개체값 후보가 넓어집니다)")
        return ScreenInfo(kind, cp, hp, nameRaw, sp, bestName?.score ?: 0.0, moves, appraisalBars, warnings)
    }
}
