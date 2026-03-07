import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60;

// Move name slug for PokeAPI: "Fire Punch" → "fire-punch"
function toSlug(name) {
  return name.toLowerCase().replace(/[()'']/g, "").replace(/\s+/g, "-").replace(/--+/g, "-");
}

// Fetch Korean move names from PokeAPI (server-side, batched)
async function fetchMoveNamesKr(allMoveNames) {
  const krMap = {};
  const unique = [...new Set(allMoveNames)];
  const batchSize = 30;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (engName) => {
        const slug = toSlug(engName);
        if (!slug) return;
        try {
          const r = await fetch(`https://pokeapi.co/api/v2/move/${slug}`);
          if (!r.ok) return;
          const d = await r.json();
          const kr = d.names?.find((n) => n.language.name === "ko");
          if (kr) krMap[engName] = kr.name;
        } catch {}
      })
    );
  }

  return krMap;
}

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    // Fetch stats, moves, and Korean names in parallel
    const [statsRes, movesRes, namesRes] = await Promise.all([
      fetch("https://pogoapi.net/api/v1/pokemon_stats.json"),
      fetch("https://pogoapi.net/api/v1/current_pokemon_moves.json"),
      fetch("https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json").catch(() => null),
    ]);

    const stats = await statsRes.json();
    const moves = await movesRes.json();

    // Build Korean name lookup from pokemon-go-api
    const krNames = {};
    if (namesRes && namesRes.ok) {
      try {
        const namesData = await namesRes.json();
        if (Array.isArray(namesData)) {
          for (const p of namesData) {
            const dex = p.dexNr || p.dex_nr || p.id;
            const kr = p.names?.Korean || p.names?.ko || null;
            if (dex && kr && !krNames[dex]) {
              krNames[dex] = kr;
            }
          }
        }
      } catch (e) {
        // Korean names failed, continue with English only
      }
    }

    // Build moves lookup
    const movesMap = {};
    for (const m of moves) {
      const key = m.pokemon_id;
      if (!movesMap[key]) movesMap[key] = [];
      movesMap[key].push(m);
    }

    // Collect all unique move names for Korean translation
    const allMoveNames = new Set();
    for (const m of moves) {
      (m.fast_moves || []).forEach((n) => allMoveNames.add(n));
      (m.charged_moves || []).forEach((n) => allMoveNames.add(n));
      (m.elite_fast_moves || []).forEach((n) => allMoveNames.add(n));
      (m.elite_charged_moves || []).forEach((n) => allMoveNames.add(n));
    }

    // Fetch Korean move names from PokeAPI (server-side cached)
    const moveNamesKr = await fetchMoveNamesKr([...allMoveNames]);

    // Combine everything
    const pokemon = stats.map((s) => {
      const pokeMoves = movesMap[s.pokemon_id] || [];
      const matchedMoves = pokeMoves.find((m) => m.form === s.form) || pokeMoves[0] || {};

      return {
        id: s.pokemon_id,
        name: s.pokemon_name,
        nameKr: krNames[s.pokemon_id] || s.pokemon_name,
        form: s.form || "Normal",
        baseAttack: s.base_attack,
        baseDefense: s.base_defense,
        baseStamina: s.base_stamina,
        fast: matchedMoves.fast_moves || [],
        charged: matchedMoves.charged_moves || [],
        eliteFast: matchedMoves.elite_fast_moves || [],
        eliteCharged: matchedMoves.elite_charged_moves || [],
      };
    });

    // Return both pokemon data and move name translations
    const result = { pokemon, moveNamesKr };
    cache = result;
    cacheTime = Date.now();

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
