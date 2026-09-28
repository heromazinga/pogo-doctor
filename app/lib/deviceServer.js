// 서버 전용: 기기 토큰 → 사용자, 연결 코드 검증 (pair / web 공용). 코드·토큰 원문은 로그에 남기지 않는다.
import { bearerToken, sha256Hex, normalizePairCode, isValidPairCodeFormat, MAX_CODE_ATTEMPTS } from "./deviceAuth";

// Authorization: Bearer <기기 토큰> → { userId, deviceId } 또는 null. last_used_at 갱신
export async function userFromDeviceToken(sb, req) {
  const token = bearerToken(req);
  if (!token || token.length < 32) return null;
  const { data } = await sb.from("device_tokens").select("id,user_id,revoked_at").eq("token_hash", sha256Hex(token)).maybeSingle();
  if (!data || data.revoked_at) return null;
  sb.from("device_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {}, () => {});
  return { userId: data.user_id, deviceId: data.id };
}

// 코드 검증 + 1회용 소진. 실패 시 활성 코드(kind 동일) 전체 attempts+1 (단일 사용자 전제, docs/PHASE3.md).
// 반환 { ok: true, userId } 또는 { ok: false, error, status }
export async function consumePairCode(sb, rawCode, kind, ip) {
  const nowIso = new Date().toISOString();
  const code = normalizePairCode(rawCode);
  const fail = async (error, status = 400) => {
    const { data } = await sb.from("device_pair_codes").select("code_hash,attempts").eq("kind", kind).is("used_at", null).gt("expires_at", nowIso);
    for (const r of data || []) await sb.from("device_pair_codes").update({ attempts: (r.attempts || 0) + 1 }).eq("code_hash", r.code_hash);
    console.warn(`[device] 코드 검증 실패 (${kind}: ${error}) ip=${ip}`);
    return { ok: false, error, status };
  };
  if (!isValidPairCodeFormat(code)) return fail("코드 형식이 올바르지 않습니다 (8자리, O/0/1/I/L 없음)");
  const { data: row, error } = await sb.from("device_pair_codes").select("code_hash,user_id,expires_at,attempts,used_at,kind").eq("code_hash", sha256Hex(code)).maybeSingle();
  if (error) return { ok: false, error: `조회 실패: ${error.message}`, status: 500 };
  if (!row || (row.kind || "pair") !== kind) return fail("코드가 없거나 틀렸습니다");
  if (row.used_at) return fail("이미 사용된 코드입니다 — 새 코드를 발급하세요");
  if (new Date(row.expires_at).getTime() < Date.now()) return fail("만료된 코드입니다 — 새 코드를 발급하세요");
  if ((row.attempts || 0) >= MAX_CODE_ATTEMPTS) return fail("실패가 누적되어 무효화된 코드입니다 — 새 코드를 발급하세요");
  const { data: claimed, error: e2 } = await sb.from("device_pair_codes").update({ used_at: nowIso }).eq("code_hash", row.code_hash).is("used_at", null).select("code_hash");
  if (e2 || !claimed?.length) return fail("코드를 사용할 수 없습니다 (동시 요청)", 409);
  return { ok: true, userId: row.user_id };
}
