-- 포고박사 1단계: 익명 계정 · 내 포켓몬 목록 · AI 사용 횟수
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
--          (또는 psql "$POSTGRES_URL_NON_POOLING" -f supabase/migrations/0001_phase1.sql)
-- 여러 번 실행해도 안전하도록 IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS 를 사용한다.

create extension if not exists "pgcrypto";

-- ─── my_pokemon: 내 포켓몬 목록 (저장의 중심) ───
create table if not exists public.my_pokemon (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  species_id    integer not null,
  form          text not null default 'Normal',
  name_kr       text not null,
  cp            integer,
  atk_iv        smallint check (atk_iv between 0 and 15),
  def_iv        smallint check (def_iv between 0 and 15),
  sta_iv        smallint check (sta_iv between 0 and 15),
  level         numeric(4,1),                                   -- nullable, 나중에 개체값 계산으로 채움
  fast_move     text,                                           -- 영어 기술명 기준 (예: "Thunder Shock")
  charged_moves text[] not null default '{}',                   -- 두 번째 차징 기술 대비 배열
  is_shadow     boolean not null default false,
  is_purified   boolean not null default false,
  is_shiny      boolean not null default false,
  is_lucky      boolean not null default false,
  status        text not null default 'keep' check (status in ('keep', 'transfer')),
  purposes      text[] not null default '{}',                   -- raid / great / ultra / master
  source        text not null default 'web' check (source in ('web', 'overlay', 'import')),
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- purposes 값 제한
alter table public.my_pokemon drop constraint if exists my_pokemon_purposes_check;
alter table public.my_pokemon add constraint my_pokemon_purposes_check
  check (purposes <@ array['raid', 'great', 'ultra', 'master']::text[]);

create index if not exists my_pokemon_user_species_idx on public.my_pokemon (user_id, species_id);

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists my_pokemon_set_updated_at on public.my_pokemon;
create trigger my_pokemon_set_updated_at
  before update on public.my_pokemon
  for each row execute function public.set_updated_at();

-- RLS: 본인 행만
alter table public.my_pokemon enable row level security;
drop policy if exists "my_pokemon_select_own" on public.my_pokemon;
drop policy if exists "my_pokemon_insert_own" on public.my_pokemon;
drop policy if exists "my_pokemon_update_own" on public.my_pokemon;
drop policy if exists "my_pokemon_delete_own" on public.my_pokemon;
create policy "my_pokemon_select_own" on public.my_pokemon for select to authenticated using (user_id = auth.uid());
create policy "my_pokemon_insert_own" on public.my_pokemon for insert to authenticated with check (user_id = auth.uid());
create policy "my_pokemon_update_own" on public.my_pokemon for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "my_pokemon_delete_own" on public.my_pokemon for delete to authenticated using (user_id = auth.uid());

-- ─── ai_usage: AI 사용 횟수 (일 단위) ───
create table if not exists public.ai_usage (
  user_id     uuid not null references auth.users (id) on delete cascade,
  usage_date  date not null,                                    -- Gemini 일일 한도 기준 시간대(America/Los_Angeles)로 계산한 날짜
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage for select to authenticated using (user_id = auth.uid());
-- insert/update/delete 정책 없음 → 클라이언트는 증가 불가. 증가는 서버(secret key, RLS 우회)에서 아래 함수로만 수행.

create or replace function public.increment_ai_usage(p_user_id uuid, p_date date)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (user_id, usage_date, count, updated_at)
  values (p_user_id, p_date, 1, now())
  on conflict (user_id, usage_date)
  do update set count = public.ai_usage.count + 1, updated_at = now()
  returning count;
$$;
-- 클라이언트 역할은 호출 불가, 서비스 역할(서버)만 호출
revoke all on function public.increment_ai_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_ai_usage(uuid, date) to service_role;
