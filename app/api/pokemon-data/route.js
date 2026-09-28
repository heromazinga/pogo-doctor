import { NextResponse } from "next/server";
import { getPokemonDataset } from "../../lib/pokemonData";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // PokeMiners 원본(약 20MB) 수신을 고려

// 응답 형식
// {
//   generatedAt, pokemon: [...], moveNamesKr: { "Thunder Shock": "전기쇼크", ... },
//   dataSources: [{ name, url, fetchedAt, ok, count, error? }],
//   dataWarnings: [...최대 100건], dataWarningCount, dataWarningCounts: { stats, moves, types }
// }
export async function GET() {
  try {
    const data = await getPokemonDataset();
    if (!data.pokemon || data.pokemon.length === 0) {
      return NextResponse.json(
        { error: "모든 데이터 소스에서 포켓몬 데이터를 받지 못했습니다", dataSources: data.dataSources, dataWarnings: data.dataWarnings },
        { status: 503 }
      );
    }
    return NextResponse.json(data, {
      headers: {
        // Vercel CDN 캐시 1시간, 갱신 중 최대 6시간 이전 응답 제공
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
