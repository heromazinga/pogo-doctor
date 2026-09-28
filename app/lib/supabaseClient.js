"use client";
// 브라우저용 Supabase 클라이언트 (publishable key 만 사용, secret key 는 절대 여기서 참조하지 않는다)
import { createClient } from "@supabase/supabase-js";

// Next.js 는 NEXT_PUBLIC_* 를 빌드 시 문자열로 치환하므로 이름을 그대로 써야 한다.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// 신형 publishable key 우선, 없으면 구형 anon key
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client = null;
export function getSupabase() {
  if (!supabaseConfigured) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

// 세션이 없으면 익명 로그인. 성공 시 { user, session }, 미설정/실패 시 null
export async function ensureAnonymousSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) return { user: session.user, session };
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    console.warn("[supabase] 익명 로그인 실패:", error.message);
    return null;
  }
  return data?.session ? { user: data.user, session: data.session } : null;
}

// 서버 API 호출 시 붙일 Authorization 헤더
export async function authHeader() {
  const sb = getSupabase();
  if (!sb) return {};
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}
