-- 포고박사 4-F.6: 내 목록(my_pokemon) 숨김 사유
--   hidden_reason: 정리 도우미 "이미 없음"(게임 결과 0마리) 처리 시 스캔 기록과 함께 내 목록 행도 숨긴다('not_seen', 복구 가능 — 웹 "숨김 복구").
--   null 이면 표시. 목록 조회·판정·정리 도우미는 hidden_reason is null 인 행만 쓴다.
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0011 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

alter table public.my_pokemon add column if not exists hidden_reason text;
create index if not exists my_pokemon_hidden_idx on public.my_pokemon (user_id) where hidden_reason is null;
