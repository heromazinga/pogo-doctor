-- 포고박사 4-C.3: 스캔 기록 재확인 사유 (같은 종·CP·HP 인데 개체값이 다른 기록 = 막대 오판독 의심 → "재스캔 필요")
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체 실행 (멱등). 0009 이후.
-- 검증: npm run test:migrations (pglite 2회 실행)

alter table public.scan_items add column if not exists recheck_reason text;
