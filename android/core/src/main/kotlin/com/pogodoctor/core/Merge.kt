package com.pogodoctor.core

// 상세 화면 결과 + 평가 화면 결과 병합 규칙
// 평가 화면은 트레이너·평가창이 기술·사탕 영역을 가리므로 기술 미인식이 정상이다. 직전(기본 3분) 상세 화면과 CP 가 같고
// (이름이 둘 다 인식됐다면) 이름도 같으면 같은 개체로 보고 합친다.
object Merge {
    const val DEFAULT_WINDOW_MS = 3 * 60 * 1000L

    fun canMerge(detail: ScreenInfo?, detailAtMs: Long, appraisal: ScreenInfo, nowMs: Long, windowMs: Long = DEFAULT_WINDOW_MS): Boolean {
        if (detail == null || detail.kind != ScreenInfo.Kind.DETAIL) return false
        if (nowMs - detailAtMs > windowMs || nowMs < detailAtMs) return false
        val dcp = detail.cp; val acp = appraisal.cp
        if (dcp == null || acp == null || dcp != acp) return false
        val dn = detail.species?.nameKr ?: detail.nameRaw
        val an = appraisal.species?.nameKr ?: appraisal.nameRaw
        if (dn != null && an != null && Fuzzy.similarity(dn, an) < 0.8) return false
        return true
    }
}
