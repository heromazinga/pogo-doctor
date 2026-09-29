// PvPoke 리그 순위 (rankings/all/overall/rankings-{1500,2500,10000}.json) — 6시간 캐시, 장애 시 이전 캐시 유지
// speciesId 규약: 데이터셋 pvpokeId(예: "azumarill", "raichu_alolan"), 섀도는 "_shadow" 접미사
const BASE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/";
export const LEAGUE_FILES = { great: "rankings-1500.json", ultra: "rankings-2500.json", master: "rankings-10000.json" };
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null, cacheAt = 0, loading = null;

async function fetchLeague(league, fetchImpl) {
  const res = await fetchImpl(BASE + LEAGUE_FILES[league], { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error("형식 오류");
  const map = new Map();
  // 4-C: moveset(["FAST","CHARGED1","CHARGED2"] PvPoke ID)도 보관 → 리그 태그의 추천 기술 표시
  arr.forEach((r, i) => { if (r?.speciesId && !map.has(r.speciesId)) map.set(r.speciesId, { rank: i + 1, score: r.score, name: r.speciesName, moveset: Array.isArray(r.moveset) ? r.moveset.slice(0, 3) : null }); });
  return map;
}

export async function getLeagueRankings({ fetchImpl = fetch, force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (loading) return loading;
  loading = (async () => {
    const out = { fetchedAt: new Date().toISOString(), leagues: {}, errors: {} };
    for (const league of Object.keys(LEAGUE_FILES)) {
      try { out.leagues[league] = await fetchLeague(league, fetchImpl); }
      catch (e) { out.errors[league] = e.message; if (cache?.leagues?.[league]) out.leagues[league] = cache.leagues[league]; }
    }
    if (Object.keys(out.leagues).length) { cache = out; cacheAt = Date.now(); }
    loading = null;
    return cache || out;
  })();
  return loading;
}

// 테스트·오프라인용 주입
export function setLeagueRankingsForTest(leagues) { cache = { fetchedAt: new Date().toISOString(), leagues, errors: {} }; cacheAt = Date.now(); }

export function leagueRankOf(rankings, league, pvpokeId, shadow) {
  if (!rankings?.leagues?.[league] || !pvpokeId) return null;
  const id = shadow ? `${pvpokeId}_shadow` : pvpokeId;
  return rankings.leagues[league].get(id) || (shadow ? rankings.leagues[league].get(pvpokeId) || null : null);
}
