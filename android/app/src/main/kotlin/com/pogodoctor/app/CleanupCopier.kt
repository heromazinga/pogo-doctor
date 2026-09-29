package com.pogodoctor.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import com.pogodoctor.core.SearchBuilder
import org.json.JSONObject

// 4-B5 정리 도우미(앱): 서버 /api/cleanup 의 묶음을 받아 k 번째 검색어를 클립보드에 복사한다. 게임 조작 없음.
// 오프라인이면 세션 스캔 항목만으로 로컬 계산(SearchBuilder, 알려진 개체 = 세션 항목 → 내 목록과의 충돌은 검사 못 함 → 안내 표기).
object CleanupCopier {
    data class Group(val category: String, val label: String, val query: String, val expected: Int, val names: String)
    @Volatile private var transfer: List<Group> = emptyList()
    @Volatile private var tags: List<Group> = emptyList()
    @Volatile private var fetchedAt = 0L
    @Volatile var transferIdx = 0
    @Volatile var tagIdx = 0
    @Volatile var lastError: String? = null

    fun status(): String = "박사행 ${if (transfer.isEmpty()) 0 else transferIdx + 1}/${transfer.size} · 태그 ${if (tags.isEmpty()) 0 else tagIdx + 1}/${tags.size}"

    // 서버에서 묶음 갱신 (60초 캐시). 실패 시 이전 캐시 유지
    @Synchronized fun refresh(prefs: Prefs, force: Boolean = false): Boolean {
        if (!force && System.currentTimeMillis() - fetchedAt < 60_000 && (transfer.isNotEmpty() || tags.isNotEmpty())) return true
        return try {
            val res = Api(prefs).cleanup(prefs.cleanupMaxLen)
            val names = res.optJSONObject("names") ?: JSONObject()
            val cats = res.optJSONArray("categories")
            val tr = ArrayList<Group>(); val tg = ArrayList<Group>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats!!.getJSONObject(i); val category = c.optString("category"); val label = c.optString("label")
                val gs = c.optJSONArray("groups") ?: continue
                for (j in 0 until gs.length()) {
                    val g = gs.getJSONObject(j)
                    val ids = g.optJSONArray("targetIds"); val nm = (0 until (ids?.length() ?: 0)).mapNotNull { names.optString(ids!!.optString(it), null) }.take(6).joinToString(", ")
                    val grp = Group(category, label, g.optString("query"), g.optInt("expected"), nm)
                    if (category == "transfer") tr.add(grp) else if (category.startsWith("tag:")) tg.add(grp)
                }
            }
            transfer = tr; tags = tg; fetchedAt = System.currentTimeMillis(); lastError = null
            if (transferIdx >= tr.size) transferIdx = 0; if (tagIdx >= tg.size) tagIdx = 0
            true
        } catch (e: Exception) { lastError = e.message ?: e.toString(); false }
    }

    // k 번째 묶음 복사 → 토스트. 반환: 다음 호출을 위한 상태 문자열
    fun copyNext(ctx: Context, kind: String): String {
        val list = if (kind == "transfer") transfer else tags
        if (list.isEmpty()) { val msg = if (lastError != null) "정리 묶음을 받지 못했습니다: $lastError" else "정리할 ${if (kind == "transfer") "박사행" else "태그"} 대상이 없습니다"; Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show(); return msg }
        val idx = if (kind == "transfer") transferIdx else tagIdx
        val g = list[idx]
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("pogo-search", g.query))
        val msg = "${g.label} 검색어 복사 ${idx + 1}/${list.size} · 예상 ${g.expected}마리 (${g.names}) — 검색 결과가 정확히 ${g.expected}마리일 때만 전체 선택하세요"
        Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        if (kind == "transfer") transferIdx = (idx + 1) % list.size else tagIdx = (idx + 1) % list.size
        return msg
    }

    // 오프라인 대체: 세션 항목만으로 계산 (내 목록과의 충돌 검사 불가 → 표기)
    fun localFallback(items: List<SearchBuilder.Item>, transferIds: Set<String>) {
        val targets = items.filter { it.id in transferIds }
        val r = SearchBuilder.buildGroups(targets, items)
        transfer = r.groups.map { Group("transfer", "❌ 박사행(로컬·내 목록 미검사)", it.query, it.expected, it.targetIds.take(6).joinToString(", ")) }
        fetchedAt = System.currentTimeMillis()
    }
}
