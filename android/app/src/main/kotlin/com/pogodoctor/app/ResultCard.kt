package com.pogodoctor.app

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.pogodoctor.core.Appraisal
import com.pogodoctor.core.Fuzzy
import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef
import com.pogodoctor.core.Verdict
import org.json.JSONArray
import org.json.JSONObject

// 결과 카드 View 생성 (오버레이 카드와 결과 액티비티가 공용). 계산은 기기 내 결정적 공식, AI 미사용.
class ResultCard(private val ctx: Context, private val repo: DataRepo, private val paired: Boolean) {
    data class Computed(val summary: IvCalc.Summary?, val ivText: String, val verdict: Verdict.Line?, val ivs: Triple<Int, Int, Int>?)
    interface Actions {
        fun onChooseSpecies(sp: SpeciesRef)
        fun onSave(info: ScreenInfo, sp: SpeciesRef, c: Computed, status: String)
        fun onClose()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()
    private fun r(x: IntRange) = if (x.first == x.last) "${x.first}" else "${x.first}~${x.last}"

    fun compute(info: ScreenInfo, sp: SpeciesRef?, ap: Appraisal?): Computed {
        val base = sp?.let { IvCalc.Base(it.atk, it.def, it.sta) }
        val cp = info.cp
        if (base == null || cp == null) return Computed(null, "개체값: 종 또는 CP 미인식", null, null)
        var cands = IvCalc.candidates(base, cp, info.hp)
        if (ap != null) cands = IvCalc.filterByAppraisal(cands, ap.atk, ap.def, ap.sta)
        val s = IvCalc.summarize(cands)
        val apA = ap?.atk; val apD = ap?.def; val apS = ap?.sta
        val ivs: Triple<Int, Int, Int>? = when {
            apA != null && apD != null && apS != null -> Triple(apA, apD, apS)
            s.exact -> Triple(s.candidates[0].atk, s.candidates[0].def, s.candidates[0].sta)
            else -> null
        }
        val ivText = when {
            s.empty -> "개체값: 후보 없음 (CP/HP 인식 확인)"
            ivs != null -> "개체값: ${ivs.first}/${ivs.second}/${ivs.third} (${Math.round((ivs.first + ivs.second + ivs.third) * 100.0 / 45)}%)${if (ap != null) " · 평가 화면 판독" else " · CP·HP 로 확정"}"
            else -> { val lr = s.levelRange!!; "개체값 후보 ${s.candidates.size}개: 공${r(s.atkRange!!)} 방${r(s.defRange!!)} HP${r(s.staRange!!)} → ${r(s.percentRange!!)}% · L${lr.start}~${lr.endInclusive} (평가 화면을 캡처하면 확정)" }
        }
        return Computed(s, ivText, if (!s.empty) Verdict.oneLiner(base, s) else null, ivs)
    }

    // 저장용 행 (웹앱 my_pokemon 규약: 기술은 영어 ID, 첫 번째를 빠른기술로 가정)
    fun buildRow(info: ScreenInfo, sp: SpeciesRef, c: Computed, status: String): JSONObject {
        val data = repo.loadCached()
        val row = JSONObject().put("species_id", sp.id).put("form", sp.form).put("name_kr", sp.nameKr).put("cp", info.cp ?: JSONObject.NULL)
            .put("atk_iv", c.ivs?.first ?: JSONObject.NULL).put("def_iv", c.ivs?.second ?: JSONObject.NULL).put("sta_iv", c.ivs?.third ?: JSONObject.NULL)
            .put("status", status).put("purposes", JSONArray())
        val en = info.moves.mapNotNull { data?.moveKrToEn?.get(it.nameKr) }
        if (en.isNotEmpty()) row.put("fast_move", en[0])
        if (en.size > 1) row.put("charged_moves", JSONArray(en.drop(1).take(2)))
        val memo = buildString {
            append("수집기")
            val sm = c.summary
            if (c.ivs == null && sm != null && !sm.empty) append(" · 개체값 후보 ${r(sm.percentRange!!)}%")
            if (info.hp != null) append(" · HP${info.hp}")
        }
        return row.put("memo", memo)
    }

    fun build(result: ResultStore.Result?, actions: Actions): View {
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundResource(R.drawable.card_bg); setPadding(dp(14), dp(12), dp(14), dp(12)) }
        fun text(s: String, size: Float = 13f, color: Int = 0xFFC8D6E5.toInt(), bold: Boolean = false) = TextView(ctx).apply { text = s; textSize = size; setTextColor(color); if (bold) setTypeface(null, Typeface.BOLD); root.addView(this) }
        fun closeBtn() = Button(ctx).apply { text = "닫기"; setOnClickListener { actions.onClose() } }

        when (result) {
            null -> { text("결과 없음", 14f, 0xFFFFD93D.toInt(), true); root.addView(closeBtn()) }
            is ResultStore.Result.Error -> { text("분석 오류", 14f, 0xFFFF6B6B.toInt(), true); text(result.message, 12f); root.addView(closeBtn()) }
            is ResultStore.Result.Blocked -> {
                text("⛔ 캡처가 차단됨 (검은 화면)", 15f, 0xFFFF6B6B.toInt(), true)
                text("캡처 이미지 평균 밝기 ${"%.1f".format(result.brightness)}/255 — 앱이 화면 캡처를 막고 있습니다(FLAG_SECURE 추정). 이 화면에서는 판독할 수 없습니다.", 12f)
                text("디버그 로그에 기록됨", 10f, 0xFF8899AA.toInt())
                root.addView(closeBtn())
            }
            is ResultStore.Result.Screen -> {
                val info = result.info
                val ap = result.appraisal
                val sp = result.chosen ?: info?.species
                if (info == null) {
                    text("평가 판독만 있습니다", 14f, 0xFFFFD93D.toInt(), true)
                    text("공${ap?.atk ?: "?"} / 방${ap?.def ?: "?"} / HP${ap?.sta ?: "?"} — 포켓몬 상세 화면에서 다시 캡처하면 결과에 합칩니다")
                    root.addView(closeBtn()); return root
                }
                text("${sp?.nameKr ?: (info.nameRaw ?: "종 미인식")}  CP${info.cp ?: "?"}  HP${info.hp ?: "?"}", 16f, Color.WHITE, true)
                if (sp == null || info.nameScore < 0.85) {
                    val data = repo.loadCached()
                    val names = data?.species?.map { it.nameKr } ?: emptyList()
                    val q = info.nameRaw ?: ""
                    val top = names.map { it to Fuzzy.similarity(q, it) }.sortedByDescending { it.second }.take(3).map { it.first }
                    if (top.isNotEmpty() && data != null) {
                        text("종 선택 (인식 ${(info.nameScore * 100).toInt()}%):", 11f, 0xFFFFD93D.toInt())
                        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
                        for (n in top) row.addView(Button(ctx).apply { text = n; textSize = 12f; setOnClickListener { actions.onChooseSpecies(data.species.first { it.nameKr == n }) } })
                        root.addView(row)
                    }
                }
                val c = compute(info, sp, ap)
                text(c.ivText, 12f)
                if (info.moves.isNotEmpty()) text("기술: " + info.moves.joinToString(" / ") { it.nameKr }, 12f) else text("기술: 미인식", 12f, 0xFF8899AA.toInt())
                c.verdict?.let { text(it.raid, 12f, 0xFF4ECDC4.toInt()); if (it.league.isNotBlank()) text(it.league, 12f, 0xFFA890F0.toInt()) }
                for (w in info.warnings) text("⚠️ $w", 10f, 0xFFFFD93D.toInt())
                text("계산: 기기 내 결정적 공식 (AI 미사용)", 9f, 0xFF576574.toInt())
                val btns = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
                btns.addView(Button(ctx).apply { text = "보관"; isEnabled = sp != null && paired; setOnClickListener { actions.onSave(info, sp!!, c, "keep") } })
                btns.addView(Button(ctx).apply { text = "박사행"; isEnabled = sp != null && paired; setOnClickListener { actions.onSave(info, sp!!, c, "transfer") } })
                btns.addView(closeBtn())
                root.addView(btns)
                if (!paired) text("저장하려면 앱에서 기기 연결이 필요합니다 (웹 📱 기기 연결 → 코드 입력)", 10f, 0xFFFF6B6B.toInt())
            }
        }
        return root
    }
}
