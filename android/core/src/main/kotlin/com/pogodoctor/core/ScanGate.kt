package com.pogodoctor.core

// 4-B3 연속 스캔 "새 개체 확정" 게이트 (순수 로직, 테스트 대상)
//  - 전체 화면 지문 대신 막대 3개 픽셀 판독값 + 이름 줄 영역 해시만 본다 (3D 모델 애니메이션·파티클·배경은 판단에서 제외)
//  - 서명(막대값, 이름해시)이 직전 확정과 다르고 stableMs(기본 400ms) 동안 동일하면 분석(게이트 열림)
class ScanGate(private val stableMs: Long = 400) {
    data class Signature(val atk: Int?, val def: Int?, val sta: Int?, val nameHash: Long) {
        val barsComplete: Boolean get() = atk != null && def != null && sta != null
    }
    enum class Reason { OPEN, NOT_APPRAISAL, UNSTABLE, SAME_AS_CONFIRMED }
    data class Decision(val reason: Reason, val stableForMs: Long)

    var lastSig: Signature? = null; private set
    var stableSince = 0L; private set
    var lastConfirmed: Signature? = null; private set
    var pendingSince = 0L; private set   // 서명이 계속 바뀌기 시작한 시각(대기 프레임 진단용)

    fun offer(sig: Signature, nowMs: Long): Decision {
        if (!sig.barsComplete) { lastSig = null; stableSince = nowMs; return Decision(Reason.NOT_APPRAISAL, 0) }
        if (sig != lastSig) { if (lastSig == null || pendingSince == 0L) pendingSince = nowMs; lastSig = sig; stableSince = nowMs; return Decision(Reason.UNSTABLE, 0) }
        val stableFor = nowMs - stableSince
        if (stableFor < stableMs) return Decision(Reason.UNSTABLE, stableFor)
        if (sig == lastConfirmed) return Decision(Reason.SAME_AS_CONFIRMED, stableFor)
        return Decision(Reason.OPEN, stableFor)
    }
    // 분석을 시도했으면(성공·실패 무관) 같은 서명으로 다시 열리지 않도록 확정 처리
    fun confirm(sig: Signature) { lastConfirmed = sig; pendingSince = 0L }
    // 서명이 계속 바뀐 채 waitMs 이상 지났는가 (게이트 장기 대기 진단)
    fun waitingTooLong(nowMs: Long, waitMs: Long): Boolean = pendingSince != 0L && lastConfirmed != lastSig && nowMs - pendingSince >= waitMs
}
