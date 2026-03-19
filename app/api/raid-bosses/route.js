import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6시간 캐시 (레이드는 2주마다 바뀜)

// ScrapedDuck tier 문자열 → 내부 tierKey 매핑
const TIER_MAP = {
  "1-Star Raids":  { key: "lvl1",         label: "⭐",           priority: false },
  "3-Star Raids":  { key: "lvl3",         label: "⭐⭐⭐",       priority: false },
  "5-Star Raids":  { key: "lvl5",         label: "⭐⭐⭐⭐⭐",   priority: true  },
  "Mega Raids":    { key: "mega",         label: "메가",          priority: true  },
  "Elite Raids":   { key: "elite",        label: "엘리트",        priority: true  },
  "Ultra Beast":   { key: "ultra_beast",  label: "UB",            priority: true  },
};

// ScrapedDuck 이미지 URL에서 덱스 번호 추출
// 예: .../poke_capture_0144_000_... → 144
// 예: .../pm144.icon.png → 144
function extractDexId(imageUrl) {
  if (!imageUrl) return 0;
  // poke_capture_XXXX 형식
  const captureMatch = imageUrl.match(/poke_capture_0*(\d+)/);
  if (captureMatch) return parseInt(captureMatch[1]);
  // pm XXX 형식
  const pmMatch = imageUrl.match(/pm0*(\d+)/);
  if (pmMatch) return parseInt(pmMatch[1]);
  return 0;
}

// "Shadow Zacian" → { isShadow: true, baseName: "Zacian" }
function parseName(name) {
  if (name.startsWith("Shadow ")) {
    return { isShadow: true, baseName: name.slice(7) };
  }
  return { isShadow: false, baseName: name };
}

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.min.json",
      { next: { revalidate: 0 } }
    );
    if (!res.ok) {
      // ScrapedDuck 실패 시 캐시 있으면 캐시 반환
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "Failed to fetch raid bosses" }, { status: 502 });
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "Unexpected data format" }, { status: 500 });
    }

    const bosses = data.map((boss) => {
      const tierInfo = TIER_MAP[boss.tier] || { key: "unknown", label: boss.tier, priority: false };
      const { isShadow, baseName } = parseName(boss.name || "");
      const dexId = extractDexId(boss.image);

      // 그림자면 tierKey에 shadow_ 접두사
      const tierKey = isShadow
        ? `shadow_${tierInfo.key}`
        : tierInfo.key;

      // 그림자 5성은 priority
      const isPriority = tierInfo.priority || (isShadow && tierInfo.key === "lvl5");

      return {
        name: baseName,
        nameKr: baseName, // 한국어 이름은 page.jsx에서 allPokemon 매칭으로 처리
        id: dexId,
        form: "Normal",
        tier: tierInfo.label,
        tierKey,
        isPriority,
        isShadow,
        shiny: boss.canBeShiny || false,
        types: (boss.types || []).map((t) => t.name),
        image: boss.image || "",
        cpMin: boss.combatPower?.normal?.min || 0,
        cpMax: boss.combatPower?.normal?.max || 0,
      };
    });

    cache = bosses;
    cacheTime = Date.now();
    return NextResponse.json(bosses);
  } catch (e) {
    if (cache) return NextResponse.json(cache);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
