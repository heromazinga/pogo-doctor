// 4-C.2 맥스배틀(다이맥스·거다이맥스) 종 목록 — "공개 데이터로 확인되는 것만"
//   확인 결과(2026-09-29, 이 환경에서 접근 가능한 공개 데이터):
//   - PokeMiners game master latest.json: pokemonSettings 에 다이맥스 가능 여부 필드 없음(ETERNATUS_ETERNAMAX 템플릿만 존재)
//   - PvPoke gamemaster tags: dynamax/gigantamax 태그 없음
//   - ScrapedDuck(LeekDuck): maxbattles 데이터 파일 없음(404)
//   → 기계 판독 가능한 "전체 목록" 공개 소스는 확인 못 함. 현재는 snacknap.com/max-battles 에 실린 **현재 맥스배틀 보스**(도감 번호)와
//     환경변수 MAX_BATTLE_SPECIES_IDS(쉼표 구분 도감 번호, 사용자가 확인한 종)만 쓴다. 목록에 없는 종은 일반 판정.
import { parseMaxBattles } from "./maxBattles.js";

const CACHE_MS = 30 * 60 * 1000;
let cache = null, cacheAt = 0, loading = null;

export async function fetchMaxBattleBosses({ fetchImpl = fetch, force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetchImpl("https://www.snacknap.com/max-battles", { headers: { "User-Agent": "Mozilla/5.0 (compatible; PoGoDoctorBot/1.0)", Accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bosses = parseMaxBattles(await res.text());
      if (bosses.length) { cache = { bosses, fetchedAt: new Date().toISOString(), error: null }; cacheAt = Date.now(); }
      else if (!cache) cache = { bosses: [], fetchedAt: null, error: "snacknap 페이지에서 보스를 찾지 못함" };
    } catch (e) {
      if (!cache) cache = { bosses: [], fetchedAt: null, error: e.message };
      else cache = { ...cache, error: e.message };
    } finally { loading = null; }
    return cache;
  })();
  return loading;
}

export function envMaxBattleIds(env = process.env) {
  return String(env.MAX_BATTLE_SPECIES_IDS || "").split(/[,\s]+/).map((x) => parseInt(x)).filter((n) => Number.isInteger(n) && n > 0);
}

// Set<number>(도감 번호). 실패해도 빈 Set(판정은 일반 규칙)
export async function getMaxBattleSpecies({ fetchImpl } = {}) {
  const ids = new Set(envMaxBattleIds());
  try { const { bosses } = await fetchMaxBattleBosses({ fetchImpl }); for (const b of bosses || []) if (b.id) ids.add(b.id); } catch {}
  return ids;
}
