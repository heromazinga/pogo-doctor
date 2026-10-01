-- 포고박사 4-F.6 D: 스캔 모드 "보호" — 게임 검색 "색이 다른,반짝반짝,xxl,xxs,배경,특별" 로 거른 뒤 스캔한 기록
--   is_protected: 보호 속성 개체(속성 종류는 모름). 판정은 박사행 금지, 같은 개체의 일반 기록은 그림자 모드와 같은 규칙으로 대체(superseded)
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0012 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

alter table public.scan_items add column if not exists is_protected boolean not null default false;
