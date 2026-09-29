package com.pogodoctor.app

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

// 4-B2 전송 대기열: 스캔 루프는 서버 응답을 절대 기다리지 않는다. 항목을 파일(JSON Lines)에 적고 워커가 순서대로 전송한다.
//  - 실패 시 지수 백오프(2s→60s) 재시도, 앱/서비스 종료 시 남은 대기열은 파일에 보존되어 다음 시작 때 이어서 전송한다.
//  - 항목 kind: "item"(/api/device/scan) | "session"(/api/device/scan/session 측정값)
class ScanQueue(private val ctx: Context, private val prefs: Prefs) {
    data class Entry(val id: Long, val kind: String, val body: JSONObject, var attempts: Int = 0)
    data class Stats(val pending: Int, val sent: Int, val failed: Int, val lastError: String?)

    private val file = File(ctx.filesDir, "scan-queue.jsonl")
    private val lock = Any()
    private val entries = ArrayList<Entry>()
    @Volatile var sent = 0; private set
    @Volatile var failedAttempts = 0; private set
    @Volatile var lastError: String? = null; private set
    @Volatile var onChange: (() -> Unit)? = null
    private var worker: Job? = null

    init { load() }

    private fun load() {
        synchronized(lock) {
            entries.clear()
            if (!file.exists()) return
            for (line in file.readLines()) {
                if (line.isBlank()) continue
                try { val o = JSONObject(line); entries.add(Entry(o.getLong("id"), o.optString("kind", "item"), o.getJSONObject("body"), o.optInt("attempts", 0))) } catch (_: Exception) {}
            }
        }
    }
    private fun persist() {
        synchronized(lock) {
            val sb = StringBuilder()
            for (e in entries) sb.append(JSONObject().put("id", e.id).put("kind", e.kind).put("body", e.body).put("attempts", e.attempts).toString()).append('\n')
            runCatching { file.writeText(sb.toString()) }
        }
    }

    val pending: Int get() = synchronized(lock) { entries.size }
    fun stats() = Stats(pending, sent, failedAttempts, lastError)

    fun enqueue(kind: String, body: JSONObject) {
        synchronized(lock) { entries.add(Entry(System.nanoTime(), kind, body)) }
        persist(); onChange?.invoke()
    }

    // 워커 시작 (이미 돌고 있으면 무시). 대기열이 빌 때까지 전송, 실패하면 백오프 후 같은 항목 재시도
    fun start(scope: CoroutineScope) {
        if (worker?.isActive == true) return
        worker = scope.launch(Dispatchers.IO) {
            var backoff = 2000L
            while (true) {
                val head = synchronized(lock) { entries.firstOrNull() } ?: break
                if (!prefs.isPaired) { lastError = "기기 연결 필요"; break }
                try {
                    val api = Api(prefs)
                    if (head.kind == "session") api.scanSession(head.body) else api.scanItem(head.body)
                    synchronized(lock) { entries.remove(head) }; persist()
                    sent++; backoff = 2000L; lastError = null
                    onChange?.invoke()
                } catch (e: Api.ApiException) {
                    // 4xx(검증 실패 등)는 재시도해도 같으므로 버린다. 401 은 토큰 문제 → 중단
                    if (e.status == 401) { lastError = "기기 토큰 무효"; break }
                    if (e.status in 400..499 && e.status != 429) { synchronized(lock) { entries.remove(head) }; persist(); lastError = "거부됨(${e.status}): ${e.message}"; failedAttempts++; onChange?.invoke(); continue }
                    head.attempts++; failedAttempts++; lastError = e.message; persist(); onChange?.invoke()
                    delay(backoff); backoff = minOf(60000L, backoff * 2)
                } catch (e: Exception) {
                    head.attempts++; failedAttempts++; lastError = e.message ?: e.toString(); persist(); onChange?.invoke()
                    delay(backoff); backoff = minOf(60000L, backoff * 2)
                }
            }
        }
    }
    fun stop() { worker?.cancel(); worker = null }
}
