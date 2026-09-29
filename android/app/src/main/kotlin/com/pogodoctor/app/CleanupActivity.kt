package com.pogodoctor.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// 4-B6 태그 카테고리 선택: 반투명 대화상자(ResultActivity 와 같은 테마)로 "카테고리명 · 예상 N마리" 목록을 보여주고,
// 한 줄을 누르면 그 검색어를 복사하고 토스트를 띄운 뒤 닫는다(포켓몬GO 로 복귀). 게임 조작 없음.
class CleanupActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setGravity(Gravity.BOTTOM)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND); window.setDimAmount(0.25f)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFF1B2430.toInt()); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        setContentView(ScrollView(this).apply { addView(root) })
        text("🏷 태그 선택 — 불러오는 중…", 13f, 0xFFC8D6E5.toInt())
        Thread {
            val ok = CleanupCopier.refresh(prefs)
            runOnUiThread { render(ok) }
        }.start()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(s: String, size: Float, color: Int, bold: Boolean = false): TextView = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(3), 0, dp(3)); root.addView(this)
    }

    private fun render(ok: Boolean) {
        root.removeAllViews()
        text("🏷 태그 선택 — 줄을 누르면 검색어가 복사됩니다", 14f, Color.WHITE, bold = true)
        text(CleanupCopier.note, 10f, 0xFF8899AA.toInt())
        if (CleanupCopier.gameTagged > 0) text("게임 태그가 이미 달린 개체 ${CleanupCopier.gameTagged}마리는 대상에서 제외됨", 10f, 0xFF8899AA.toInt())
        val cats = CleanupCopier.categories()
        if (!ok && cats.isEmpty()) text("정리 묶음을 받지 못했습니다: ${CleanupCopier.lastError ?: "오류"}", 12f, 0xFFFF6B6B.toInt())
        else if (cats.isEmpty()) text("태그를 붙일 대상이 없습니다", 12f, 0xFFC8D6E5.toInt())
        for (cat in cats) for ((gi, g) in cat.groups.withIndex()) {
            val head = cat.label + (if (cat.groups.size > 1) " ${gi + 1}/${cat.groups.size}" else "")
            val line = "$head · " + (if (g.expected < 0) "예상 수 없음(게임 검색어)" else "예상 ${g.expected}마리") + (if (g.overlap > 0) " ⚠️ 다른 개체 최대 ${g.overlap}마리 포함 가능" else "")
            Button(this).apply {
                text = line; textSize = 13f; setAllCaps(false); gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setOnClickListener { CleanupCopier.copyTag(this@CleanupActivity, cat, gi); startService(Intent(this@CleanupActivity, CaptureService::class.java).setAction(CaptureService.ACTION_REFRESH_NOTIF)); finish() }
                root.addView(this)
            }
            if (g.names.isNotBlank()) text("   ${g.names}", 10f, 0xFF8899AA.toInt())
        }
        val tr = CleanupCopier.transferCount()
        if (tr > 0) Button(this).apply {
            text = "❌ 박사행 ${CleanupCopier.transferIdx + 1}/$tr 복사 (되돌릴 수 없음 · 🛡 보호 조건 포함 → 결과 ≤ 예상)"; textSize = 13f; setAllCaps(false); gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setOnClickListener { CleanupCopier.copyNextTransfer(this@CleanupActivity); startService(Intent(this@CleanupActivity, CaptureService::class.java).setAction(CaptureService.ACTION_REFRESH_NOTIF)); finish() }
            root.addView(this)
        }
        Button(this).apply { text = "닫기"; setAllCaps(false); setOnClickListener { finish() }; root.addView(this) }
    }

    override fun finish() { super.finish(); overridePendingTransition(0, 0) }
}
