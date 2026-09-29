package com.pogodoctor.core

// 4-B3 연속 스캔 "새 개체 확정" 게이트 (순수 로직, 테스트 대상)
//  - 전체 화면 지문 대신 막대 3개 픽셀 판독값 + 이름 줄 영역 해시만 본다 (3D 모델 애니메이션·파티클·배경은 판단에서 제외)
//  - 서명(막대값, 이름해시)이 직전 확정과 다르고 stableMs(기본 400ms) 동안 동일하면 분석(게이트 열림)
class ScanGate(private val stableMs: Long = 400, private val maxAttempts: Int = 3, private val retryGapMs: Long = 300) {
    data class Signature(val atk: Int?, val def: Int?, val sta: Int?, val nameHash: Long) {
        val barsComplete: Boolean get() = atk != null && def != null && sta != null
    }
    enum class Reason { OPEN, NOT_APPRAISAL, UNSTABLE, SAME_AS_CONFIRMED }
    data class Decision(val reason: Reason, val stableForMs: Long)

    var lastSig: Signature? = null; private set
    var stableSince = 0L; private set
    var lastConfirmed: Signature? = null; private set
    var pendingSince = 0L; private set   // 서명이 계속 바뀌기 시작한 시각(대기 프레임 진단용)
    var attempts = 0; private set          // 현재 확정 서명에 대한 분석 시도 횟수 (4-B4: 종 미확정이면 300ms 간격 최대 2회 재시도 → 총 3회)
    private var lastAttemptAt = 0L
    private var closed = false             // 성공 또는 재시도 소진으로 닫힘

    fun offer(sig: Signature, nowMs: Long): Decision {
        if (!sig.barsComplete) { lastSig = null; stableSince = nowMs; return Decision(Reason.NOT_APPRAISAL, 0) }
        if (sig != lastSig) { if (lastSig == null || pendingSince == 0L) pendingSince = nowMs; lastSig = sig; stableSince = nowMs; return Decision(Reason.UNSTABLE, 0) }
        val stableFor = nowMs - stableSince
        if (stableFor < stableMs) return Decision(Reason.UNSTABLE, stableFor)
        if (sig == lastConfirmed) {
            // 재시도: 아직 닫히지 않았고 시도 횟수가 남았으며 직전 시도 후 retryGapMs 지났으면 다시 연다
            if (!closed && attempts < maxAttempts && nowMs - lastAttemptAt >= retryGapMs) return Decision(Reason.OPEN, stableFor)
            return Decision(Reason.SAME_AS_CONFIRMED, stableFor)
        }
        return Decision(Reason.OPEN, stableFor)
    }
    // 분석 시도 기록. 새 서명이면 시도 횟수를 1 로, 같은 서명이면 +1. 호출측은 성공 시 close(), 실패 시 그대로 두면 재시도 가능
    fun confirm(sig: Signature, nowMs: Long = System.currentTimeMillis()) {
        if (sig != lastConfirmed) { lastConfirmed = sig; attempts = 1; closed = false } else attempts++
        lastAttemptAt = nowMs; pendingSince = 0L
    }
    // 성공(기록) 또는 재시도 소진 → 같은 서명으로 더 열리지 않음
    fun close() { closed = true }
    val retriesExhausted: Boolean get() = attempts >= maxAttempts
    // 서명이 계속 바뀐 채 waitMs 이상 지났는가 (게이트 장기 대기 진단)
    fun waitingTooLong(nowMs: Long, waitMs: Long): Boolean = pendingSince != 0L && lastConfirmed != lastSig && nowMs - pendingSince >= waitMs
}
