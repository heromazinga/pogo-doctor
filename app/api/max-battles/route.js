import { NextResponse } from "next/server";
import { fetchMaxBattleBosses } from "../../lib/maxBattleSpecies";

export const dynamic = "force-dynamic";

// snacknap.com/max-battles → 현재 맥스배틀 보스 (30분 캐시, 장애 시 이전 캐시). 4-C.2: 판정의 맥스배틀 종 목록과 같은 소스(app/lib/maxBattleSpecies.js)
export async function GET() {
  const r = await fetchMaxBattleBosses();
  if (r.bosses.length) return NextResponse.json(r.bosses);
  return NextResponse.json({ error: r.error ? `snacknap.com: ${r.error}` : "맥스배틀 정보를 읽지 못했습니다" }, { status: 502 });
}
