"use client";
// 3-0 계정 연결: 익명 계정 → 이메일 인증(OTP 6자리 코드) 으로 정식 전환, 다른 기기 로그인, 익명 목록 병합
// publishable key 만 사용. 비밀값 없음.
import { getSupabase } from "./supabaseClient";

const COLUMNS = "id,species_id,form,name_kr,cp,atk_iv,def_iv,sta_iv,level,fast_move,charged_moves,is_shadow,is_purified,is_shiny,is_lucky,status,purposes,source,memo";

// 현재 계정 상태
export async function getAccountState() {
  const sb = getSupabase();
  if (!sb) return { configured: false, user: null, email: null, anonymous: true };
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user || null;
  return { configured: true, user, email: user?.email || null, anonymous: !user || user.is_anonymous === true || !user.email };
}

const friendly = (msg) => {
  const m = String(msg || "");
  if (/already (been )?registered|already exists|email_exists/i.test(m)) return "이미 가입된 이메일입니다 — \"다른 기기 계정으로 로그인\" 을 사용하세요";
  if (/rate limit|too many|over_email_send_rate_limit/i.test(m)) return "요청이 너무 잦습니다 — 잠시 후 다시 시도하세요";
  if (/expired|invalid|otp_expired/i.test(m)) return "코드가 틀렸거나 만료되었습니다 — 다시 요청하세요";
  if (/Signups not allowed|signup_disabled/i.test(m)) return "이메일 가입이 비활성화되어 있습니다 (Supabase 대시보드 설정 확인)";
  if (/Anonymous sign-ins are disabled/i.test(m)) return "익명 로그인이 비활성화되어 있습니다";
  return m;
};

// ── A. 현재 익명 계정에 이메일 연결 (같은 user id 유지 → 목록·사용 횟수 그대로) ──
// 1) 코드 요청: updateUser({ email }) → 새 주소로 "Confirm Email Change" 메일(코드 {{ .Token }})
export async function requestLinkEmail(email) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) return { error: "세션 없음" };
  const { error } = await sb.auth.updateUser({ email });
  return { error: error ? friendly(error.message) : null };
}
// 2) 코드 확인: type 'email_change'
export async function verifyLinkEmail(email, token) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { data, error } = await sb.auth.verifyOtp({ email, token: String(token).trim(), type: "email_change" });
  if (error) return { error: friendly(error.message) };
  // 세션의 user 정보를 최신으로
  const { data: { user } } = await sb.auth.getUser();
  return { error: null, user: user || data?.user || null };
}

// ── B. 다른 기기: 같은 이메일로 로그인 (user id 가 바뀜) ──
// 로그인 전에 현재 익명 계정의 목록을 스냅샷해 두었다가 병합 여부를 묻는다
export async function snapshotAnonymousRows() {
  const sb = getSupabase();
  if (!sb) return { userId: null, rows: [] };
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user || !(user.is_anonymous === true || !user.email)) return { userId: user?.id || null, rows: [] };
  const { data, error } = await sb.from("my_pokemon").select(COLUMNS);
  return { userId: user.id, rows: error ? [] : data || [] };
}
export async function requestSignInEmail(email) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return { error: error ? friendly(error.message) : null };
}
export async function verifySignInEmail(email, token) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { data, error } = await sb.auth.verifyOtp({ email, token: String(token).trim(), type: "email" });
  if (error) return { error: friendly(error.message) };
  return { error: null, user: data?.user || null, session: data?.session || null };
}

// 중복 기준: 종·폼·CP·개체값(공/방/HP)·섀도 동일
const dupKey = (r) => [r.species_id, r.form || "Normal", r.cp ?? "", r.atk_iv ?? "", r.def_iv ?? "", r.sta_iv ?? "", r.is_shadow ? 1 : 0].join("|");

// 익명 목록(스냅샷)을 현재 로그인 계정으로 병합. 중복은 건너뜀. 반환 { inserted, skipped, error }
export async function mergeRowsIntoCurrent(rows) {
  const sb = getSupabase();
  if (!sb) return { inserted: 0, skipped: 0, error: "미설정" };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { inserted: 0, skipped: 0, error: "세션 없음" };
  const { data: existing, error: e1 } = await sb.from("my_pokemon").select("species_id,form,cp,atk_iv,def_iv,sta_iv,is_shadow");
  if (e1) return { inserted: 0, skipped: 0, error: e1.message };
  const seen = new Set((existing || []).map(dupKey));
  const toInsert = [];
  for (const r of rows || []) {
    const k = dupKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const { id, ...rest } = r; // 서버 생성 컬럼 제외, 새 user_id 로
    toInsert.push({ ...rest, user_id: user.id });
  }
  if (toInsert.length === 0) return { inserted: 0, skipped: (rows || []).length, error: null };
  const { error } = await sb.from("my_pokemon").insert(toInsert);
  if (error) return { inserted: 0, skipped: (rows || []).length - toInsert.length, error: error.message };
  return { inserted: toInsert.length, skipped: (rows || []).length - toInsert.length, error: null };
}

export async function signOutAccount() {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { error } = await sb.auth.signOut();
  return { error: error ? error.message : null };
}
