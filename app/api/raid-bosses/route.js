import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 30; // 30분 캐시

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const res = await fetch("https://pokemon-go-api.github.io/pokemon-go-api/api/raidboss.json");
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch raid bosses" }, { status: 502 });
    }

    const data = await res.json();
    const currentList = data.currentList;
    if (!currentList) {
      return NextResponse.json({ error: "No currentList found" }, { status: 500 });
    }

    const tierLabels = {
      lvl1: "⭐",
      lvl3: "⭐⭐⭐",
      lvl5: "⭐⭐⭐⭐⭐",
      mega: "메가",
      ultra_beast: "UB",
      shadow_lvl1: "⭐",
      shadow_lvl3: "⭐⭐⭐",
      shadow_lvl5: "⭐⭐⭐⭐⭐",
    };

    // 5성, 메가, UB, 그림자5성 위주로 표시 (1성/3성은 관심도 낮음)
    const priorityTiers = ["lvl5", "mega", "ultra_beast", "shadow_lvl5"];

    const bosses = [];
    for (const [tier, arr] of Object.entries(currentList)) {
      if (!Array.isArray(arr)) continue;
      const tierLabel = tierLabels[tier] || tier;
      const isPriority = priorityTiers.includes(tier);

      for (const boss of arr) {
        if (!boss.id || !boss.names) continue;

        // Extract dex number from asset URL (pm144.icon.png → 144)
        let dexId = 0;
        const assetUrl = boss.assets?.image || "";
        const match = assetUrl.match(/pm(\d+)/);
        if (match) dexId = parseInt(match[1]);

        bosses.push({
          name: boss.names.English || boss.id,
          nameKr: boss.names.Korean || boss.names.English || boss.id,
          id: dexId,
          form: boss.form || "Normal",
          tier: tierLabel,
          tierKey: tier,
          isPriority,
          shiny: boss.shiny || false,
          types: boss.types || [],
          image: assetUrl,
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
