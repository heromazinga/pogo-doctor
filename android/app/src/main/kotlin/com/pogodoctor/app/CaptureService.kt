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
import com.pogodoctor.core.ScanGate
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
        if (queue.pending > 0) queue.start(scope)   // 4-B2: 이전에 남은 전송 대기열 이어서 전송
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

    // ─── 4-B 연속 스캔 (4-B2 개정): 초당 2~3프레임 샘플 → 픽셀 기반 평가 화면 판별(막대 띠 존재) → 지문이 scanStableMs(500ms) 이상 안정 → OCR·막대 1회 분석
    //     → 로컬 확정(✅ 기록 n, 진동) → 전송 대기열(ScanQueue)에 넣고 즉시 다음 프레임. 스캔 루프는 서버 응답을 기다리지 않는다.
    //     결과 액티비티는 띄우지 않는다(게임 조작 방해 금지). 자동 저장 없음(서버 스캔 기록만). 기술은 읽지 않는다.
    private fun batteryPct(): Int = try { getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) } catch (_: Exception) { -1 }
    private val queue: ScanQueue by lazy { ScanQueue(this, prefs).also { q -> q.onChange = { handler.post { if (scanning) refreshScanLine() } } } }
    private var scanStartedAt = 0L
    private fun startScan() {
        val session = ScanSession(); session.metrics.batteryStart = batteryPct()
        scan = session; scanning = true; scanStartedAt = System.currentTimeMillis(); gate = ScanGate(prefs.scanStableMs.toLong(), 3, 300)
        hideCard(); bubble?.text = "📷"
        if (prefs.scanStrip) showStrip()   // 상단 띠는 기본 끔(설정에서 켜기). 결과는 알림 한 줄
        queue.start(scope)
        refreshScanLine("평가 화면(막대 3개)을 켜고 좌우로 넘기세요")
        DebugLog.add(this, "scan", emptyList(), "연속 스캔 시작 세션 ${session.id} 간격 ${prefs.scanIntervalMs}ms 안정 ${prefs.scanStableMs}ms 대기열 ${queue.pending}")
        handler.removeCallbacks(scanTick); handler.post(scanTick)
    }
    private fun stopScan() {
        val session = scan ?: return
        handler.removeCallbacks(scanTick)
        scanning = false; scan = null; scanBusy = false
        session.metrics.batteryEnd = batteryPct()
        session.metrics.queueSent = queue.sent; session.metrics.queuePending = queue.pending; session.metrics.queueFailed = queue.failedAttempts
        val report = session.metrics.report()
        prefs.lastScanReport = "${session.id}: $report"
        DebugLog.add(this, "scan", emptyList(), "연속 스캔 종료 — $report")
        // 세션 측정값도 서버에 남긴다(대기열 경유, 웹 스캔 기록에서 표시)
        queue.enqueue("session", session.sessionBody()); queue.start(scope)
        hideStrip(); bubble?.text = "⚡"
        updateNotification("스캔 종료 · 기록 ${session.metrics.recorded}건 · 전송 대기 ${queue.pending} — 웹 내 목록 → 📷 스캔 기록에서 검토·저장")
        toast("연속 스캔 종료: 기록 ${session.metrics.recorded}건 (웹 📷 스캔 기록에서 저장)")
    }
    private fun refreshScanLine(head: String? = null) {
        val session = scan ?: return
        val base = head ?: session.lastLine
        val line = "✅ 기록 ${session.metrics.recorded} · 전송 ${queue.sent}/대기 ${queue.pending}${queue.lastError?.let { " (오류: ${it.take(30)})" } ?: ""} · $base"
        setStrip(line); updateNotification(line)
    }
    private fun vibrateShort() {
        if (!prefs.scanVibrate) return
        try {
            val v = if (Build.VERSION.SDK_INT >= 31) (getSystemService(android.os.VibratorManager::class.java)).defaultVibrator else @Suppress("DEPRECATION") getSystemService(android.os.Vibrator::class.java)
            v.vibrate(android.os.VibrationEffect.createOneShot(40, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) {}
    }
    private val scanTick = object : Runnable {
        override fun run() {
            if (!scanning) return
            if (!scanBusy) scanFrame()
            handler.postDelayed(this, prefs.scanIntervalMs.toLong())
        }
    }
    // 4-B3 게이트: 막대 3개 판독값 + 이름 줄 해시 서명이 직전 확정과 다르고 scanStableMs(400) 동안 동일하면 분석
    private var gate: ScanGate? = null
    private var parserCache: Pair<String?, ScreenParser>? = null
    private fun parserFor(data: DataRepo.Data): ScreenParser {
        val c = parserCache
        if (c != null && c.first == data.generatedAt) return c.second
        return ScreenParser(data.species, data.allMoveNamesKr).also { parserCache = data.generatedAt to it }
    }
    private fun scanFrame() {
        val session = scan ?: return
        val g = gate ?: ScanGate(prefs.scanStableMs.toLong(), 3, 300).also { gate = it }
        scanBusy = true
        scope.launch {
            try {
                val t0 = System.currentTimeMillis()
                // 시작 직후 1.5초는 알림창·타일 패널이 닫히는 중이므로 프레임 제외
                if (t0 - scanStartedAt < 1500) return@launch
                val bmp = captureOnce() ?: return@launch
                val t1 = System.currentTimeMillis()
                val band = session.nameBand ?: ScanSession.defaultBand(bmp.width, bmp.height)
                val sig = withContext(Dispatchers.Default) { ScanSession.signature(bmp, band) }
                val t2 = System.currentTimeMillis()
                session.metrics.frames++; session.metrics.captureMs += t1 - t0; session.metrics.fpMs += t2 - t1
                val d = g.offer(sig, t2)
                when (d.reason) {
                    ScanGate.Reason.NOT_APPRAISAL -> { session.metrics.gateNotAppraisal++; return@launch }
                    ScanGate.Reason.UNSTABLE -> {
                        session.metrics.gateUnstable++
                        // 서명이 2초 이상 계속 바뀌면(게이트 장기 대기) 디버그 모드에서 5초에 1장 업로드 (세션 최대 20장)
                        if (prefs.debugMode && g.waitingTooLong(t2, 2000) && t2 - session.lastWaitUploadAt > 5000 && session.metrics.debugUploads < prefs.scanDebugMax) {
                            session.lastWaitUploadAt = t2; session.metrics.debugUploads++
                            uploadDebug("scan-wait", emptyList(), "게이트 대기 ≥2s · 서명 막대 ${sig.atk}/${sig.def}/${sig.sta} 이름해시 ${sig.nameHash}", bmp)
                        }
                        return@launch
                    }
                    ScanGate.Reason.SAME_AS_CONFIRMED -> { session.metrics.gateSame++; return@launch }
                    ScanGate.Reason.OPEN -> { session.metrics.gateOpen++ }
                }
                if (averageBrightness(bmp) <= BLACK_THRESHOLD) { session.lastLine = "⛔ 캡처 차단(검은 화면)"; refreshScanLine(); return@launch }
                g.confirm(sig, t2)   // 시도 기록. 성공하면 scanAnalyze 가 g.close(), 종 미확정이면 300ms 간격 최대 2회 재시도 후 닫음
                scanAnalyze(session, bmp, sig, g)
            } catch (e: Exception) {
                DebugLog.add(this@CaptureService, "scan-error", emptyList(), "", e.toString())
            } finally { scanBusy = false }
        }
    }
    private fun scanFail(session: ScanSession, why: String, lines: List<com.pogodoctor.core.OcrLine>, bmp: Bitmap, detail: String) {
        session.lastLine = why; refreshScanLine()
        if (prefs.debugMode && session.metrics.debugUploads < prefs.scanDebugMax) { session.metrics.debugUploads++; uploadDebug("scan-fail", lines, "$why · $detail", bmp) }
    }
    private suspend fun scanAnalyze(session: ScanSession, bmp: Bitmap, sig: ScanGate.Signature, g: ScanGate) {
        val data = repo.loadCached() ?: return
        val t0 = System.currentTimeMillis()
        val lines = Ocr.recognize(bmp)
        val t1 = System.currentTimeMillis()
        val parser = parserFor(data)
        var info = parser.parse(lines)
        val t2 = System.currentTimeMillis()
        session.metrics.analyses++; session.metrics.ocrMs += t1 - t0; session.metrics.parseMs += t2 - t1
        if (info.kind != ScreenInfo.Kind.APPRAISAL) { g.close(); session.metrics.failNotAppraisal++; scanFail(session, "평가 화면(막대 3개)이 아닙니다", lines, bmp, "OCR 라벨 없음"); return }
        val labels = lines.filter { ScreenParser.isLabelLine(it) }
        val reading = withContext(Dispatchers.Default) { BarReader.readAppraisal({ x, y -> if (x in 0 until bmp.width && y in 0 until bmp.height) bmp.getPixel(x, y) else 0 }, bmp.width, bmp.height, labels) }
        val t3 = System.currentTimeMillis()
        session.metrics.barMs += t3 - t2
        var ap = reading.appraisal
        if (ap.atk == null || ap.def == null || ap.sta == null) { g.close(); session.metrics.failNotAppraisal++; scanFail(session, "막대 판독 실패", lines, bmp, reading.detail); return }
        info = parser.parse(lines, ap)
        // 4-B4: 비율 판독이 기본. 라벨 y 판독(alt)과 다르면 CP/HP 역산으로 검증해 성립하는 쪽을 쓴다(둘 다 모순이면 기본값 + 재확인)
        var altUsed = false
        val altAp = reading.alt
        if (reading.mismatch && altAp != null && info.cp != null) {
            val spTry = info.species ?: info.speciesCandidates.firstOrNull()
            if (spTry != null) {
                val baseTry = IvCalc.Base(spTry.atk, spTry.def, spTry.sta)
                val okPrimary = IvCalc.consistent(baseTry, info.cp, info.hp, ap)
                val okAlt = IvCalc.consistent(baseTry, info.cp, info.hp, altAp)
                if (!okPrimary && okAlt) { ap = altAp; altUsed = true; info = parser.parse(lines, ap) }
            }
        }
        val apA = ap.atk; val apD = ap.def; val apS = ap.sta   // 다른 모듈의 public 프로퍼티는 스마트 캐스트 불가 → 지역 val
        if (apA == null || apD == null || apS == null) { g.close(); session.metrics.failNotAppraisal++; scanFail(session, "막대 판독 실패", lines, bmp, reading.detail); return }
        session.metrics.parseMs += System.currentTimeMillis() - t3
        // 이름 줄 띠 학습: 인식된 이름 줄의 박스(위아래 여유 4px)를 다음 프레임 서명에 사용
        info.nameRaw?.let { raw -> lines.firstOrNull { it.text.trim() == raw }?.let { l -> if (l.height in 10..200) session.nameBand = intArrayOf(l.top - 4, l.bottom + 4, maxOf(0, l.left - 8), l.right + 8) } }
        val sp = info.species
        var spResolved = sp; var forcedRecheck = false
        if (spResolved == null) {
            if (!g.retriesExhausted) { session.metrics.failNoSpecies++; session.lastLine = "종 미인식(${info.nameRaw ?: "?"}) · 재시도 ${g.attempts}/3"; refreshScanLine(); return }   // 300ms 뒤 같은 서명으로 재시도
            // 재시도 소진: CP/HP·막대와 성립하는 후보가 있으면 그 종으로 "재확인 필요" 기록, 없으면 기록 불가(종 없이는 저장 못 함)
            g.close()
            val cand = info.speciesCandidates.firstOrNull()
            if (cand == null) { session.metrics.failNoSpecies++; scanFail(session, "종 미인식(${info.nameRaw ?: "?"}) · 후보 없음 (재시도 3회)", lines, bmp, "막대 ${reading.detail}"); return }
            spResolved = cand; forcedRecheck = true
            session.metrics.failNoSpecies++
        }
        val spFinal: SpeciesRef = spResolved
        val cp = info.cp
        // CP 가 배너에 가려진 프레임도 막대+HP 로 레벨 범위 기록("CP 미확인"). 같은 개체를 이후 CP 까지 읽으면 서버가 그 기록을 갱신한다
        if (cp == null) { session.metrics.skippedNoCp++; session.metrics.failNoCp++ }
        val key = ScanSession.scanKey(spFinal, cp, info.hp, ap, false)
        if (session.isDuplicate(key)) { g.close(); session.metrics.duplicates++; session.metrics.failDuplicate++; session.lastLine = "같은 개체(이미 기록)"; refreshScanLine(); return }
        // CP/HP 로 레벨 교차 확인: 막대 개체값과 성립하는 후보가 없으면 "재확인 필요"
        val base = IvCalc.Base(spFinal.atk, spFinal.def, spFinal.sta)
        var cands: List<IvCalc.Candidate> = if (cp != null) IvCalc.filterByAppraisal(IvCalc.candidates(base, cp, info.hp), apA, apD, apS) else emptyList()
        val recheck = forcedRecheck || (cp != null && cands.isEmpty())
        if (recheck) session.metrics.failMismatch++
        if (cands.isEmpty()) cands = IvCalc.candidatesWithoutCp(base, info.hp, ap)
        val pct = Math.round((apA + apD + apS) * 100.0 / 45)
        val body = session.body(spFinal, info, ap, cands, reading.stars, recheck)
        // 로컬 확정 → 대기열 (서버 응답을 기다리지 않는다)
        session.metrics.recorded++
        g.close()
        queue.enqueue("item", body); queue.start(scope)
        // 진동은 "새 기록"에만: 같은 개체의 CP 보완(앞서 CP 미확인으로 기록된 것)은 진동 없이 문구만 갱신
        val cpFill = cp != null && session.isCpFill(spFinal, info.hp, ap)
        if (!cpFill) vibrateShort()
        session.lastLine = "${if (cpFill) "CP 보완" else "방금"} ${spFinal.nameKr} ${pct}%${if (cp == null) " (CP 미확인)" else " CP$cp"}${if (recheck) " ⚠️재확인" else ""}${if (altUsed) " (라벨행 값 채택)" else ""}"
        refreshScanLine()
        if (prefs.debugMode) {
            DebugLog.add(this, "scan-item", lines.map { it.text }, "$key 막대 ${reading.detail} 서명 ${sig.atk}/${sig.def}/${sig.sta} 후보 ${cands.size} 재확인=$recheck")
            if (recheck && session.metrics.debugUploads < prefs.scanDebugMax) { session.metrics.debugUploads++; uploadDebug("scan-fail", lines, "막대-CP 모순 $key · ${reading.detail}", bmp) }
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
        queue.stop()   // 남은 대기열은 파일에 보존됨 (다음 시작 때 전송)
        running = false; scanning = false
        handler.removeCallbacks(delayedCapture); handler.removeCallbacks(scanTick); hideStrip()
        hideCard(); bubble?.let { runCatching { wm.removeView(it) } }; bubble = null
        display?.release(); reader?.close(); projection?.stop()
        scope.cancel()
        super.onDestroy()
    }
}
