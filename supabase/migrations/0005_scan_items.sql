-- 포고박사 4-B: 연속 스캔 기록 (세션별, 사용자가 검토 후 저장 확정. 자동 저장 없음)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0004 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

create table if not exists public.scan_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  device_id     uuid references public.device_tokens (id) on delete set null,
  session_id    text not null,                                    -- 앱이 연속 스캔 시작 시 만든 세션 ID (yyyyMMdd-HHmm-랜덤)
  scan_key      text not null,                                    -- 종|폼|CP|HP|공|방|HP|섀도 (같은 개체 재기록 방지)
  species_id    integer not null,
  form          text not null default 'Normal',
  name_kr       text not null,
  cp            integer,
  hp            integer,
  atk_iv        integer, def_iv integer, sta_iv integer,
  level         numeric(4,1),
  stars         integer,
  is_shadow     boolean not null default false,
  caught_on     date,                                             -- 포획 날짜만 (장소 없음)
  recheck       boolean not null default false,                   -- CP/HP 와 막대 불일치 → 재확인 필요
  verdict       jsonb,                                            -- 스캔 시점 4-A 판정 요약 (tier, summary, recommendedTags, purposes)
  saved_pokemon_id uuid references public.my_pokemon (id) on delete set null,
  dismissed     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (user_id, session_id, scan_key)
);
create index if not exists scan_items_user_idx on public.scan_items (user_id, created_at desc);
alter table public.scan_items enable row level security;
drop policy if exists "scan_items_select_own" on public.scan_items;
drop policy if exists "scan_items_update_own" on public.scan_items;
drop policy if exists "scan_items_delete_own" on public.scan_items;
create policy "scan_items_select_own" on public.scan_items for select to authenticated using (user_id = auth.uid());
create policy "scan_items_update_own" on public.scan_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "scan_items_delete_own" on public.scan_items for delete to authenticated using (user_id = auth.uid());
revoke all on table public.scan_items from anon, authenticated;
grant select, update (dismissed, saved_pokemon_id), delete on table public.scan_items to authenticated;

-- 14일 지난 스캔 기록 정리 (keep-alive cron)
create or replace function public.cleanup_scan_items() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.scan_items where created_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cleanup_scan_items() from public, anon, authenticated;
grant execute on function public.cleanup_scan_items() to service_role;
