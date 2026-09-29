package com.pogodoctor.app

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

// 웹앱 API 호출 (HttpURLConnection, 추가 의존 없음). 토큰 원문은 로그에 남기지 않는다.
class Api(private val prefs: Prefs) {
    class ApiException(val status: Int, message: String) : Exception(message)

    private fun request(method: String, path: String, body: JSONObject? = null, token: String? = null, timeoutMs: Int = 20000): JSONObject {
        val conn = (URL(prefs.serverUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeoutMs; readTimeout = timeoutMs
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "pogo-doctor-android/${BuildConfig.VERSION_NAME}")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json; charset=utf-8") }
        }
        try {
            if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText) ?: ""
            val json = try { JSONObject(text) } catch (_: Exception) { JSONObject().put("error", "응답 형식 오류 (HTTP $status)") }
            if (status !in 200..299) throw ApiException(status, json.optString("error", "HTTP $status") + (json.optJSONArray("details")?.let { " — " + it.join(", ") } ?: ""))
            return json
        } finally { conn.disconnect() }
    }

    fun requestRaw(path: String, timeoutMs: Int = 60000): String {
        val conn = (URL(prefs.serverUrl + path).openConnection() as HttpURLConnection).apply { connectTimeout = timeoutMs; readTimeout = timeoutMs }
        try {
            if (conn.responseCode !in 200..299) throw ApiException(conn.responseCode, "HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use(BufferedReader::readText)
        } finally { conn.disconnect() }
    }

    // 연결 코드 → 장기 토큰 (1회 반환). 성공 시 토큰을 암호화 저장
    fun pair(code: String): String {
        val res = request("POST", "/api/device/pair", JSONObject().put("code", code).put("deviceName", prefs.deviceName))
        val token = res.optString("token", "")
        if (token.isBlank()) throw ApiException(500, "토큰이 응답에 없습니다")
        prefs.deviceToken = token
        return res.optString("name", prefs.deviceName)
    }

    // 연결 상태 확인 (토큰 유효성). 401 이면 토큰 삭제
    fun status(): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        try { return request("GET", "/api/device/pokemon", token = token) }
        catch (e: ApiException) { if (e.status == 401) prefs.deviceToken = null; throw e }
    }

    // 앱 → 웹 로그인 코드 (계정 복구). 8자리·10분·1회용
    fun webLoginCode(): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        try { return request("POST", "/api/device/web-code", JSONObject(), token) }
        catch (e: ApiException) { if (e.status == 401) prefs.deviceToken = null; throw e }
    }

    // 디버그 캡처 업로드 (이미지는 상태바 가림·축소된 JPEG base64, 없으면 null)
    fun uploadDebug(kind: String, ocr: List<String>, result: String, imageBase64: String?): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        val body = JSONObject().put("kind", kind).put("ocr", org.json.JSONArray(ocr)).put("result", result)
        if (imageBase64 != null) body.put("imageBase64", imageBase64)
        return request("POST", "/api/device/debug", body, token, timeoutMs = 40000)
    }

    // 4-A 서버 판정. 기기 토큰이 있으면 내 목록과 비교(인증 선택), 없으면 종·개체만으로 판정
    fun verdict(body: JSONObject): JSONObject = request("POST", "/api/verdict", body, prefs.deviceToken, timeoutMs = 15000)

    // 4-B 연속 스캔 항목 기록 (서버가 판정 계산·저장, 자동 목록 저장 없음)
    fun scanItem(body: JSONObject): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        try { return request("POST", "/api/device/scan", body, token, timeoutMs = 15000) }
        catch (e: ApiException) { if (e.status == 401) prefs.deviceToken = null; throw e }
    }

    // 4-B2 세션 측정값 저장
    fun scanSession(body: JSONObject): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        try { return request("POST", "/api/device/scan/session", body, token, timeoutMs = 15000) }
        catch (e: ApiException) { if (e.status == 401) prefs.deviceToken = null; throw e }
    }

    fun savePokemon(row: JSONObject): JSONObject {
        val token = prefs.deviceToken ?: throw ApiException(401, "기기 연결 필요")
        try { return request("POST", "/api/device/pokemon", row, token) }
        catch (e: ApiException) { if (e.status == 401) prefs.deviceToken = null; throw e }
    }
}
