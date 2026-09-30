package com.pogodoctor.app

import android.graphics.Bitmap
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.BarReader
import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.ScanGate
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 4-B 연속 스캔 세션 상태·순수 로직 (프레임 지문, 안정 판정, 중복 키, 측정값). 서비스가 캡처·OCR·API 를 붙인다.
// 절대 규칙: 화면을 읽기만 한다. 터치·스와이프 자동 조작 없음.
// mode(4-D): normal | shadow | purified — 세션 동안 고정. shadow 면 기록에 is_shadow=true(섀도 판정), purified 면 is_purified=true
// fullSync(4-F.2): 검색어 없이 보관함 전체를 넘기는 "전체 동기화" 세션 — 서버 metrics.fullSync 로 표시, 웹이 종료 후 "다시 보이지 않은 기록 숨김" 을 제안
class ScanSession(val id: String = newId(), val mode: String = "normal", val fullSync: Boolean = false) {
    val isShadow: Boolean get() = mode == "shadow"
    val isPurified: Boolean get() = mode == "purified"
    val modeLabel: String get() = when (mode) { "shadow" -> "섀도"; "purified" -> "정화"; else -> "일반" }
    companion object {
        fun newId(): String = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date()) + "-" + (1000 + (Math.random() * 9000).toInt())

        // 프레임 지문: 이름·CP 영역(상단 6~30%) + 막대 영역(70~82%) 을 격자 샘플링해 밝기 합을 블록별로 담는다. 값 차이가 임계 이상이면 "변화"
        fun fingerprint(bmp: Bitmap): IntArray {
            val w = bmp.width; val h = bmp.height
            val out = IntArray(2 * 8 * 4)
            var i = 0
            for ((y0, y1) in listOf(0.06 to 0.30, 0.70 to 0.82)) {
                val ys = (h * y0).toInt(); val ye = (h * y1).toInt()
                for (bx in 0 until 8) for (by in 0 until 4) {
                    var sum = 0L; var n = 0
                    val xs = w * bx / 8; val xe = w * (bx + 1) / 8
                    val bys = ys + (ye - ys) * by / 4; val bye = ys + (ye - ys) * (by + 1) / 4
                    var y = bys
                    while (y < bye) { var x = xs; while (x < xe) { val c = bmp.getPixel(x, y); sum += ((c shr 16) and 255) + ((c shr 8) and 255) + (c and 255); n++; x += 6 }; y += 6 }
                    out[i++] = if (n == 0) 0 else (sum / n).toInt()
                }
            }
            return out
        }
        fun same(a: IntArray?, b: IntArray?, tol: Int = 6): Boolean {
            if (a == null || b == null || a.size != b.size) return false
            var diff = 0
            for (k in a.indices) if (Math.abs(a[k] - b[k]) > tol) diff++
            return diff <= 1 // 블록 1개까지 허용(애니메이션 잔여)
        }
        // 4-B3 서명: 막대 3개 비율 위치 판독값 + 이름 줄 띠 해시 (모델·배경 제외)
        fun signature(bmp: Bitmap, band: IntArray): ScanGate.Signature {
            val px = BarReader.PixelSource { x, y -> bmp.getPixel(x, y) }
            val a = BarReader.readByRatio(px, bmp.width, bmp.height, BarReader.Y_ATK).value
            val d = BarReader.readByRatio(px, bmp.width, bmp.height, BarReader.Y_DEF).value
            val st = BarReader.readByRatio(px, bmp.width, bmp.height, BarReader.Y_STA).value
            return ScanGate.Signature(a, d, st, bandHash(bmp, band))
        }
        // 띠(top,bottom,left,right) 를 4px 격자로 샘플링, 밝기를 8단계로 양자화해 FNV-1a 해시 (안티앨리어싱 잡음 내성)
        fun bandHash(bmp: Bitmap, band: IntArray): Long {
            var h = 0xcbf29ce484222325uL
            val top = band[0].coerceIn(0, bmp.height - 1); val bottom = band[1].coerceIn(top + 1, bmp.height)
            val left = band[2].coerceIn(0, bmp.width - 1); val right = band[3].coerceIn(left + 1, bmp.width)
            var y = top
            while (y < bottom) { var x = left; while (x < right) { val c = bmp.getPixel(x, y); val lum = (((c shr 16) and 255) * 3 + ((c shr 8) and 255) * 6 + (c and 255)) / 10; h = (h xor (lum / 32).toULong()) * 0x100000001b3uL; x += 4 }; y += 4 }
            return h.toLong()
        }
        // 기본 이름 줄 띠 (A90 720×1600 기준 비율: 이름 y 0.42~0.48H, x 0.10~0.90W). OCR 로 이름 줄 박스를 읽으면 그 위치로 갱신
        fun defaultBand(w: Int, h: Int) = intArrayOf((h * 0.42).toInt(), (h * 0.48).toInt(), (w * 0.10).toInt(), (w * 0.90).toInt())
        fun scanKey(sp: SpeciesRef, cp: Int?, hp: Int?, ap: Appraisal?, shadow: Boolean) =
            listOf(sp.id, sp.form, cp ?: "", hp ?: "", ap?.atk ?: "", ap?.def ?: "", ap?.sta ?: "", if (shadow) 1 else 0).joinToString("|")
    }

    data class Metrics(var frames: Int = 0, var analyses: Int = 0, var recorded: Int = 0, var duplicates: Int = 0, var skippedNoCp: Int = 0, var prefiltered: Int = 0,
                       var captureMs: Long = 0, var fpMs: Long = 0, var prefilterMs: Long = 0, var ocrMs: Long = 0, var parseMs: Long = 0, var barMs: Long = 0,
                       // 4-B3 게이트 미개방 사유 / 분석 실패 사유
                       var gateUnstable: Int = 0, var gateSame: Int = 0, var gateNotAppraisal: Int = 0, var gateOpen: Int = 0,
                       var failNotAppraisal: Int = 0, var failNoSpecies: Int = 0, var failNoCp: Int = 0, var failMismatch: Int = 0, var failDuplicate: Int = 0, var debugUploads: Int = 0, var cpRejected: Int = 0,
                       var queueSent: Int = 0, var queuePending: Int = 0, var queueFailed: Int = 0,
                       val startedAt: Long = System.currentTimeMillis(), var batteryStart: Int = -1, var batteryEnd: Int = -1) {
        val minutes: Double get() = (System.currentTimeMillis() - startedAt) / 60000.0
        fun report(): String {
            val a = maxOf(1, analyses); val f = maxOf(1, frames)
            return "세션 ${"%.1f".format(minutes)}분 · 프레임 $frames · 게이트(불안정 $gateUnstable/동일 $gateSame/평가 아님 $gateNotAppraisal/열림 $gateOpen) · 분석 $analyses · 기록 $recorded · " +
                "실패(평가 아님 $failNotAppraisal/종 미확정 $failNoSpecies/CP 없음 $failNoCp(검증 탈락 $cpRejected)/막대-HP 모순 $failMismatch/중복 $failDuplicate) · " +
                "평균 ms: 캡처 ${captureMs / f} 서명 ${fpMs / f} OCR ${ocrMs / a} 파싱 ${parseMs / a} 막대 ${barMs / a} · " +
                "전송 $queueSent/대기 $queuePending(실패 시도 $queueFailed) · 배터리 ${if (batteryStart >= 0) "$batteryStart% → $batteryEnd%" else "?"}"
        }
        fun json(): JSONObject = JSONObject().put("minutes", Math.round(minutes * 10) / 10.0).put("frames", frames).put("prefiltered", prefiltered).put("analyses", analyses).put("recorded", recorded)
            .put("duplicates", duplicates).put("noCp", skippedNoCp).put("avgMs", JSONObject().put("capture", captureMs / maxOf(1, frames)).put("fingerprint", fpMs / maxOf(1, frames)).put("prefilter", prefilterMs / maxOf(1, frames))
            .put("ocr", ocrMs / maxOf(1, analyses)).put("parse", parseMs / maxOf(1, analyses)).put("bars", barMs / maxOf(1, analyses)))
            .put("gate", JSONObject().put("unstable", gateUnstable).put("same", gateSame).put("notAppraisal", gateNotAppraisal).put("open", gateOpen))
            .put("fail", JSONObject().put("notAppraisal", failNotAppraisal).put("noSpecies", failNoSpecies).put("noCp", failNoCp).put("mismatch", failMismatch).put("duplicate", failDuplicate))
            .put("debugUploads", debugUploads).put("cpRejected", cpRejected)
            .put("queue", JSONObject().put("sent", queueSent).put("pending", queuePending).put("failedAttempts", queueFailed))
            .put("battery", JSONObject().put("start", batteryStart).put("end", batteryEnd))
    }

    val metrics = Metrics()
    private val keys = HashSet<String>()
    var nameBand: IntArray? = null          // 이름 줄 띠 (OCR 로 학습, 없으면 기본 비율)
    var lastWaitUploadAt = 0L
    @Volatile var lastLine: String = "스캔 대기 — 평가 화면을 넘기세요"

    fun sessionBody(): JSONObject = JSONObject().put("session_id", id).put("metrics", metrics.json().put("fullSync", fullSync).put("mode", mode)).put("started_at", metrics.startedAt).put("ended_at", System.currentTimeMillis())

    fun isDuplicate(key: String): Boolean = !keys.add(key)
    // 이 세션에서 같은 종·HP·막대로 CP 없이 기록된 적이 있으면 → 이번 기록은 CP 보완(서버 cpFilled)
    fun isCpFill(sp: SpeciesRef, hp: Int?, ap: Appraisal?): Boolean = keys.contains(scanKey(sp, null, hp, ap, isShadow))

    // 스캔 항목 본문 (/api/device/scan). 기술은 읽지 않는다. 포획 장소 없음(날짜만)
    fun body(sp: SpeciesRef, info: ScreenInfo, ap: Appraisal, cands: List<IvCalc.Candidate>, stars: Int?, recheck: Boolean, recheckReason: String? = null): JSONObject {
        val b = JSONObject().put("session_id", id).put("species_id", sp.id).put("form", sp.form).put("name_kr", sp.nameKr)
            .put("app_version", BuildConfig.VERSION_NAME)                  // 4-D 신뢰 기록 판단(≥0.1.38)
            .put("is_shadow", isShadow).put("is_purified", isPurified)      // 4-D 스캔 모드
        info.cp?.let { b.put("cp", it) }; info.hp?.let { b.put("hp", it) }
        b.put("atk_iv", ap.atk).put("def_iv", ap.def).put("sta_iv", ap.sta)
        if (cands.size == 1) b.put("level", cands[0].level)
        stars?.let { b.put("stars", it) }
        info.caughtOn?.let { b.put("caught_on", it) }
        b.put("recheck", recheck)
        if (recheck && recheckReason != null) b.put("recheck_reason", recheckReason.take(80)) // 4-C.4 재확인 사유(서버 recheck_reason)
        // 4-B6: 화면에서 읽은 게임 태그 칩(알려진 태그 이름과 일치하는 OCR 줄). 있으면 서버가 박사행·검색 묶음에서 제외한다
        if (info.gameTags.isNotEmpty()) b.put("game_tags", JSONArray(info.gameTags.take(8)))
        if (cands.isNotEmpty()) { val arr = JSONArray(); for (c in cands.take(100)) arr.put(JSONObject().put("level", c.level).put("atk", c.atk).put("def", c.def).put("sta", c.sta)); b.put("ivCandidates", arr) }
        return b
    }
}
