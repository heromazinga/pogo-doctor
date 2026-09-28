// snacknap.com/max-battles HTML 파서 (라우트와 분리해 단독 테스트 가능)

const TIER_MAP = {
  "Tier 1": { key: "tier1", label: "1성", priority: false },
  "Tier 2": { key: "tier2", label: "2성", priority: false },
  "Tier 3": { key: "tier3", label: "3성", priority: true },
  "Tier 5": { key: "tier5", label: "5성", priority: true },
  "Gigantamax": { key: "gmax", label: "거다이맥스", priority: true },
};

// 스프라이트 URL 에서 도감 번호 추출. raids.nl(.../webp/1.webp) 외에 .../1.png, pm0001_00.png 형식도 허용
const SPRITE_ID_RE = /\/(?:pm0*)?(\d{1,4})(?:_\d+)?\.(?:webp|png)/;
export function extractDexId(url) {
  const m = String(url || "").match(SPRITE_ID_RE);
  return m ? parseInt(m[1]) : 0;
}

export function parseMaxBattles(html) {
  const bosses = [];
  let currentTier = { key: "tier1", label: "1성", priority: false };

  // h2 태그로 섹션 분리
  const sections = String(html || "").split(/<h2[^>]*>/i);

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

    // 포켓몬 파싱: title="D-Max Bulbasaur" 또는 title="G-Max Venusaur" 뒤에 오는 스프라이트 URL
    const pokeMatches = [...section.matchAll(/title="([DG]-Max[^"]+)"[^>]*>[\s\S]{0,600}?src="([^"]+)"/gi)];

    for (const match of pokeMatches) {
      const fullName = match[1]; // "D-Max Bulbasaur"
      const dexId = extractDexId(match[2]);

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
        .map((m) => m[1])
        .filter((t) => !["shiny", "search"].includes(t));

      // 이로치 여부
      const shiny = /is_shiny/i.test(block);

      // CP 범위
      const cpMatch = block.match(/CP\s*([\d,]+)\s*[-–]\s*\*?\*?([\d,]+)/i);
      const cpMin = cpMatch ? parseInt(cpMatch[1].replace(/,/g, "")) : 0;
      const cpMax = cpMatch ? parseInt(cpMatch[2].replace(/,/g, "")) : 0;

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
  return bosses.filter((b) => {
    const key = `${b.id}-${b.tierKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
