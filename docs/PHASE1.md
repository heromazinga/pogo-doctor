# 1단계 작업 지시서 — 서버 저장 (익명 계정 · 내 포켓몬 목록 · 사용 횟수)

작업 전 `docs/ROADMAP.md` 를 먼저 읽는다. 이 문서 범위 밖 기능(오버레이, 팀 추천, 녹화 판독, 이메일 로그인 화면)은 구현하지 않는다.

## 작업 규칙
- `main` 기준 새 브랜치 + 새 PR. 병합하지 않는다(검증 후 별도로 병합).
- 커밋마다 `npm run build` 통과.
- "없다/불가능하다"고 판단할 때는 확인한 경로·명령·응답을 보고서에 근거로 첨부.
- 비밀값은 코드에 넣지 않는다. 서비스 역할 키(service role)는 서버 코드에서만 사용하고 클라이언트 번들에 절대 포함하지 않는다.

## 전제 (사용자가 완료)
- Vercel Marketplace 로 Supabase 무료 프로젝트를 만들어 `pogo-doctor` Vercel 프로젝트에 연결 → Supabase 환경변수가 Vercel 에 자동 등록됨.
- Supabase 대시보드에서 익명 로그인(Anonymous Sign-Ins) 활성화.
- 환경변수 이름은 Vercel 에 실제로 등록된 이름을 확인해서 사용한다(추측 금지). 로컬 개발용은 `.env.example` 에 이름만 추가.

## 0. 선행 작은 수정 (0단계 마무리)
1. 분석 중 첫 글자가 오기 전(모델의 thinking 구간, 실측 약 5~10초)에 "박사가 생각 중…" 표시. 첫 텍스트가 오면 사라짐.
2. 천적 후보가 "출시 미확인"이면 AI 답변에도 "(출시 미확인)" 표기를 그대로 옮기도록 프롬프트 규칙 추가.

## 1. 익명 계정
- 앱 첫 진입 시 세션이 없으면 Supabase 익명 로그인을 자동 실행. 로그인 화면 없음.
- 세션은 브라우저에 유지(Supabase 클라이언트 기본 동작). 화면 구석에 "이 기기에 저장됨 · 브라우저 데이터를 지우면 목록이 사라질 수 있음" 안내 1줄.
- 이메일 연결(계정 업그레이드)은 이번 범위 밖. 단, 나중에 익명 사용자에 이메일을 연결해도 데이터가 이어지도록 모든 데이터는 `auth.users.id` 기준으로 저장.

## 2. 데이터 구조 (Supabase Postgres, 마이그레이션 SQL 파일로 저장소에 포함)

### `my_pokemon` — 내 포켓몬 목록 (저장의 중심)
| 컬럼 | 설명 |
|---|---|
| id | uuid PK |
| user_id | auth.users.id, not null |
| species_id, form | 도감번호, 폼 |
| name_kr | 표시용 한국어명 |
| cp, atk_iv, def_iv, sta_iv | 숫자 |
| level | nullable (나중에 개체값 계산으로 채움) |
| fast_move, charged_moves | 영어 기술 ID 기준 (charged_moves 는 배열, 두 번째 차징 기술 대비) |
| is_shadow, is_purified, is_shiny, is_lucky | boolean |
| status | `keep`(보관) / `transfer`(박사에게 보낼 예정). 기본 `keep` |
| purposes | 배열: `raid`, `great`, `ultra`, `master` (복수 선택, 빈 배열 허용) |
| source | `web` / `overlay` / `import`. 이번 단계는 `web`, `import` 만 사용 (overlay 는 2단계용 자리) |
| memo | nullable 텍스트 |
| created_at, updated_at | timestamp |

- **판정 결과(verdict)는 저장하지 않는다.** 판정은 볼 때마다 계산한다(같은 포켓몬도 용도별로 평가가 다르기 때문).

### `ai_usage` — AI 사용 횟수
| 컬럼 | 설명 |
|---|---|
| user_id | auth.users.id |
| usage_date | 날짜 (Gemini 일일 한도 기준 시간대로 계산. 기준 시간대는 공식 문서로 확인해 근거 첨부, 확인 불가 시 America/Los_Angeles 로 가정하고 보고) |
| count | 성공한 AI 호출 수 |
| PK | (user_id, usage_date) |

### 보안
- 두 테이블 모두 RLS 활성화, 정책은 `user_id = auth.uid()` 인 행만 조회·추가·수정·삭제.
- `ai_usage` 증가는 서버(API 라우트)에서만 수행.

## 3. 기능

### 3-1. 내 포켓몬 목록 (기존 "보유목록" 대체)
- 분석 결과 화면의 기존 "킵" 버튼 → **"내 목록에 저장"** 으로 변경. 저장 시 상태(보관/박사에게 보낼 예정)와 용도 태그 선택 가능(기본: 보관, 태그 없음).
- 목록 화면: 도감번호순(기존 유지) + 상태·용도 태그 필터. 항목별 상태·태그·메모 수정, 삭제.
- 목록 항목을 눌러 "다시 분석" 하면 그 시점 데이터로 새로 판정(저장된 판정 없음).
- 레이드·맥스배틀·비교 등 기존에 `collection` 을 AI 에 넘기던 곳은 `my_pokemon` 에서 읽은 목록으로 대체. 넘길 때 `verdict` 필드 제거, 대신 `status`, `purposes` 전달.

### 3-2. 기존 브라우저 저장 목록 이전
- localStorage `pogo-collection` 이 있으면 익명 로그인 직후 1회 자동 이전(`source = 'import'`, `status = 'keep'`, 기존 verdict 값은 버림).
- 성공 시 localStorage 키를 `pogo-collection-migrated` 로 이름 변경(삭제하지 않음, 문제 시 복구용). 실패 시 원본 유지 + 화면 안내.

### 3-3. AI 사용 횟수 표시
- `/api/analyze` 에서 Gemini 호출이 성공하면 해당 사용자의 `ai_usage.count` +1.
- 화면 상단 작은 표시: "오늘 AI 사용 N회".
- Gemini 가 한도 초과(429)를 반환하면 "오늘 무료 한도 소진 · 초기화 예정 HH:MM(한국 시간)" 안내.
- 요청에 사용자 식별이 없으면(세션 없음) 기존처럼 분석은 허용하되 횟수 기록은 생략하고 서버 로그에 경고.

## 4. 완료 기준
- [ ] 새 브라우저(시크릿 창)로 접속 → 로그인 화면 없이 사용 가능, Supabase 에 익명 사용자 생성 확인
- [ ] 포켓몬 저장 → 새로고침·다른 탭에서도 목록 유지
- [ ] 다른 익명 사용자(다른 시크릿 창)는 첫 사용자의 목록을 볼 수 없음 (RLS 확인 방법·결과를 PR 에 기록)
- [ ] localStorage 에 기존 목록을 넣어 두고 접속 → 자동 이전, 키 이름 변경 확인
- [ ] 분석 2회 후 "오늘 AI 사용 2회" 표시
- [ ] 서비스 역할 키가 클라이언트 번들에 없음 (`.next/static` 검색 결과를 PR 에 기록)
- [ ] 마이그레이션 SQL, 환경변수 목록, Supabase 무료 티어 제약(휴면 정책 등, 공식 문서 근거)을 README 에 정리
