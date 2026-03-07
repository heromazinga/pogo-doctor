import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) {
    return NextResponse.json(cache);
  }

  try {
    const [statsRes, movesRes] = await Promise.all([
      fetch("https://pogoapi.net/api/v1/pokemon_stats.json"),
      fetch("https://pogoapi.net/api/v1/current_pokemon_moves.json"),
    ]);

    const stats = await statsRes.json();
    const moves = await movesRes.json();

    // Build moves lookup by pokemon_id
    const movesMap = {};
    for (const m of moves) {
      const key = m.pokemon_id;
      if (!movesMap[key]) movesMap[key] = [];
      movesMap[key].push(m);
    }

    // Combine into one list
    const pokemon = stats.map((s) => ({
      id: s.id,
      name: s.pokemon_name,
      form: s.form || "Normal",
      baseAttack: s.base_attack,
      baseDefense: s.base_defense,
      baseStamina: s.base_stamina,
      moves: (movesMap[s.id] || []).map((m) => ({
        form: m.form,
        fast: m.fast_moves || [],
        charged: m.charged_moves || [],
        eliteFast: m.elite_fast_moves || [],
        eliteCharged: m.elite_charged_moves || [],
      })),
    }));

    cache = pokemon;
    cacheTime = Date.now();

    return NextResponse.json(pokemon);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
