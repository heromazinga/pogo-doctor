-- 포고박사 4-A: 사용자가 확정한 추천 태그, HP, 포획일 (목록 매칭용, 장소는 저장하지 않음)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0003 이후.
-- RLS: my_pokemon 의 기존 정책(user_id = auth.uid())이 새 컬럼에도 그대로 적용된다 (행 단위 정책).

alter table public.my_pokemon add column if not exists tags text[] not null default '{}';
alter table public.my_pokemon add column if not exists hp integer;
alter table public.my_pokemon add column if not exists caught_on date;

-- 태그 개수·길이 제한 (자유 문자열이지만 최대 8개, 각 24자)
alter table public.my_pokemon drop constraint if exists my_pokemon_tags_check;
-- CHECK 제약에는 서브쿼리를 쓸 수 없으므로(Postgres 0A000) 검사 함수를 거친다
create or replace function public.pogo_tags_valid(t text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(array_length(t, 1), 0) <= 8
     and not exists (select 1 from unnest(t) x where length(x) > 24 or length(x) = 0);
$$;
alter table public.my_pokemon add constraint my_pokemon_tags_check check (public.pogo_tags_valid(tags));
alter table public.my_pokemon drop constraint if exists my_pokemon_hp_check;
alter table public.my_pokemon add constraint my_pokemon_hp_check check (hp is null or hp between 10 and 999);

-- uuid 는 GIN 기본 연산자 클래스가 없으므로 tags 만 GIN 색인 (user_id 는 기존 색인 사용)
drop index if exists public.my_pokemon_user_tags_idx;
create index if not exists my_pokemon_tags_idx on public.my_pokemon using gin (tags);
