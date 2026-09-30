package com.pogodoctor.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import com.pogodoctor.core.SearchBuilder
import org.json.JSONObject

// 4-B5/4-B6 정리 도우미(앱): 서버 /api/cleanup 의 묶음을 받아 검색어를 클립보드에 복사한다. 게임 조작 없음.
// 4-B6: 태그는 카테고리 목록(CleanupActivity)에서 골라 복사한다.
// 4-E: 박사행도 순환 복사 대신 묶음 목록("묶음 n · 예상 N마리 · 상태")에서 골라 복사하고, 줄마다 "보냄" 처리(서버 /api/cleanup done)를 할 수 있다.
// 오프라인이면 세션 스캔 항목만으로 로컬 계산(SearchBuilder, 알려진 개체 = 세션 항목 → 내 목록과의 충돌은 검사 못 함 → 안내 표기).
object CleanupCopier {
    // 예상 수 한계 문구 (웹 searchBuilder.js EXPECTED_LIMIT_NOTE 와 같은 뜻). 서버 응답의 note 가 있으면 그것을 쓴다
    const val LIMIT_NOTE = "예상 수는 앱이 아는 개체(스캔 기록 + 내 목록) 기준입니다. 앱이 모르는 같은 종·HP 개체가 게임에 있으면 결과가 더 나옵니다 — 게임 결과 수가 예상과 다르면 보내지 마세요."
    data class Group(val category: String, val label: String, val query: String, val expected: Int, val names: String, val overlap: Int = 0, val targetIds: List<String> = emptyList(), val members: List<String> = emptyList())
    // 카테고리 한 줄: "카테고리명 · 예상 N마리" (N = 묶음들의 예상 합). 태그 카테고리는 묶음이 여러 개일 수 있어 groups 로 보관
    data class Category(val category: String, val label: String, val groups: List<Group>, val optional: Boolean = false) { val expected: Int get() = if (groups.any { it.expected < 0 }) -1 else groups.sumOf { it.expected } }
    // 4-E 박사행 묶음 상태: 미복사 → 복사됨 → 보냄 (query 기준, 앱 프로세스 동안 유지. 보냄 처리된 묶음은 서버 갱신 후 목록에서 사라짐)
    enum class State(val label: String) { NONE("미복사"), COPIED("복사됨"), DONE("보냄"), GONE("이미 없음") }
    @Volatile private var transfer: List<Group> = emptyList()
    @Volatile private var tagCats: List<Category> = emptyList()
    @Volatile private var fetchedAt = 0L
    private val copied = HashSet<String>()
    private val done = HashSet<String>()
    @Volatile private var statesLoaded = false
    // 4-E.2 상태를 Prefs(JSON {query: "copied"|"done"})에 저장해 앱 재시작 후에도 유지
    @Synchronized private fun loadStates(prefs: Prefs) {
        if (statesLoaded) return
        try { val o = JSONObject(prefs.cleanupStates); for (k in o.keys()) { when (o.optString(k)) { "done" -> done.add(k); "copied" -> copied.add(k) } } } catch (_: Exception) {}
        statesLoaded = true
    }
    @Synchronized private fun saveStates(prefs: Prefs) {
        val o = JSONObject(); for (q in copied) o.put(q, "copied"); for (q in done) o.put(q, "done")
        prefs.cleanupStates = o.toString()
    }
    @Volatile var lastError: String? = null
    @Volatile var note: String = LIMIT_NOTE
    @Volatile var gameTagged: Int = 0
    @Volatile var pending: Int = 0        // 4-D2 서버 판정 재계산 남은 수 — >0 이면 박사행 복사 차단(되돌릴 수 없음)

    fun status(): String {
        val tr = transfer
        val c = tr.count { stateOf(it) == State.COPIED }; val d = tr.count { stateOf(it) == State.DONE }
        return "박사행 묶음 ${tr.size}" + (if (tr.isNotEmpty()) "(복사됨 $c · 보냄 $d)" else "") + " · 태그 카테고리 ${tagCats.size}개" +
            (if (gameTagged > 0) " · 게임 태그 있음 $gameTagged 제외" else "") + (if (pending > 0) " · 🔒 재계산 중 $pending" else "")
    }
    fun categories(): List<Category> = tagCats
    fun transfers(): List<Group> = transfer
    fun transferCount(): Int = transfer.size
    @Synchronized fun stateOf(g: Group): State = when { g.query in done -> State.DONE; g.query in copied -> State.COPIED; else -> State.NONE }

    // 서버에서 묶음 갱신 (60초 캐시). 실패 시 이전 캐시 유지
    @Synchronized fun refresh(prefs: Prefs, force: Boolean = false): Boolean {
        loadStates(prefs)
        if (!force && System.currentTimeMillis() - fetchedAt < 60_000 && (transfer.isNotEmpty() || tagCats.isNotEmpty())) return true
        return try {
            val res = Api(prefs).cleanup(prefs.cleanupMaxLen)
            val names = res.optJSONObject("names") ?: JSONObject()
            val membersObj = res.optJSONObject("members") ?: JSONObject()
            // 4-E.2 "포함 포켓몬 보기" 한 줄: 👤 이름 · CP HP · a/d/s (%) Lx
            fun memberLine(id: String): String? {
                val m = membersObj.optJSONObject(id) ?: return names.optString(id, null)
                val ivs = if (m.has("atk") && !m.isNull("atk")) { val a = m.optInt("atk"); val d = m.optInt("def"); val s = m.optInt("sta"); "$a/$d/$s (${Math.round((a + d + s) / 45.0 * 100)}%)" } else "개체값 없음"
                val form = m.optString("form", "Normal").let { if (it == "Normal" || it.isBlank()) "" else " ($it)" }
                return (if (m.optBoolean("is_shadow")) "👤 " else "") + (if (m.optBoolean("is_purified")) "✨ " else "") + m.optString("name") + form +
                    " · CP" + (if (m.isNull("cp")) "?" else m.optInt("cp").toString()) + " HP" + (if (m.isNull("hp")) "?" else m.optInt("hp").toString()) + " · " + ivs +
                    (if (m.isNull("level")) "" else " L" + m.optDouble("level").let { if (it % 1.0 == 0.0) it.toInt().toString() else it.toString() })
            }
            val cats = res.optJSONArray("categories")
            val tr = ArrayList<Group>(); val tg = ArrayList<Category>()
            for (i in 0 until (cats?.length() ?: 0)) {
                val c = cats!!.getJSONObject(i); val category = c.optString("category"); val label = c.optString("label")
                val gs = c.optJSONArray("groups") ?: continue
                val list = ArrayList<Group>()
                for (j in 0 until gs.length()) {
                    val g = gs.getJSONObject(j)
                    val ids = g.optJSONArray("targetIds")
                    val idList = (0 until (ids?.length() ?: 0)).map { ids!!.optString(it) }.filter { it.isNotBlank() }
                    val nm = idList.mapNotNull { names.optString(it, null) }.take(6).joinToString(", ")
                    // expected 가 null(고정 검색어)이면 -1
                    val expected = if (g.isNull("expected")) -1 else g.optInt("expected")
                    val glabel = g.optString("label", "").ifBlank { label }
                    list.add(Group(category, if (category == "collect") "💎 $glabel" else label, g.optString("query"), expected, nm, g.optInt("overlap", 0), idList, idList.mapNotNull { memberLine(it) }))
                }
                if (category == "transfer") tr.addAll(list)
                else if (category.startsWith("tag:") && list.isNotEmpty()) tg.add(Category(category, label, list, c.optBoolean("optional", false)))
                else if (category == "collect") for (g in list) tg.add(Category("collect:${g.query}", g.label, listOf(g)))
            }
            transfer = tr; tagCats = tg; fetchedAt = System.currentTimeMillis(); lastError = null
            note = res.optString("note", LIMIT_NOTE).ifBlank { LIMIT_NOTE }; gameTagged = res.optInt("gameTagged", 0); pending = res.optInt("pending", 0)
            // 서버 목록에 없는(보냄 처리되어 사라진) 묶음의 상태는 정리
            val alive = tr.map { it.query }.toHashSet(); copied.retainAll(alive); done.retainAll(alive); saveStates(prefs)
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
        // 4-C.2: 박사행 묶음은 보호 조건이 항상 붙어 "결과 ≤ 예상" (보호 대상이 빠짐). 고정 검색어(수집: 색이 다른/배경/xxl)는 예상 수 없음
        val sb = StringBuilder(when {
            g.expected < 0 -> "[$head] 복사됨 · 예상 수 없음(앱이 모르는 정보) — 게임 결과를 보고 태그"
            g.category == "transfer" -> "[$head] 복사됨 · 게임 결과 ≤ 예상 ${g.expected}마리. 적으면 보호 대상이 빠진 것, 많으면 보내지 말 것"
            else -> "[$head] 복사됨 · 예상 ${g.expected}마리 — 게임 결과 수가 같을 때만 전체 선택"
        })
        if (g.overlap > 0) sb.append("\n⚠️ 다른 개체 최대 ${g.overlap}마리 포함 가능(태그는 덮어써도 됨)")
        if (g.names.isNotBlank()) sb.append("\n(${g.names})")
        if (withNote) sb.append("\n$note")
        return sb.toString()
    }

    // 4-E 박사행 idx 번째 묶음 복사 → 상태 "복사됨", 토스트 "[박사행 k/n] …". 반환: 상태 문자열 (재계산 중이면 차단)
    fun copyTransfer(ctx: Context, idx: Int): String {
        if (pending > 0) { val msg = "판정 재계산 중 ${pending}건 — 박사행 복사는 잠시 후 다시(웹 🧹 패널 🔄 로 갱신)"; Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show(); return msg }
        val g = transfer.getOrNull(idx) ?: run { val msg = if (lastError != null) "정리 묶음을 받지 못했습니다: $lastError" else "정리할 박사행 대상이 없습니다"; Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show(); return msg }
        copy(ctx, g.query)
        synchronized(this) { copied.add(g.query) }; saveStates(Prefs(ctx))
        val msg = toastText("박사행 ${idx + 1}/${transfer.size}", g, withNote = true)
        Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
        return msg
    }

    // 4-E 박사행 묶음 보냄 처리 (게임에서 보낸 뒤): 서버에 done → 상태 "보냄". 실패 시 예외 메시지 반환
    fun markDone(prefs: Prefs, g: Group): String? = try {
        Api(prefs).cleanupDone(g.targetIds, deleteRows = true)
        synchronized(this) { done.add(g.query) }; saveStates(prefs)
        null
    } catch (e: Exception) { e.message ?: e.toString() }
    // 4-F.5 B 게임 결과 0마리 → "이미 없음" (스캔 기록 not_seen, 복구 가능)
    fun markNotSeen(prefs: Prefs, g: Group): String? = try {
        Api(prefs).cleanupNotSeen(g.targetIds)
        synchronized(this) { done.add(g.query) }; saveStates(prefs)
        null
    } catch (e: Exception) { e.message ?: e.toString() }

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
        // 4-F.5: 사용자 고유 태그가 있는 개체만 제외, 앱 관리 태그는 포함. 보호 접미사에 관측된 사용자 태그 절
        val userTags = SearchBuilder.userTagsOf(items)
        val targets = items.filter { it.id in transferIds && it.id !in gameTaggedIds && it.gameTags.none { t -> !SearchBuilder.isAppTag(t) } }
        val r = SearchBuilder.buildGroups(targets, items, strict = true, suffix = SearchBuilder.protectSuffix(userTags))
        transfer = r.groups.map { Group("transfer", "❌ 박사행(로컬·내 목록 미검사)", it.query, it.expected, it.targetIds.take(6).joinToString(", "), 0, it.targetIds.map { id -> "scan:$id" }) }
        gameTagged = gameTaggedIds.size
        fetchedAt = System.currentTimeMillis()
    }
}
