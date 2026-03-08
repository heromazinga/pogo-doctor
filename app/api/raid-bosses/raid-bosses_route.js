import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 15; // 15분 캐시 (레이드 보스는 자주 바뀔 수 있음)

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const res = await fetch("https://pogoapi.net/api/v1/raid_bosses.json");
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch raid bosses" }, { status: 502 });
    }

    const data = await res.json();
    const tiers = {
      "Tier 1": "⭐",
      "Tier 3": "⭐⭐⭐",
      "Tier 5": "⭐⭐⭐⭐⭐",
      "Mega": "🔥 메가",
    };

    const bosses = [];
    for (const [tier, arr] of Object.entries(data)) {
      if (!Array.isArray(arr)) continue;
      const tierLabel = tiers[tier] || tier;
      for (const boss of arr) {
        bosses.push({
          name: boss.pokemon_name,
          id: boss.pokemon_id,
          form: boss.form || "Normal",
          tier: tierLabel,
          tierKey: tier,
        });
      }
    }

    cache = bosses;
    cacheTime = Date.now();
    return NextResponse.json(bosses);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
