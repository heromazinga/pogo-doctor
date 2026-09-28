# 3단계 작업 지시서 — 안드로이드 수집기 (오버레이)

작업 전 `docs/ROADMAP.md` 를 먼저 읽는다. 3단계는 3-0 → 3-1 → 3-2 순서로 **각각 별도 PR** 로 진행한다.

## 절대 규칙 (계정 안전)
1. 수집기 앱은 **화면을 읽고 보여주기만** 한다. 포켓몬GO 화면을 대신 터치·스와이프하는 기능(접근성 서비스 자동 조작, 자동 클릭 등)은 만들지 않는다.
2. 포켓몬GO 계정 정보·게임 서버 통신에 관여하지 않는다.
3. 루팅 전제 기능 금지.

## 작업 규칙
- `main` 기준 새 브랜치 + 새 PR. 병합하지 않는다.
- "없다/불가능하다" 판단 시 확인한 경로·명령·응답을 근거로 첨부.
- 비밀값은 코드·APK 에 넣지 않는다. 앱에는 공개 키(publishable)만 포함.

## 개발·배포 환경 (USB·로컬 PC 없이)
- 저장소: 이 저장소의 `android/` 폴더(모노레포). Vercel 빌드에 영향 없도록 `.vercelignore` 에 `android/` 추가.
- 테스트 기기: Samsung Galaxy A90 5G (SM-A908N), Android 12 / One UI 4.1
- 빌드: GitHub Actions (`android/**` 변경 시에만 실행). PR 마다 테스트 APK 를 Actions 산출물로, `main` 병합 시 GitHub Release 에 APK 첨부.
- 서명: 고정 keystore 를 만들어 GitHub Secrets 에 저장(사용자가 등록해야 하면 보고서 맨 위에 절차 기재). 모든 빌드를 같은 키로 서명해 업데이트 설치 가능하게.
- 설치: A90 에서 GitHub Release 링크로 APK 설치("출처를 알 수 없는 앱" 허용).
- 원격 디버깅: 앱 "디버그 모드" 켜면 캡처 이미지·인식 결과·오류를 서버에 업로드 → 웹앱의 본인 전용 디버그 화면에서 확인. 7일 후 자동 삭제. 트레이너명 등 개인정보 영역은 업로드 전 가림.

---

## 3-0. 계정 연결 (웹앱, 선행 필수) — 기기 연결 코드 방식으로 확정
**이유**: 지금은 기기마다 익명 계정이 따로 생긴다. 안드로이드 앱이 기록한 포켓몬이 웹앱의 "내 목록"에 나오려면 두 곳이 같은 계정을 써야 한다.

**결정 (PR #19 이후)**: 이메일 계정 연결은 사용하지 않는다. Supabase 는 커스텀 SMTP 없이 이메일 템플릿을 수정할 수 없어 OTP 코드(`{{ .Token }}`)를 보낼 수 없고, 기본 발송은 수신자·발송량 제약이 있다. 단일 사용자라 SMTP 도입은 과하다. PR #19 코드는 삭제하지 않고 UI 만 숨긴다(`NEXT_PUBLIC_ENABLE_EMAIL_LINK=true` 일 때만 표시). 익명 행 보존 로직은 그대로 유지.

**기기 연결 코드 방식 (웹앱)**
- 테이블(마이그레이션 `supabase/migrations/0002_device_pairing.sql`, 적용은 사용자가 SQL Editor 에서):
  - `device_pair_codes(code_hash, user_id, expires_at, attempts, used_at)`
  - `device_tokens(id, user_id, name, token_hash, created_at, last_used_at, revoked_at)`
  - RLS: 둘 다 본인 행만 select. `device_tokens` 는 본인 행 revoke(`revoked_at` 갱신)만 허용. insert·검증은 서버(service role)에서만.
- 흐름:
  1. 웹 "📱 기기 연결" → `POST /api/device/pair-code` (로그인 세션 필요) → 8자리 코드(혼동 문자 O/0/1/I/L 제외), 10분 유효, 해시로 저장
  2. 앱 → `POST /api/device/pair {code, deviceName}` → 장기 토큰(32바이트 랜덤) 1회 반환, 해시로 저장. 코드는 1회용, 실패 5회면 무효화, IP 당 요청 제한
  3. 앱 → `POST /api/device/pokemon` (`Authorization: Bearer 토큰`) → 서버가 토큰으로 user_id 를 결정하고 `my_pokemon` 에 insert (`source='overlay'`). 요청 본문의 user_id 는 무시. 필드 검증 필수
  4. 웹 설정에 연결된 기기 목록 + 해제 버튼
- 토큰·코드 원문은 로그에 남기지 않는다.
- Supabase 휴면 방지: Vercel Cron(하루 1회) → `GET /api/keep-alive` (`Authorization: Bearer CRON_SECRET`) → DB 가벼운 조회 1건.
- 완료 기준: 코드 발급→교환→curl 로 저장→웹 목록 표시 / 해제 후 401 / 만료·재사용 코드 거부 / 다른 사용자 목록에 안 보임(RLS)

## 3-1. 안드로이드 수집기 MVP
- 기술: Kotlin + Jetpack Compose(설정 화면), Foreground Service + MediaProjection(캡처), `SYSTEM_ALERT_WINDOW` 오버레이, Google ML Kit Text Recognition **Korean**(기기 내부). **Supabase Kotlin 클라이언트·이메일 로그인은 사용하지 않는다.** 인증은 3-0 의 기기 토큰만 사용(Android Keystore 기반 암호화 저장).
- 앱 첫 실행: 연결 코드 입력 화면. 미연결 상태에서도 분석·결과 카드는 동작하고, 저장 버튼만 "기기 연결 필요" 안내.
- 종족값·기술·CP 배율 표: 웹앱 `/api/pokemon-data` 를 받아 기기에 캐시.
- 기능 (이것만):
  1. 떠 있는 작은 버튼. 누르면 **현재 화면 1장**을 캡처해 분석.
  2. 포켓몬 상세 화면에서 이름·CP·HP·기술명 인식. 이름·기술명은 서버 데이터의 한국어 목록과 유사도 매칭으로 보정.
  3. 평가(감정) 화면이 캡처되면 막대 3개로 개체값 판독. 상세 화면만 있으면 CP·HP 로 개체값 후보 계산(웹앱 `cpm.js` 와 같은 공식).
  4. 결과 카드(오버레이): 종·CP·개체값(또는 후보 범위)·레이드/리그 한줄평(서버 계산, AI 미사용).
  5. **"보관" / "박사행" 버튼** → `my_pokemon` 에 저장 (`source = 'overlay'`, `status = keep | transfer`). 이 행은 즉시 웹앱 목록에 보임.
- 완료 기준:
  - [ ] Actions 에서 서명된 APK 빌드, Release 링크로 A90 설치·업데이트
  - [ ] 포켓몬GO 위에 오버레이 표시·캡처 정상(검은 화면 아님)
  - [ ] 표본 30마리 이름·CP·HP 인식 정확도 보고(목표 90% 이상, 미달 시 원인·개선안)
  - [ ] "보관" 1회 → 웹앱 내 목록에 표시

## 3-2. 연속 모드 · 레이드 카운터 오버레이 (3-1 검증 후)
- 연속 모드: 캡처를 켜 두고 화면이 바뀔 때만(프레임 차이 감지) 분석. 사용자는 보관함에서 옆으로 넘기기만 하면 결과 카드 갱신. **자동 저장 금지**, 저장은 버튼으로만.
- 레이드 카운터: 레이드 대기 화면에서 버튼 → 현재 레이드 목록(ScrapedDuck)에서 보스 선택 → 2단계 `/api/team` 결과를 오버레이에 표시. 보스 자동 인식은 이후 과제.
- 배터리·발열 측정값 보고.

---

## 사용자가 해야 하는 일 (예상)
- 3-0: 마이그레이션 `0002_device_pairing.sql` 적용, Vercel 에 `CRON_SECRET` 등록(절차는 PR 보고서에 기재됨)
- 3-1: GitHub Secrets 에 서명 키 등록(필요 시), A90 에 APK 설치·권한 허용, 포켓몬 30마리 표본 캡처 테스트
