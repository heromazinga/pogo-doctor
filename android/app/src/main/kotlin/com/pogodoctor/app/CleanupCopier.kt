package com.pogodoctor.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import com.pogodoctor.core.SearchBuilder
import org.json.JSONObject

// 4-B5/4-B6 정리 도우미(앱): 서버 /api/cleanup 의 묶음을 받아 검색어를 클립보드에 복사한다. 게임 조작 없음.
// 4-B6: 태그는 순환 복사 대신 카테고리 목록(CleanupActivity)에서 골라 복사한다. 박사행은 k 번째 묶음을 순서대로("박사행 k/n").
// 오프라인이면 세션 스캔 항목만으로 로컬 계산(SearchBuilder, 알려진 개체 = 세션 항목 → 내 목록과의 충돌은 검사 못 함 → 안내 표기).
object CleanupCopier {
    // 예상 수 한계 문구 (웹 searchBuilder.js EXPECTED_LIMIT_NOTE 와 같은 뜻). 서버 응답의 note 가 있으면 그것을 쓴다
    const val LIMIT_NOTE = "예상 수는 앱이 아는 개체(스캔 기록 + 내 목록) 기준입니다. 앱이 모르는 같은 종·HP 개체가 게임에 있으면 결과가 더 나옵니다 — 게임 결과 수가 예상과 다르면 보내지 마세요."
    data class Group(val category: String, val label: String, val query: String, val expected: Int, val names: String, val overlap: Int = 0)
    // 카테고리 한 줄: "카테고리명 · 예상 N마리" (N = 묶음들의 예상 합). 태그 카테고리는 묶음이 여러 개일 수 있어 groups 로 보관
    data class Category(val category: String, val label: String, val groups: List<Group>) { val expected: Int get() = groups.sumOf { it.expected } }
    @Volatile private var transfer: List<Group> = emptyList()
    @Volatile private var tagCats: List<Category> = emptyList()
    @Volatile private var fetchedAt = 0L
    @Volatile var transferIdx = 0
    @Volatile var lastError: String? = null
    @Volatile var note: String = LIMIT_NOTE
    @Volatile var gameTagged: Int = 0
    @Volatile var noTag: Boolean = false   // 4-C 서버가 박사행 검색어에 &!# 를 붙였는지

    fun status(): String = "박사행 ${if (transfer.isEmpty()) 0 else transferIdx + 1}/${transfer.size} · 태그 카테고리 ${tagCats.size}개" + (if (gameTagged > 0) " · 게임 태그 있음 $gameTagged 제외" else "")
    fun categories(): List<Category> = tagCats
    fun transferCount(): Int = transfer.size

    // 서버에서 묶음 갱신 (60초 캐시). 실패 시 이전 캐시 유지
    @Synchronized fun refresh(prefs: Prefs, force: Boolean = false): Boolean {
        if (!force && System.currentTimeMillis() - fetchedAt < 60_000 && (transfer.isNotEmpty() || tagCats.isNotEmpty())) return true
        return try {
            val res = Api(prefs).cleanup(prefs.cleanupMaxLen, prefs.cleanupNoTag)
            noTag = res.optBoolean("noTag", false)
            val names = res.optJSONObject("names") ?: JSONObject()
            val cats = res.optJSONArray("categories")
            val tr = ArrayList<Group>(); val tg = ArrayList<Category>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats!!.getJSONObject(i); val category = c.optString("category"); val label = c.optString("label")
                val gs = c.optJSONArray("groups") ?: continue
                val list = ArrayList<Group>()
                for (j in 0 until gs.length()) {
                    val g = gs.getJSONObject(j)
                    val ids = g.optJSONArray("targetIds"); val nm = (0 until (ids?.length() ?: 0)).mapNotNull { names.optString(ids!!.optString(it), null) }.take(6).joinToString(", ")
                    list.add(Group(category, label, g.optString("query"), g.optInt("expected"), nm, g.optInt("overlap", 0)))
                }
                if (category == "transfer") tr.addAll(list) else if (category.startsWith("tag:") && list.isNotEmpty()) tg.add(Category(category, label, list))
            }
            transfer = tr; tagCats = tg; fetchedAt = System.currentTimeMillis(); lastError = null
            note = res.optString("note", LIMIT_NOTE).ifBlank { LIMIT_NOTE }; gameTagged = res.optInt("gameTagged", 0)
            if (transferIdx >= tr.size) transferIdx = 0
            true
        } catch (e: Exception) { lastError = e.message ?: e.toString(); false }
    }

    private fun copy(ctx: Context, query: String) {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("pogo-search", query))
    }
    private fun cleanLabel(label: String) = label.replace(Regex("^[^가-힣A-Za-z0-9]+"), "").trim()

    // 토스트 본문 형식: "[불꽃 레이드] 복사됨 · 예상 N마리 — 게임 결과 수가 같을 때만 전체 선택" (박사행: "[박사행 1/2] …")
    fun toastText(head: String, g: Group, withNote: Boolean): String {
        // 4-C: &!# 옵션이 켜진 박사행 묶음은 "결과 ≤ 예상" (태그 달린 개체가 빠짐)
        val sb = StringBuilder(if (noTag && g.category == "transfer") "[$head] 복사됨 · 게임 결과 ≤ 예상 ${g.expected}마리. 적으면 태그 달린 개체가 빠진 것 — 많으면 보내지 마세요" else "[$head] 복사됨 · 예상 ${g.expected}마리 — 게임 결과 수가 같을 때만 전체 선택")
        if (g.overlap > 0) sb.append("\n⚠️ 다른 개체 최대 ${g.overlap}마리 포함 가능(태그는 덮어써도 됨)")
        if (g.names.isNotBlank()) sb.append("\n(${g.names})")
        if (withNote) sb.append("\n$note")
        return sb.toString()
    }

    // 박사행 k 번째 묶음 복사 → 토스트 "[박사행 k/n] …" + 한계 문구. 반환: 상태 문자열
    fun copyNextTransfer(ctx: Context): String {
        if (transfer.isEmpty()) { val msg = if (lastError != null) "정리 묶음을 받지 못했습니다: $lastError" else "정리할 박사행 대상이 없습니다"; Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show(); return msg }
        val idx = transferIdx; val g = transfer[idx]
        copy(ctx, g.query)
        val msg = toastText("박사행 ${idx + 1}/${transfer.size}", g, withNote = true)
        Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        transferIdx = (idx + 1) % transfer.size
        return msg
    }

    // 태그 카테고리의 묶음 하나 복사 → 토스트 "[불꽃 레이드] 복사됨 · …" (묶음이 여럿이면 "[불꽃 레이드 2/3]")
    fun copyTag(ctx: Context, cat: Category, groupIdx: Int): String {
        val g = cat.groups.getOrNull(groupIdx) ?: return "묶음 없음"
        copy(ctx, g.query)
        val head = cleanLabel(cat.label) + (if (cat.groups.size > 1) " ${groupIdx + 1}/${cat.groups.size}" else "")
        val msg = toastText(head, g, withNote = false)
        Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        return msg
    }

    // 오프라인 대체: 세션 항목만으로 계산 (내 목록과의 충돌 검사 불가 → 표기). 게임 태그가 이미 달린 개체는 대상에서 제외
    fun localFallback(items: List<SearchBuilder.Item>, transferIds: Set<String>, gameTaggedIds: Set<String> = emptySet()) {
        val targets = items.filter { it.id in transferIds && it.id !in gameTaggedIds }
        val r = SearchBuilder.buildGroups(targets, items, strict = true)
        transfer = r.groups.map { Group("transfer", "❌ 박사행(로컬·내 목록 미검사)", it.query, it.expected, it.targetIds.take(6).joinToString(", ")) }
        gameTagged = gameTaggedIds.size
        fetchedAt = System.currentTimeMillis()
    }
}
