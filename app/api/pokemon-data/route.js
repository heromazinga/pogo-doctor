import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60;

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const [statsRes, movesRes, namesRes] = await Promise.all([
      fetch("https://pogoapi.net/api/v1/pokemon_stats.json"),
      fetch("https://pogoapi.net/api/v1/current_pokemon_moves.json"),
      fetch("https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json").catch(() => null),
    ]);

    const stats = await statsRes.json();
    const moves = await movesRes.json();

    const krNames = {};
    if (namesRes && namesRes.ok) {
      try {
        const namesData = await namesRes.json();
        if (Array.isArray(namesData)) {
          for (const p of namesData) {
            const dex = p.dexNr || p.dex_nr || p.id;
            const kr = p.names?.Korean || p.names?.ko || null;
            if (dex && kr && !krNames[dex]) krNames[dex] = kr;
          }
        }
      } catch (e) {}
    }

    const movesMap = {};
    for (const m of moves) {
      const key = m.pokemon_id;
      if (!movesMap[key]) movesMap[key] = [];
      movesMap[key].push(m);
    }

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

    cache = pokemon;
    cacheTime = Date.now();
    return NextResponse.json(pokemon);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
