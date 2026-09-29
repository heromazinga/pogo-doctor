// 4-C.2 사용자 설정 (user_settings, 마이그레이션 0009): 보관함 여유 + 스캔 기록 백필 버전. 서버 전용(service client)
import { RULES } from "./verdictRules.js";

const isColumnError = (e) => /relation|column|schema cache|does not exist/i.test(String(e?.message || ""));

export async function loadUserSettings(sb, userId) {
  if (!sb || !userId) return null;
  const { data, error } = await sb.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) { if (!isColumnError(error)) console.warn(`[settings] 조회 실패: ${error.message}`); return null; }
  return data || null;
}

// storageMode 저장 (값이 유효하고 저장값과 다를 때만). 테이블이 없으면(0009 미적용) 조용히 건너뜀
export async function saveStorageMode(sb, userId, storageMode) {
  if (!sb || !userId || !(storageMode in RULES.STORAGE_HOLD_LIMIT)) return false;
  const { error } = await sb.from("user_settings").upsert({ user_id: userId, storage_mode: storageMode, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) { if (!isColumnError(error)) console.warn(`[settings] 저장 실패: ${error.message}`); return false; }
  return true;
}

export async function saveBackfillVersion(sb, userId, version) {
  if (!sb || !userId) return false;
  const { error } = await sb.from("user_settings").upsert({ user_id: userId, scan_backfill_version: version, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) { if (!isColumnError(error)) console.warn(`[settings] 백필 버전 저장 실패: ${error.message}`); return false; }
  return true;
}
