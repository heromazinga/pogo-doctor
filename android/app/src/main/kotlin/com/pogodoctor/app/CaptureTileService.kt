package com.pogodoctor.app

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

// 빠른 설정 타일 "포고박사 캡처": 포켓몬GO 가 오버레이 창을 숨겨도(Window.setHideOverlayWindows / 게임 부스터 추정)
// 알림창은 열리므로 타일로 캡처를 트리거한다. 접근성 서비스·자동 입력은 쓰지 않는다.
class CaptureTileService : TileService() {
    override fun onStartListening() { super.onStartListening(); refresh() }

    private fun refresh() {
        val t = qsTile ?: return
        val running = CaptureService.running
        t.state = if (running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        t.label = "포고박사 캡처"
        if (Build.VERSION.SDK_INT >= 29) t.subtitle = if (running) "탭하면 1장 캡처" else "앱에서 오버레이 시작 필요"
        t.updateTile()
    }

    override fun onClick() {
        super.onClick()
        // 실행 중이면 트램펄린(알림창 닫고 지연 캡처), 아니면 앱 열기
        val target = if (CaptureService.running) TrampolineActivity::class.java else MainActivity::class.java
        val intent = Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 10, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION") startActivityAndCollapse(intent)
        }
    }
}
