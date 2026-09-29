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
        val extra = intent?.getStringExtra(EXTRA_ACTION)
        if (extra == "choose_tag") {
            // 4-B6: 알림 액션 "태그 선택" → 카테고리 목록(반투명 대화상자). 순환 복사 폐지
            startActivity(Intent(this, CleanupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(); overridePendingTransition(0, 0)
            return
        }
        if (extra == "copy_transfer") {
            // 4-B5: 알림 액션 → 박사행 검색어 복사 (클립보드 쓰기는 포그라운드 액티비티에서). 서버 묶음 갱신 후 복사, 끝나면 종료
            val prefs = Prefs(this)
            Thread {
                CleanupCopier.refresh(prefs)
                runOnUiThread { CleanupCopier.copyNextTransfer(this); startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_REFRESH_NOTIF)); finish(); overridePendingTransition(0, 0) }
            }.start()
            return
        }
        if (CaptureService.running) {
            // 4-B: EXTRA_ACTION=scan 이면 연속 스캔 토글, 아니면 1장 지연 캡처
            val action = if (extra == "scan") CaptureService.ACTION_SCAN_TOGGLE else CaptureService.ACTION_CAPTURE_DELAYED
            startService(Intent(this, CaptureService::class.java).setAction(action))
        } else {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
        overridePendingTransition(0, 0)
    }
}
