import { NextResponse } from "next/server";
import { getPokemonDataset, findPokemon } from "../../lib/pokemonData";
import { buildRaidTeam, buildRocketTeam } from "../../lib/teamScore";

export const maxDuration = 60;

// 팀 추천은 서버의 결정적 계산만 사용한다 (AI 호출 없음)
// body: { mode: "raid" | "rocket", boss?: {id, form, name, types?}, lineup?: {...}, myPokemon: my_pokemon 행 배열 }
export async function POST(req) {
  try {
    const body = await req.json();
    const { mode, boss, lineup, myPokemon } = body;
    if (!Array.isArray(myPokemon)) return NextResponse.json({ error: "myPokemon 배열이 필요합니다" }, { status: 400 });
    const dataset = await getPokemonDataset();
    if (!dataset?.pokemon?.length) return NextResponse.json({ error: "포켓몬 데이터 없음" }, { status: 503 });

    if (mode === "raid") {
      const sp = findPokemon(dataset, { id: boss?.id, form: boss?.form, name: boss?.name });
      if (!sp) return NextResponse.json({ error: "보스 포켓몬을 데이터에서 찾지 못했습니다" }, { status: 404 });
      const bossData = { ...sp, types: boss?.types?.length ? boss.types : sp.types };
      return NextResponse.json({ mode, ...buildRaidTeam(myPokemon, bossData, dataset), generatedAt: dataset.generatedAt });
    }
    if (mode === "rocket") {
      if (!lineup?.name) return NextResponse.json({ error: "lineup 이 필요합니다" }, { status: 400 });
      return NextResponse.json({ mode, ...buildRocketTeam(myPokemon, lineup, dataset), generatedAt: dataset.generatedAt });
    }
    return NextResponse.json({ error: `지원하지 않는 mode: ${mode}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
