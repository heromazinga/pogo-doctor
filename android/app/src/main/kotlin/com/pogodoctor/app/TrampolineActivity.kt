package com.pogodoctor.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

// 투명 트램펄린: 빠른 설정 타일·알림 액션에서 시작되어 알림창을 닫고, 서비스에 "지연 캡처" 를 요청한 뒤 즉시 종료한다.
// (액티비티 시작 자체가 알림창을 접는다. 지연값(prefs.captureDelayMs) 뒤에 캡처하므로 트램펄린·알림창은 찍히지 않는다)
class TrampolineActivity : Activity() {
    companion object { const val EXTRA_ACTION = "action" }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (CaptureService.running) {
            // 4-B: EXTRA_ACTION=scan 이면 연속 스캔 토글, 아니면 1장 지연 캡처
            val action = if (intent?.getStringExtra(EXTRA_ACTION) == "scan") CaptureService.ACTION_SCAN_TOGGLE else CaptureService.ACTION_CAPTURE_DELAYED
            startService(Intent(this, CaptureService::class.java).setAction(action))
        } else {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
        overridePendingTransition(0, 0)
    }
}
