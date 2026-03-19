import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 30; // 30분 캐시 (snacknap은 5분마다 갱신)

const TIER_MAP = {
  "Tier 1": { key: "tier1", label: "1성", priority: false },
  "Tier 2": { key: "tier2", label: "2성", priority: false },
  "Tier 3": { key: "tier3", label: "3성", priority: true },
  "Tier 5": { key: "tier5", label: "5성", priority: true },
  "Gigantamax": { key: "gmax", label: "거다이맥스", priority: true },
};

function extractDexId(url) {
  // https://www.raids.nl/assets/img/sprites-v2/webp/1.webp → 1
  const m = url.match(/\/webp\/(\d+)\.webp/);
  return m ? parseInt(m[1]) : 0;
}

function parseMaxBattles(html) {
  const bosses = [];
  let currentTier = { key: "tier1", label: "1성", priority: false };

  // h2 태그로 섹션 분리
  const sections = html.split(/<h2[^>]*>/i);

  for (const section of sections) {
    // 티어 헤딩 파싱
    const tierMatch = section.match(/^([^<]+)/);
    if (tierMatch) {
      const tierText = tierMatch[1].trim();
      for (const [key, val] of Object.entries(TIER_MAP)) {
        if (tierText.includes(key)) {
          currentTier = val;
          break;
        }
      }
    }

    // 포켓몬 파싱: title="D-Max Bulbasaur" 또는 title="G-Max Venusaur"
    const pokeMatches = [...section.matchAll(/title="([^"]+)"[^>]*>[\s\S]*?\/webp\/(\d+)\.webp/g)];

    for (const match of pokeMatches) {
      const fullName = match[1]; // "D-Max Bulbasaur"
      const dexId = parseInt(match[2]);

      if (!fullName || !dexId) continue;

      // 이름에서 prefix 제거 → "Bulbasaur"
      const baseName = fullName.replace(/^[DG]-Max\s+/i, "").trim();
      const isGmax = fullName.toLowerCase().startsWith("g-max") || currentTier.key === "gmax";

      // 해당 포켓몬 블록에서 타입/CP 추출
      const afterTitle = section.slice(section.indexOf(match[0]));
      const blockEnd = afterTitle.search(/<\/a>/i);
      const block = afterTitle.slice(0, blockEnd > 0 ? blockEnd + 4 : 400);

      // 타입
      const types = [...block.matchAll(/alt="([a-z]+)"[^>]*>/g)]
        .map(m => m[1])
        .filter(t => !["shiny", "search"].includes(t));

      // 이로치 여부
      const shiny = /is_shiny/i.test(block);

      // CP 범위
      const cpMatch = block.match(/CP\s*([\d,]+)\s*[-–]\s*\*?\*?([\d,]+)/i);
      const cpMin = cpMatch ? parseInt(cpMatch[1].replace(",", "")) : 0;
      const cpMax = cpMatch ? parseInt(cpMatch[2].replace(",", "")) : 0;

      bosses.push({
        name: baseName,
        nameKr: baseName, // page.jsx에서 allPokemon으로 매칭
        fullName,
        id: dexId,
        isGmax,
        tier: currentTier.label,
        tierKey: currentTier.key,
        isPriority: currentTier.priority || isGmax,
        types,
        shiny,
        cpMin,
        cpMax,
      });
    }
  }

  // 중복 제거 (같은 dexId + tier)
  const seen = new Set();
  return bosses.filter(b => {
    const key = `${b.id}-${b.tierKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const res = await fetch("https://www.snacknap.com/max-battles", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PoGoDoctorBot/1.0)",
        "Accept": "text/html",
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "Failed to fetch max battles" }, { status: 502 });
    }

    const html = await res.text();
    const bosses = parseMaxBattles(html);

    if (bosses.length === 0) {
      // 파싱 실패 시 캐시 반환
      if (cache) return NextResponse.json(cache);
      return NextResponse.json([]);
    }

    cache = bosses;
    cacheTime = Date.now();
    return NextResponse.json(bosses);
  } catch (e) {
    if (cache) return NextResponse.json(cache);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
