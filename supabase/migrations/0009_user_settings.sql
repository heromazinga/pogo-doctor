-- 포고박사 4-C.2: 사용자 설정 (서버 판정에 쓰는 보관함 여유 + 스캔 기록 백필 버전)
-- 배경: 앱·웹에서 고른 보관함 여유(storageMode)가 /api/verdict 요청 본문에만 실려 스캔 기록 후계산·정리 도우미·stats 는 항상 기본값(normal)을 썼다.
--       이제 요청에 storageMode 가 오면 여기 저장하고, 본문에 없을 때는 저장값을 쓴다.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0008 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

create table if not exists public.user_settings (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  storage_mode          text not null default 'normal' check (storage_mode in ('relaxed', 'normal', 'tight')),
  scan_backfill_version text,                       -- 스캔 기록 superseded 백필을 마친 규칙 버전 (조회 시 1회 실행)
  updated_at            timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_upsert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy "user_settings_upsert_own" on public.user_settings for insert to authenticated with check (user_id = auth.uid());
create policy "user_settings_update_own" on public.user_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on table public.user_settings from anon, authenticated;
grant select, insert, update (storage_mode, updated_at) on table public.user_settings to authenticated;
