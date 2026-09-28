package com.pogodoctor.app

import android.content.Context
import com.pogodoctor.core.SpeciesRef
import org.json.JSONObject
import java.io.File

// 웹앱 /api/pokemon-data (종족값·기술·한국어명) 를 받아 기기에 캐시. 오프라인이면 캐시 사용.
class DataRepo(private val ctx: Context, private val prefs: Prefs) {
    private val file = File(ctx.filesDir, "pokemon-data.json")

    class Data(val species: List<SpeciesRef>, val moveKrToEn: Map<String, String>, val allMoveNamesKr: List<String>, val generatedAt: String?)

    @Volatile var data: Data? = null; private set

    fun loadCached(): Data? {
        if (data != null) return data
        if (!file.exists()) return null
        return try { parse(file.readText()).also { data = it } } catch (_: Exception) { null }
    }

    // 네트워크 갱신 (실패 시 예외). 24시간 지났거나 force 일 때만
    fun refresh(api: Api, force: Boolean = false): Data {
        val stale = System.currentTimeMillis() - prefs.dataUpdatedAt > 24L * 3600 * 1000
        if (!force && !stale && loadCached() != null) return data!!
        val text = api.requestRaw("/api/pokemon-data")
        val d = parse(text)
        file.writeText(text)
        prefs.dataUpdatedAt = System.currentTimeMillis()
        data = d
        return d
    }

    private fun parse(text: String): Data {
        val root = JSONObject(text)
        val names = root.optJSONObject("moveNamesKr") ?: JSONObject()
        val krToEn = HashMap<String, String>()
        for (k in names.keys()) krToEn[names.getString(k)] = k
        val arr = root.getJSONArray("pokemon")
        val list = ArrayList<SpeciesRef>()
        for (i in 0 until arr.length()) {
            val p = arr.getJSONObject(i)
            val nameKr = p.optString("nameKr", "").ifBlank { p.optString("name", "") }
            if (nameKr.isBlank() || p.optInt("baseAttack", 0) == 0) continue
            val moves = ArrayList<String>()
            for (key in listOf("fast", "charged", "eliteFast", "eliteCharged", "signatureFast", "signatureCharged", "unverifiedFast", "unverifiedCharged", "unverifiedEliteFast", "unverifiedEliteCharged")) {
                val a = p.optJSONArray(key) ?: continue
                for (j in 0 until a.length()) { val en = a.getString(j); moves.add(names.optString(en, en)) }
            }
            list.add(SpeciesRef(p.getInt("id"), p.optString("form", "Normal"), nameKr, p.getInt("baseAttack"), p.getInt("baseDefense"), p.getInt("baseStamina"), moves.distinct()))
        }
        // 같은 한국어명(폼 차이)은 Normal 폼 우선 1개만 이름 매칭 대상으로
        val byName = LinkedHashMap<String, SpeciesRef>()
        for (s in list.sortedBy { if (it.form == "Normal") 0 else 1 }) byName.putIfAbsent(s.nameKr, s)
        return Data(byName.values.toList(), krToEn, krToEn.keys.toList(), root.optString("generatedAt", "").takeIf { it.isNotBlank() })
    }
}
