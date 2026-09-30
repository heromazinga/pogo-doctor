// 서버 전용: /api/verdict 계산 컨텍스트 (데이터셋·PvPoke 순위·이벤트 대상·내 목록)
// 인증 선택: Authorization Bearer 가 JWT(점 포함)면 웹 세션, 아니면 기기 토큰. 인증되면 내 목록을 서비스 클라이언트로 읽어 개체 비교에 쓴다.
import { getPokemonDataset } from "./pokemonData.js";
import { getLeagueRankings } from "./pvpokeRankings.js";
import { getEventTargets } from "./eventTargets.js";
import { getUserFromRequest, getServiceClient } from "./supabaseServer.js";
import { userFromDeviceToken } from "./deviceServer.js";
import { RULES } from "./verdictRules.js";
import { loadUserSettings, saveStorageMode } from "./userSettings.js";
import { getMaxBattleSpecies } from "./maxBattleSpecies.js";
import { fetchActiveScanItems } from "./scanQuery.js";
import { buildReserveRanks } from "./reserveRanks.js";

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

// 4-C.2 보관함 여유 동기화: 요청에 storageMode 가 오면 user_settings 에 저장(앱·웹 어디서 바꿔도 서버 판정에 반영), 없으면 저장값, 그것도 없으면 기본값.
//   이전에는 본문 값만 써서 스캔 기록 후계산·정리 도우미·stats 가 항상 normal 이었다(실DB 검증에서 확인).
// 4-F: scanItems(활성 스캔 기록)를 주면 그것으로, 없으면 조회해 보관함 상대 순위(ctx.reserve: 레이드 예비·리그 예비)를 만든다
export async function buildVerdictContext(req, { storageMode, myRows, scanItems } = {}) {
  const [dataset, leagueRankings, events] = await Promise.all([getPokemonDataset(), getLeagueRankings(), getEventTargets()]);
  const maxBattleSpecies = getMaxBattleSpecies();
  const user = await resolveUser(req);
  const sb = user ? getServiceClient() : null;
  const [rows, settings] = await Promise.all([myRows || (user ? loadMyRows(user.userId) : []), user ? loadUserSettings(sb, user.userId) : null]);
  let mode = storageMode && storageMode in RULES.STORAGE_HOLD_LIMIT ? storageMode : null;
  if (mode && user && settings?.storage_mode !== mode) await saveStorageMode(sb, user.userId, mode);
  if (!mode) mode = settings?.storage_mode in RULES.STORAGE_HOLD_LIMIT ? settings.storage_mode : RULES.STORAGE_DEFAULT;
  let scans = Array.isArray(scanItems) ? scanItems : [];
  if (!Array.isArray(scanItems) && user && sb) { try { scans = (await fetchActiveScanItems(sb, user.userId)).items; } catch (e) { console.warn(`[verdict] 스캔 기록 조회 실패(예비 순위 생략): ${e.message}`); } }
  let reserve = null;
  try { reserve = buildReserveRanks(dataset, rows, scans); } catch (e) { console.warn(`[verdict] 예비 순위 계산 실패: ${e.message}`); }
  return {
    ctx: { dataset, leagueRankings, eventTargets: events.targets || [], myRows: rows, storageMode: mode, now: Date.now(), settings, maxBattleSpecies, reserve },
    user,
    meta: {
      dataset: { generatedAt: dataset.generatedAt || null, stale: Boolean(dataset.stale) },
      pvpoke: { fetchedAt: leagueRankings?.fetchedAt || null, errors: leagueRankings?.errors || {}, leagues: Object.keys(leagueRankings?.leagues || {}) },
      events: { fetchedAt: events.fetchedAt, error: events.error, targets: (events.targets || []).length },
      myRows: rows.length, authenticated: Boolean(user), via: user?.via || null, storageMode: mode, maxBattleSpecies: maxBattleSpecies.size, reserve: reserve ? reserve.size : 0,
    },
  };
}
