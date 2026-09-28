package com.pogodoctor.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 디버그 모드: 최근 캡처의 OCR 텍스트·인식 결과·오류를 기기 안에 보관 (최대 30건). 이미지·토큰은 저장하지 않는다.
// (서버 업로드·웹 디버그 화면은 후속 PR — 3-0 보완 병합 후 별도 테이블 필요)
object DebugLog {
    private const val MAX = 30
    private fun file(ctx: Context) = File(ctx.filesDir, "debug-log.json")

    @Synchronized fun add(ctx: Context, kind: String, ocr: List<String>, result: String, error: String? = null) {
        val arr = read(ctx)
        val entry = JSONObject().put("at", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).format(Date())).put("kind", kind)
            .put("ocr", JSONArray(ocr)).put("result", result).put("error", error ?: JSONObject.NULL)
        arr.put(entry)
        val trimmed = JSONArray()
        for (i in maxOf(0, arr.length() - MAX) until arr.length()) trimmed.put(arr.get(i))
        file(ctx).writeText(trimmed.toString())
    }

    fun read(ctx: Context): JSONArray = try { JSONArray(file(ctx).takeIf { it.exists() }?.readText() ?: "[]") } catch (_: Exception) { JSONArray() }
    fun clear(ctx: Context) { file(ctx).delete() }

    fun asText(ctx: Context): String {
        val arr = read(ctx); val sb = StringBuilder()
        for (i in arr.length() - 1 downTo 0) {
            val e = arr.getJSONObject(i)
            sb.append("[${e.optString("at")}] ${e.optString("kind")}\n결과: ${e.optString("result")}\n")
            if (!e.isNull("error")) sb.append("오류: ${e.optString("error")}\n")
            val ocr = e.optJSONArray("ocr"); if (ocr != null) sb.append("OCR: ").append((0 until ocr.length()).joinToString(" | ") { ocr.getString(it) }).append("\n")
            sb.append("\n")
        }
        return sb.toString()
    }
}
