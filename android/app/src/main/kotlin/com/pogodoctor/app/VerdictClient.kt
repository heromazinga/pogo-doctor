package com.pogodoctor.app

import com.pogodoctor.core.IvCalc
import com.pogodoctor.core.ScreenInfo
import com.pogodoctor.core.SpeciesRef
import org.json.JSONArray
import org.json.JSONObject

// 4-A 서버 판정(POST /api/verdict) 호출 + 응답 파싱. 오프라인이면 호출측이 기기 내 간이 판정으로 대체한다.
// 보내는 것: 종·폼·개체값 후보(최대 300)·CP·HP·기술(영어 ID)·보관함 여유. 포획 장소는 보내지 않는다.
object VerdictClient {
    data class Tag(val name: String, val tier: String, val reason: String)
    data class Verdict(
        val tier: String, val summary: String, val tags: List<Tag>, val recommendedTags: List<String>, val purposes: List<String>,
        val collect: List<String>, val eventNote: String?, val confident: Boolean, val warnings: List<String>, val candidates: Int,
    ) {
        val tierLabel: String get() = when (tier) { "main" -> "✅ 주력"; "hold" -> "🟡 보류"; "transfer" -> "❌ 박사행"; else -> "❔ 평가 화면 캡처 필요" }
    }

    fun body(sp: SpeciesRef, info: ScreenInfo, cands: List<IvCalc.Candidate>, moveEn: List<String>, storageMode: String): JSONObject {
        val b = JSONObject().put("species_id", sp.id).put("form", sp.form).put("storageMode", storageMode)
        info.cp?.let { b.put("cp", it) }; info.hp?.let { b.put("hp", it) }
        if (cands.isNotEmpty()) {
            val arr = JSONArray()
            for (c in cands.take(300)) arr.put(JSONObject().put("level", c.level).put("atk", c.atk).put("def", c.def).put("sta", c.sta))
            b.put("ivCandidates", arr)
        }
        if (moveEn.isNotEmpty()) { b.put("fast_move", moveEn[0]); if (moveEn.size > 1) b.put("charged_moves", JSONArray(moveEn.drop(1).take(2))) }
        return b
    }

    fun parse(res: JSONObject): Verdict {
        val v = res.optJSONObject("verdict") ?: res
        fun strs(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { a!!.optString(it) }
        val tags = ArrayList<Tag>()
        val ta = v.optJSONArray("tags")
        for (i in 0 until (ta?.length() ?: 0)) { val t = ta!!.getJSONObject(i); tags.add(Tag(t.optString("name"), t.optString("tier"), t.optString("reason"))) }
        val collect = ArrayList<String>()
        val ca = v.optJSONArray("collect")
        for (i in 0 until (ca?.length() ?: 0)) collect.add(ca!!.getJSONObject(i).optString("reason"))
        return Verdict(
            v.optString("tier", "need_appraisal"), v.optString("summary", ""), tags, strs(v.optJSONArray("recommendedTags")), strs(v.optJSONArray("purposes")),
            collect, v.optJSONObject("event")?.optString("note"), v.optBoolean("confident", false), strs(v.optJSONArray("warnings")), v.optInt("candidates", 0),
        )
    }
}
