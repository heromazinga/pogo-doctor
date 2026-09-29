// 서버 전용: /api/verdict 계산 컨텍스트 (데이터셋·PvPoke 순위·이벤트 대상·내 목록)
// 인증 선택: Authorization Bearer 가 JWT(점 포함)면 웹 세션, 아니면 기기 토큰. 인증되면 내 목록을 서비스 클라이언트로 읽어 개체 비교에 쓴다.
import { getPokemonDataset } from "./pokemonData.js";
import { getLeagueRankings } from "./pvpokeRankings.js";
import { getEventTargets } from "./eventTargets.js";
import { getUserFromRequest, getServiceClient } from "./supabaseServer.js";
import { userFromDeviceToken } from "./deviceServer.js";
import { RULES } from "./verdictRules.js";

export async function resolveUser(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const asWeb = async () => { const u = await getUserFromRequest(req); return u ? { userId: u.id, via: "web" } : null; };
  const asDevice = async () => { const sb = getServiceClient(); if (!sb) return null; const d = await userFromDeviceToken(sb, req); return d ? { userId: d.userId, via: "device", deviceId: d.deviceId } : null; };
  // JWT(점 포함)는 웹 세션 우선, 아니면 기기 토큰 우선. 실패하면 다른 쪽도 시도
  return token.includes(".") ? (await asWeb()) || (await asDevice()) : (await asDevice()) || (await asWeb());
}

export async function loadMyRows(userId) {
  const sb = getServiceClient();
  if (!sb || !userId) return [];
  const { data, error } = await sb.from("my_pokemon").select("*").eq("user_id", userId).limit(2000);
  if (error) { console.warn(`[verdict] 내 목록 조회 실패: ${error.message}`); return []; }
  return data || [];
}

export async function buildVerdictContext(req, { storageMode, myRows } = {}) {
  const [dataset, leagueRankings, events] = await Promise.all([getPokemonDataset(), getLeagueRankings(), getEventTargets()]);
  const user = await resolveUser(req);
  const rows = myRows || (user ? await loadMyRows(user.userId) : []);
  const mode = storageMode && storageMode in RULES.STORAGE_HOLD_LIMIT ? storageMode : RULES.STORAGE_DEFAULT;
  return {
    ctx: { dataset, leagueRankings, eventTargets: events.targets || [], myRows: rows, storageMode: mode, now: Date.now() },
    user,
    meta: {
      dataset: { generatedAt: dataset.generatedAt || null, stale: Boolean(dataset.stale) },
      pvpoke: { fetchedAt: leagueRankings?.fetchedAt || null, errors: leagueRankings?.errors || {}, leagues: Object.keys(leagueRankings?.leagues || {}) },
      events: { fetchedAt: events.fetchedAt, error: events.error, targets: (events.targets || []).length },
      myRows: rows.length, authenticated: Boolean(user), via: user?.via || null, storageMode: mode,
    },
  };
}
