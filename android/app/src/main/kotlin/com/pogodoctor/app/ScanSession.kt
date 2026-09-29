package com.pogodoctor.app

import android.graphics.Bitmap
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 4-B 연속 스캔 세션 상태·순수 로직 (프레임 지문, 안정 판정, 중복 키, 측정값). 서비스가 캡처·OCR·API 를 붙인다.
// 절대 규칙: 화면을 읽기만 한다. 터치·스와이프 자동 조작 없음.
class ScanSession(val id: String = newId()) {
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
        fun scanKey(sp: SpeciesRef, cp: Int?, hp: Int?, ap: Appraisal?, shadow: Boolean) =
            listOf(sp.id, sp.form, cp ?: "", hp ?: "", ap?.atk ?: "", ap?.def ?: "", ap?.sta ?: "", if (shadow) 1 else 0).joinToString("|")
    }

    data class Metrics(var frames: Int = 0, var analyses: Int = 0, var recorded: Int = 0, var duplicates: Int = 0, var skippedNoCp: Int = 0,
                       var captureMs: Long = 0, var fpMs: Long = 0, var ocrMs: Long = 0, var barMs: Long = 0, var apiMs: Long = 0, var apiFail: Int = 0,
                       val startedAt: Long = System.currentTimeMillis(), var batteryStart: Int = -1, var batteryEnd: Int = -1) {
        fun report(): String {
            val min = (System.currentTimeMillis() - startedAt) / 60000.0
            val a = maxOf(1, analyses)
            return "세션 ${"%.1f".format(min)}분 · 프레임 $frames · 분석 $analyses · 기록 $recorded (중복 $duplicates, CP 가림 대기 $skippedNoCp) · " +
                "평균 ms: 캡처 ${captureMs / maxOf(1, frames)} 지문 ${fpMs / maxOf(1, frames)} OCR ${ocrMs / a} 막대 ${barMs / a} API ${apiMs / maxOf(1, recorded)} (실패 $apiFail) · " +
                "배터리 ${if (batteryStart >= 0) "$batteryStart% → $batteryEnd%" else "?"}"
        }
    }

    val metrics = Metrics()
    private val keys = HashSet<String>()
    var lastFp: IntArray? = null
    var stableCount = 0
    var lastAnalyzedFp: IntArray? = null
    var lastBars: Appraisal? = null
    @Volatile var lastLine: String = "스캔 대기 — 평가 화면을 넘기세요"

    // 새 프레임 지문 → 분석해야 하는지 (연속 2프레임 동일 + 직전 분석 프레임과 다름)
    fun shouldAnalyze(fp: IntArray): Boolean {
        val stable = same(lastFp, fp)
        stableCount = if (stable) stableCount + 1 else 0
        lastFp = fp
        if (stableCount < 1) return false                 // 연속 2프레임 동일 (이전 + 현재)
        if (same(lastAnalyzedFp, fp)) return false        // 이미 분석한 화면
        return true
    }

    fun isDuplicate(key: String): Boolean = !keys.add(key)

    // 스캔 항목 본문 (/api/device/scan). 기술은 읽지 않는다. 포획 장소 없음(날짜만)
    fun body(sp: SpeciesRef, info: ScreenInfo, ap: Appraisal, cands: List<IvCalc.Candidate>, stars: Int?, recheck: Boolean): JSONObject {
        val b = JSONObject().put("session_id", id).put("species_id", sp.id).put("form", sp.form).put("name_kr", sp.nameKr)
        info.cp?.let { b.put("cp", it) }; info.hp?.let { b.put("hp", it) }
        b.put("atk_iv", ap.atk).put("def_iv", ap.def).put("sta_iv", ap.sta)
        if (cands.size == 1) b.put("level", cands[0].level)
        stars?.let { b.put("stars", it) }
        info.caughtOn?.let { b.put("caught_on", it) }
        b.put("recheck", recheck)
        if (cands.isNotEmpty()) { val arr = JSONArray(); for (c in cands.take(100)) arr.put(JSONObject().put("level", c.level).put("atk", c.atk).put("def", c.def).put("sta", c.sta)); b.put("ivCandidates", arr) }
        return b
    }
}
