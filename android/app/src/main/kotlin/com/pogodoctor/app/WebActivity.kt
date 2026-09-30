package com.pogodoctor.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.app.AlertDialog
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 4-0: 웹앱을 앱 안에서 연다 (WebView).
// - 자동 로그인: 기기 토큰으로 /api/device/web-code 를 받아 URL 해시(#applogin=<코드>&uid=<user_id>)로 넘긴다.
//   웹이 /api/auth/web-login 으로 교환(3-1c 흐름). 코드는 화면에 표시하지 않고, 해시는 서버로 전송되지 않으며 웹이 즉시 지운다.
//   웹 세션이 이미 같은 user_id 면 웹이 코드를 쓰지 않는다. 세션은 WebView 저장소(localStorage)에 남아 앱 재시작 후에도 유지된다.
// - 보안: 우리 도메인(serverUrl 호스트)만 WebView 에서 열고 그 외 링크는 외부 브라우저로. JavaScript 브리지 없음(addJavascriptInterface 미사용),
//   파일·콘텐츠 접근 비활성, 혼합 콘텐츠 차단, 위치 비활성. 기기 토큰 원문은 WebView 로 넘기지 않는다.
class WebActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        val ourHost = Uri.parse(prefs.serverUrl).host ?: ""
        web.settings.apply {
            javaScriptEnabled = true          // 웹앱(Next.js) 동작에 필요
            domStorageEnabled = true          // Supabase 세션(localStorage) 유지
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + " PogoDoctorApp/" + BuildConfig.VERSION_NAME
        }
        // 4-E.2: WebChromeClient 가 없으면 window.confirm/alert 이 즉시 false/무시 → 웹 "보냄 처리 완료" 등 확인 버튼이 무반응(실측). 네이티브 대화상자로 연결
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@WebActivity).setMessage(message ?: "").setPositiveButton("확인") { _, _ -> result?.confirm() }.setOnCancelListener { result?.confirm() }.show()
                return true
            }
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@WebActivity).setMessage(message ?: "").setPositiveButton("확인") { _, _ -> result?.confirm() }.setNegativeButton("취소") { _, _ -> result?.cancel() }.setOnCancelListener { result?.cancel() }.show()
                return true
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val ok = (u.scheme == "https" || (u.scheme == "http" && ourHost == "localhost")) && u.host.equals(ourHost, ignoreCase = true)
                if (ok) return false
                // 외부 링크(포켓몬GO 위키·PvPoke 등)는 시스템 브라우저로
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else loadWithAutoLogin()
    }

    private fun loadWithAutoLogin() {
        val base = prefs.serverUrl + "/"
        if (!prefs.isPaired) { web.loadUrl(base); return }
        scope.launch {
            val hash = try {
                val r = withContext(Dispatchers.IO) { Api(prefs).webLoginCode() }
                val code = r.optString("code", ""); val uid = r.optString("userId", "")
                if (code.isBlank()) "" else "#applogin=" + Uri.encode(code) + (if (uid.isNotBlank()) "&uid=" + Uri.encode(uid) else "")
            } catch (e: Exception) {
                Toast.makeText(this@WebActivity, "자동 로그인 코드 발급 실패: ${e.message} — 익명으로 엽니다", Toast.LENGTH_LONG).show(); ""
            }
            web.loadUrl(base + hash)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onDestroy() { scope.cancel(); web.destroy(); super.onDestroy() }
}
