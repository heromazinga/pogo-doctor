import { NextResponse } from "next/server";

let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6시간

const URL_ = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/rocketLineups.min.json";

export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) return NextResponse.json(cache);
  try {
    const res = await fetch(URL_, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: `ScrapedDuck 응답 오류 (HTTP ${res.status})` }, { status: 502 });
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      if (cache) return NextResponse.json(cache);
      return NextResponse.json({ error: "로켓단 라인업 형식 오류" }, { status: 502 });
    }
    // 화면에 필요한 필드만
    const lineups = data.map((l) => ({
      name: l.name, title: l.title, type: l.type || "",
      firstPokemon: (l.firstPokemon || []).map((p) => ({ name: p.name, types: p.types || [], image: p.image || "" })),
      secondPokemon: (l.secondPokemon || []).map((p) => ({ name: p.name, types: p.types || [], image: p.image || "" })),
      thirdPokemon: (l.thirdPokemon || []).map((p) => ({ name: p.name, types: p.types || [], image: p.image || "" })),
    }));
    cache = { fetchedAt: new Date().toISOString(), lineups };
    cacheTime = Date.now();
    return NextResponse.json(cache);
  } catch (e) {
    if (cache) return NextResponse.json(cache);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
