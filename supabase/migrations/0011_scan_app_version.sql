-- 포고박사 4-D: 스캔 기록에 앱 버전·정화 여부·숨김 사유 추가
--   app_version: 기록한 앱 버전(0.1.38 이상 = 라벨행 값 채택 폐지 이후 "신뢰 기록", 충돌 시 이전 기록을 대체)
--   is_purified: 스캔 모드 "정화" 로 기록(수집 판단용)
--   dismissed_reason: 웹 "이 세션 이전 기록 모두 숨김"(before_session) 은 복구 가능
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0010 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

alter table public.scan_items add column if not exists app_version text;
alter table public.scan_items add column if not exists is_purified boolean not null default false;
alter table public.scan_items add column if not exists dismissed_reason text;
