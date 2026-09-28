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

    var debugMode: Boolean
        get() = plain.getBoolean("debug", false)
        set(v) = plain.edit().putBoolean("debug", v).apply()

    var dataUpdatedAt: Long
        get() = plain.getLong("data_updated_at", 0)
        set(v) = plain.edit().putLong("data_updated_at", v).apply()

    val isPaired: Boolean get() = !deviceToken.isNullOrBlank()
}
