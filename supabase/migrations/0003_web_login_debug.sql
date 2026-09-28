-- 포고박사 3-1c: 앱 → 웹 로그인 코드(kind), 디버그 캡처 업로드(테이블 + 비공개 Storage 버킷)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0002 가 먼저 적용되어 있어야 한다.

-- ─── 1) device_pair_codes.kind: 'pair'(앱 연결) | 'web'(앱 → 웹 로그인) ───
alter table public.device_pair_codes add column if not exists kind text not null default 'pair';
alter table public.device_pair_codes drop constraint if exists device_pair_codes_kind_check;
alter table public.device_pair_codes add constraint device_pair_codes_kind_check check (kind in ('pair', 'web'));
grant select (kind) on table public.device_pair_codes to authenticated;

-- ─── 2) device_debug_logs: 디버그 캡처 (7일 보관, keep-alive 가 정리) ───
create table if not exists public.device_debug_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_id   uuid references public.device_tokens (id) on delete set null,
  kind        text not null default 'detail',                     -- detail | appraisal | unknown | blocked | error
  ocr         jsonb not null default '[]'::jsonb,                  -- OCR 줄 텍스트 배열
  result      text,                                                -- 판독값 요약
  image_path  text,                                                -- storage: debug-captures/<user_id>/<id>.jpg (상태바·트레이너 영역 가림)
  created_at  timestamptz not null default now()
);
create index if not exists device_debug_logs_user_idx on public.device_debug_logs (user_id, created_at desc);
alter table public.device_debug_logs enable row level security;
drop policy if exists "device_debug_logs_select_own" on public.device_debug_logs;
drop policy if exists "device_debug_logs_delete_own" on public.device_debug_logs;
create policy "device_debug_logs_select_own" on public.device_debug_logs for select to authenticated using (user_id = auth.uid());
create policy "device_debug_logs_delete_own" on public.device_debug_logs for delete to authenticated using (user_id = auth.uid());
revoke all on table public.device_debug_logs from anon, authenticated;
grant select, delete on table public.device_debug_logs to authenticated;

-- ─── 3) Storage 비공개 버킷 debug-captures: 본인 폴더(<user_id>/...)만 읽기·삭제. 업로드는 서버(secret key)만 ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('debug-captures', 'debug-captures', false, 2097152, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];
drop policy if exists "debug_captures_select_own" on storage.objects;
drop policy if exists "debug_captures_delete_own" on storage.objects;
create policy "debug_captures_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'debug-captures' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "debug_captures_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'debug-captures' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── 4) 7일 지난 디버그 행 정리 (이미지는 서버가 행 목록으로 삭제) ───
create or replace function public.expired_device_debug_logs()
returns table (id uuid, image_path text)
language sql security definer set search_path = public as $$
  select id, image_path from public.device_debug_logs where created_at < now() - interval '7 days';
$$;
create or replace function public.delete_device_debug_logs(p_ids uuid[])
returns integer language sql security definer set search_path = public as $$
  with d as (delete from public.device_debug_logs where id = any(p_ids) returning 1) select count(*)::integer from d;
$$;
revoke all on function public.expired_device_debug_logs() from public, anon, authenticated;
revoke all on function public.delete_device_debug_logs(uuid[]) from public, anon, authenticated;
grant execute on function public.expired_device_debug_logs() to service_role;
grant execute on function public.delete_device_debug_logs(uuid[]) to service_role;
