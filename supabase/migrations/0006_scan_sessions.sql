-- 포고박사 4-B2: 연속 스캔 세션 측정값 (앱이 종료 시 전송, 웹 스캔 기록에서 표시). 14일 후 정리.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0005 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

create table if not exists public.scan_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references public.device_tokens (id) on delete set null,
  session_id  text not null,
  metrics     jsonb not null default '{}'::jsonb,   -- 프레임·분석·기록 수, 단계별 평균 ms, 전송/대기, 배터리
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, session_id)
);
create index if not exists scan_sessions_user_idx on public.scan_sessions (user_id, created_at desc);
alter table public.scan_sessions enable row level security;
drop policy if exists "scan_sessions_select_own" on public.scan_sessions;
create policy "scan_sessions_select_own" on public.scan_sessions for select to authenticated using (user_id = auth.uid());
revoke all on table public.scan_sessions from anon, authenticated;
grant select on table public.scan_sessions to authenticated;

-- 정리 함수 확장: 스캔 항목 + 세션 (14일)
create or replace function public.cleanup_scan_items() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; m integer;
begin
  delete from public.scan_items where created_at < now() - interval '14 days';
  get diagnostics n = row_count;
  delete from public.scan_sessions where created_at < now() - interval '14 days';
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function public.cleanup_scan_items() from public, anon, authenticated;
grant execute on function public.cleanup_scan_items() to service_role;
