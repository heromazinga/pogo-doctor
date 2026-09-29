-- 포고박사 4-C: 강화·진화 후 같은 개체의 새 스캔 기록이 들어오면 과거 기록을 "대체됨(superseded)" 으로 표시
-- (dismissed 와 별도: 사용자가 숨긴 것이 아니라 새 기록이 대신함. cleanup·목록·stats 는 superseded 를 제외)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0007 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

alter table public.scan_items add column if not exists superseded boolean not null default false;
alter table public.scan_items add column if not exists superseded_by uuid references public.scan_items (id) on delete set null;
create index if not exists scan_items_active_idx on public.scan_items (user_id, dismissed, superseded);
-- 웹(authenticated)은 superseded 를 직접 바꾸지 않는다(서버 service_role 만). 기존 grant 유지
