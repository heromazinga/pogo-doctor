-- 포고박사 4-A: 사용자가 확정한 추천 태그, HP, 포획일 (목록 매칭용, 장소는 저장하지 않음)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0003 이후.
-- RLS: my_pokemon 의 기존 정책(user_id = auth.uid())이 새 컬럼에도 그대로 적용된다 (행 단위 정책).

alter table public.my_pokemon add column if not exists tags text[] not null default '{}';
alter table public.my_pokemon add column if not exists hp integer;
alter table public.my_pokemon add column if not exists caught_on date;

-- 태그 개수·길이 제한 (자유 문자열이지만 최대 8개, 각 24자)
alter table public.my_pokemon drop constraint if exists my_pokemon_tags_check;
alter table public.my_pokemon add constraint my_pokemon_tags_check
  check (coalesce(array_length(tags, 1), 0) <= 8 and not exists (select 1 from unnest(tags) t where length(t) > 24 or length(t) = 0));
alter table public.my_pokemon drop constraint if exists my_pokemon_hp_check;
alter table public.my_pokemon add constraint my_pokemon_hp_check check (hp is null or hp between 10 and 999);

create index if not exists my_pokemon_user_tags_idx on public.my_pokemon using gin (user_id, tags);
