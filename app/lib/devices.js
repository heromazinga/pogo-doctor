"use client";
// 연결된 기기 목록 (device_tokens) — RLS 로 본인 행만, 컬럼 권한으로 해시는 읽을 수 없고 revoked_at 만 갱신 가능
import { getSupabase } from "./supabaseClient";

export async function listDevices() {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "미설정" };
  const { data, error } = await sb.from("device_tokens").select("id,name,created_at,last_used_at,revoked_at").order("created_at", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}

export async function revokeDevice(id) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { error } = await sb.from("device_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  return { error: error ? error.message : null };
}

// ─── 디버그 캡처 (device_debug_logs, storage debug-captures) — RLS/스토리지 정책으로 본인 것만 ───
export async function listDebugLogs(limit = 30) {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "미설정" };
  const { data, error } = await sb.from("device_debug_logs").select("id,device_id,kind,ocr,result,image_path,created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null };
}
export async function debugImageUrl(path, expiresSec = 600) {
  const sb = getSupabase();
  if (!sb || !path) return null;
  const { data, error } = await sb.storage.from("debug-captures").createSignedUrl(path, expiresSec);
  return error ? null : data?.signedUrl || null;
}
export async function deleteDebugLog(row) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  if (row.image_path) await sb.storage.from("debug-captures").remove([row.image_path]);
  const { error } = await sb.from("device_debug_logs").delete().eq("id", row.id);
  return { error: error ? error.message : null };
}
