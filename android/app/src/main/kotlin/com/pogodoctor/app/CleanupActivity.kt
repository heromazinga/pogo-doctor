package com.pogodoctor.app

import android.app.Activity
import android.app.AlertDialog
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
import android.widget.Toast

// 4-B6 태그 카테고리 선택 / 4-E 박사행 묶음 목록: 반투명 대화상자(ResultActivity 와 같은 테마).
// kind=tag: "카테고리명 · 예상 N마리" 목록, 한 줄을 누르면 그 검색어를 복사하고 토스트를 띄운 뒤 닫는다(포켓몬GO 로 복귀).
// kind=transfer: "묶음 n · 예상 N마리 · 상태(미복사/복사됨/보냄)" 목록. 아무 줄이나 다시 복사 가능, 줄마다 "보냄" 처리 버튼(서버 정리). 게임 조작 없음.
class CleanupActivity : Activity() {
    companion object { const val EXTRA_KIND = "kind"; const val KIND_TAG = "tag"; const val KIND_TRANSFER = "transfer" }
    private lateinit var prefs: Prefs
    private lateinit var root: LinearLayout
    private var kind = KIND_TAG

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        kind = intent?.getStringExtra(EXTRA_KIND) ?: KIND_TAG
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setGravity(Gravity.BOTTOM)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND); window.setDimAmount(0.25f)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFF1B2430.toInt()); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        setContentView(ScrollView(this).apply { addView(root) })
        load(force = false)
    }

    // singleTask: 이미 떠 있는 상태에서 다른 kind 로 다시 열리면 갈아탄다
    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); kind = intent?.getStringExtra(EXTRA_KIND) ?: kind; load(force = false) }

    private fun load(force: Boolean) {
        root.removeAllViews()
        text(if (kind == KIND_TRANSFER) "❌ 박사행 묶음 — 불러오는 중…" else "🏷 태그 선택 — 불러오는 중…", 13f, 0xFFC8D6E5.toInt())
        Thread {
            val ok = CleanupCopier.refresh(prefs, force)
            runOnUiThread { if (kind == KIND_TRANSFER) renderTransfer(ok) else renderTag(ok) }
        }.start()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun text(s: String, size: Float, color: Int, bold: Boolean = false): TextView = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(3), 0, dp(3)); root.addView(this)
    }
    private fun button(label: String, color: Int? = null, onClick: () -> Unit): Button = Button(this).apply {
        text = label; textSize = 13f; setAllCaps(false); gravity = Gravity.START or Gravity.CENTER_VERTICAL
        if (color != null) setTextColor(color)
        setOnClickListener { onClick() }
    }
    private fun refreshNotif() = startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_REFRESH_NOTIF))
    private fun footer() {
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@CleanupActivity).apply { text = if (kind == KIND_TRANSFER) "🏷 태그 목록" else "❌ 박사행 목록"; setAllCaps(false); setOnClickListener { kind = if (kind == KIND_TRANSFER) KIND_TAG else KIND_TRANSFER; load(force = false) } })
            addView(Button(this@CleanupActivity).apply { text = "🔄"; setAllCaps(false); setOnClickListener { load(force = true) } })
            addView(Button(this@CleanupActivity).apply { text = "닫기"; setAllCaps(false); setOnClickListener { finish() } })
            root.addView(this)
        }
    }

    private fun renderTag(ok: Boolean) {
        root.removeAllViews()
        text("🏷 태그 선택 — 줄을 누르면 검색어가 복사됩니다", 14f, Color.WHITE, bold = true)
        text(CleanupCopier.note, 10f, 0xFF8899AA.toInt())
        if (CleanupCopier.gameTagged > 0) text("게임 태그가 이미 달린 개체 ${CleanupCopier.gameTagged}마리는 대상에서 제외됨", 10f, 0xFF8899AA.toInt())
        val cats = CleanupCopier.categories()
        if (!ok && cats.isEmpty()) text("정리 묶음을 받지 못했습니다: ${CleanupCopier.lastError ?: "오류"}", 12f, 0xFFFF6B6B.toInt())
        else if (cats.isEmpty()) text("태그를 붙일 대상이 없습니다", 12f, 0xFFC8D6E5.toInt())
        // 4-F.5: 선택 태그(수집(종 대표))는 뒤로 보내고 "(선택)" 표시 — 서버가 optional 로 표시
        for (cat in cats.sortedBy { if (it.optional) 1 else 0 }) for ((gi, g) in cat.groups.withIndex()) {
            val head = cat.label + (if (cat.groups.size > 1) " ${gi + 1}/${cat.groups.size}" else "")
            val line = "$head · " + (if (g.expected < 0) "예상 수 없음(게임 검색어)" else "예상 ${g.expected}마리") + (if (g.overlap > 0) " ⚠️ 다른 개체 최대 ${g.overlap}마리 포함 가능" else "")
            root.addView(button(line) { CleanupCopier.copyTag(this, cat, gi); refreshNotif(); finish() })
            if (g.names.isNotBlank()) text("   ${g.names}", 10f, 0xFF8899AA.toInt())
        }
        footer()
    }

    // 4-E 박사행 묶음 목록
    private fun renderTransfer(ok: Boolean) {
        root.removeAllViews()
        text("❌ 박사행 묶음 — 줄을 누르면 검색어 복사 (되돌릴 수 없음 · 🛡 보호 조건 포함 → 게임 결과 ≤ 예상)", 14f, Color.WHITE, bold = true)
        text("붙여넣기 → 결과 수 확인 → 전체 선택 → 보내기 → 여기서 \"보냄\". 결과가 예상보다 많으면 보내지 마세요.", 10f, 0xFFFFC46B.toInt())
        val tr = CleanupCopier.transfers()
        if (!ok && tr.isEmpty()) text("정리 묶음을 받지 못했습니다: ${CleanupCopier.lastError ?: "오류"}", 12f, 0xFFFF6B6B.toInt())
        else if (CleanupCopier.pending > 0) text("🔒 판정 재계산 중 ${CleanupCopier.pending}건 — 박사행 복사는 잠시 후 다시(🔄)", 12f, 0xFFFFD93D.toInt())
        else if (tr.isEmpty()) text("정리할 박사행 대상이 없습니다", 12f, 0xFFC8D6E5.toInt())
        else for ((i, g) in tr.withIndex()) {
            val st = CleanupCopier.stateOf(g)
            val color = when (st) { CleanupCopier.State.DONE -> 0xFF8899AA.toInt(); CleanupCopier.State.COPIED -> 0xFFFFD93D.toInt(); else -> Color.WHITE }
            LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(button("묶음 ${i + 1} · 예상 ${g.expected}마리 · ${st.label}", color) { CleanupCopier.copyTransfer(this@CleanupActivity, i); refreshNotif(); finish() },
                    LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                if (st != CleanupCopier.State.DONE) addView(button("보냄", 0xFFFF6B6B.toInt()) { confirmDone(i, g) })
                if (st != CleanupCopier.State.DONE) addView(button("없음", 0xFF8899AA.toInt()) { confirmNotSeen(i, g) }) // 4-F.5 B 게임 결과 0마리
                root.addView(this)
            }
            // 4-E.2 포함 포켓몬 보기(펼치기): 보내기 전 남길 개체를 알아보고 태그를 달 수 있게
            if (g.members.isNotEmpty()) {
                val detail = TextView(this).apply { text = g.members.joinToString("\n"); textSize = 10f; setTextColor(0xFFC8D6E5.toInt()); setPadding(dp(12), 0, 0, dp(4)); visibility = android.view.View.GONE }
                val toggle = TextView(this).apply { text = "   ▸ 포함 포켓몬 ${g.members.size}마리 보기"; textSize = 10f; setTextColor(0xFF8899AA.toInt()); setPadding(0, dp(2), 0, dp(2))
                    setOnClickListener { val open = detail.visibility == android.view.View.GONE; detail.visibility = if (open) android.view.View.VISIBLE else android.view.View.GONE; text = (if (open) "   ▾" else "   ▸") + " 포함 포켓몬 ${g.members.size}마리 보기" } }
                root.addView(toggle); root.addView(detail)
            } else if (g.names.isNotBlank()) text("   ${g.names}", 10f, 0xFF8899AA.toInt())
        }
        if (CleanupCopier.gameTagged > 0) text("게임 태그가 이미 달린 개체 ${CleanupCopier.gameTagged}마리는 대상에서 제외됨", 10f, 0xFF8899AA.toInt())
        footer()
    }

    private fun confirmNotSeen(i: Int, g: CleanupCopier.Group) {
        AlertDialog.Builder(this).setTitle("묶음 ${i + 1} 이미 없음")
            .setMessage("게임 검색 결과가 0마리입니까? 이 묶음 ${g.expected}마리의 스캔 기록을 \"이미 없음\"(복구 가능)으로 숨깁니다.")
            .setPositiveButton("없음 처리") { _, _ ->
                Thread {
                    val err = CleanupCopier.markNotSeen(prefs, g)
                    runOnUiThread {
                        Toast.makeText(this, if (err != null) "처리 실패: $err" else "묶음 ${i + 1} 이미 없음 처리", Toast.LENGTH_LONG).show()
                        refreshNotif(); renderTransfer(true)
                    }
                }.start()
            }
            .setNegativeButton("취소", null).show()
    }
    private fun confirmDone(i: Int, g: CleanupCopier.Group) {
        val rows = g.targetIds.count { it.startsWith("row:") }
        AlertDialog.Builder(this).setTitle("묶음 ${i + 1} 보냄 처리")
            .setMessage("이 묶음 ${g.expected}마리를 게임에서 박사에게 보냈습니까? 스캔 기록을 정리하고${if (rows > 0) " 내 목록 ${rows}건을 삭제합니다" else ""}.")
            .setPositiveButton("보냈음") { _, _ ->
                Thread {
                    val err = CleanupCopier.markDone(prefs, g)
                    runOnUiThread {
                        if (err != null) Toast.makeText(this, "보냄 처리 실패: $err", Toast.LENGTH_LONG).show()
                        else Toast.makeText(this, "묶음 ${i + 1} 보냄 처리 완료", Toast.LENGTH_SHORT).show()
                        refreshNotif(); renderTransfer(true)
                    }
                }.start()
            }
            .setNegativeButton("취소", null).show()
    }

    override fun finish() { super.finish(); overridePendingTransition(0, 0) }
}
