// 이벤트 대상 종 추출 (ScrapedDuck events.min.json) — 4-A 이벤트 연동
// 매칭 근거(테스트로 고정):
//  - eventType "community-day": extraData.communityday.spawns[].name (영어 종명), 없으면 name 에서 "X Community Day" 의 X
//  - eventType "pokemon-spotlight-hour": name 의 "X Spotlight Hour" 의 X
//  - 창: 지금부터 RULES.EVENT_WINDOW_DAYS 일 이내 시작(진행 중 포함), 종료 전
import { RULES } from "./verdictRules.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function extractEventTargets(events, now = Date.now()) {
  const windowEnd = now + RULES.EVENT_WINDOW_DAYS * 86400000;
  const out = [];
  for (const e of events || []) {
    const type = e.eventType || "";
    if (!RULES.EVENT_TYPES[type]) continue;
    const start = e.start ? new Date(e.start).getTime() : 0;
    const end = e.end ? new Date(e.end).getTime() : 0;
    if (!(start <= windowEnd && (end === 0 || end >= now))) continue;
    const names = [];
    const spawns = e.extraData?.communityday?.spawns;
    if (Array.isArray(spawns)) for (const s of spawns) if (s?.name) names.push(s.name);
    const m = String(e.name || "").match(/^(.+?)\s+(Community Day|Spotlight Hour)/i);
    if (m && !names.length) names.push(m[1]);
    if (!names.length) continue;
    out.push({ name: e.name, type, label: RULES.EVENT_TYPES[type], start, end, link: e.link || null, targets: names.map(norm) });
  }
  return out;
}

// ScrapedDuck events.min.json → 대상 목록 (6시간 캐시, 장애 시 이전 캐시 유지, 없으면 [])
export const EVENTS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json";
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null, cacheAt = 0;
export async function getEventTargets({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && now - cacheAt < CACHE_MS) return cache;
  try {
    const res = await fetchImpl(EVENTS_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache = { fetchedAt: new Date(now).toISOString(), targets: extractEventTargets(data, now), error: null };
    cacheAt = now;
  } catch (e) {
    if (!cache) cache = { fetchedAt: null, targets: [], error: e.message };
    else cache = { ...cache, error: e.message };
  }
  return cache;
}
export function setEventTargetsForTest(targets) { cache = { fetchedAt: new Date().toISOString(), targets, error: null }; cacheAt = Date.now(); }

// 종(영어명) 또는 진화 계열(familyNames: 영어명 배열)이 대상인 이벤트
export function matchEvents(targets, speciesName, familyNames = []) {
  const keys = new Set([norm(speciesName), ...familyNames.map(norm)]);
  return targets.filter((t) => t.targets.some((n) => keys.has(n)));
}
