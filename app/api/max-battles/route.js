import { NextResponse } from "next/server";
import { parseMaxBattles } from "../../lib/maxBattles";

export const dynamic = "force-dynamic";
let cache = null, cacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 30; // 30분 캐시 (snacknap은 5분마다 갱신)

// snacknap.com/max-battles → 현재 맥스배틀 보스 (웹 표시용). 판정의 맥스배틀 종 목록은 app/data/maxBattleSpecies.json (4-C.3)
export async function GET() {
  if (cache && Date.now() - cacheTime < CACHE_DURATION) return NextResponse.json(cache);
  try {
    const res = await fetch("https://www.snacknap.com/max-battles", { headers: { "User-Agent": "Mozilla/5.0 (compatible; PoGoDoctorBot/1.0)", Accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) { if (cache) return NextResponse.json(cache); return NextResponse.json({ error: `snacknap.com 응답 오류 (HTTP ${res.status})` }, { status: 502 }); }
    const bosses = parseMaxBattles(await res.text());
    if (bosses.length === 0) {
      if (cache) return NextResponse.json(cache);
      console.warn("[max-battles] snacknap 페이지에서 보스를 찾지 못함 (HTML 구조 변경 가능성)");
      return NextResponse.json({ error: "snacknap.com 페이지 형식이 바뀌어 맥스배틀 정보를 읽지 못했습니다" }, { status: 502 });
    }
    cache = bosses; cacheTime = Date.now();
    return NextResponse.json(bosses);
  } catch (e) {
    if (cache) return NextResponse.json(cache);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
