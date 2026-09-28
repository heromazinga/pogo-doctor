// 기기 연결 코드·토큰 유틸 (서버 전용 로직이지만 순수 함수라 테스트에서도 import 한다)
// 코드·토큰 원문은 로그에 남기지 않는다.
import { createHash, randomBytes, randomInt } from "node:crypto";

// 혼동 문자(0/O, 1/I/L) 제외 32자
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 10 * 60 * 1000; // 10분
export const MAX_CODE_ATTEMPTS = 5;

export function generatePairCode() {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// 입력 정규화: 대문자, 공백·하이픈 제거. 알파벳에 없는 문자(O,0,1,I,L 등)가 있으면 형식 오류로 거부
export function normalizePairCode(input) {
  return String(input || "").toUpperCase().replace(/[\s-]/g, "");
}
export function isValidPairCodeFormat(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export function sha256Hex(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

// 32바이트 랜덤 → base64url (43자)
export function generateDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export function bearerToken(req) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export function clientIp(req) {
  const xf = req.headers.get("x-forwarded-for") || "";
  return xf.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

// 간이 IP/키별 요청 제한 (인스턴스 메모리, 서버리스에서는 인스턴스마다 별도 — 최선 노력)
const buckets = new Map();
export function rateLimit(key, { limit, windowMs }, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { ok: true, remaining: limit - 1 }; }
  b.count += 1;
  if (b.count > limit) return { ok: false, remaining: 0, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, remaining: limit - b.count };
}
export function _resetRateLimits() { buckets.clear(); }

// ─── 앱이 보내는 my_pokemon 행 검증 (user_id·id·source 등 서버 결정 컬럼은 무시) ───
const PURPOSES = ["raid", "great", "ultra", "master"];
const isInt = (v) => Number.isInteger(v);
const optInt = (v, min, max) => v === null || v === undefined || (isInt(v) && v >= min && v <= max);
const optStr = (v, max) => v === null || v === undefined || (typeof v === "string" && v.length <= max);

export function validatePokemonBody(b) {
  const errors = [];
  if (!b || typeof b !== "object") return { errors: ["본문이 객체가 아닙니다"] };
  if (!isInt(b.species_id) || b.species_id < 1 || b.species_id > 2000) errors.push("species_id 는 1~2000 정수");
  if (!optStr(b.form, 40)) errors.push("form 은 40자 이하 문자열");
  if (typeof b.name_kr !== "string" || !b.name_kr.trim() || b.name_kr.length > 60) errors.push("name_kr 은 1~60자 문자열");
  if (!optInt(b.cp, 10, 9999)) errors.push("cp 는 10~9999 정수 또는 null");
  const ivs = [b.atk_iv, b.def_iv, b.sta_iv];
  const anyIv = ivs.some((v) => v !== null && v !== undefined);
  if (anyIv && !ivs.every((v) => isInt(v) && v >= 0 && v <= 15)) errors.push("개체값은 공/방/HP 모두 0~15 정수이거나 모두 null");
  if (!optStr(b.fast_move, 60)) errors.push("fast_move 는 60자 이하 문자열 또는 null");
  if (b.charged_moves !== undefined && b.charged_moves !== null && !(Array.isArray(b.charged_moves) && b.charged_moves.length <= 2 && b.charged_moves.every((m) => typeof m === "string" && m.length <= 60))) errors.push("charged_moves 는 60자 이하 문자열 최대 2개");
  for (const k of ["is_shadow", "is_shiny", "is_lucky", "is_purified"]) if (b[k] !== undefined && typeof b[k] !== "boolean") errors.push(`${k} 는 boolean`);
  if (b.status !== undefined && !["keep", "transfer"].includes(b.status)) errors.push("status 는 keep|transfer");
  if (b.purposes !== undefined && !(Array.isArray(b.purposes) && b.purposes.every((p) => PURPOSES.includes(p)))) errors.push("purposes 는 raid|great|ultra|master 배열");
  if (!optStr(b.memo, 200)) errors.push("memo 는 200자 이하");
  if (b.level !== undefined && b.level !== null && !(typeof b.level === "number" && b.level >= 1 && b.level <= 51)) errors.push("level 은 1~51 숫자 또는 null");
  if (errors.length) return { errors };
  return {
    errors: [],
    row: {
      species_id: b.species_id,
      form: (b.form || "Normal").trim() || "Normal",
      name_kr: b.name_kr.trim(),
      cp: b.cp ?? null,
      atk_iv: anyIv ? b.atk_iv : null, def_iv: anyIv ? b.def_iv : null, sta_iv: anyIv ? b.sta_iv : null,
      level: b.level ?? null,
      fast_move: b.fast_move || null,
      charged_moves: (b.charged_moves || []).filter(Boolean),
      is_shadow: Boolean(b.is_shadow), is_shiny: Boolean(b.is_shiny), is_lucky: Boolean(b.is_lucky), is_purified: Boolean(b.is_purified),
      status: b.status || "keep",
      purposes: b.purposes || [],
      memo: b.memo ? String(b.memo).trim() || null : null,
      source: "overlay",
    },
  };
}
