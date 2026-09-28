package com.pogodoctor.app

import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef

// 서비스 → 결과 화면(액티비티/오버레이 카드) 사이의 프로세스 내 공유 상태
// (Parcelable 직렬화 대신 단일 프로세스 싱글턴. 서비스가 갱신하면 화면이 다시 그린다)
object ResultStore {
    sealed class Result {
        data class Screen(
            val info: ScreenInfo?, val appraisal: Appraisal?, val chosen: SpeciesRef?,
            val merged: Boolean = false,          // 상세 + 평가 화면 결과를 합친 경우
            val stars: Int? = null,               // 평가 별 개수 (합계 범위 제약)
            val levels: List<Double>? = null,     // 강화 비용으로 좁힌 레벨 목록
            val barDetail: String? = null,        // 막대 판독 상세 (디버그)
        ) : Result()
        data class Blocked(val brightness: Double) : Result()   // 검은 화면(캡처 차단)
        data class Error(val message: String) : Result()
    }
    @Volatile var current: Result? = null
    @Volatile var listener: (() -> Unit)? = null
    fun publish(r: Result) { current = r; listener?.invoke() }
}
