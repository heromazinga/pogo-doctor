-- 포고박사 4-B6: 평가 화면에서 판독한 게임 태그 칩 이름 (사용자가 게임에서 이미 단 태그). 박사행 대상·검색 묶음에서 제외하는 근거.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0006 이후.  검증: npm run test:migrations
alter table public.scan_items add column if not exists game_tags text[] not null default '{}';
alter table public.my_pokemon add column if not exists game_tags text[] not null default '{}';
alter table public.scan_items drop constraint if exists scan_items_game_tags_check;
alter table public.scan_items add constraint scan_items_game_tags_check check (public.pogo_tags_valid(game_tags));
alter table public.my_pokemon drop constraint if exists my_pokemon_game_tags_check;
alter table public.my_pokemon add constraint my_pokemon_game_tags_check check (public.pogo_tags_valid(game_tags));
