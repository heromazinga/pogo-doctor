package com.pogodoctor.app

import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef

// 서비스 → 결과 화면(액티비티/오버레이 카드) 사이의 프로세스 내 공유 상태
// (Parcelable 직렬화 대신 단일 프로세스 싱글턴. 서비스가 갱신하면 화면이 다시 그린다)
object ResultStore {
    sealed class Result {
        data class Screen(val info: ScreenInfo?, val appraisal: Appraisal?, val chosen: SpeciesRef?) : Result()
        data class Blocked(val brightness: Double) : Result()   // 검은 화면(캡처 차단)
        data class Error(val message: String) : Result()
    }
    @Volatile var current: Result? = null
    @Volatile var listener: (() -> Unit)? = null
    fun publish(r: Result) { current = r; listener?.invoke() }
}
