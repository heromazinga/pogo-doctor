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
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
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
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.BarReader
import com.pogodoctor.core.Fuzzy
import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.OcrLine
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.ScreenParser
import com.pogodoctor.core.SpeciesRef
import com.pogodoctor.core.Verdict
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

// 포그라운드 서비스: MediaProjection 으로 "버튼을 눌렀을 때만" 화면 1장을 캡처 → 기기 내 OCR → 결과 카드 오버레이
// 절대 규칙: 화면을 읽고 보여주기만 한다. 터치·스와이프 자동 조작 없음. 게임 계정·서버 통신 관여 없음.
class CaptureService : Service() {
    companion object {
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val ACTION_STOP = "com.pogodoctor.app.STOP"
        private const val CHANNEL = "capture"
        private const val NOTIF_ID = 1
        @Volatile var running = false
    }

    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var repo: DataRepo
    private lateinit var wm: WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val handler = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var width = 0; private var height = 0; private var dpi = 0

    private var bubble: View? = null
    private var card: View? = null
    private var busy = false

    // 마지막 인식 결과 (상세 + 평가 화면을 합쳐 개체값 확정)
    private var lastDetail: ScreenInfo? = null
    private var lastAppraisal: Appraisal? = null
    private var chosenSpecies: SpeciesRef? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this); api = Api(prefs); repo = DataRepo(this, prefs)
        wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        val code = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        @Suppress("DEPRECATION") val data: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        if (projection == null && code != 0 && data != null) {
            if (!startProjection(code, data)) { toast("화면 캡처 권한을 얻지 못했습니다"); stopSelf(); return START_NOT_STICKY }
        }
        if (bubble == null) showBubble()
        running = true
        scope.launch(Dispatchers.IO) { try { repo.refresh(api) } catch (e: Exception) { if (repo.loadCached() == null) withContext(Dispatchers.Main) { toast("포켓몬 데이터 없음: ${e.message} — 인터넷 연결 후 앱에서 '데이터 갱신'") } } }
        return START_NOT_STICKY
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notif).setContentTitle(getString(R.string.notif_title)).setContentText(getString(R.string.notif_text))
            .setContentIntent(open).addAction(Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_notif), "중지", stop).build()).setOngoing(true).build()
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

    // ─── 오버레이: 떠 있는 버튼 ───
    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun showBubble() {
        val tv = TextView(this).apply {
            text = "⚡"; textSize = 22f; gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bubble_bg)
            layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
        }
        val lp = WindowManager.LayoutParams(dp(52), dp(52), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.TOP or Gravity.START; lp.x = dp(8); lp.y = height / 2
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        tv.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> { val dx = e.rawX - downX; val dy = e.rawY - downY; if (abs(dx) > 12 || abs(dy) > 12) moved = true; lp.x = startX + dx.toInt(); lp.y = startY + dy.toInt(); wm.updateViewLayout(v, lp); true }
                MotionEvent.ACTION_UP -> { if (!moved) onBubbleTap(); true }
                else -> false
            }
        }
        wm.addView(tv, lp); bubble = tv
    }

    private fun onBubbleTap() {
        if (busy) return
        busy = true
        (bubble as? TextView)?.text = "…"
        scope.launch {
            try {
                val bmp = captureOnce() ?: run { toast("캡처 실패 (화면 프레임 없음) — 다시 눌러주세요"); return@launch }
                analyze(bmp)
            } catch (e: Exception) {
                DebugLog.add(this@CaptureService, "error", emptyList(), "", e.toString())
                toast("분석 오류: ${e.message}")
            } finally { busy = false; (bubble as? TextView)?.text = "⚡" }
        }
    }

    // ─── 분석: OCR → 파싱 → (평가 화면이면 막대 판독) → 카드 ───
    private suspend fun analyze(bmp: Bitmap) {
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
            if (lastDetail == null) { toast("평가 판독 공${bars.atk ?: "?"}/방${bars.def ?: "?"}/HP${bars.sta ?: "?"} — 상세 화면도 캡처하면 결과 카드에 합칩니다"); showCard(null); return }
            showCard(lastDetail); return
        }
        if (info.kind == ScreenInfo.Kind.UNKNOWN) {
            if (prefs.debugMode) DebugLog.add(this, "unknown", lines.map { it.text }, "포켓몬 화면 아님")
            toast("포켓몬 상세 화면을 찾지 못했습니다 (CP·이름 없음)"); return
        }
        lastDetail = info; chosenSpecies = info.species
        if (prefs.debugMode) DebugLog.add(this, "detail", lines.map { it.text }, "CP${info.cp} HP${info.hp} 종=${info.species?.nameKr ?: "?"}(${(info.nameScore * 100).toInt()}%) 기술=${info.moves.joinToString("/") { it.nameKr }}")
        showCard(info)
    }

    // ─── 결과 카드 ───
    private data class Computed(val summary: IvCalc.Summary?, val ivText: String, val verdict: Verdict.Line?, val ivs: Triple<Int, Int, Int>?)

    private fun compute(info: ScreenInfo, sp: SpeciesRef?): Computed {
        val base = sp?.let { IvCalc.Base(it.atk, it.def, it.sta) }
        if (base == null || info.cp == null) return Computed(null, "개체값: 종 또는 CP 미인식", null, null)
        var cands = IvCalc.candidates(base, info.cp!!, info.hp)
        val ap = lastAppraisal
        if (ap != null) cands = IvCalc.filterByAppraisal(cands, ap.atk, ap.def, ap.sta)
        val s = IvCalc.summarize(cands)
        val ivs: Triple<Int, Int, Int>? = when {
            ap != null && ap.atk != null && ap.def != null && ap.sta != null -> Triple(ap.atk, ap.def, ap.sta)
            s.exact -> Triple(s.candidates[0].atk, s.candidates[0].def, s.candidates[0].sta)
            else -> null
        }
        val ivText = when {
            s.empty -> "개체값: 후보 없음 (CP/HP 인식 확인)"
            ivs != null -> "개체값: ${ivs.first}/${ivs.second}/${ivs.third} (${Math.round((ivs.first + ivs.second + ivs.third) * 100.0 / 45)}%)${if (ap != null) " · 평가 화면 판독" else " · CP·HP 로 확정"}"
            else -> "개체값 후보 ${s.candidates.size}개: 공${r(s.atkRange!!)} 방${r(s.defRange!!)} HP${r(s.staRange!!)} → ${r(s.percentRange!!)}% · L${s.levelRange!!.start}~${s.levelRange.endInclusive} (평가 화면을 캡처하면 확정)"
        }
        return Computed(s, ivText, if (!s.empty) Verdict.oneLiner(base, s) else null, ivs)
    }
    private fun r(x: IntRange) = if (x.first == x.last) "${x.first}" else "${x.first}~${x.last}"

    private fun showCard(info: ScreenInfo?) {
        hideCard()
        val sp = chosenSpecies ?: info?.species
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundResource(R.drawable.card_bg); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        fun text(s: String, size: Float = 13f, color: Int = 0xFFC8D6E5.toInt(), bold: Boolean = false) = TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) setTypeface(null, Typeface.BOLD); root.addView(this) }
        if (info == null) {
            text("평가 판독만 있습니다", 14f, 0xFFFFD93D.toInt(), true)
            text("공${lastAppraisal?.atk ?: "?"} / 방${lastAppraisal?.def ?: "?"} / HP${lastAppraisal?.sta ?: "?"} — 포켓몬 상세 화면에서 ⚡ 를 다시 누르세요")
        } else {
            text("${sp?.nameKr ?: (info.nameRaw ?: "종 미인식")}  CP${info.cp ?: "?"}  HP${info.hp ?: "?"}", 16f, Color.WHITE, true)
            if (sp == null || info.nameScore < 0.85) {
                // 종 후보 3개 (닉네임·오인식 보정)
                val data = repo.loadCached()
                val names = data?.species?.map { it.nameKr } ?: emptyList()
                val q = info.nameRaw ?: ""
                val top = names.map { it to Fuzzy.similarity(q, it) }.sortedByDescending { it.second }.take(3).map { it.first }
                if (top.isNotEmpty()) {
                    text("종 선택 (인식 ${(info.nameScore * 100).toInt()}%):", 11f, 0xFFFFD93D.toInt())
                    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    for (n in top) row.addView(Button(this).apply { text = n; textSize = 12f; setOnClickListener { chosenSpecies = data!!.species.first { it.nameKr == n }; showCard(info) } })
                    root.addView(row)
                }
            }
            val c = compute(info, sp)
            text(c.ivText, 12f)
            if (info.moves.isNotEmpty()) text("기술: " + info.moves.joinToString(" / ") { it.nameKr }, 12f) else text("기술: 미인식", 12f, 0xFF8899AA.toInt())
            c.verdict?.let { text(it.raid, 12f, 0xFF4ECDC4.toInt()); if (it.league.isNotBlank()) text(it.league, 12f, 0xFFA890F0.toInt()) }
            for (w in info.warnings) text("⚠️ $w", 10f, 0xFFFFD93D.toInt())
            text("계산: 기기 내 결정적 공식 (AI 미사용)", 9f, 0xFF576574.toInt())
            val btns = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            val paired = prefs.isPaired
            btns.addView(Button(this).apply { text = "보관"; isEnabled = sp != null && paired; setOnClickListener { save(info, sp!!, c, "keep") } })
            btns.addView(Button(this).apply { text = "박사행"; isEnabled = sp != null && paired; setOnClickListener { save(info, sp!!, c, "transfer") } })
            btns.addView(Button(this).apply { text = "닫기"; setOnClickListener { hideCard() } })
            root.addView(btns)
            if (!paired) text("저장하려면 앱에서 기기 연결이 필요합니다 (웹 📱 기기 연결 → 코드 입력)", 10f, 0xFFFF6B6B.toInt())
        }
        if (info == null) root.addView(Button(this).apply { text = "닫기"; setOnClickListener { hideCard() } })
        val scroll = ScrollView(this).apply { addView(root) }
        val lp = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT)
        lp.gravity = Gravity.BOTTOM; lp.y = dp(24)
        wm.addView(scroll, lp); card = scroll
    }

    private fun hideCard() { card?.let { runCatching { wm.removeView(it) } }; card = null }

    private fun save(info: ScreenInfo, sp: SpeciesRef, c: Computed, status: String) {
        val data = repo.loadCached()
        val row = JSONObject().put("species_id", sp.id).put("form", sp.form).put("name_kr", sp.nameKr).put("cp", info.cp ?: JSONObject.NULL)
            .put("atk_iv", c.ivs?.first ?: JSONObject.NULL).put("def_iv", c.ivs?.second ?: JSONObject.NULL).put("sta_iv", c.ivs?.third ?: JSONObject.NULL)
            .put("status", status).put("purposes", JSONArray())
        // 기술은 영어 ID 로 저장 (웹앱 my_pokemon 규약). 첫 번째 기술이 빠른기술이라는 보장이 없으므로 종 데이터로 구분하지 않고 순서대로 넣는다
        val en = info.moves.mapNotNull { data?.moveKrToEn?.get(it.nameKr) }
        if (en.isNotEmpty()) row.put("fast_move", en[0])
        if (en.size > 1) row.put("charged_moves", JSONArray(en.drop(1).take(2)))
        val memo = buildString {
            append("수집기")
            if (c.ivs == null && c.summary != null && !c.summary.empty) append(" · 개체값 후보 ${r(c.summary.percentRange!!)}%")
            if (info.hp != null) append(" · HP${info.hp}")
        }
        row.put("memo", memo)
        scope.launch {
            try {
                withContext(Dispatchers.IO) { api.savePokemon(row) }
                toast(if (status == "keep") "보관에 저장했습니다 — 웹 내 목록에 표시됩니다" else "박사행으로 저장했습니다")
                hideCard(); lastDetail = null; lastAppraisal = null; chosenSpecies = null
            } catch (e: Exception) {
                DebugLog.add(this@CaptureService, "save-error", emptyList(), row.toString(), e.toString())
                toast("저장 실패: ${e.message}")
            }
        }
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    override fun onDestroy() {
        running = false
        hideCard(); bubble?.let { runCatching { wm.removeView(it) } }; bubble = null
        display?.release(); reader?.close(); projection?.stop()
        scope.cancel()
        super.onDestroy()
    }
}
