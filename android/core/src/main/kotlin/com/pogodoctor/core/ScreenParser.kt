package com.pogodoctor.core

// OCR 줄(텍스트 + 화면 좌표) → 포켓몬 상세/평가 화면 정보
// 포켓몬GO 상세 화면: 상단 "CP 1234", 이름(닉네임일 수 있음), "HP 123 / 123", 기술 이름 2~3개, 하단 "포획 날짜/장소"
// 4-A 보정(사용자 디버그 캡처 16장 근거):
//  - 화면 분류: "공격"+"방어"+"HP" 라벨이 함께 있으면 평가 화면 (문구 힌트는 보조). 평가 화면에서는 강화 비용을 읽지 않는다(호출측).
//  - OCR 정규화: CP 의 c/C/ＣＰ, 숫자 속 O→0. 자릿수가 비정상(2자리 이하 = 잘림 의심)이면 CP 를 null 로 두고 경고. HP 의 O→0.
//  - 종 보정: 이름 유사도 상위 후보 중 CP/HP(·막대)와 성립하는 종만 남긴다. 여러 종이 남으면 speciesCandidates 로 선택하게 한다.
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
    val species: SpeciesRef?,     // 유사도 + CP/HP 성립으로 고른 종
    val nameScore: Double,
    val moves: List<MoveMatch>,   // 인식된 기술 (한국어명)
    val appraisal: Appraisal?,    // 평가 화면이면 막대 값
    val warnings: List<String>,
    val speciesCandidates: List<SpeciesRef> = emptyList(), // CP/HP 와 성립하는 종 후보(여러 개면 사용자 선택)
    val caughtOn: String? = null, // 포획 날짜(YYYY-MM-DD, 기기 내 판독). 장소는 보관하지 않는다
    val cpTruncated: Boolean = false,
) {
    enum class Kind { DETAIL, APPRAISAL, UNKNOWN }
}

data class MoveMatch(val nameKr: String, val raw: String, val score: Double)
data class Appraisal(val atk: Int?, val def: Int?, val sta: Int?)

class ScreenParser(private val species: List<SpeciesRef>, private val allMoveNamesKr: Collection<String>) {
    private val speciesByName: Map<String, SpeciesRef> = species.associateBy { Fuzzy.normalize(it.nameKr) }
    private val speciesNames: List<String> = species.map { it.nameKr }.distinct()
    private val nameIndex = NameIndex(speciesNames)   // 4-B3: 자모 색인으로 후보를 줄여 편집 거리 계산 (파싱 543ms → 수십 ms 목표)

    companion object {
        val CP_RE = Regex("(?:CP|cp|Cp|cP|ＣＰ)\\s*([0-9]{1,5})")
        val CP_ONLY_DIGITS = Regex("^\\s*([0-9]{2,4})\\s*$")
        val HP_RE = Regex("(?:HP|hp|ＨＰ)\\s*([0-9]{1,3})\\s*/\\s*([0-9]{1,3})")
        val HP_RE2 = Regex("([0-9]{1,3})\\s*/\\s*([0-9]{1,3})")
        val APPRAISAL_HINTS = listOf("최고예요", "훌륭해요", "괜찮아요", "그럭저럭", "이 포켓몬의")
        val NOISE = listOf("포획", "날짜", "장소", "km", "사탕", "강화", "진화", "송신", "즐겨찾기", "체중", "신장", "kg", "m", "잡았다", "잡은")
        // 포획 장소 줄: "○○에서 잡았다", "잡은 날짜", 날짜 표기
        val CAUGHT_RE = Regex("에서\\s*잡았|잡은\\s*(날짜|장소)|포획\\s*(장소|날짜)")
        val DATE_RE = Regex("(20[0-9]{2})\\s*[./년-]\\s*([0-9]{1,2})\\s*[./월-]\\s*([0-9]{1,2})")
        private val LABEL_KEYS = listOf("공격", "방어", "HP", "체력")

        // 숫자 사이/옆의 O/o → 0 (OCR 오인식). "15O" → "150", "2O81" → "2081"
        fun fixDigits(s: String): String {
            var t = s
            repeat(2) { t = t.replace(Regex("(?<=[0-9])[Oo]"), "0").replace(Regex("[Oo](?=[0-9])"), "0") }
            return t
        }
        fun isLabelLine(l: OcrLine): Boolean { val t = l.text.replace(" ", ""); return t.length <= 4 && LABEL_KEYS.any { t.contains(it) } }
        // 포획 장소·날짜 줄 (업로드 제외·가림 대상)
        fun isCaughtLine(l: OcrLine): Boolean = CAUGHT_RE.containsMatchIn(l.text) || DATE_RE.containsMatchIn(l.text)
        fun parseCaughtOn(lines: List<OcrLine>): String? {
            for (l in lines) {
                val m = DATE_RE.find(fixDigits(l.text)) ?: continue
                val y = m.groupValues[1].toInt(); val mo = m.groupValues[2].toInt(); val d = m.groupValues[3].toInt()
                if (mo in 1..12 && d in 1..31) return "%04d-%02d-%02d".format(y, mo, d)
            }
            return null
        }
    }

    fun parse(lines: List<OcrLine>, appraisalBars: Appraisal? = null): ScreenInfo {
        val warnings = ArrayList<String>()
        val texts = lines.map { fixDigits(it.text.trim()) }.filter { it.isNotEmpty() }

        // 화면 분류: 공격·방어·HP 라벨이 함께 있으면 평가 화면
        val labelHits = LABEL_KEYS.filter { k -> lines.any { l -> isLabelLine(l) && l.text.replace(" ", "").contains(k) } }
        val labelsPresent = labelHits.contains("공격") && labelHits.contains("방어") && (labelHits.contains("HP") || labelHits.contains("체력"))
        val isAppraisal = labelsPresent || appraisalBars != null || texts.any { t -> APPRAISAL_HINTS.any { t.contains(it) } }

        // CP (O→0 정규화, 잘림 의심 처리)
        var cp: Int? = null; var cpTruncated = false
        for (t in texts) { CP_RE.find(t)?.let { cp = it.groupValues[1].toIntOrNull() }; if (cp != null) break }
        if (cp == null) {
            val idx = texts.indexOfFirst { it.equals("CP", true) || it == "ＣＰ" }
            if (idx >= 0 && idx + 1 < texts.size) CP_ONLY_DIGITS.find(texts[idx + 1])?.let { cp = it.groupValues[1].toInt() }
        }
        val cpVal = cp
        if (cpVal != null && (cpVal < 100 || cpVal > 9999)) { cp = null; cpTruncated = true; warnings.add("CP 자릿수 비정상($cpVal) — 잘림·가림 의심, CP 없이 판정") }

        // HP (최대치)
        var hp: Int? = null
        for (t in texts) { HP_RE.find(t)?.let { hp = it.groupValues[2].toIntOrNull() }; if (hp != null) break }
        if (hp == null) for (t in texts) { HP_RE2.find(t)?.let { hp = it.groupValues[2].toIntOrNull() }; if (hp != null) break }
        if (hp != null && (hp!! < 10 || hp!! > 999)) hp = null

        // 이름: CP 줄 아래 ~ HP 줄 위의 한글 줄 중 종 이름과 가장 유사한 것 (라벨·포획 줄 제외)
        val cpLine = lines.firstOrNull { CP_RE.containsMatchIn(fixDigits(it.text)) }
        val hpLine = lines.firstOrNull { HP_RE.containsMatchIn(fixDigits(it.text)) || HP_RE2.containsMatchIn(fixDigits(it.text)) }
        fun nameLike(l: OcrLine): Boolean { val t = l.text.trim(); return t.length in 2..12 && t.any { it in '가'..'힣' } && NOISE.none { t.contains(it) } && !isLabelLine(l) && !isCaughtLine(l) && !CP_RE.containsMatchIn(t) && !HP_RE2.containsMatchIn(t) }
        val nameCands = lines.filter { l -> nameLike(l) && (cpLine == null || l.centerY > cpLine.centerY) && (hpLine == null || l.centerY < hpLine.centerY) }
            .ifEmpty { lines.filter { nameLike(it) } }
        var bestName: Fuzzy.Match? = null; var nameRaw: String? = null
        val ranked = ArrayList<Pair<SpeciesRef, Double>>()
        for (l in nameCands) {
            val m = nameIndex.best(l.text, 0.0) ?: continue
            if (bestName == null || m.score > bestName!!.score) { bestName = m; nameRaw = l.text.trim() }
        }
        // 종 보정: 이름 유사도 상위 후보(≥0.4) 중 CP/HP(·막대)와 성립하는 종만 남긴다
        if (nameRaw != null) {
            val q = nameRaw!!
            for (m in nameIndex.rank(q, 0.4, 8)) speciesByName[Fuzzy.normalize(m.value)]?.let { ranked.add(it to m.score) }
        }
        val top = ranked.take(8)
        val consistent = if (cp != null) top.filter { IvCalc.consistent(IvCalc.Base(it.first.atk, it.first.def, it.first.sta), cp, hp, appraisalBars) } else top
        val best = top.firstOrNull()
        var sp: SpeciesRef? = null
        var candidates: List<SpeciesRef> = emptyList()
        if (best != null) {
            when {
                consistent.isEmpty() -> {
                    sp = best.first.takeIf { best.second >= 0.6 }
                    if (cp != null) warnings.add("이름 후보가 CP$cp/HP${hp ?: "?"} 와 맞지 않습니다 — CP·HP 인식 확인 또는 종 직접 선택")
                    candidates = top.take(3).map { it.first }
                }
                consistent.size == 1 -> {
                    sp = consistent[0].first
                    if (sp !== best.first) warnings.add("\"${nameRaw ?: ""}\" 유사 종 중 CP·HP 와 성립하는 ${sp.nameKr} 로 보정 (${best.first.nameKr} 는 불가)")
                    candidates = listOf(sp)
                }
                else -> {
                    // 여러 종이 성립: 이름 유사도가 확실(≥0.85)하고 1위가 성립하면 채택, 아니면 선택 요청
                    val first = consistent[0]
                    sp = if (first.second >= 0.85 && first.first === best.first) first.first else null
                    candidates = consistent.take(4).map { it.first }
                    if (sp == null) warnings.add("CP·HP 와 성립하는 종이 ${candidates.size}개 — 종을 선택하세요")
                }
            }
        }
        if (bestName != null && bestName!!.score < 0.6 && sp == null) warnings.add("이름 인식 불확실: \"$nameRaw\" (유사 ${bestName!!.value} ${(bestName!!.score * 100).toInt()}%) — 닉네임이면 종을 직접 선택")
        else if (bestName == null && nameCands.isNotEmpty()) { nameRaw = nameCands.first().text.trim(); warnings.add("이름 인식 불확실: \"$nameRaw\" (유사한 종 이름 없음) — 닉네임이면 종을 직접 선택") }

        // 기술: 종의 기술 목록 우선, 없으면 전체 기술명. HP 줄 아래에서 찾는다 (평가 화면에서는 가려져 미인식이 정상)
        val movePool = sp?.moveNamesKr?.takeIf { it.isNotEmpty() } ?: allMoveNamesKr
        val moves = ArrayList<MoveMatch>()
        if (!isAppraisal) {
            val moveLines = lines.filter { l -> (hpLine == null || l.centerY > hpLine.centerY) && !isCaughtLine(l) && !isLabelLine(l) }
            for (l in moveLines) {
                val t = l.text.trim()
                if (t.length < 2 || t.length > 14 || NOISE.any { t.contains(it) }) continue
                val m = Fuzzy.best(t, movePool, 0.7) ?: continue
                if (moves.none { it.nameKr == m.value }) moves.add(MoveMatch(m.value, t, m.score))
                if (moves.size >= 3) break
            }
        }

        val kind = when {
            isAppraisal -> ScreenInfo.Kind.APPRAISAL
            cp != null || sp != null || cpTruncated -> ScreenInfo.Kind.DETAIL
            else -> ScreenInfo.Kind.UNKNOWN
        }
        if (cp == null && !cpTruncated) warnings.add("CP 를 찾지 못했습니다")
        if (hp == null) warnings.add("HP 를 찾지 못했습니다 (개체값 후보가 넓어집니다)")
        return ScreenInfo(kind, cp, hp, nameRaw, sp, bestName?.score ?: 0.0, moves, appraisalBars, warnings, candidates, parseCaughtOn(lines), cpTruncated)
    }
}
