// 4-C.3 맥스배틀(다이맥스·거다이맥스) 종 목록 — 저장소 파일 app/data/maxBattleSpecies.json (빈 목록으로 시작, PR 로 관리). 서버 전용
//   확인 결과(2026-09-29, 이 환경에서 접근 가능한 공개 데이터): PokeMiners game master(pokemonSettings 에 다이맥스 필드 없음), PvPoke gamemaster(tags 에 없음),
//   ScrapedDuck(maxbattles 파일 없음) → 기계 판독 가능한 전체 목록 공개 소스 미확인. 환경변수·snacknap 현재 보스 방식은 4-C.3 에서 폐지(사용자 결정).
import fs from "node:fs";
import path from "node:path";

let cached = null;
export function getMaxBattleSpecies() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "app", "data", "maxBattleSpecies.json"), "utf8");
    const data = JSON.parse(raw);
    cached = new Set((data?.ids || []).filter((n) => Number.isInteger(n) && n > 0));
  } catch (e) { console.warn(`[maxBattle] 목록 파일 읽기 실패: ${e.message}`); cached = new Set(); }
  return cached;
}
