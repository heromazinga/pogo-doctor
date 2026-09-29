package com.pogodoctor.app

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// 설정 저장. 기기 토큰은 Android Keystore 기반 EncryptedSharedPreferences 에만 저장한다 (평문 파일·로그에 남기지 않음)
class Prefs(ctx: Context) {
    private val plain: SharedPreferences = ctx.getSharedPreferences("pogo", Context.MODE_PRIVATE)
    private val secure: SharedPreferences = run {
        val key = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(ctx, "pogo_secure", key, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }

    var serverUrl: String
        get() {
            // 저장값·빌드 기본값이 비었거나 http(s) 가 아니면 운영 도메인으로 대체 (빈 값이면 "no protocol" 오류)
            val v = plain.getString("server_url", null)?.trim()?.trimEnd('/')
            val d = BuildConfig.DEFAULT_SERVER_URL.trim().trimEnd('/')
            return listOf(v, d).firstOrNull { it != null && (it.startsWith("https://") || it.startsWith("http://")) }
                ?: "https://pogo-doctor.vercel.app"
        }
        set(v) = plain.edit().putString("server_url", v.trim().trimEnd('/')).apply()

    var deviceToken: String?
        get() = secure.getString("device_token", null)
        set(v) = secure.edit().apply { if (v == null) remove("device_token") else putString("device_token", v) }.apply()

    var deviceName: String
        get() = plain.getString("device_name", android.os.Build.MODEL ?: "Android")!!
        set(v) = plain.edit().putString("device_name", v).apply()

    // 빠른 설정 타일·알림 "캡처" 후 실제 캡처까지 지연(ms): 알림창·트램펄린이 닫힐 시간
    var captureDelayMs: Int
        get() = plain.getInt("capture_delay_ms", 800).coerceIn(100, 5000)
        set(v) = plain.edit().putInt("capture_delay_ms", v.coerceIn(100, 5000)).apply()

    // 4-A 보관함 여유: relaxed(여유) | normal(보통) | tight(빠듯). 판정 API 에 전달
    var storageMode: String
        get() = plain.getString("storage_mode", "normal")!!.takeIf { it in listOf("relaxed", "normal", "tight") } ?: "normal"
        set(v) = plain.edit().putString("storage_mode", v).apply()

    // 4-B 연속 스캔 프레임 간격(ms): 초당 2~3프레임 샘플
    var scanIntervalMs: Int
        get() = plain.getInt("scan_interval_ms", 400).coerceIn(250, 2000)
        set(v) = plain.edit().putInt("scan_interval_ms", v.coerceIn(250, 2000)).apply()
    // 연속 스캔 안정 대기(ms): 화면 지문이 이 시간 이상 같아야 분석 (넘기는 도중·애니메이션 프레임 제외)
    var scanStableMs: Int
        get() = plain.getInt("scan_stable_ms", 400).coerceIn(200, 3000)
        set(v) = plain.edit().putInt("scan_stable_ms", v.coerceIn(200, 3000)).apply()
    var scanVibrate: Boolean
        get() = plain.getBoolean("scan_vibrate", true)
        set(v) = plain.edit().putBoolean("scan_vibrate", v).apply()
    // 연속 스캔 상단 띠 오버레이 (기본 끔: 포켓몬GO 위에서는 숨겨지므로 결과는 알림 한 줄)
    var scanStrip: Boolean
        get() = plain.getBoolean("scan_strip", false)
        set(v) = plain.edit().putBoolean("scan_strip", v).apply()
    var lastScanReport: String
        get() = plain.getString("last_scan_report", "")!!
        set(v) = plain.edit().putString("last_scan_report", v).apply()

    var debugMode: Boolean
        get() = plain.getBoolean("debug", false)
        set(v) = plain.edit().putBoolean("debug", v).apply()

    var dataUpdatedAt: Long
        get() = plain.getLong("data_updated_at", 0)
        set(v) = plain.edit().putLong("data_updated_at", v).apply()

    val isPaired: Boolean get() = !deviceToken.isNullOrBlank()
}
