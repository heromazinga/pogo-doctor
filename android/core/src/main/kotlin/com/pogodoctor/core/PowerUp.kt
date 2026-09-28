package com.pogodoctor.core

// 강화 비용 → 레벨 범위. 출처: PokeMiners game master latest.json `POKEMON_UPGRADE_SETTINGS.pokemonUpgrades`
//   stardustCost[49], candyCost[50], xlCandyCost[10], upgradesPerLevel=2, xlCandyMinPokemonLevel=40 (2026-09 기준)
// 인덱스 = floor(레벨)-1 (같은 정수 레벨의 x.0 / x.5 강화 비용이 같다). XL 사탕은 L40 이상, 인덱스 = floor(레벨)-40.
object PowerUp {
    val STARDUST = intArrayOf(200,200,400,400,600,600,800,800,1000,1000,1300,1300,1600,1600,1900,1900,2200,2200,2500,2500,3000,3000,3500,3500,4000,4000,4500,4500,5000,5000,6000,6000,7000,7000,8000,8000,9000,9000,10000,10000,11000,11000,12000,12000,13000,13000,14000,14000,15000)
    val CANDY = intArrayOf(1,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,2,3,3,3,3,3,4,4,4,4,4,6,6,8,8,10,10,12,12,15,0,0,0,0,0,0,0,0,0,0,0)
    val XL_CANDY = intArrayOf(10,10,12,12,15,15,17,17,20,20)

    data class Cost(val stardust: Int, val candy: Int, val xlCandy: Int)

    // 현재 레벨에서 한 단계(0.5) 강화 비용. 섀도(×1.2)·정화(×0.9) 배율은 호출측에서 적용
    fun costAt(level: Double): Cost? {
        val i = level.toInt() - 1
        if (level < 1.0 || i >= STARDUST.size) return null
        val candy = if (i < CANDY.size) CANDY[i] else 0
        val xl = if (level >= 40.0 && level.toInt() - 40 < XL_CANDY.size) XL_CANDY[level.toInt() - 40] else 0
        return Cost(STARDUST[i], candy, xl)
    }

    // OCR 로 읽은 비용(일부 null 가능)과 일치하는 현재 레벨 목록 (0.5 단위). 섀도/정화 배율 후보도 함께 허용
    fun levelsForCost(stardust: Int?, candy: Int?, xlCandy: Int?): List<Double> {
        if (stardust == null && candy == null && xlCandy == null) return emptyList()
        val out = ArrayList<Double>()
        for (lv in Cpm.levels()) {
            val c = costAt(lv) ?: continue
            val dustOk = stardust == null || listOf(1.0, 1.2, 0.9).any { m -> Math.round(c.stardust * m).toInt() == stardust }
            val candyOk = candy == null || listOf(1.0, 1.2, 0.9).any { m -> Math.round(c.candy * m).toInt() == candy } || (candy == 0 && c.candy == 0)
            val xlOk = xlCandy == null || c.xlCandy == xlCandy || (xlCandy == 0 && c.xlCandy == 0)
            if (dustOk && candyOk && xlOk) out.add(lv)
        }
        return out
    }

    data class Parsed(val stardust: Int?, val candy: Int?, val xlCandy: Int?)

    // 상세 화면 하단(강화 버튼 주변) OCR 줄에서 비용 추출: 별의모래 = 200 이상의 숫자 중 표에 있는 값, 사탕 = 1~30 의 작은 숫자들
    // 하단 영역 판별: 화면 높이의 65% 아래 줄만 본다. XL 은 "XL" 표기가 같은 줄/인접 줄에 있는 작은 숫자
    fun parse(lines: List<OcrLine>, screenHeight: Int): Parsed {
        val bottom = lines.filter { screenHeight <= 0 || it.centerY >= screenHeight * 0.65 }
        val dustSet = STARDUST.flatMap { d -> listOf(d, Math.round(d * 1.2).toInt(), Math.round(d * 0.9).toInt()) }.toSet()
        var dust: Int? = null; var candy: Int? = null; var xl: Int? = null
        val numRe = Regex("(?<![0-9])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,6})(?![0-9])")
        for ((idx, l) in bottom.withIndex()) {
            val t = l.text
            val nums = numRe.findAll(t).map { it.groupValues[1].replace(",", "").toIntOrNull() }.filterNotNull().toList()
            // XL 판정: 같은 줄에 XL 이 있거나, 바로 다음 줄이 숫자 없는 "XL" 토큰일 때
            val next = if (idx + 1 < bottom.size) bottom[idx + 1].text else ""
            val hasXl = t.contains("XL", true) || (next.contains("XL", true) && !next.any { it.isDigit() })
            for (n in nums) {
                if (n >= 200 && n in dustSet) { if (dust == null) dust = n }
                else if (n in 1..30) { if (hasXl && xl == null) xl = n else if (!hasXl && candy == null) candy = n }
            }
        }
        return Parsed(dust, candy, xl)
    }
}
