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
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import android.os.BatteryManager
import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.BarReader
import com.pogodoctor.core.Merge
import com.pogodoctor.core.PowerUp
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
        const val ACTION_SCAN_TOGGLE = "com.pogodoctor.app.SCAN_TOGGLE"   // 4-B 연속 스캔 켜기/끄기
        @Volatile var scanning = false
        @Volatile var scanLine: String = ""
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

    // ─── 4-B 연속 스캔 ───
    private var scan: ScanSession? = null
    private var strip: TextView? = null
    private var scanBusy = false

    // 상세 + 평가 화면을 합쳐 개체값 확정
    private var lastDetail: ScreenInfo? = null
    private var lastDetailAt = 0L
    private var lastLevels: List<Double>? = null
    private var lastAppraisal: Appraisal? = null
    private var lastStars: Int? = null
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
            ACTION_SCAN_TOGGLE -> {
                if (projection == null) { toast("캡처 서비스가 실행 중이 아닙니다 — 앱에서 오버레이 시작"); return START_NOT_STICKY }
                if (scanning) stopScan() else startScan()
                return START_NOT_STICKY
            }
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

    private fun buildNotification(text: String? = null): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), flags)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), flags)
        // "캡처" 는 트램펄린 액티비티로: 액티비티 시작이 알림창을 닫고, 서비스에 지연 캡처를 요청한다
        val capture = PendingIntent.getActivity(this, 3, Intent(this, TrampolineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val scanToggle = PendingIntent.getActivity(this, 4, Intent(this, TrampolineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(TrampolineActivity.EXTRA_ACTION, "scan"), flags)
        val icon = Icon.createWithResource(this, R.drawable.ic_notif)
        val title = if (scanning) "연속 스캔 중 — 평가 화면을 넘기세요" else getString(R.string.notif_title)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notif).setContentTitle(title).setContentText(text ?: (if (scanning) scanLine else getString(R.string.notif_text)))
            .setStyle(Notification.BigTextStyle().bigText(text ?: (if (scanning) scanLine else getString(R.string.notif_text))))
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(icon, "캡처", capture).build())
            .addAction(Notification.Action.Builder(icon, if (scanning) "스캔 중지" else "연속 스캔", scanToggle).build())
            .addAction(Notification.Action.Builder(icon, "중지", stop).build())
            .setOnlyAlertOnce(true).setOngoing(true).build()
    }
    private fun updateNotification(text: String) { scanLine = text; getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text)) }

    // ─── 4-B 연속 스캔: 초당 2~3프레임 샘플 → 이름·CP·막대 영역 지문 변화 감지 → 연속 2프레임 동일(안정) 시 1회 분석 → 서버 기록 → 알림 한 줄 갱신 ───
    //     결과 액티비티는 띄우지 않는다(게임 조작 방해 금지). 자동 저장 없음(서버 스캔 기록만). 기술은 읽지 않는다.
    private fun batteryPct(): Int = try { getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) } catch (_: Exception) { -1 }
    private fun startScan() {
        val session = ScanSession(); session.metrics.batteryStart = batteryPct()
        scan = session; scanning = true
        hideCard(); bubble?.text = "📷"
        showStrip(); updateNotification("스캔 0 · 평가 화면(막대 3개)을 켜고 좌우로 넘기세요")
        DebugLog.add(this, "scan", emptyList(), "연속 스캔 시작 세션 ${session.id} 간격 ${prefs.scanIntervalMs}ms")
        handler.removeCallbacks(scanTick); handler.post(scanTick)
    }
    private fun stopScan() {
        val session = scan ?: return
        handler.removeCallbacks(scanTick)
        scanning = false; scan = null; scanBusy = false
        session.metrics.batteryEnd = batteryPct()
        val report = session.metrics.report()
        prefs.lastScanReport = "${session.id}: $report"
        DebugLog.add(this, "scan", emptyList(), "연속 스캔 종료 — $report")
        hideStrip(); bubble?.text = "⚡"
        updateNotification("스캔 종료 · 기록 ${session.metrics.recorded}건 — 웹 내 목록 → 📷 스캔 기록에서 검토·저장")
        toast("연속 스캔 종료: 기록 ${session.metrics.recorded}건 (웹 📷 스캔 기록에서 저장)")
    }
    private val scanTick = object : Runnable {
        override fun run() {
            if (!scanning) return
            if (!scanBusy) scanFrame()
            handler.postDelayed(this, prefs.scanIntervalMs.toLong())
        }
    }
    private fun scanFrame() {
        val session = scan ?: return
        scanBusy = true
        scope.launch {
            try {
                val t0 = System.currentTimeMillis()
                val bmp = captureOnce() ?: return@launch
                val t1 = System.currentTimeMillis()
                val fp = withContext(Dispatchers.Default) { ScanSession.fingerprint(bmp) }
                val t2 = System.currentTimeMillis()
                session.metrics.frames++; session.metrics.captureMs += t1 - t0; session.metrics.fpMs += t2 - t1
                if (!session.shouldAnalyze(fp)) return@launch
                if (averageBrightness(bmp) <= BLACK_THRESHOLD) { setStrip("⛔ 캡처 차단(검은 화면)"); return@launch }
                session.lastAnalyzedFp = fp
                scanAnalyze(session, bmp)
            } catch (e: Exception) {
                DebugLog.add(this@CaptureService, "scan-error", emptyList(), "", e.toString())
            } finally { scanBusy = false }
        }
    }
    private suspend fun scanAnalyze(session: ScanSession, bmp: Bitmap) {
        val data = repo.loadCached() ?: return
        val t0 = System.currentTimeMillis()
        val lines = Ocr.recognize(bmp)
        val t1 = System.currentTimeMillis()
        val parser = ScreenParser(data.species, data.allMoveNamesKr)
        var info = parser.parse(lines)
        session.metrics.analyses++; session.metrics.ocrMs += t1 - t0
        if (info.kind != ScreenInfo.Kind.APPRAISAL) { setStrip("평가 화면(막대 3개)이 아닙니다 · 스캔 ${session.metrics.recorded}"); return }
        val labels = lines.filter { ScreenParser.isLabelLine(it) }
        val reading = withContext(Dispatchers.Default) { BarReader.readAppraisal({ x, y -> if (x in 0 until bmp.width && y in 0 until bmp.height) bmp.getPixel(x, y) else 0 }, bmp.width, bmp.height, labels) }
        session.metrics.barMs += System.currentTimeMillis() - t1
        val ap = reading.appraisal
        if (ap.atk == null || ap.def == null || ap.sta == null) { setStrip("막대 판독 대기(애니메이션) · 스캔 ${session.metrics.recorded}"); session.lastAnalyzedFp = null; return }
        // 막대 안정: 직전 분석과 같은 값이어야 기록 (채움 애니메이션 종료 확인). 다르면 다음 프레임에서 재확인
        if (session.lastBars != ap) { session.lastBars = ap; session.lastAnalyzedFp = null; return }
        info = parser.parse(lines, ap)
        val sp = info.species
        if (info.cp == null) { session.metrics.skippedNoCp++; setStrip("CP 가 가려짐 — 안내 배너가 사라지면 다시 읽습니다 · 스캔 ${session.metrics.recorded}"); session.lastAnalyzedFp = null; return }
        if (sp == null) { setStrip("종 미인식(${info.nameRaw ?: "?"}) · 후보 ${info.speciesCandidates.map { it.nameKr }} · 스캔 ${session.metrics.recorded}"); return }
        val key = ScanSession.scanKey(sp, info.cp, info.hp, ap, false)
        if (session.isDuplicate(key)) { session.metrics.duplicates++; setStrip("같은 개체(이미 기록) · 스캔 ${session.metrics.recorded}"); return }
        // CP/HP 로 레벨 교차 확인: 막대 개체값과 성립하는 후보가 없으면 "재확인 필요"
        val base = IvCalc.Base(sp.atk, sp.def, sp.sta)
        val all = IvCalc.candidates(base, info.cp!!, info.hp)
        var cands = IvCalc.filterByAppraisal(all, ap.atk, ap.def, ap.sta)
        val recheck = cands.isEmpty()
        if (recheck) cands = IvCalc.candidatesWithoutCp(base, info.hp, ap)
        val pct = Math.round((ap.atk + ap.def + ap.sta) * 100.0 / 45)
        val body = session.body(sp, info, ap, cands, reading.stars, recheck)
        val t2 = System.currentTimeMillis()
        try {
            val res = withContext(Dispatchers.IO) { Api(prefs).scanItem(body) }
            session.metrics.apiMs += System.currentTimeMillis() - t2
            session.metrics.recorded++
            val v = res.optJSONObject("verdict")
            val line = "스캔 ${session.metrics.recorded} · 방금 ${sp.nameKr} ${pct}%${if (recheck) " ⚠️재확인" else ""} ${v?.optString("summary")?.take(60) ?: ""}"
            setStrip(line); updateNotification(line)
            if (prefs.debugMode) DebugLog.add(this, "scan-item", lines.map { it.text }, "$key → ${v?.optString("tier")} ${v?.optString("summary")}")
        } catch (e: Exception) {
            session.metrics.apiFail++
            setStrip("기록 실패: ${e.message} · 스캔 ${session.metrics.recorded}")
            DebugLog.add(this, "scan-api-error", emptyList(), key, e.toString())
        }
    }
    // 작은 띠 오버레이: 터치 통과(FLAG_NOT_TOUCHABLE), 불투명도 0.8 (Android 12 untrusted touch 규칙). 포켓몬GO 가 숨기면 알림만 보인다
    private fun showStrip() {
        hideStrip()
        val tv = TextView(this).apply { text = "📷 연속 스캔 시작"; textSize = 12f; setTextColor(Color.WHITE); setBackgroundColor(0xCC0F2035.toInt()); setPadding(dp(10), dp(6), dp(10), dp(6)); alpha = 0.8f }
        val lp = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.TOP; lp.y = dp(28); lp.alpha = 0.8f
        runCatching { wm.addView(tv, lp); strip = tv }
    }
    private fun hideStrip() { strip?.let { runCatching { wm.removeView(it) } }; strip = null }
    private fun setStrip(text: String) { scanLine = text; strip?.text = text }

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
                    if (prefs.debugMode) uploadDebug("blocked", emptyList(), "평균 밝기 ${"%.1f".format(bright)}", bmp)
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
        val now = System.currentTimeMillis()
        if (info.kind == ScreenInfo.Kind.APPRAISAL) {
            // 평가 화면("공격"+"방어"+"HP" 라벨): 라벨 기준(없으면 비율 위치)으로 막대 3개 + 별 판독. 강화 비용은 읽지 않는다(4-A 보정).
            // 평가 화면에도 CP·이름·HP 가 보이므로 그 자체로 판정 가능하고, 직전 상세 화면이 있으면 기술만 합친다.
            val labels = lines.filter { ScreenParser.isLabelLine(it) }
            val reading = withContext(Dispatchers.Default) { BarReader.readAppraisal({ x, y -> if (x in 0 until bmp.width && y in 0 until bmp.height) bmp.getPixel(x, y) else 0 }, bmp.width, bmp.height, labels) }
            info = parser.parse(lines, reading.appraisal) // 막대까지 반영해 종 후보를 CP/HP·막대와 성립하는 종으로 좁힌다
            lastAppraisal = reading.appraisal; lastStars = reading.stars
            val mergeable = Merge.canMerge(lastDetail, lastDetailAt, info, now)
            val summary = "막대 ${reading.detail}${if (reading.fromRatio) " (비율 위치)" else ""} · CP${info.cp} HP${info.hp} 종=${info.species?.nameKr ?: "?"} 후보=${info.speciesCandidates.map { it.nameKr }} · 병합=${mergeable}${if (!mergeable && lastDetail != null) " (직전 상세 CP${lastDetail?.cp} ${(now - lastDetailAt) / 1000}초 전)" else ""}"
            if (prefs.debugMode) { DebugLog.add(this, "appraisal", lines.map { it.text }, summary); uploadDebug(if (mergeable) "merged" else "appraisal", lines, summary, bmp) }
            val screen = when {
                mergeable -> { val d = lastDetail!!; ResultStore.Result.Screen(info.copy(moves = d.moves.ifEmpty { info.moves }, species = info.species ?: d.species, caughtOn = info.caughtOn ?: d.caughtOn), reading.appraisal, chosenSpecies ?: info.species, merged = true, stars = reading.stars, levels = lastLevels, barDetail = reading.detail) }
                info.cp != null || info.species != null -> ResultStore.Result.Screen(info, reading.appraisal, info.species, stars = reading.stars, barDetail = reading.detail)
                else -> ResultStore.Result.Screen(null, reading.appraisal, null, stars = reading.stars, barDetail = reading.detail)
            }
            show(screen, viaActivity)
            return
        }
        if (info.kind == ScreenInfo.Kind.UNKNOWN) {
            if (prefs.debugMode) { DebugLog.add(this, "unknown", lines.map { it.text }, "포켓몬 화면 아님"); uploadDebug("unknown", lines, "포켓몬 화면 아님", bmp) }
            show(ResultStore.Result.Error("포켓몬 상세 화면을 찾지 못했습니다 (CP·이름 없음)"), viaActivity); return
        }
        // 상세 화면: 강화 비용(별의모래·사탕·XL)으로 레벨 범위를 좁힌다
        val pu = PowerUp.parse(lines, bmp.height)
        val levels = PowerUp.levelsForCost(pu.stardust, pu.candy, pu.xlCandy).takeIf { it.isNotEmpty() }
        lastDetail = info; lastDetailAt = now; lastLevels = levels; chosenSpecies = info.species
        // 새 상세 화면(다른 CP)이면 이전 평가 판독은 버린다
        lastAppraisal = null; lastStars = null
        val summary = "CP${info.cp}${if (info.cpTruncated) "(잘림)" else ""} HP${info.hp} 종=${info.species?.nameKr ?: "?"}(${(info.nameScore * 100).toInt()}%) 후보=${info.speciesCandidates.map { it.nameKr }} 기술=${info.moves.joinToString("/") { it.nameKr }} 강화=${pu.stardust}/${pu.candy}/${pu.xlCandy}XL → L${levels?.joinToString(",") ?: "?"} 포획일=${info.caughtOn ?: "?"}"
        if (prefs.debugMode) { DebugLog.add(this, "detail", lines.map { it.text }, summary); uploadDebug("detail", lines, summary, bmp) }
        show(ResultStore.Result.Screen(info, null, chosenSpecies, levels = levels), viaActivity)
    }

    // ─── 디버그 업로드 (4-D): 상단 상태바(6%) + 포획 장소·날짜 줄의 OCR 박스만 가림(고정 영역 가림 폐지 — HP 막대를 덮었음).
    //     해당 줄 텍스트는 업로드 OCR 목록에서 제외한다. 폭 720 축소 → JPEG 75 → 서버 (기기 토큰) ───
    private fun uploadDebug(kind: String, lines: List<com.pogodoctor.core.OcrLine>, result: String, bmp: Bitmap) {
        if (!prefs.isPaired) return
        scope.launch(Dispatchers.IO) {
            try {
                val scale = minOf(1.0, 720.0 / bmp.width)
                val w = (bmp.width * scale).toInt(); val h = (bmp.height * scale).toInt()
                val small = Bitmap.createScaledBitmap(bmp, w, h, true).copy(Bitmap.Config.ARGB_8888, true)
                val canvas = Canvas(small); val paint = Paint().apply { color = Color.BLACK }
                canvas.drawRect(0f, 0f, w.toFloat(), h * 0.06f, paint)                       // 상태바(시계·알림)
                val caught = lines.filter { ScreenParser.isCaughtLine(it) }
                for (l in caught) {
                    val pad = maxOf(6, l.height / 2)
                    canvas.drawRect(0f, ((l.top - pad) * scale).toFloat(), w.toFloat(), ((l.bottom + pad) * scale).toFloat(), paint) // 포획 장소·날짜 줄 (가로 전체)
                }
                val ocr = lines.filter { !ScreenParser.isCaughtLine(it) }.map { it.text }
                val out = java.io.ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG, 75, out)
                val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                Api(prefs).uploadDebug(kind, ocr, result + (if (caught.isNotEmpty()) " · 포획 줄 ${caught.size}개 가림" else ""), b64)
            } catch (e: Exception) { DebugLog.add(this@CaptureService, "upload-error", emptyList(), kind, e.toString()) }
        }
    }

    private fun show(result: ResultStore.Result, viaActivity: Boolean) {
        ResultStore.publish(result)
        // 4-A: 서버 판정 비동기 요청 → 결과 화면 갱신 (액티비티는 ResultStore 리스너로, 오버레이 카드는 다시 그린다)
        if (result is ResultStore.Result.Screen && result.info != null) VerdictFetch.start(scope, this, repo, prefs, result) { if (!viaActivity && card != null) showCard() }
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
            override fun onChooseSpecies(sp: SpeciesRef) { chosenSpecies = sp; val cur = ResultStore.current as? ResultStore.Result.Screen ?: return; val next = cur.copy(chosen = sp, verdict = null, verdictError = null); ResultStore.current = next; showCard(); VerdictFetch.start(scope, this@CaptureService, repo, prefs, next) { if (this@CaptureService.card != null) showCard() } }
            override fun onSave(info: ScreenInfo, sp: SpeciesRef, c: ResultCard.Computed, status: String, tags: List<String>, purposes: List<String>) {
                val row = card.buildRow(info, sp, c, status, tags, purposes)
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { Api(prefs).savePokemon(row) }
                        toast(if (status == "keep") (if (tags.isNotEmpty()) "보관 저장 · 태그: ${tags.joinToString(", ")}" else "보관에 저장했습니다 — 웹 내 목록에 표시됩니다") else "박사행으로 저장했습니다")
                        hideCard(); lastDetail = null; lastAppraisal = null; lastStars = null; lastLevels = null; chosenSpecies = null; ResultStore.current = null
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
        if (scanning) stopScan()
        running = false; scanning = false
        handler.removeCallbacks(delayedCapture); handler.removeCallbacks(scanTick); hideStrip()
        hideCard(); bubble?.let { runCatching { wm.removeView(it) } }; bubble = null
        display?.release(); reader?.close(); projection?.stop()
        scope.cancel()
        super.onDestroy()
    }
}
