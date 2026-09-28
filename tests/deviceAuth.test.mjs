// 3-0 보완: 기기 연결 코드·토큰·검증 유틸 단위 테스트 (DB 불필요)
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePairCode, normalizePairCode, isValidPairCodeFormat, sha256Hex, generateDeviceToken, rateLimit, _resetRateLimits, validatePokemonBody, CODE_ALPHABET } from "../app/lib/deviceAuth.js";

test("연결 코드: 8자리, 혼동 문자(O/0/1/I/L) 없음, 정규화·형식 검사", () => {
  for (let i = 0; i < 200; i++) {
    const c = generatePairCode();
    assert.equal(c.length, 8);
    assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)), c);
    assert.ok(!/[O01IL]/.test(c));
  }
  assert.equal(normalizePairCode(" ab cd-ef gh "), "ABCDEFGH");
  assert.equal(isValidPairCodeFormat("ABCDEFGH"), true);
  assert.equal(isValidPairCodeFormat("ABCDEFG0"), false, "0 은 알파벳에 없음");
  assert.equal(isValidPairCodeFormat("ABCDEFG"), false, "7자리");
});

test("해시·토큰: sha256 hex 64자, 토큰 43자 base64url, 원문마다 다름", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const t1 = generateDeviceToken(), t2 = generateDeviceToken();
  assert.equal(t1.length, 43); assert.ok(/^[A-Za-z0-9_-]+$/.test(t1)); assert.notEqual(t1, t2);
});

test("요청 제한: 창 안에서 limit 초과 시 거부, 창 지나면 초기화", () => {
  _resetRateLimits();
  const opt = { limit: 3, windowMs: 1000 };
  assert.equal(rateLimit("k", opt, 0).ok, true);
  assert.equal(rateLimit("k", opt, 10).ok, true);
  assert.equal(rateLimit("k", opt, 20).ok, true);
  const r = rateLimit("k", opt, 30);
  assert.equal(r.ok, false); assert.ok(r.retryAfterSec >= 1);
  assert.equal(rateLimit("k", opt, 1001).ok, true, "창 리셋");
  assert.equal(rateLimit("other", opt, 30).ok, true, "키별 분리");
});

test("포켓몬 본문 검증: 정상 행은 source=overlay 로 정규화, user_id/id 무시", () => {
  const v = validatePokemonBody({ id: "x", user_id: "attacker", source: "web", species_id: 448, name_kr: "루카리오", cp: 3000, atk_iv: 15, def_iv: 14, sta_iv: 15, fast_move: "Counter", charged_moves: ["Aura Sphere"], is_shadow: false, status: "keep", purposes: ["raid"], memo: " 오버레이 " });
  assert.deepEqual(v.errors, []);
  assert.equal(v.row.source, "overlay");
  assert.equal(v.row.user_id, undefined); assert.equal(v.row.id, undefined);
  assert.equal(v.row.form, "Normal"); assert.equal(v.row.memo, "오버레이");
});

test("포켓몬 본문 검증: 잘못된 값 거부", () => {
  assert.ok(validatePokemonBody({ species_id: 0, name_kr: "x" }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "" }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", cp: 5 }).errors.some((e) => e.includes("cp")));
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", atk_iv: 15 }).errors.some((e) => e.includes("개체값")), "개체값 일부만");
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", atk_iv: 16, def_iv: 0, sta_iv: 0 }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", charged_moves: ["a", "b", "c"] }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", status: "sell" }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", purposes: ["pvp"] }).errors.length);
  assert.ok(validatePokemonBody({ species_id: 1, name_kr: "a", is_shadow: "yes" }).errors.length);
  assert.equal(validatePokemonBody({ species_id: 1, name_kr: "a", atk_iv: null, def_iv: null, sta_iv: null }).errors.length, 0, "모두 null 허용");
});
