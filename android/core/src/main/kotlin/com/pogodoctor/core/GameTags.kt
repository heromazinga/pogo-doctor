package com.pogodoctor.core

// 4-B6 게임 태그 칩 판독 (텍스트 기준): 평가/상세 화면의 OCR 줄 중 "알려진 태그 이름"과 일치하는 짧은 줄을 태그 칩으로 본다.
// 알려진 태그 = 포고박사 추천 태그 문자열(사용자가 게임에서 그대로 태그를 다는 규약) + 호출측이 넘기는 사용자 태그 목록.
// 픽셀 기반 칩 판독(색 있는 둥근 칩)은 실측 캡처가 없어 이번 PR 에서는 쓰지 않는다 — 칩 띠 비율 상수만 정의(검증 필요 표기).
object GameTags {
    val TYPES_KR = listOf("노말", "불꽃", "물", "전기", "풀", "얼음", "격투", "독", "땅", "비행", "에스퍼", "벌레", "바위", "고스트", "드래곤", "악", "강철", "페어리")
    // 포고박사 추천 태그 이름 (현행 유지 — 사용자가 앞으로 이 이름으로 태그를 닮)
    val RECOMMENDED: Set<String> = (TYPES_KR.map { "$it 레이드" } + listOf("체육관 방어", "슈퍼리그", "하이퍼리그", "마스터리그", "수집", "교환용", "진화 후보", "다이맥스")).toSet()
    // 4-B6.2 사용자의 기존 게임 태그 이름(실DB 검증에서 확인). 앱 설정에서 편집 가능(Prefs.gameTagNames), 기본값 = 이 목록
    val USER_DEFAULT: List<String> = listOf("즐겨찾기", "슈퍼리그", "하이퍼리그", "레이드1군", "레이드2군", "다이맥스", "체육관")
    val KNOWN: Set<String> = RECOMMENDED + USER_DEFAULT
    // 칩 띠(720×1600 비율, 미검증): 이름 줄 아래 ~ 기술 줄 위. 실측 디버그 캡처로 확인 후 픽셀 판독을 붙인다
    const val CHIP_Y0 = 0.49; const val CHIP_Y1 = 0.56

    private fun norm(s: String) = s.replace(" ", "").replace("#", "").trim()

    // OCR 줄 → 판독된 게임 태그 이름 목록 (중복 제거, 최대 8). extra: 사용자 태그 목록(웹 my_pokemon.tags 등)
    fun detect(lines: List<OcrLine>, extra: Collection<String> = emptyList()): List<String> {
        val known = HashMap<String, String>()
        for (k in KNOWN + extra) known[norm(k)] = k
        val out = LinkedHashSet<String>()
        for (l in lines) {
            val t = l.text.trim()
            if (t.length !in 2..24) continue
            // 줄 전체가 태그 하나면 그대로("체육관 방어" 를 "체육관"+"방어" 로 쪼개지 않음). 아니면 칩 여러 개가 붙은 줄로 보고 공백·구분자로 나눠 본다
            val whole = known[norm(t)]
            if (whole != null) { out.add(whole); continue }
            val parts = t.split(Regex("[\\s|·,/]+")).filter { it.length >= 2 }
            for (p in parts) { val k = known[norm(p)]; if (k != null) out.add(k) }
            // "불꽃 레이드" 처럼 두 토큰이 떨어져 인식된 경우: 인접 토큰 결합
            val toks = t.split(Regex("\\s+")).filter { it.isNotBlank() }
            for (i in 0 until toks.size - 1) { val k = known[norm(toks[i] + toks[i + 1])]; if (k != null) out.add(k) }
        }
        return out.take(8)
    }
}
