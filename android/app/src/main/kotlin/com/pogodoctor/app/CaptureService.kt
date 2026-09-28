package com.pogodoctor.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.drawable.Icon
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.BarReader
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.ScreenParser
import com.pogodoctor.core.SpeciesRef
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

// 포그라운드 서비스: MediaProjection 으로 "요청이 있을 때만" 화면 1장을 캡처 → 기기 내 OCR → 결과 표시
// 트리거: ① 떠 있는 버튼(다른 앱 위) ② 빠른 설정 타일·알림 "캡처"(포켓몬GO 위, 지연 캡처)
// 결과 표시: 포켓몬GO 위에서는 오버레이 창이 숨겨지므로(Android 12+ setHideOverlayWindows/게임 부스터 추정) 반투명 ResultActivity 사용
// 절대 규칙: 화면을 읽고 보여주기만 한다. 터치·스와이프 자동 조작·접근성 서비스 없음. 게임 계정·서버 통신 관여 없음.
class CaptureService : Service() {
    companion object {
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val ACTION_STOP = "com.pogodoctor.app.STOP"
        const val ACTION_CAPTURE_DELAYED = "com.pogodoctor.app.CAPTURE_DELAYED"
        private const val CHANNEL = "capture"
        private const val NOTIF_ID = 1
        private const val BLACK_THRESHOLD = 12.0 // 평균 밝기(0~255) 이하면 캡처 차단(검은 화면)으로 판정
        @Volatile var running = false
    }

    private lateinit var prefs: Prefs
    private lateinit var repo: DataRepo
    private lateinit var wm: WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var width = 0; private var height = 0; private var dpi = 0

    private var bubble: BubbleView? = null
    private var card: View? = null
    private var busy = false

    // 상세 + 평가 화면을 합쳐 개체값 확정
    private var lastDetail: ScreenInfo? = null
    private var lastAppraisal: Appraisal? = null
    private var chosenSpecies: SpeciesRef? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this); repo = DataRepo(this, prefs)
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_CAPTURE_DELAYED -> {
                if (projection == null) { toast("캡처 서비스가 실행 중이 아닙니다 — 앱에서 오버레이 시작"); return START_NOT_STICKY }
                val delay = prefs.captureDelayMs.toLong()
                if (prefs.debugMode) DebugLog.add(this, "trigger", emptyList(), "지연 캡처 요청 ${delay}ms · 오버레이 버튼 표시 상태: ${bubbleVisibility()}")
                handler.removeCallbacks(delayedCapture)
                handler.postDelayed(delayedCapture, delay)
                return START_NOT_STICKY
            }
        }
        startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        val code = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        @Suppress("DEPRECATION") val data: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        if (projection == null && code != 0 && data != null) {
            if (!startProjection(code, data)) { toast("화면 캡처 권한을 얻지 못했습니다"); stopSelf(); return START_NOT_STICKY }
        }
        if (bubble == null) showBubble()
        running = true
        scope.launch(Dispatchers.IO) { try { repo.refresh(Api(prefs)) } catch (e: Exception) { if (repo.loadCached() == null) withContext(Dispatchers.Main) { toast("포켓몬 데이터 없음: ${e.message} — 인터넷 연결 후 앱에서 '데이터 갱신'") } } }
        return START_NOT_STICKY
    }

    private val delayedCapture = Runnable { captureAndAnalyze(viaActivity = true) }

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), flags)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), flags)
        // "캡처" 는 트램펄린 액티비티로: 액티비티 시작이 알림창을 닫고, 서비스에 지연 캡처를 요청한다
        val capture = PendingIntent.getActivity(this, 3, Intent(this, TrampolineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val icon = Icon.createWithResource(this, R.drawable.ic_notif)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notif).setContentTitle(getString(R.string.notif_title)).setContentText(getString(R.string.notif_text))
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(icon, "캡처", capture).build())
            .addAction(Notification.Action.Builder(icon, "중지", stop).build())
            .setOngoing(true).build()
    }

    private fun startProjection(code: Int, data: Intent): Boolean {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val p = try { mpm.getMediaProjection(code, data) } catch (e: Exception) { null } ?: return false
        if (Build.VERSION.SDK_INT >= 30) {
            val bounds = wm.currentWindowMetrics.bounds
            width = bounds.width(); height = bounds.height()
        } else {
            @Suppress("DEPRECATION") val m = android.util.DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
            width = m.widthPixels; height = m.heightPixels
        }
        dpi = resources.displayMetrics.densityDpi
        p.registerCallback(object : MediaProjection.Callback() { override fun onStop() { handler.post { stopSelf() } } }, handler)
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        display = p.createVirtualDisplay("pogo-doctor", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader!!.surface, null, handler)
        projection = p
        return true
    }

    // ─── 캡처 1장 → Bitmap ───
    private suspend fun captureOnce(): Bitmap? = withContext(Dispatchers.IO) {
        val r = reader ?: return@withContext null
        var img = r.acquireLatestImage()
        if (img == null) { Thread.sleep(150); img = r.acquireLatestImage() }
        img ?: return@withContext null
        try {
            val plane = img.planes[0]
            val rowStride = plane.rowStride; val pixelStride = plane.pixelStride
            val padded = Bitmap.createBitmap(rowStride / pixelStride, img.height, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            if (padded.width == img.width) padded else Bitmap.createBitmap(padded, 0, 0, img.width, img.height)
        } finally { img.close() }
    }

    // 평균 밝기 (격자 샘플링). 캡처 차단(FLAG_SECURE) 시 전부 검은색
    private fun averageBrightness(bmp: Bitmap): Double {
        var sum = 0L; var n = 0
        val sx = maxOf(1, bmp.width / 48); val sy = maxOf(1, bmp.height / 96)
        var y = 0
        while (y < bmp.height) { var x = 0; while (x < bmp.width) { val c = bmp.getPixel(x, y); sum += ((c shr 16) and 255) + ((c shr 8) and 255) + (c and 255); n += 3; x += sx }; y += sy }
        return if (n == 0) 0.0 else sum.toDouble() / n
    }

    // ─── 오버레이: 떠 있는 버튼 (다른 앱 위에서 사용. 포켓몬GO 위에서는 숨겨질 수 있음 → 표시 상태를 디버그 로그에 남긴다) ───
    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    inner class BubbleView(ctx: Context) : TextView(ctx) {
        override fun onWindowVisibilityChanged(visibility: Int) {
            super.onWindowVisibilityChanged(visibility)
            if (prefs.debugMode) DebugLog.add(context, "overlay", emptyList(), "오버레이 창 가시성 변경: ${visName(visibility)} · isShown=$isShown")
        }
    }
    private fun visName(v: Int) = when (v) { View.VISIBLE -> "VISIBLE"; View.INVISIBLE -> "INVISIBLE"; View.GONE -> "GONE"; else -> "$v" }
    private fun bubbleVisibility(): String { val b = bubble ?: return "버튼 없음"; return "windowVisibility=${visName(b.windowVisibility)} isShown=${b.isShown} attached=${b.isAttachedToWindow}" }

    private fun showBubble() {
        val tv = BubbleView(this).apply {
            text = "⚡"; textSize = 22f; gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bubble_bg)
        }
        val lp = WindowManager.LayoutParams(dp(52), dp(52), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.TOP or Gravity.START; lp.x = dp(8); lp.y = height / 2
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        tv.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> { val dx = e.rawX - downX; val dy = e.rawY - downY; if (abs(dx) > 12 || abs(dy) > 12) moved = true; lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt(); wm.updateViewLayout(v, lp); true }
                MotionEvent.ACTION_UP -> { if (!moved) captureAndAnalyze(viaActivity = false); true }
                else -> false
            }
        }
        wm.addView(tv, lp); bubble = tv
    }

    // ─── 캡처 → 분석 → 표시 ───
    private fun captureAndAnalyze(viaActivity: Boolean) {
        if (busy) return
        busy = true
        bubble?.text = "…"
        scope.launch {
            try {
                val bmp = captureOnce() ?: run { toast("캡처 실패 (화면 프레임 없음) — 다시 시도하세요"); return@launch }
                val bright = averageBrightness(bmp)
                if (bright <= BLACK_THRESHOLD) {
                    DebugLog.add(this@CaptureService, "blocked", emptyList(), "캡처 차단(검은 화면) 평균 밝기 ${"%.1f".format(bright)} · ${bubbleVisibility()}")
                    show(ResultStore.Result.Blocked(bright), viaActivity); return@launch
                }
                analyze(bmp, viaActivity)
            } catch (e: Exception) {
                DebugLog.add(this@CaptureService, "error", emptyList(), "", e.toString())
                show(ResultStore.Result.Error(e.message ?: e.toString()), viaActivity)
            } finally { busy = false; bubble?.text = "⚡" }
        }
    }

    private suspend fun analyze(bmp: Bitmap, viaActivity: Boolean) {
        val data = repo.loadCached() ?: run { toast("포켓몬 데이터가 없습니다 — 앱에서 '데이터 갱신'"); return }
        val lines = Ocr.recognize(bmp)
        val parser = ScreenParser(data.species, data.allMoveNamesKr)
        var info = parser.parse(lines)
        if (info.kind == ScreenInfo.Kind.APPRAISAL) {
            val labels = lines.filter { l -> val t = l.text.replace(" ", ""); t.contains("공격") || t.contains("방어") || t == "HP" || t.contains("체력") }
            val bars = withContext(Dispatchers.Default) { BarReader.readAppraisal({ x, y -> if (x in 0 until bmp.width && y in 0 until bmp.height) bmp.getPixel(x, y) else 0 }, bmp.width, labels) }
            info = parser.parse(lines, bars)
            lastAppraisal = bars
            if (prefs.debugMode) DebugLog.add(this, "appraisal", lines.map { it.text }, "막대 공${bars.atk} 방${bars.def} HP${bars.sta}")
            show(ResultStore.Result.Screen(lastDetail, bars, chosenSpecies), viaActivity); return
        }
        if (info.kind == ScreenInfo.Kind.UNKNOWN) {
            if (prefs.debugMode) DebugLog.add(this, "unknown", lines.map { it.text }, "포켓몬 화면 아님")
            show(ResultStore.Result.Error("포켓몬 상세 화면을 찾지 못했습니다 (CP·이름 없음)"), viaActivity); return
        }
        lastDetail = info; chosenSpecies = info.species
        if (prefs.debugMode) DebugLog.add(this, "detail", lines.map { it.text }, "CP${info.cp} HP${info.hp} 종=${info.species?.nameKr ?: "?"}(${(info.nameScore * 100).toInt()}%) 기술=${info.moves.joinToString("/") { it.nameKr }}")
        show(ResultStore.Result.Screen(info, lastAppraisal, chosenSpecies), viaActivity)
    }

    private fun show(result: ResultStore.Result, viaActivity: Boolean) {
        ResultStore.publish(result)
        if (viaActivity) {
            hideCard()
            // 포그라운드 서비스 + SYSTEM_ALERT_WINDOW 권한이 있어 백그라운드 액티비티 시작이 허용된다
            startActivity(Intent(this, ResultActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        } else showCard()
    }

    // ─── 오버레이 결과 카드 (다른 앱 위) ───
    private fun showCard() {
        hideCard()
        val card = ResultCard(this, repo, prefs.isPaired)
        val view = card.build(ResultStore.current, object : ResultCard.Actions {
            override fun onChooseSpecies(sp: SpeciesRef) { chosenSpecies = sp; val cur = ResultStore.current as? ResultStore.Result.Screen ?: return; ResultStore.current = cur.copy(chosen = sp); showCard() }
            override fun onSave(info: ScreenInfo, sp: SpeciesRef, c: ResultCard.Computed, status: String) {
                val row = card.buildRow(info, sp, c, status)
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { Api(prefs).savePokemon(row) }
                        toast(if (status == "keep") "보관에 저장했습니다 — 웹 내 목록에 표시됩니다" else "박사행으로 저장했습니다")
                        hideCard(); lastDetail = null; lastAppraisal = null; chosenSpecies = null; ResultStore.current = null
                    } catch (e: Exception) {
                        DebugLog.add(this@CaptureService, "save-error", emptyList(), row.toString(), e.toString())
                        toast("저장 실패: ${e.message}")
                    }
                }
            }
            override fun onClose() { hideCard() }
        })
        val scroll = ScrollView(this).apply { addView(view) }
        val lp = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.BOTTOM; lp.y = dp(24)
        wm.addView(scroll, lp); this.card = scroll
    }

    private fun hideCard() { card?.let { runCatching { wm.removeView(it) } }; card = null }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(delayedCapture)
        hideCard(); bubble?.let { runCatching { wm.removeView(it) } }; bubble = null
        display?.release(); reader?.close(); projection?.stop()
        scope.cancel()
        super.onDestroy()
    }
}
