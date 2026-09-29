package com.pogodoctor.app

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

// 4-B 빠른 설정 타일 "포고박사 연속 스캔": 켜기/끄기 토글. 평가 화면을 넘기기만 하면 자동 분석·기록(자동 저장 없음).
class ScanTileService : TileService() {
    override fun onStartListening() { super.onStartListening(); refresh() }
    private fun refresh() {
        val t = qsTile ?: return
        t.state = if (CaptureService.scanning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        t.label = "포고박사 연속 스캔"
        if (Build.VERSION.SDK_INT >= 29) t.subtitle = if (CaptureService.scanning) "스캔 중 — 탭하면 중지" else if (CaptureService.running) "탭하면 시작" else "앱에서 오버레이 시작 필요"
        t.updateTile()
    }
    override fun onClick() {
        super.onClick()
        val target = if (CaptureService.running) TrampolineActivity::class.java else MainActivity::class.java
        val intent = Intent(this, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra(TrampolineActivity.EXTRA_ACTION, "scan")
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 11, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        else @Suppress("DEPRECATION") startActivityAndCollapse(intent)
    }
}
