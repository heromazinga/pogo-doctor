-- 포고박사 3-0 보완: 기기 연결 코드 · 기기 토큰 (안드로이드 수집기 인증)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run. 여러 번 실행해도 안전(멱등).
--
-- 원칙
-- - 코드·토큰은 원문을 저장하지 않고 SHA-256 해시만 저장한다.
-- - insert·검증은 서버(secret key, RLS 우회)에서만 한다. 클라이언트(웹)는 본인 행 조회와 device_tokens.revoked_at 갱신(해제)만 가능.

create extension if not exists "pgcrypto";

-- ─── device_pair_codes: 웹에서 발급한 8자리 연결 코드 (10분 유효, 1회용) ───
create table if not exists public.device_pair_codes (
  code_hash   text primary key,                                   -- sha256(코드) hex
  user_id     uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,                         -- 실패 누적 (5회 이상이면 무효)
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists device_pair_codes_user_idx on public.device_pair_codes (user_id, expires_at);

alter table public.device_pair_codes enable row level security;
drop policy if exists "device_pair_codes_select_own" on public.device_pair_codes;
create policy "device_pair_codes_select_own" on public.device_pair_codes for select to authenticated using (user_id = auth.uid());
-- 클라이언트는 해시 컬럼을 읽을 수 없고, 쓰기 불가 (서버 secret key 만)
revoke all on table public.device_pair_codes from anon, authenticated;
grant select (user_id, expires_at, attempts, used_at, created_at) on table public.device_pair_codes to authenticated;

-- ─── device_tokens: 앱 장기 토큰 (32바이트 랜덤, 해시 저장) ───
create table if not exists public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null default '기기',
  token_hash    text not null unique,                             -- sha256(토큰) hex
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;
drop policy if exists "device_tokens_select_own" on public.device_tokens;
drop policy if exists "device_tokens_update_own" on public.device_tokens;
create policy "device_tokens_select_own" on public.device_tokens for select to authenticated using (user_id = auth.uid());
create policy "device_tokens_update_own" on public.device_tokens for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 클라이언트: 해시 제외 조회 + revoked_at 만 갱신(해제). insert/delete 불가 (서버 secret key 만)
revoke all on table public.device_tokens from anon, authenticated;
grant select (id, user_id, name, created_at, last_used_at, revoked_at) on table public.device_tokens to authenticated;
grant update (revoked_at) on table public.device_tokens to authenticated;

-- 만료·사용된 코드 정리 (서버 keep-alive 등에서 호출 가능, 서비스 역할만)
create or replace function public.cleanup_device_pair_codes()
returns integer
language sql
security definer
set search_path = public
as $$
  with d as (
    delete from public.device_pair_codes
    where used_at is not null or expires_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from d;
$$;
revoke all on function public.cleanup_device_pair_codes() from public, anon, authenticated;
grant execute on function public.cleanup_device_pair_codes() to service_role;
