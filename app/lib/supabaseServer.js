// 서버 전용 Supabase 유틸 (API 라우트에서만 import 한다 — 클라이언트 컴포넌트에서 import 금지)
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
// 신형 secret key 우선, 없으면 구형 service_role key. 서버 코드에서만 읽는다.
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseServerConfigured = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

// Authorization: Bearer <access_token> 에서 사용자 확인. 없거나 무효면 null
export async function getUserFromRequest(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !SUPABASE_URL || !PUBLISHABLE_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch (e) {
    console.warn(`[supabase] 사용자 확인 실패: ${e.message}`);
    return null;
  }
}

let serviceClient = null;
// 서비스 역할 클라이언트 (RLS 우회). API 라우트에서만 사용
export function getServiceClient() {
  if (!SUPABASE_URL || !SECRET_KEY) return null;
  if (!serviceClient) serviceClient = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}

// ai_usage.count +1 (SECURITY DEFINER 함수, 서비스 역할만 호출 가능). 반환: 오늘 누적 횟수 또는 null
export async function incrementAiUsage(userId, usageDate) {
  const sb = getServiceClient();
  if (!sb) {
    console.warn("[supabase] SUPABASE_SECRET_KEY 미설정 → 사용 횟수 기록 생략");
    return null;
  }
  const { data, error } = await sb.rpc("increment_ai_usage", { p_user_id: userId, p_date: usageDate });
  if (error) {
    console.warn(`[supabase] ai_usage 증가 실패: ${error.message}`);
    return null;
  }
  return typeof data === "number" ? data : null;
}
