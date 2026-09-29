# 포고박사 (PoGo Doctor) ⚡

포켓몬GO AI 어드바이저 — 킵? 버려? 냅둬? AI가 판정해드립니다.

## v0.5 (0단계: 점검·복구) 변경사항

- **Gemini 모델 교체**: 종료된 `gemini-2.0-flash`, 무료 미제공·종료 예정 `gemini-2.5-pro` 삭제. 폴백 순서를 `gemini-3.6-flash → gemini-3.1-flash-lite → gemini-3-flash-preview` 로 변경, `GEMINI_MODELS` 환경변수로 교체 가능
- **데이터 소스 교차검증**: pokemon-go-api / PvPoke / pogoapi.net / PokeMiners 4개 소스에서 종족값·타입·기술을 받아 다수결로 채택. 한 소스가 죽어도 서비스 유지
- **AI 답변 최신성**: 프롬프트에 오늘 날짜(KST)와 교차검증 데이터를 넣고 "제공 데이터가 학습 지식과 다르면 제공 데이터를 따른다", "없는 정보는 데이터 없음이라고 답한다" 규칙 적용. 타입 상성(약점/저항)은 서버에서 계산해 전달
- **데이터 기준 시각 표시**: 화면 하단에 데이터 생성 시각·소스별 정상 여부·불일치 건수 표시
- **외부 소스 장애 대응**: 레이드/이벤트/맥스배틀 소스가 죽으면 해당 기능만 비활성화하고 안내 문구 표시
- **Next.js 14 → 16, React 18 → 19** (보안 취약점 해소, 별도 커밋)

## 구조

```
브라우저(app/page.jsx)
  ├─ GET /api/pokemon-data  ← app/lib/pokemonData.js (4개 소스 교차검증, 6시간 캐시)
  ├─ GET /api/raid-bosses   ← ScrapedDuck raids.min.json (LeekDuck)
  ├─ GET /api/events        ← ScrapedDuck events.min.json
  ├─ GET /api/max-battles   ← snacknap.com/max-battles HTML 파싱 (app/lib/maxBattles.js)
  └─ POST /api/analyze      ← Gemini (스트리밍). 서버 교차검증 데이터 + 타입 상성(app/lib/typeChart.js: 방어 배율표(약점·반감 행)·천적 후보) + 용어집(app/lib/glossary.js) 주입. 천적 후보 = PvPoke released 인 포켓몬 중 약점 타입의 빠른+차징 기술 보유, 점수 = 공격 종족값 × 사이클 DPS(PokeMiners PvE 수치) × 자속 1.2 × 배율
```

- **프레임워크**: Next.js 16 (App Router) + React 19, Vercel 배포
- **AI 판정**: Google Gemini API (무료 티어), 모델 폴백 체인
- **한국어 이름**: 포켓몬·기술 한국어명은 pokemon-go-api 에서 서버가 모아서 전달, 누락분만 PokeAPI 로 보충

## Gemini 모델

| 순서 | 모델 | 비고 |
|---|---|---|
| 1 | `gemini-3.6-flash` | 기본 |
| 2 | `gemini-3.1-flash-lite` | 정식 모델 (preview 는 2026-05-25 종료) |
| 3 | `gemini-3-flash-preview` | 후순위 유지, 종료일 미공지 |

삭제한 모델: `gemini-2.0-flash` (2026-06-01 종료), `gemini-2.5-pro` (2026-10-16 종료 예정, 2026-04-01부터 무료 티어 미제공).

`GEMINI_MODELS=모델1,모델2,...` 로 순서를 바꿀 수 있다. 앞 모델이 오류(한도 초과, 종료 등)를 내면 다음 모델로 넘어간다.

### 무료 티어 한도 (확인 필요)

이 저장소 작성 시점(2026-09-28)에 아래 값은 제3자 정리 자료 기준이며, **실제 한도는 [AI Studio 요청 한도 페이지](https://aistudio.google.com/rate-limit)와 [공식 Rate limits 문서](https://ai.google.dev/gemini-api/docs/rate-limits)에서 반드시 확인**해야 한다.

| 모델 | RPM | RPD | 출처 |
|---|---|---|---|
| gemini-3.6-flash | 약 15 | 자료마다 상이(20~1,500) — 확인 필요 | 제3자 정리 자료 |
| gemini-3.1-flash-lite | 약 15 | 약 500 | 제3자 정리 자료 |
| gemini-3-flash-preview | 확인 필요 | 확인 필요 | — |

- Google 검색 그라운딩: 3.x 모델은 무료 티어에 포함되지 않는 것으로 확인됨(유료 티어 월 5,000회 무료 후 과금). 따라서 **도입하지 않음**.

## 환경변수

`.env.example` 참고.

| 변수 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | O | AI Studio 에서 발급한 키 |
| `GEMINI_MODELS` | X | 모델 폴백 순서(쉼표 구분). 비우면 코드 기본값 |
| `GEMINI_MODELS_TEAM` | X | 박사 코멘트(`mode: "team"`) 전용 모델 순서. 비우면 `gemini-3.1-flash-lite,gemini-3-flash-preview` (고급 모델 한도를 개체값 분석용으로 남김) |
| `CRON_SECRET` | X (권장) | Vercel Cron → `/api/keep-alive` 인증. 없으면 keep-alive 가 503 으로 거부 |
| `NEXT_PUBLIC_ENABLE_EMAIL_LINK` | X | `true` 면 이메일 계정 연결 UI 표시(기본 숨김) |
| `GEMINI_MIN_CHARS` | X | 응답 본문이 이 글자 수 미만이거나 `finishReason` 이 `STOP` 이 아니면 비정상으로 보고 다음 모델로 재시도(기본 400). 재시도 시 클라이언트는 `__RESET__` 마커로 이전 본문을 버리고, 사용 횟수는 최종 채택된 응답 1회만 기록 |
| `GEMINI_MIN_CHARS_TEAM` | X | 박사 코멘트(`mode: "team"`, 3~5줄)의 짧은 응답 기준(기본 60) |
| `GEMINI_API_BASE` | X | 테스트용 모의 서버 지정(기본 공식 엔드포인트) |
| `GEMINI_THINKING_LEVEL` | X | thinking 수준(`generationConfig.thinkingConfig.thinkingLevel`), 기본 `low`. 모델이 거부(400)하면 파라미터 없이 재시도. `off` 면 미전송 |
| `POGO_DISABLE_SOURCES` | X | 테스트용. 지정한 데이터 소스를 실패한 것으로 처리 (`pokemon-go-api,pvpoke,pogoapi,pokeminers`) |
| `POKEMON_DATA_TTL_MS` | X | 포켓몬 데이터 메모리 캐시 시간(ms), 기본 6시간 |
| `POKEMINERS_TTL_MS` | X | PokeMiners 원본 파싱 결과 캐시 시간(ms), 기본 24시간 |
| `SOURCE_STALE_DAYS` | X | 갱신 시각이 이 일수 이상 지난 소스는 투표에서 제외(화면에 "오래됨(투표 제외)"), 기본 60 |
| `POGO_DEBUG_PROMPT` | X | `1` 이면 Gemini 에 보내는 프롬프트를 서버 로그에 출력 |

## 데이터 소스

| 우선순위 | 소스 | 용도 | 캐시 |
|---|---|---|---|
| 1 | [pokemon-go-api](https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json) | 종족값·타입·기술·한국어명(포켓몬/기술) | 메모리 6h |
| 2 | [PvPoke gamemaster](https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json) | 종족값·타입·기술 | 메모리 6h + fetch revalidate 6h |
| 3 | [pogoapi.net](https://pogoapi.net/api/v1/pokemon_stats.json) (`pokemon_stats.json`, `current_pokemon_moves.json`) | 기존 소스, 보조 | 메모리 6h + fetch revalidate 6h |
| 참고 | [PokeMiners game_masters](https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json) | 게임 원본(약 20MB). 불일치가 있을 때만 조회, 분쟁 시 최종 기준. 서버에서만 사용 | 메모리 24h |
| 유지 | [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck) raids/events | 레이드 보스·이벤트 | 메모리 6h / 3h |
| 유지 | [snacknap.com/max-battles](https://www.snacknap.com/max-battles) | 맥스배틀 | 메모리 30m |
| 보조 | [PokeAPI CSV](https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv) | 기술 한국어명 보충(서버, 투표 미참여) | fetch revalidate 24h |
| 보조 | [PokeAPI](https://pokeapi.co) | 한국어 기술명 누락분 보충(클라이언트) | sessionStorage |

`/api/pokemon-data` 응답은 CDN 에서 1시간 캐시(`s-maxage=3600, stale-while-revalidate=21600`)된다.

### 교차검증 규칙 (`app/lib/pokemonData.js`)

- 종족값(공/방/체)·타입·기술 목록을 소스별로 정규화해 비교한다.
- **2개 이상 소스가 일치하는 값을 채택**한다(다수결). 최다 득표가 동률이거나 전부 다르면 **가장 최근 갱신된 소스**의 값을 따른다. PokeMiners 를 "최종 기준"으로 특별 취급하지 않는다(`latest.json` 이 항상 최신이 아님이 확인됨).
- 갱신 시각이 `SOURCE_STALE_DAYS`(기본 60일) 이상 지난 소스는 투표에서 제외하고 화면에 "오래됨(투표 제외)"으로 표시한다. 투표 가능 소스가 2개 미만이면 화면에 경고를 띄우고, 0개면 오래된 소스 값을 임시로 사용한다. 갱신 시각을 모르는 소스는 제외하지 않는다.
- 소스 갱신 시각(`dataSources[].updatedAt`)은 PvPoke `gamemaster.timestamp`, pogoapi `api_hashes.json` 의 `last_modified`, PokeMiners 는 GitHub commits API(`latest/latest.json` 최신 커밋 시각, 무인증 60회/시간·24h 캐시), 그 외 HTTP `Last-Modified` 로 기록하며(`updatedAtFrom` 에 근거 표기), 화면 하단에 소스별로 표시된다. 알 수 없으면 동률 판단에서 가장 후순위.
- 기술의 빠른/차징 구분은 소스별 목록 위치가 아니라 **기술 자체의 종류**(PvPoke 에너지 획득/소모, PokeMiners `_FAST` 접미사, pokemon-go-api quick/cinematic)를 다수결로 정해 통일한다. PokeMiners 의 숫자 기술 ID(예: 497)는 `V0497_MOVE_*` 템플릿으로 이름을 찾고, 못 찾으면 제외한다. 기술은 **일반 / 레거시(`eliteFast/eliteCharged`, 대단한 기술머신 필요) / 전용기(`signatureFast/signatureCharged`, PokeMiners `nonTmCinematicMoves` 와 `formChange[].moveReassignment` 에서 파싱 — 아이템·폼 체인지로만 습득) / 한정기(미검증)(`unverifiedEliteFast/Charged`, 1개 소스만 보고했고 그 소스가 한정기로 표시) / 미검증** 으로 구분해 화면과 프롬프트에 전달한다. 프롬프트에는 기술명을 "한국어(영어)" 로 넘기고, 포켓몬GO 용어집(`app/lib/glossary.js`: 용어/정의/금지 표현)을 고정 포함해 임의 용어·번역을 금지한다. AI 답변에 금지 표현("노멀기술", "운석", "4배", "자폭기", 기술 교체 의미의 "해방" 등)이 나오면 서버 로그에 `[analyze] ... 금지 표현` 경고를 남긴다.
- 기술 한국어명은 pokemon-go-api → [PokeAPI CSV](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)(`moves.csv` + `move_names.csv`, 한국어 language_id=3, 누락이 있을 때만 조회·24h 캐시) → 수동 매핑(`app/lib/moveNamesKrManual.js`) 순으로 채운다. 그래도 없는 기술은 응답 `moveNamesKrMissing` 에 남고, 프롬프트에 포함되면 서버 로그에 `[analyze] 한국어명 없는 기술` 경고를 남긴다.
- 기술은 2개 이상 소스에 있으면 "검증됨"으로 채택한다. 한 소스에만 있는 기술은 제외하지 않고 `unverifiedFast/unverifiedCharged` 로 분리해 화면에 **미검증(❔)** 으로 노출한다. "미검증"은 교차검증 소스가 1개라는 뜻일 뿐 **미출시로 판단하지 않는다.** AI 프롬프트 규칙: 미검증 기술은 배제하지 않되 "(미검증)"으로 명시하고, 주력 추천은 검증 기술 우선.
- PokeMiners 원본(약 20MB)은 1~3순위 소스 간 불일치가 있을 때(또는 정상 소스가 2개 미만일 때)만 추가 투표용으로 조회하고, 파싱 결과는 24시간(`POKEMINERS_TTL_MS`) 메모리 캐시한다.
- 불일치 유형은 `dataWarningCounts` 로 집계된다: `stat`(종족값 실제 차이), `type`(타입 차이), `moveMajority`(일부 소스에 없지만 2개 이상 일치로 채택), `moveUnverified`(1개 소스만 보유).
- 불일치는 서버 로그(`[pokemonData] ...`)와 응답의 `dataWarnings`(최대 100건) / `dataWarningCount` 에 남긴다.
- 응답의 `dataSources: [{ name, url, fetchedAt, ok, count, error? }]` 로 소스별 상태를 확인할 수 있고, 화면 하단에 "데이터 기준 시각"으로 표시된다.
- 소스가 전부 실패하면 이전에 성공한 데이터를 계속 사용한다(`stale: true`).

### 장애 테스트 방법

```bash
# 예: PvPoke 와 PokeMiners 를 강제로 실패시킨 상태에서 실행
POGO_DISABLE_SOURCES=pvpoke,pokeminers npm run dev
curl -s localhost:3000/api/pokemon-data | jq '.dataSources, .pokemon | length'
```

Vercel 에서는 환경변수 `POGO_DISABLE_SOURCES` 를 Preview 환경에 잠시 넣고 재배포해 같은 방식으로 확인한다. 화면 하단 소스 상태에 `✗` 가 표시되고 나머지 기능은 정상 동작해야 한다.

## 1단계: 서버 저장 (Supabase — 익명 계정 · 내 포켓몬 목록 · AI 사용 횟수)

### 사용자가 해야 하는 설정
1. Vercel Marketplace 로 Supabase 프로젝트를 만들어 `pogo-doctor` 에 연결(환경변수 자동 등록), Supabase 대시보드 → Authentication → Sign In / Providers 에서 **Anonymous Sign-Ins** 활성화.
2. **마이그레이션 적용**: Supabase 대시보드 → SQL Editor → `supabase/migrations/0001_phase1.sql` 전체를 붙여넣고 Run. (대안: `psql "$POSTGRES_URL_NON_POOLING" -f supabase/migrations/0001_phase1.sql`). 여러 번 실행해도 안전(멱등).
3. 로컬 개발 시 `.env.local` 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` 입력.

### 환경변수
| 변수 | 위치 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 클라이언트·서버 | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (구형 `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | 클라이언트·서버 | 브라우저용 키. 신형 우선, 없으면 구형 |
| `SUPABASE_SECRET_KEY` (구형 `SUPABASE_SERVICE_ROLE_KEY`) | **서버 전용** | `ai_usage` 증가(RLS 우회)에만 사용. `app/lib/supabaseServer.js` 에서만 읽으며 클라이언트 번들에 포함되지 않음 |
| `AI_USAGE_TZ` / `NEXT_PUBLIC_AI_USAGE_TZ` | 선택 | 사용 횟수 날짜 기준 시간대. 기본 `America/Los_Angeles` |

### 동작
- 첫 진입 시 세션이 없으면 `signInAnonymously()` 자동 실행(로그인 화면 없음). 세션은 브라우저(localStorage)에 유지. 모든 데이터는 `auth.users.id` 기준이라 나중에 이메일을 연결해도 이어진다.
- **내 포켓몬 목록** `my_pokemon`: 종·폼, CP, 개체값, 기술(영어 ID), 섀도/정화/이로치/럭키, 상태(`keep`/`transfer`), 용도 태그(`raid`/`great`/`ultra`/`master`), 등록 경로(`web`/`overlay`/`import`), 메모. **판정 결과는 저장하지 않는다.** 목록 항목 "🔄 다시 분석"은 저장된 값으로 새로 판정.
- 목록에서 ✏️ 로 상태·용도·메모와 **CP·개체값(공/방/HP)** 을 직접 수정할 수 있다. 개체값 미입력 항목은 목록 위쪽에 모아 표시. 📤 내보내기는 서버 행 구조(`species_id, form, atk_iv, …`)의 JSON(`schemaVersion: 1`)으로 백업하며, 가져오기는 범위 밖.
- 폴백 모델로 답한 경우 상단에 안내: 429 의 `quotaId` 가 일일 한도면 "오늘 고급 모델 한도 소진 → 기본 모델로 분석 중", 분당 한도면 "분당 한도 초과 → … 잠시 후 고급 모델로 자동 복귀"(매 요청 1순위 모델부터 다시 시도).
- 기존 브라우저 목록(`localStorage.pogo-collection`)은 익명 로그인 직후 1회 자동 이전(`source='import'`, `status='keep'`, verdict 는 버림). 성공 시 키를 `pogo-collection-migrated` 로 바꿔 보존.
- **AI 사용 횟수** `ai_usage(user_id, usage_date, count)`: `/api/analyze` 가 Gemini 호출에 성공하면 서버에서 `increment_ai_usage()`(SECURITY DEFINER, service_role 만 실행 가능)로 +1. 클라이언트는 `Authorization: Bearer <access_token>` 을 보내고, 없으면 분석은 되지만 기록은 생략(서버 로그 경고). 날짜는 Gemini 일일 한도가 초기화되는 **태평양 시간 자정** 기준(`America/Los_Angeles`, [Gemini rate limits 문서](https://ai.google.dev/gemini-api/docs/rate-limits)). Gemini 429 시 "오늘 무료 한도 소진 · 초기화 예정 M/D HH:MM(한국 시간)" 안내.
- RLS: 두 테이블 모두 `user_id = auth.uid()` 인 행만 접근. `ai_usage` 는 클라이언트 조회만 허용(증가 정책 없음).

### Supabase 무료 플랜 제약 (확인 필요 — [공식 요금 페이지](https://supabase.com/pricing) 기준, 이 환경에서 직접 열람 불가하여 2026-09 기준 제3자 정리로 확인)
- 활성 프로젝트 2개, DB 500MB, 파일 저장 1GB, 이그레스 5GB, MAU 50,000.
- **7일간 활동이 없으면 프로젝트가 일시 정지**되며 대시보드에서 수동 복구해야 한다(데이터는 보존). 사용자가 드물면 주기적 접속(또는 유료 전환)이 필요.
- 백업·SLA 없음.

## 2단계: 내 목록 기반 팀 추천 (레이드 · 로켓단)

**팀 선정은 서버의 결정적 계산이며 AI 를 쓰지 않는다.** AI(Gemini)는 팀 결과 아래 "🧠 박사 코멘트" 버튼을 눌렀을 때만 1회 호출되고(`mode: "team"`), 프롬프트에 "팀 구성·순서·기술을 바꾸지 말 것"을 명시한다. 코멘트도 사용 횟수에 포함된다.

### 화면
- **내 목록 ✏️ 편집**에 빠른 기술 1 + 차징 기술 최대 2 선택 추가. 선택지는 해당 종·폼의 기술만(일반 / ⭐한정기술 / 🔑전용기 / ⭐❔한정기·확인 필요 / ❔미검증 구분). 기술이 비어 있으면 "기술 미입력" 표시.
- **레이드 탭** "📋 내 목록으로 팀 추천" → 보스(현재 레이드 목록 또는 검색으로 선택) 대상 내 목록 상위 6마리. 종·CP·추정 레벨·기술·차징 배율·DPS·TDO·점수, 추정 여부(레벨 추정/개체값 추정/기술 가정) 표시. 같은 종 중복 허용. 6마리 미만이면 "구하면 좋은 포켓몬"(0단계 천적 후보 `counterCandidates`)으로 채워 구분 표시. 팀 절반 이상이 보스 자속 기술에 약점이면 경고.
- **🚀 로켓단 탭** 신설: 보스(Giovanni) / 간부(Cliff·Arlo·Sierra) / 조무래기(타입별) 선택 → 슬롯(1·2·3번째)별 가능한 상대 전체를 고려해 내 목록에서 3마리. 한 마리가 다른 슬롯 상위 3위에도 들면 "커버 n번" 표시. "간이 추천" 표기.
- `status = 'transfer'`(보낼 예정) 항목은 두 추천 모두에서 제외한다.

### 계산 (`app/lib/cpm.js`, `app/lib/teamScore.js` — 코드 주석과 동일)
- **CP 배율표**: PokeMiners `PLAYER_LEVEL_SETTINGS.cpMultiplier`(정수 레벨 1~51). 반 레벨은 `sqrt((cpm(L)² + cpm(L+1)²)/2)`.
- **레벨 추정**: `CP = floor((Atk+atkIv) × sqrt(Def+defIv) × sqrt(Sta+staIv) × CPM² / 10)` 를 1~51(0.5 단위)에서 계산해 입력 CP 와 정확히 일치하는 레벨(없으면 가장 가까운 레벨, "레벨 근사"). 개체값 미입력이면 10/10/10 가정("개체값 추정"), CP 없으면 L40 가정("레벨 추정"). 입력 CP 가 L51 최대치보다 크면 "CP 최대치 초과(입력 확인)".
- **실제 능력치**: `(종족값 + 개체값) × CPM`. 섀도는 공격 ×1.2, 방어 ×0.833. HP 는 내림.
- **기술**: 저장된 기술(수치가 있는 것만). 미입력이면 그 종의 검증 기술(일반+한정+전용) 전체를 후보로 두고 대상별 최적 조합을 골라 "기술 가정" 표시. 기술 수치(타입/위력/시간/에너지)는 0단계 `moveStats`(PokeMiners PvE 우선).
- **레이드 점수** (보스 = 종족값+15, L40 CPM 0.7903 가정):
  - 피해 = `floor(0.5 × 위력 × 공격/방어 × 타입배율 × 자속1.2) + 1`
  - 사이클 = 차징 1회에 필요한 빠른기술 n회 + 차징 1회. `DPS = 사이클 피해 / 사이클 시간`. 여러 기술 조합 중 DPS 최대를 선택.
  - 생존: 보스의 실제 기술(없으면 보스 1타입 자속 12위력/1초 + 100위력/3초 가정) 중 나에게 가장 아픈 조합의 DPS 로 `TTF = 내 HP / 받는 DPS`, `TDO = DPS × TTF`.
  - `점수 = DPS^0.775 × TDO^0.225` (DPS 를 우선하되 내구를 반영). 보스 타입 자속 공격에 내가 약점이면 `vulnerable` 경고.
- **로켓단 간이 점수** (실드·에너지 흐름은 단순화): 기술 점수 = `빠른기술 EPS × 2 + (차징 위력/에너지) × 20`, 공격 배율 = 슬롯 상대 후보들에 대한 max(빠른·차징 배율×자속) 평균, 피격 배율 = 상대 타입 자속 가정 시 내가 받는 배율 평균, 내구 = `sqrt(방어 × HP)/100`. `점수 = 공격 × 기술점수 × 공격배율 / 피격배율 × 내구 / 100`. 슬롯 1→2→3 순으로 아직 안 뽑힌 개체 중 최고 점수를 선택.

### API
- `POST /api/team` `{ mode: "raid", boss: {id, form}, myPokemon: [my_pokemon 행] }` / `{ mode: "rocket", lineup, myPokemon }` → 팀 JSON (AI 호출 없음).
- `GET /api/rocket-lineups` — ScrapedDuck `rocketLineups.min.json`(26개 라인업), 메모리 캐시 6시간, 실패 시 이전 캐시 또는 502 + 화면 안내(해당 탭만 비활성화).
- `POST /api/analyze` `mode: "team"` — 박사 코멘트(3~5줄). **기본 모델 고정**: `GEMINI_MODELS_TEAM`(기본 `gemini-3.1-flash-lite → gemini-3-flash-preview`)을 쓰며 고급 모델 `gemini-3.6-flash` 는 호출하지 않는다(무료 일일 한도 약 20회를 개체값 분석용으로 보존). 폴백 시 상단 안내는 "코멘트 모델(…) → …로 코멘트 중". 짧은 응답 재시도 기준은 `GEMINI_MIN_CHARS_TEAM`(기본 60자).

### 맥스배틀 팀 추천은 구현하지 않음 (근거)
다이맥스/거다이맥스 **가능 여부** 데이터가 교차검증 소스에 없다.
- PokeMiners `latest.json` `pokemonSettings`: 다이맥스 가능 여부 키 없음. `breadTierGroup`(맥스배틀 난이도 티어) 이 2,478개 폼 중 2,467개에 있어 "가능한 종" 구분 값이 아니다. `BREAD_*` 는 시스템 템플릿뿐.
- pokemon-go-api `pokedex.json`: `hasGigantamaxEvolution` 만 있고(16종: 이상해꽃·리자몽·거북왕·버터플·나옹·괴력몬·팬텀·킹크랩·라프라스·잠만보·더스트나·고릴타·에이스번·인텔리레온·스트린더·오롱털) 다이맥스 가능 종 목록은 없다.
- PvPoke gamemaster: 맥스 관련 태그 없음.
- 개별 포켓몬이 다이맥스 가능한지는 게임 내 "맥스 포켓몬" 여부(포획 경로)에 달려 있어 목록 행에도 저장되지 않는다. 따라서 "다이맥스 가능 포켓몬만" 조건을 만족하는 팀을 계산할 수 없어 구현하지 않는다. 필요하면 목록 행에 `is_max` 같은 사용자 입력 컬럼을 추가하는 것이 선행 조건.

### 테스트
`npm test` (`node --test tests/*.test.mjs`): 레벨 추정(뮤츠·레쿠쟈·망나뇽 L40 100% CP, 반 레벨 왕복), 섀도 보정, 레이드 순서(마기라스 → 격투 상위, 박사행 제외, 6마리 채움), 로켓 슬롯 커버.

## 3-0단계 보완: 기기 연결 코드 (안드로이드 수집기 인증)

이메일 계정 연결(아래 절)은 **사용하지 않는다**(Supabase 기본 발송은 템플릿 수정 불가·발송 제약). 대신 웹에서 발급한 8자리 코드를 앱에 입력해 장기 토큰을 받는 방식으로 앱이 이 계정의 `my_pokemon` 에 저장한다.

### 사용자가 해야 하는 설정
1. Supabase SQL Editor 에서 `supabase/migrations/0002_device_pairing.sql` 전체 실행(멱등).
2. Vercel → 프로젝트 → Settings → Environment Variables 에 `CRON_SECRET` 추가(임의의 긴 문자열, Production). Vercel Cron 이 `/api/keep-alive` 호출 시 `Authorization: Bearer <CRON_SECRET>` 를 자동으로 붙인다. 재배포 후 Vercel → Cron Jobs 에서 `0 3 * * *`(UTC, 한국 12:00) 등록 확인.
3. (이메일 UI 를 다시 켜려면) `NEXT_PUBLIC_ENABLE_EMAIL_LINK=true`.

### 테이블 (`supabase/migrations/0002_device_pairing.sql`)
- `device_pair_codes(code_hash pk, user_id, expires_at, attempts, used_at)` — 코드는 SHA-256 해시만 저장. 클라이언트는 본인 행의 해시 외 컬럼만 select, 쓰기 불가.
- `device_tokens(id, user_id, name, token_hash, created_at, last_used_at, revoked_at)` — 토큰은 해시만 저장. 클라이언트는 본인 행 select(해시 제외) + `revoked_at` 컬럼만 update(해제). insert·검증은 서버(secret key)만.
- `cleanup_device_pair_codes()` — 사용·만료 코드 삭제(서비스 역할, keep-alive 에서 호출).

### API (`app/api/device/*`, `app/lib/deviceAuth.js`)
| 단계 | 요청 | 규칙 |
|---|---|---|
| 1. 코드 발급 | `POST /api/device/pair-code` (웹, `Authorization: Bearer <Supabase 세션>`) | 8자리, 알파벳 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`(O/0/1/I/L 제외), 10분 유효, 사용자당 활성 코드 1개, 10분 5회 |
| 2. 교환 | `POST /api/device/pair` `{code, deviceName}` (앱) | 1회용(`used_at` 조건부 갱신으로 동시 요청 차단), 만료·재사용 거부, 실패 시 활성 코드 `attempts+1` → 5회면 무효, IP 당 10분 10회 → 429. 응답 `{token, deviceId, name}` 의 토큰은 이때 1회만 반환 |
| 3. 저장 | `POST /api/device/pokemon` (`Authorization: Bearer <토큰>`) | 토큰 해시로 `user_id` 결정, 본문의 `user_id/id/source` 무시, `source='overlay'`. 필드 검증(종 1~2000, CP 10~9999, 개체값 0~15 전부 또는 전부 null, 기술 ≤2, status/purposes 열거값). 해제된 토큰은 401. `GET` 은 연결 상태 확인 |
| 4. 관리 | 웹 "📱 기기 연결" 패널 | 코드 발급·표시, 연결 기기 목록, 해제(`revoked_at`) |
- 코드·토큰 원문은 서버 로그에 남기지 않는다(`[device]` 로그는 기기 id·이름·실패 사유만).
- `GET /api/keep-alive` — `CRON_SECRET` 검사 후 `ai_usage` 1건 조회 + 코드 정리. `vercel.json` cron `0 3 * * *`.

### 검증 (이 환경, 모의 PostgREST)
코드 발급 → 소문자·공백 섞인 입력으로 교환 성공 → 같은 코드 재사용 400 → `user_id` 위조 본문 저장 시 서버 결정 계정으로 `source='overlay'` 저장 → 검증 실패 400 → 토큰 없음/해제 후 401 → 만료 코드 400 → 실패 5회 누적 코드 400 → IP 제한 429 → keep-alive 비밀 없음 401/정상 200. 로그에 코드·토큰 원문 0건. RLS 는 실제 Supabase 에서 확인 필요.

## 4-0: 웹 화면을 수집기 앱에 통합 (WebView + 자동 로그인)

- 앱 첫 화면 "🌐 포고박사 열기" → `WebActivity`(WebView)가 `serverUrl` 웹앱을 연다. 세션은 WebView 저장소(localStorage)에 남아 앱 재시작 후에도 유지된다.
- **자동 로그인**: 앱이 기기 토큰으로 `POST /api/device/web-code`(응답에 `userId` 포함) → URL 해시 `#applogin=<코드>&uid=<user_id>` 로 웹을 연다. 웹(`app/page.jsx` 부트스트랩)은 해시를 즉시 URL 에서 지우고, 현재 세션이 같은 `user_id` 면 코드를 쓰지 않으며, 다르면 `/api/auth/web-login` 으로 교환(3-1c 흐름). 해시는 서버로 전송되지 않고 코드는 화면에 표시되지 않는다. 익명 목록이 있으면 병합 질문(📱 기기 연결 패널).
- **WebView 보안**: 우리 도메인(serverUrl 호스트, https)만 WebView 에서 열고 그 외 링크는 시스템 브라우저(`ACTION_VIEW`). `addJavascriptInterface` 없음(기기 토큰 원문은 WebView 로 넘기지 않음), 파일·콘텐츠 접근 비활성, 혼합 콘텐츠 차단, 위치 비활성. 뒤로가기는 WebView 히스토리 우선. User-Agent 에 `PogoDoctorApp/<버전>` 접미사.
- 미사용 웹 코드는 발급 시 지우지 않는다(PC 용으로 받은 코드가 앱 웹 화면 열기로 무효화되지 않도록). 발급 제한 IP 당 10분 30회.
- PC 브라우저는 계속 사용 가능(앱 → 웹 로그인 코드). "홈 화면에 추가" 는 앱 화면에 안내만.

## 4-D2: 실DB 검증 후속 — 구버전 기록 숨김 기준, 보관함 설정 초기 저장 경합, 찌르꼬 순위 보고, 판정 재계산 청크

검증 통과(PR #39): 신뢰 기록 467 + 구기록 139 숨김, population 470, 리그 태그 63→21, 진화 후보 단일(68), 박사행 278/15묶음.

1. **숨김 기준 변경**: "최신 세션 이전" → **신뢰 아닌 기록(app_version < 0.1.38 또는 null)만** 숨김(`/api/scan POST action=dismiss_untrusted`, 활성 기록을 페이지네이션으로 읽어 200건씩 dismissed). 섀도/정화 모드 세션 뒤에 누르면 전체 스캔 기록까지 숨겨지던 문제 해소. 버튼 "구버전 앱 기록 숨김", 복구는 그대로(`dismissed_reason='before_session'`).
2. **보관함 설정 초기 저장 경합**: `page.jsx` 가 `useState("normal")` 상태로 첫 `/api/verdict/batch` 에 `storageMode:"normal"` 을 보내 `user_settings`(relaxed) 를 덮어썼다. 수정: 초기값 null, **본문에 storageMode 를 넣지 않고** 서버 저장값(`meta.storageMode`)을 받아 상태에 반영(아래 5). 사용자가 버튼을 누를 때만 전송·저장. 단일 판정(`/api/verdict`)도 동일.
3. **찌르꼬 0/15/14 박사행 — 현행 유지**: PvPoke 순위 파일(2026-09-29 조회) 찌르호크 **슈퍼 710위/1146, 하이퍼 507위/844, 마스터 없음** → 리그 후보 조건(≤300) 밖이라 규칙대로 박사행. (참고: 찌르버드 슈퍼 646위, 찌르꼬 없음.)
4. **판정 재계산 청크**(`fillMissingVerdicts`): 한 요청에 최대 100건·15초(`FILL_CHUNK`, `FILL_BUDGET_MS`), 나머지는 응답 `pending` 으로 알리고 다음 조회가 이어서 처리(첫 `/api/scan` 27.6s → 함수 시간 제한 위험). 웹 스캔 기록·🧹 패널에 "⏳ 판정 갱신 중 — n건 남음" 표시. **pending > 0 이면 박사행 묶음 잠금**(`categories[transfer].locked`, `lockReason`): 웹은 복사·보냄 처리 버튼을 숨기고 "재계산 중 N건 — 잠시 후 다시 열기", 앱 `CleanupCopier` 도 응답 `pending` 을 보고 박사행 복사를 차단(태그 선택 목록에 안내). 태그·수집 묶음은 표시 유지(되돌릴 수 있음).
6. **스캔 모드 기록이 일반 기록을 대체**: 실측 — 섀도 모드 37건(0.1.40)이 전날 일반 모드 기록(0.1.38)과 종·CP·HP·개체값이 같은데 둘 다 활성(매칭·백필이 is_shadow 일치를 조건으로 함) → population 508(실제 470). 수정 — 신뢰 기록 중 섀도/정화 모드 기록이 같은 종·폼·CP·HP·개체값의 **일반 모드** 기록과 만나면 일반 기록을 superseded(`planModeSupersede`, 삽입 시 `/api/device/scan` + 백필 1회, `RULES_VERSION` 2026-09-30.2). 반대 방향(일반이 섀도를 대체)은 없음. 테스트 8건.
7. **박사행 보호 조건에 코스튬 추가**: `!특별`(한국어판 코스튬 검색어, 사용자 확인) → 최종 `&!#&!색이 다른&!반짝반짝&!xxl&!배경&!특별`(40자, 길이 계산 포함). 웹·Kotlin 동일.
5. **보관함 설정 서버 값 우선**: 페이지 로드 시 본문 없이 `/api/verdict/batch` 를 보내 `meta.storageMode`(서버 저장값)로 상태·localStorage 캐시를 갱신. localStorage 는 서버 응답 전 표시용 캐시일 뿐 서버로 보내지 않는다. 서버 저장은 사용자가 보관함 버튼을 눌렀을 때만.

## 4-D: 전체 스캔(470마리) 실DB 결과 반영 — 조회 상한 제거 · 신뢰 기록 우선 · 리그 후보 축소 · 진화 후보 단일 태그 · 스캔 모드

실측(세션 20260929-2152-7818): 새 기록 478(superseded 11, 활성 467 ≈ 보유 470), 판독 741, mismatch 3, noCp 114, noSpecies 6. 활성 전체 518 = 새 467 + 수정 전 앱 기록 51.

1. **[치명] 조회 상한 300 제거**: `/api/scan`·`/api/cleanup`·`/api/verdict/stats`·기기 조회가 `limit(300)` 으로 활성 518건 중 300건만 써서 population 303 → 예상 수·보호 판단 오류. `app/lib/scanQuery.js fetchActiveScanItems`(range 페이지네이션, 1000건씩, 상한 3000, 응답 `truncated`). 테스트 `tests/scanQuery.test.mjs`(518건 3페이지, 3000 상한, 오류).
2. **이전 기록 정리**: 마이그레이션 **0011**(`scan_items.app_version`, `is_purified`, `dismissed_reason`). 앱이 `app_version` 을 보내고(`BuildConfig.VERSION_NAME`), **≥0.1.38 = 신뢰 기록**(`app/lib/appVersion.js`, 라벨행 채택 폐지 이후). 같은 종·CP·HP(개체값 다름) 또는 같은 종·개체값 충돌 시 신뢰 기록이 미신뢰(구 앱) 기록을 superseded 로 대체(insert 시 `/api/device/scan`, 백필 `planConflicts.supersede`·`planSupersede ②'`). 신뢰 기록끼리 갈릴 때만 둘 다 재확인. 신뢰 기록은 오판독 의심 휴리스틱 대상 아님. 웹 스캔 기록 패널 **[이 세션 이전 기록 모두 숨김]**(최신 세션의 첫 기록보다 오래된 활성 기록 → `dismissed=true, dismissed_reason='before_session'`, 확인창) + **[숨김 복구]**(`restore_dismissed`).
3. **리그 후보(D) 축소**: 조건 = 그 리그 PvPoke 순위 ≤300(`LEAGUE_CANDIDATE_SPECIES_RANK`) AND 스탯곱 ≤41 AND **상한 도달**(상한 레벨 < 50 AND 상한 레벨 CP ≥ 상한×0.97, `LEAGUE_CAP_REACH_PCT`). 일반 리그 보류도 상한 미도달 개체는 제외(주력 조건은 그대로). 약한 종(도치마론 1080위·롱스톤 906위)은 L50 에도 상한 미도달이라 고개체가 스탯곱 1위였던 문제 해소. 회귀 테스트: 찌르꼬 0/15/14(찌르호크 하이퍼 L36 CP2497) 유지, 도치마론 15/15/12 제외, PvPoke 301위 제외.
4. **진화 후보 태그 단일화**: `TAG.evolve()` = "진화 후보" 하나(카테고리 50개+ 방지). 진화형·사탕은 사유("→찌르호크 기준: … · 사탕 125개 필요"), `metrics.finalKr`. 최종형이 여럿(이브이)이면 등급 → 사탕 순 하나만 태그로, 나머지는 "(다른 진화형 n: …)"·`metrics.alternatives`. 같은 이름 태그가 여러 개 생겨 need_appraisal 이 되는 것 방지.
5. **스캔 모드**(앱, **새 APK 필요**): 연속 스캔 시작 전 일반/섀도/정화 선택(`Prefs.scanMode`, 앱 화면 버튼, 타일·알림 시작에도 적용). 세션 동안 고정, 알림 제목·안내 줄에 표시. 섀도 모드는 `is_shadow=true` 로 기록(섀도 판정·중복 키), 정화 모드는 `is_purified=true`. 사용자는 게임 검색("섀도"/"정화")으로 먼저 거른 뒤 스캔 — 한국어판 검색어 동작은 사용자 확인 후. 이로치·배경·XXL 은 박사행 보호 조건으로 충분(모드 없음), 코스튬은 사용자 태그.
- `RULES_VERSION` 2026-09-30.1 → 판정 재계산·백필 재실행.

## 4-C.4: 실DB 검증(136건) 반영 — 라벨행 값 채택 경로 폐지(막대 절반 판독 원인), 과거 기록 의심 표시, 찌르꼬 진화 후보

### 1. 방어·HP 막대 절반 판독(충돌 30건) — 원인 코드 경로
- 경로: `CaptureService.scanAnalyze` 4-B4 분기 — 비율 판독(`reading.appraisal`)이 CP/HP 와 모순(`IvCalc.consistent` false)이면 라벨행 판독값(`reading.alt`)이 CP/HP 와 **성립하기만 하면** 채택(`altUsed`, 알림 줄 "(라벨행 값 채택)").
- 왜 통과했나: `IvCalc.consistent` 는 `candidates(base, cp, hp)` 중 막대값과 같은 조합이 **하나라도** 있으면 참인데, CP·HP 하나에 성립하는 개체값 조합은 보통 수십 개라 잘못된 값도 쉽게 통과한다(충돌 쌍의 두 값이 모두 같은 CP·HP 와 성립하는 것이 그 증거).
- 왜 절반·같은 값인가: `BarReader.readForLabel` 후보 행 = 라벨 아래 0.3~1.6h + 라벨 중심 ±h/4, 그중 분류 픽셀이 가장 많은 행(`totalPx` 최대, 동률이면 먼저 넣은 "라벨 아래" 행). 라벨이 막대 왼쪽·위에 있을 때 이 행들은 **인접 막대·패널 배경**을 지나며, 빈칸 회색 판정(`isEmpty`, 무채색 165~240)이 배경·테두리 픽셀을 통과시켜 분모가 커진다(4-B4 에서 x 범위는 고정했지만 y 후보 행 문제는 남아 있었음). 그래서 방어=HP 같은 값(냐오불 13/7/7, 과사삭벌레 11/4/4)과 절반값이 나온다. 공격은 첫 라벨이라 아래 행이 바로 공격 막대여서 정상.
- 비율 판독이 모순이 되는 계기(막대 채움 애니메이션 중 프레임 등)는 이 경로가 "그럴듯한 값"으로 덮어 씌워 감춰졌다.
- 수정(앱, **새 APK 필요**): 라벨행 값 채택 경로 폐지 — 비율 판독만 쓰고, 두 방식이 다르면(`reading.mismatch`) 채택하지 않고 `recheck=true` + `recheck_reason="막대 판독 불일치(비율≠라벨행) — 재스캔 필요"` 로 기록(서버 `/api/device/scan` 본문 `recheck_reason`). 게이트 400ms 는 유지(원인이 채택 경로로 확정됐고, 모순 프레임은 재확인으로 걸러진다).

### 2. 과거 기록 의심 표시(휴리스틱)
- 앱은 라벨행 채택 여부를 저장하지 않았다 → 백필에서 **방어·HP 둘 다 ≤8 이고 공격 ≥ 방어+5** 인 활성 기록을 `recheck` + "막대 오판독 의심(…) — 재스캔 필요" 로 표시(`planSuspects`, 이미 recheck 면 제외). 재확인 기록은 박사행·태그·수집 묶음 제외, population(예상 수)에는 남김. 사용자 재스캔(새 APK)으로 해소. `RULES_VERSION` 2026-09-29.6 로 백필 재실행. 응답 `backfill.suspects`.

### 3. 찌르꼬 0/15/14 여전히 박사행 — 원인
- 4-C.3 수정(HP 레벨 후보)은 맞았지만 진화 후보 판단이 최종형의 **주력 태그만** 세었다. 찌르호크의 하이퍼 태그는 D(리그 후보: 종 PvPoke 순위 200위 밖·스탯곱 ≤41) **보류**라 진화 후보가 만들어지지 않았고 박사행이 됐다.
- 수정: 최종형에 주력이 없고 리그 후보 보류만 있으면 진화 후보를 **보류**로 부여. 테스트 "4-C.4 결함 3"(찌르호크 하이퍼 300위 가정 → 진화 후보 보류; PvPoke 파일에 아예 없으면 D 제외 규칙대로 박사행 — 실DB explain 의 `leagues.ultra.pvpokeRank` 로 확인).

## 4-C.3: 실DB 검증(139건) 반영 — 리그 후보 미적용 원인, 개체값 충돌 재스캔, 백필 보강, 맥스배틀 목록 파일

통과: user_settings(relaxed) 반영, 백필 3건, 보호 조건 4묶음, 잉어킹 진화 후보 보류, 추천 기술 문구. 결함 3건 수정:

1. **찌르꼬 0/15/14(L2, CP null, HP22) 박사행 — 원인**: `normalizeCandidates` 가 CP·레벨이 없는 개체값 확정 입력을 **L40 으로 가정**해 진화 후보 평가에서 찌르호크 L40 이 하이퍼 상한(스탯곱 최적 L36)을 넘어 "불가" 처리됐다. 앱은 최초 기록 때 `ivCandidates`(HP 레벨 후보)를 보내지만, 규칙 버전 변경 시 재계산(`verdictForItem`)에는 없어 이 경로에서 발생. 수정: CP·레벨이 없고 HP 가 있으면 HP 로 가능한 레벨들을 후보로 쓴다. 테스트 "4-C.3 결함 1"(재계산 경로 포함). 찌르호크의 PvPoke 하이퍼 순위 존재 여부는 실DB `explain` 으로 확인 필요(테스트는 합성 순위).
2. **같은 종·CP·HP 인데 개체값이 다른 기록**(괴력몬 2634/163 15/12/14 vs 15/6/8, 냐오불 577/83 13/15/12 vs 13/7/7): 마이그레이션 **0010** `scan_items.recheck_reason`. insert 시(`/api/device/scan`)와 백필에서 충돌 쌍 모두 `recheck=true, recheck_reason="같은 CP·HP 다른 개체값 — 재스캔 필요"`. 재확인 기록은 박사행·태그·수집 묶음 모두 제외(`classify`), 웹 스캔 기록에 사유 표시. **원인 추정**(디버그 수치 없음 — 확인 필요): 두 사례 모두 공격 막대는 같고 방어·HP 막대만 약 절반(12→6, 14→8, 15→7, 12→7)으로 읽혔다. 후보 ① 라벨행 판독값(`alt`) 채택 — CP/HP 후보가 두 개체값 조합 모두와 성립해 `IvCalc.consistent` 검증이 못 거른 경우(알림 줄 "(라벨행 값 채택)" 표시 여부로 확인), ② 채움 애니메이션 중 프레임 — 공격 막대가 먼저 차고 방어·HP 가 뒤늦게 차는 시점에 서명이 400ms 동안 우연히 같았던 경우. 디버그 모드에서 해당 개체의 `detail`(ratio/label 값)을 받으면 확정 가능.
3. **백필 잔여**(리자몽 15/7/7·썬더 12/7/7 같은 세션·HP·한쪽 CP null·레벨 null, 뚜벅쵸 9/4/4 다른 세션 CP·HP 동일): 규칙 보강 — ⓪ 종·CP·HP·개체값이 모두 같은 기록은 검증과 무관하게 최신만 남김, ① 같은 세션·종·개체값·HP 에서 한쪽만 CP 가 있으면 레벨·검증 없이 CP 있는 쪽을 남김(다른 세션·다른 HP 는 대체 안 함 — 동일 개체 증명 불가). `RULES_VERSION` 2026-09-29.5 로 백필 재실행.
- 맥스배틀 종 목록: 환경변수·snacknap 방식 폐지 → 저장소 파일 `app/data/maxBattleSpecies.json`(빈 목록, PR 관리). 비어 있으면 안내 없음. 사용자는 게임 "다이맥스" 태그 + 보호 조건 `!#` 로 보호.
- D "PvPoke 파일에 없는 종 제외" 현행 유지(사용자 동의).

## 4-C.2: 실DB 검증(142건) 반영 — 백필 · CP 검증 · 박사행 보호 조건 · 수집 태그 · 리그 후보 · 진화 후보 · 보관함 동기화 · 맥스배틀 안내

검증 결과: 0008 적용, 스캔 조회 정상(139건 재계산), 추천 기술 한국어 정상, `&!#` 정상. 문제: superseded 0건(기존 중복 6쌍 잔존 — insert 시점에만 처리), 서버 storageMode 가 항상 normal.

- **스캔 기록 백필**(`app/lib/scanBackfill.js`, 멱등): `/api/scan`·`/api/cleanup` 조회 시 `user_settings.scan_backfill_version` 이 현재 `RULES_VERSION` 과 다르면 1회 실행하고 저장. 같은 계열·폼·섀도·개체값 묶음에서 ① CP 미검증(없음·개체값/HP 와 불일치) 기록은 같은 HP 또는 같은 세션의 검증된 기록으로 대체, ② 검증된 기록끼리는 시간순으로 규칙 ③ 재생(최신 유지, 서로 다른 과거 후보 2개 이상이면 보류). 응답 `backfill: {ran, superseded, version}`, 웹 🧹 패널에 표시. 테스트 `tests/backfill.test.mjs`(사용자 사례 6쌍 유형).
- **A. CP 자리수 누락 방지**: `/api/device/scan` 저장 전 `cpConsistentLevel`(종·개체값·HP 로 가능한 레벨의 CP 와 대조, 레벨 null 이어도 HP 로 역산)이 실패하면 CP 를 null 로 저장(응답 `cpRejected`). 예: 괴력몬 2634 → 263.
- **B. 박사행 보호 조건 고정**(옵션 폐지): 박사행 검색어 끝에 항상 `&!#&!색이 다른&!반짝반짝&!xxl&!배경`(`PROTECT_SUFFIX`, 길이 상한 계산 포함; 4-D2 에서 `&!특별` 코스튬 추가). 안내·토스트 "게임 결과 ≤ 예상 N마리. 적으면 보호 대상이 빠진 것, 많으면 보내지 말 것". 한국어판 동작은 사용자 확인("색이 다른" 띄어쓰기 포함). 코스튬은 검색어가 없어 태그로 보호. `matches()` 부정 절: `!#`→game_tags 없음, `!색이 다른`→이로치 아님, `!반짝반짝`→럭키 아님, `!xxl`·`!배경`→앱이 모르는 정보(잡힌다고 봄). 웹·Kotlin 동일.
- **C. "수집" 태그**(`TAG.collect`): 100%·0%·반짝반짝·오래 전 포획(교환 시 반짝반짝)이면 등급과 무관하게 `recommendedTags` 에 "수집" → 정리 도우미 `tag:수집` 묶음. 이로치·배경·XXL 은 게임 검색어 고정 묶음("색이 다른", "배경", "xxl", 예상 수 없음).
- **D. 리그 후보**: 스탯곱 순위 ≤41(`LEAGUE_CANDIDATE_PRODUCT_RANK`, 상위 1%)이면 종 PvPoke 순위와 무관하게 보류("리그 후보" 표기, `metrics.candidate`). 사례: 찌르꼬 0/15/14 → 찌르호크 하이퍼 4위·슈퍼 115위.
- **E. "진화 대기" → "진화 후보"**(`TAG.evolve`, `EVOLVE_PREFIX`): 필요 사탕 ≥200(`EVOLVE_CANDY_HOLD`)이면 등급 상한 보류. 사례: 잉어킹 15/12/11 사탕 400 → 보류.
- **F. 보관함 설정 동기화**(마이그레이션 **0009** `user_settings`): 원인은 `buildVerdictContext` 가 요청 본문의 storageMode 만 쓰고 저장하지 않아 스캔 후계산·정리 도우미·stats 가 기본값(normal)을 쓴 것. 이제 `/api/verdict`·`/api/verdict/batch` 본문의 storageMode 를 `user_settings.storage_mode` 에 저장하고, 본문에 없는 경로는 저장값을 쓴다(`stats` 응답 `storageMode` 로 확인).
- **G. 맥스배틀 종 안내**: 목록에 있는 종은 판정 대신 "🟡 보류: 맥스배틀 종 — 다이맥스 태그 권장"(`recommendedTags: ["다이맥스"]`, `dynamax: true`). **목록 출처 한계**: 이 환경에서 접근 가능한 공개 데이터(PokeMiners game master, PvPoke gamemaster, ScrapedDuck)에는 다이맥스 가능 종 필드가 없어 전체 목록을 확인하지 못함. 4-C.3 부터 저장소 파일 `app/data/maxBattleSpecies.json` 로 관리(빈 목록 시작).
- `RULES_VERSION` 2026-09-29.4 → 조회 시 판정 재계산.

## 4-C: 추천 기술 표시 · 강화/진화 후 동일 개체 갱신 · 정리 도우미 `&!#` 옵션 (기술 스캔 취소)

방침 변경(사용자 판단): 기술은 기술머신·이벤트로 바꾸므로 상세 화면 기술 캡처·OCR 은 **취소**. 기존 "최적 기술 가정" 판정 유지(`docs/PHASE4.md` 4-C 취소 표기).

### 1. 추천 기술 표시
- 보관(주력/보류) 태그마다 `moves = { fast, charged[], fastKr, chargedKr[], special }`(`verdict.js recommendedMoves`). 레이드는 종 순위 산출에 쓴 최적 조합(`speciesRankings` fast/charged), 리그(슈퍼/하이퍼/마스터)는 PvPoke 순위 파일의 `moveset`(ID → 데이터셋 기술명, 영숫자만 비교: `X_SCISSOR` → `X-Scissor`), 진화 대기는 최종형의 첫 주력 태그 기술.
- 표기: "추천 기술: 불꽃회오리/블라스트번", 레거시·전용기면 "⚠ 특수 기술머신", 30일 내 이벤트 대상 종의 진화 대기 태그에는 "📅 이벤트 때 진화(날짜 이벤트명)". "기술 확인 필요(최적 기술 가정)" 문구 폐지(경고 아님). 판정 응답 `recommendedMoves: { 태그명: moves }`, 스캔 기록 `verdict.tags[].moves` 저장(`RULES_VERSION` 올림 → 조회 시 재계산).
- 표시 위치: 웹 내 목록·스캔 기록("🎯 태그 추천 기술: …"), 앱 결과 카드.

### 2. 강화·진화 후 동일 개체 갱신 (`pokemonMatch.js` 규칙 ③)
- 조건: 같은 진화 계열·폼·섀도, 개체값 3개 확정·동일, 새 레벨 ≥ 기존 레벨(레벨이 없으면 CP 로 비교, 둘 다 없으면 비교 불가 → 매칭 안 함). 일치하면 CP·HP·레벨·종 갱신, tags/status/memo/game_tags 유지(`mergePatch`). ①·② 규칙이 먼저.
- 후보가 2개 이상이면 병합하지 않고 `ambiguous` → 내 목록은 새 행 memo 에 "⚠ 같은 개체값 n마리와 구분 불가 — 재확인", 스캔 기록은 `recheck`.
- 스캔 기록: 새 기록 insert 시 같은 조건의 과거 기록(다른 세션 포함, `findSuperseded`)을 `superseded=true, superseded_by=<새 id>` 로 표시(마이그레이션 **0008**, dismissed 와 별도). `/api/scan`·`/api/cleanup`·`/api/verdict/stats`·앱 조회는 superseded 제외. 응답 `superseded: n`.
- 테스트 `tests/match.test.mjs`: 강화(CP·HP·레벨 증가), 진화(계열 내 종 변경), 동일 개체값 2마리 충돌, findSuperseded(같은 값 재기록은 대체, 서로 다른 후보 2개는 ambiguous).

### 3. 게임 태그 vs 판정 불일치
게임 태그 우선(박사행 제외 유지). 웹 내 목록에 "⚠️ 불일치 — 판정: … / 게임 태그: …" 표시만, 자동 변경 없음.

### 4. 태그 칩 판독 중단 → 박사행 검색어 `&!#` 옵션
- 평가 화면(연속 스캔)에는 태그가 보이지 않음(사용자 확인) → 칩 OCR·픽셀 판독은 진행하지 않는다(`GameTags` 코드는 `ScreenParser` 가 쓰므로 유지, 결과는 비어 있음).
- 대신 정리 도우미에 옵션 `noTag`(웹 체크박스, 앱 설정 스위치, `GET /api/cleanup?noTag=1`): 박사행 묶음 검색어 끝에 `&!#`(게임 검색: 태그 없는 개체만). 켜면 안내·토스트가 "게임 결과 ≤ 예상 N마리. 적으면 태그 달린 개체가 빠진 것" 으로 바뀐다. **기본 끔** — 한국어판 `!#` 동작은 사용자 확인 결과를 받아 반영. `matches()` 는 `!#` 절을 game_tags 가 비어 있을 때 참으로 본다(웹·Kotlin 동일, 테스트).

## 4-B6: 레이드 공격 IV 하한 · 게임 태그 칩 판독 · 태그 선택 목록 (4-B 실기기 결과 반영, 4-C 전 소형 PR)

실기기(v0.1.30) 결과: 박사행 11=11 정상. 문제 3가지 — 격투 레이드 묶음에 저승갓숭(#979, 공격 0, 하이퍼리그용) 포함 / 박사행에 게임 태그가 이미 달린 두랄루돈·라이츄 포함 / 태그 복사 순환·"예상 N마리" 의미 불명.

### 1. 레이드 태그 공격 IV 하한
- `RAID_MIN_ATK_IV = 10`(이 미만이면 레이드 태그 없음), `RAID_MAIN_MIN_ATK_IV = 12`(주력 조건). 섀도도 같은 하한. `app/lib/verdict.js` 레이드 후보 루프에서 적용.
- 수정 전후 비교: `GET /api/verdict/stats`(웹 로그인 또는 기기 토큰) → 내 목록 + 스캔 항목의 등급 분포(주력/보류/박사행/평가 필요)·보류 사유·주력 태그. `?RAID_MIN_ATK_IV=0&RAID_MAIN_MIN_ATK_IV=0` 으로 옛 규칙을 재현해 비교(`ctx.rulesOverride`). 이 환경에서는 사용자 DB 에 접근할 수 없어 수치는 사용자가 두 URL 을 열어 확인한다.
- 테스트 `tests/verdict.test.mjs` "4-B6 레이드 공격 IV 하한": 저승갓숭 0/15/15·9/15/15 → 레이드 태그 없음, 11 → 보류, 12 → 주력, 섀도 동일, `rulesOverride` 로 옛 규칙 재현.

### 1-2. 실DB 검증(120마리) 반영 — 4-B6.2
- 등급 분포: 레이드 하한 적용 전 주력 52 / 보류 45 / 박사행 23 → 적용 후 주력 38 / 보류 45 / 박사행 37.
- 저승갓숭 실제 기록 0/11/14 L28.5 CP2461: 하이퍼 PvPoke 59위, 스탯곱 594위 → 보류 기준 500 초과로 태그 없음, 레이드 하한으로 격투 레이드도 빠져 박사행. 규칙 결함이 아니라 기준값 문제.
- **판정 최신화**(결함 수정): 정리 도우미가 저장된 `scan_items.verdict` 를 그대로 써서 규칙 변경이 반영되지 않았다. `RULES_VERSION`(`verdictRules.js`)을 판정에 저장(`verdict.rulesVersion`)하고, `/api/scan`·`/api/cleanup` 조회 시 버전이 다르면 다시 계산·저장(`isStaleVerdict`, `fillMissingVerdicts`). `/api/verdict/stats` 는 항상 새로 계산. 기준값·로직을 바꿀 때 `RULES_VERSION` 을 올린다. 테스트 "4-B6.2 판정 최신화".
- **리그 보류 기준 완화**(가방 여유, 박사행 비가역): `LEAGUE_HOLD_PRODUCT_RANK` 500 → **800**(상위종), `LEAGUE_MID_HOLD_PRODUCT_RANK` 100 → **200**. 보관함 "빠듯" 이면 기존 500/100 유지(`*_TIGHT`). 이로써 저승갓숭 0/11/14(594위)는 보통/여유에서 **하이퍼리그 보류**, 빠듯에서는 박사행. `stats` 의 덮어쓰기 가능 항목에 `LEAGUE_*` 추가(`?LEAGUE_HOLD_PRODUCT_RANK=500&LEAGUE_MID_HOLD_PRODUCT_RANK=100` = 완화 전).
- **사용자 기존 게임 태그 이름** 인식 목록 추가(`GameTags.USER_DEFAULT`): 즐겨찾기, 슈퍼리그, 하이퍼리그, 레이드1군, 레이드2군, 다이맥스, 체육관. 앱 설정 "내 게임 태그 이름"(쉼표 구분)에서 편집, 기본값 = 위 목록. 추천 태그 이름(`RECOMMENDED`)은 항상 인식. 비교는 띄어쓰기·`#` 무시. 줄 전체가 태그 하나면 토큰으로 쪼개지 않는다("체육관 방어" 를 "체육관" 으로 오인하지 않음).
- 칩 존재 여부 픽셀 판독(이름과 무관)은 다음 실기기 캡처(4-C 상세 화면과 함께 수집) 이후.

### 2. 저승갓숭 하이퍼리그 미판정 조사
- 규칙상 저승갓숭(기본 220/178/242, PvPoke 하이퍼 순위 59위 ≤ 100)은 하이퍼 스탯곱 순위 ≤100 이면 주력, ≤500 이면 보류 태그가 붙어야 한다. 공격 0 이면 스탯곱 순위가 오히려 높다(0/15/15 → 1위, L28.5, CP 2492; 0/14/15 → 12위; 0/15/14 → 14위).
- 태그가 안 붙는 경우는 규칙이 아니라 입력이다: ① 현재 CP 가 2500 초과(강화됨) → 하이퍼 불가, ② CP 미확인(cp null) 이면 레벨 후보가 2500 상한을 넘나들어 `need_appraisal`(추천 태그 비움), ③ 막대 오독으로 공격이 0 이 아닐 때. 사용자 기록으로 확인: `GET /api/verdict/explain?scan=<scan_items.id>`(또는 `?row=<my_pokemon.id>`) → 리그별 PvPoke 순위·스탯곱 순위·상한 레벨·그 레벨 CP·현재 CP 와 판정을 돌려준다.

### 3. 게임 태그 칩 판독 → `game_tags`
- `core/GameTags.kt`: OCR 줄 가운데 "알려진 태그 이름"(포고박사 추천 태그 문자열 25종: `{타입} 레이드` 18 + 체육관 방어/슈퍼리그/하이퍼리그/마스터리그/수집/교환용/진화 대기)과 일치하는 짧은 줄을 칩으로 본다(공백·`#`·구분자 무시, 두 토큰 결합). **픽셀 기반 칩 판독은 이번 PR 에 없다**: 칩 띠 비율 상수(`CHIP_Y0 0.49H ~ CHIP_Y1 0.56H`, 720×1600 기준)는 미검증 추정값이며, 실기기 디버그 캡처(칩이 보이는 평가 화면)로 확인 후 붙인다.
- 저장: 마이그레이션 `0007_game_tags.sql`(scan_items·my_pokemon `game_tags text[]`, pglite 2회 ALL OK, **SQL Editor 실행은 사용자**). 앱 `/api/device/scan` 본문 `game_tags`, 저장 시 my_pokemon 으로 전달(`mergePatch` 는 합집합).
- 정리 도우미: `classify` 가 `game_tags` 있는 개체를 박사행·태그·수집 대상에서 제외. 웹 스캔 목록 "🏷 게임 태그 있음(…)", 내 목록 "🎮 게임 태그 있음", 🧹 패널 "게임 태그 있음 n마리 제외". 앱 로컬 대체 계산도 제외.

### 4. 알림·토스트
- 태그 복사 순환 폐지. 알림 액션 [태그 선택] → `CleanupActivity`(결과 화면과 같은 반투명 대화상자): 줄마다 "카테고리명 · 예상 N마리"(묶음이 여럿이면 "불꽃 레이드 2/3", 느슨 묶음이면 "⚠️ 다른 개체 최대 n마리 포함 가능"), 누르면 복사·토스트·닫힘.
- 토스트 형식: `[불꽃 레이드] 복사됨 · 예상 N마리 — 게임 결과 수가 같을 때만 전체 선택`, 박사행은 `[박사행 1/2] …` + 한계 문구.
- 예상 수 한계 문구(`EXPECTED_LIMIT_NOTE`, 서버 `/api/cleanup` 응답 `note`) 상시 표기: 박사행 토스트, 웹 🧹 패널 상단, 앱 🧹 카드·태그 선택 목록 상단.

### 5. 묶음 생성 strict/loose
- `buildGroups(targets, population, { maxLen, strict })`: strict(박사행)는 충돌 묶음 분할·구분 불가 대상 제외(현행). loose(태그·수집)는 충돌이 있어도 길이 상한만 지키고 `overlap`(알려진 비대상 중 잡히는 수)을 표기 → 웹 "다른 개체 최대 n마리 포함 가능" 경고. Kotlin `SearchBuilder.buildGroups(..., strict)` 동일. 테스트: 웹 `tests/search.test.mjs` +2, core `Phase4b6Test` 2건.

## 4-B5: CP 정리 · 정리 도우미(검색어) · 실시간 판정 띠 — 4-B 완료

최종 실측(v0.1.28, 게임 부스터 끔): 2.7분 · 프레임 377 · 게이트 열림 84 · 기록 53(중복 30) · 넘긴 50마리 → 스캔 항목 51건(기록률 ≈100%), 개체값 정답 일치. 오버레이 숨김의 원인은 **삼성 게임 부스터**(사용자 확인) — 끄면 포켓몬GO 위에도 띠·버튼이 보인다.

### A. CP 정리
- CP 는 게이트가 열린 그 프레임의 OCR 값만 쓴다(이월 없음). `IvCalc.validateCp`: 막대 IV + HP 로 가능한 레벨에서 계산한 CP 와 일치할 때만 저장, 아니면 `cp=null`(레벨은 HP+IV 로 산출, 재확인 표시 없음, 카운터 `cpRejected`). "재확인 필요"는 막대와 HP 가 모순(후보 0)일 때만. 테스트 `Phase4b5Test.cp_must_agree_with_bars_and_hp_else_null`(이월 CP 2212·잘린 221 → null).

### B. 정리 도우미 — 포켓몬GO 검색어로 일괄 박사행·태그 (게임 조작 없음)
- 검색 문법(한국어판, 사용자 확인): `A,B&C,D` = (A 또는 B) 그리고 (C 또는 D) — & 절마다 , 는 OR(CNF). `cp2100-2200` 범위 동작. `(A&B),(C&D)` 불가.
- 생성기 `app/lib/searchBuilder.js` = `android/core/SearchBuilder.kt`(같은 사례로 단위 테스트): 형식 `{도감번호 OR}&{hp OR}[&cp OR]`(예: `700,381&hp154,hp118`). 이름 대신 도감번호. 알려진 전체 개체(스캔 기록 + 내 목록)에 대해 검색식이 대상 외 개체를 잡으면 묶음을 쪼갬(최악 종별 1식). 같은 종·HP 의 비대상은 검증된 CP 로 좁히고, CP 도 같으면 그 대상은 제외("안전한 검색식 없음"). 섀도·폼은 별도 묶음(키워드 미사용). 묶음마다 "예상 N마리". 길이 상한 기본 200자(설정, 실제 상한 확인 필요).
- 대상 분류(`classify`): 박사행 = tier transfer 이고 재확인·need_appraisal·💎·이로치·럭키·전설 제외 / 추천 태그별 / 수집 추천. 서버 `GET /api/cleanup?maxLen=` → 분류별 묶음(`targetIds` 는 `scan:<id>`/`row:<id>`), `POST {action:"done", targetIds, deleteRows}` → 스캔 기록 dismissed(+박사행이면 내 목록 삭제).
- 앱: 스캔 중·후 알림 액션 [박사행 복사] [태그 복사](클립보드 쓰기는 트램펄린 액티비티에서) → 토스트 "예상 N마리: 결과가 N마리일 때만 전체 선택". 누를 때마다 다음 묶음. 앱 화면 🧹 카드에도 같은 버튼. 알림 액션은 3개 제한이라 스캔 중·스캔 기록 이후에는 [스캔 중지/연속 스캔][박사행 복사][태그 복사], 그 외 [캡처][연속 스캔][중지].
- 웹: 내 목록 → 🧹 정리 도우미: 분류별 묶음, [복사], 예상 수, [보냄 처리 완료](확인창 → 스캔 기록 정리 + 내 목록 삭제)/[완료(정리)].
- 실시간 판정 띠: 기록 직후 `/api/verdict` 비동기 → "❌ 박사행 / ✅ 주력: 불꽃 레이드 / 💎". 띠 설정 기본 켬(터치 통과), 안 보이면 알림만.
- 안전: 복사할 때마다 "결과 수 불일치 시 진행 금지" 안내. 박사행 묶음에 보관 판정 개체가 섞일 가능성이 계산상 있으면 그 묶음은 만들지 않는다(제외 목록에 표시).

### C. 문서·설정
- "포켓몬GO 가 오버레이를 숨김" → "삼성 게임 부스터가 원인(사용자 확인)" 으로 정정(앱 안내·PHASE3/4). 디버그 업로드 상한 기본 20 복귀.

## 4-B4: 막대 판독 방식 선택 수정 (디버그 캡처 24건 분석 반영)

디버그 24건 중 22건이 "label≠ratio" 였고 앱이 label 값을 채택해 막대-CP 모순으로 폐기됐다. ratio 값은 7건 모두 기존 정답과 일치(에이스번 15/14/14, 마기라스 15/15/14, 가이오가 11/12/11, 전수목 12/14/13, 라티오스 15/12/8, 디안시 15/15/11, 님피아 11/6/11).

- **버그 원인**(`BarReader.readForLabel`): 라벨 왼쪽(`label.left - h`)부터 **화면 오른쪽 끝(`width - 8`)까지** 훑어 첫/마지막 "막대색 또는 빈칸 회색" 픽셀을 막대 양끝으로 삼았다. 빈칸 판정(`isEmpty`: 무채색·밝기 165~240)은 막대 오른쪽 패널·카드 배경의 밝은 회색도 통과하므로 분모가 실제 막대(≈370px@1080, 0.119~0.464W)의 약 2배(≈737px)가 되어 값이 절반으로 나왔다. 단위 테스트 `Phase4b4Test.label_x_range_bug_is_fixed_label_uses_fixed_x` 가 옛 방식(화면 끝까지)의 분모 >1.5배를 재현한다.
- **수정**: 막대 값은 **비율 방식(x 0.119~0.464W 고정)** 이 기본. 라벨은 y 위치 보정에만 쓰고 x 는 고정 범위. 두 값이 다르면(`Reading.mismatch`, `alt`) 앱이 CP/HP 역산(`IvCalc.consistent`)으로 검증해 성립하는 쪽을 채택, 둘 다 모순이면 비율 값 + "재확인 필요".
- 진동은 **새 기록에만**. CP 보완(같은 종·HP·막대로 CP 미확인 기록이 있던 개체)·중복은 진동 없이 알림 문구만.
- 게이트 열림 후 종 미확정: 같은 서명으로 300ms 간격 최대 2회 재시도(총 3회, `ScanGate(maxAttempts=3, retryGapMs=300)`). 그래도 실패하면 서명을 닫고 CP/HP·막대와 성립하는 종 후보가 있으면 그 종으로 "재확인 필요" 기록, 후보가 없으면 기록 불가(종 없이는 저장할 수 없음 — 카운터 `failNoSpecies`).
- 디버그 업로드 상한 설정값 `scanDebugMax`(이번 테스트 기본 50, 검증 후 20 으로 복귀 예정). Storage 50×~100KB, 7일 정리 현행.
- 테스트 `Phase4b4Test` 4건(core 32/32): 위 7건 ratio 기대값(1080×2400, 라벨 있음), 라벨 x 고정 + 옛 방식 분모 재현, 라벨 y 어긋남 시 ratio 기본·alt 제공, 게이트 재시도.

## 4-B3: 연속 스캔 게이트 개정 (실기기 2차 측정 반영)

실기기(v0.1.24) 2차: 6.6분 · 프레임 977 · 분석 7 · 기록 2 · 파싱 543ms. 전송 문제는 해결됐으나 전체 화면 지문의 500ms 안정이 3D 모델 애니메이션·파티클·배경 때문에 거의 오지 않아 "새 개체 확정" 게이트가 열리지 않았다.

- **게이트** `core/ScanGate.kt`(순수 로직, 테스트): 서명 = 막대 3개 비율 위치 판독값(`BarReader.readByRatio`) + 이름 줄 띠 해시(`ScanSession.bandHash`, 4px 격자·8단계 양자화 FNV). 모델·배경 영역은 판단에서 제외. 서명이 직전 확정과 다르고 `scanStableMs`(기본 400ms) 동안 동일하면 열림. 분석 시도 후 `confirm` → 같은 서명으로 다시 열리지 않음(새 막대값·이름이면 다시 열림). 이름 줄 띠는 기본 비율(0.42~0.48H)에서 시작해 OCR 이 이름 줄 박스를 읽으면 그 위치로 학습.
- **사유별 카운터**(세션 측정값·웹 표시): 게이트 미개방 = 불안정 / 직전과 동일 / 평가 화면 아님(막대 미판독), 분석 실패 = 평가 아님(OCR 라벨 없음) / 종 미확정 / CP 없음 / 막대-CP 모순 / 중복.
- **파싱 속도** `core/NameIndex.kt`: 종 이름의 정규화·자모 분해·자모 바이그램을 사전 계산, 길이 차 ≤3 & 바이그램 공유 후보에만 편집 거리. 파서 인스턴스도 데이터셋 `generatedAt` 별로 재사용. 단위 테스트에서 1,412종 조회 20ms 미만(JVM), 전체 비교와 상위 1 결과 동일.
- **디버그 업로드**: 디버그 모드에서 분석 실패 프레임과 게이트 2초 이상 대기 프레임(5초당 1장)을 세션당 최대 20장 `/api/device/debug`(kind `scan-fail`/`scan-wait`, 포획 줄 가림)로 업로드.
- 4-B2 검토 ①: 서버가 4xx 로 거부한 대기열 항목은 `scan-rejected.jsonl` 에 최근 50건 보관, 앱 화면에서 건수·내용 확인·지우기.
- 단위 테스트 `Phase4b3Test`: 막대값 동일·모델 영역만 변하는 시퀀스 → 게이트 1회 열림, 막대값 변경 시퀀스(애니메이션 프레임 포함) → 400ms 안정 후 새 개체 확정, 막대 미판독 → 평가 아님, 같은 막대·다른 이름 → 새 개체, 장기 대기 진단, 이름 색인.

## 4-B2: 연속 스캔 성능 개정 (실기기 측정값 반영)

실기기(A90, v0.1.22) 첫 세션: 3.1분 · 프레임 336 · 분석 23 · 기록 2 · API 평균 7,687ms. 원인: 스캔 루프가 `/api/device/scan` 응답(판정 계산 포함, 콜드 스타트)을 기다리는 동안 `scanBusy` 로 프레임을 건너뛰어 넘긴 개체를 놓침(코드 확인: `scanFrame` 의 `finally { scanBusy = false }` 가 API 완료 후에 실행됨).

### 사용자가 해야 하는 설정
- Supabase SQL Editor 에서 `supabase/migrations/0006_scan_sessions.sql` 실행 (멱등, pglite 2회 검증). `scan_sessions`(세션 측정값) + `cleanup_scan_items()` 확장.

### 앱
- **전송 대기열** `ScanQueue.kt`: 스캔 루프는 서버 응답을 기다리지 않는다. 항목을 `filesDir/scan-queue.jsonl` 에 적고 워커가 순서대로 전송, 실패 시 지수 백오프(2s→60s) 재시도, 4xx(검증 거부)는 버림, 401 은 중단. 서비스·앱 종료 시 남은 대기열은 파일에 보존되어 다음 시작(서비스 시작 또는 앱 화면 "지금 재전송")에 이어서 전송. 알림: "✅ 기록 n · 전송 s/대기 m · 방금 …" — 기록 수는 로컬 확정 시점, 전송 상태는 별도.
- **픽셀 기반 평가 화면 판별**(OCR 전): 하단 0.62~0.86H 띠에서 막대 픽셀 행이 3줄 이상일 때만 OCR. 알림창·상세 화면·전환 중 프레임은 여기서 걸러진다(측정 `prefiltered`).
- **안정 대기 500ms**(`scanStableMs`, 설정 200~3000): 지문이 500ms 이상 그대로일 때만 분석(넘기는 중·애니메이션 프레임 제외). 스캔 시작 후 1.5초는 알림창·타일 패널이 닫히는 중이므로 제외.
- **진동 피드백**: 기록 확정 시 40ms(설정에서 끔). `VIBRATE` 권한.
- **측정값 분리**: 이전 "막대 238ms" 는 `parser.parse`(종 유사도 매칭)가 섞인 측정 오류였다 → OCR / 파싱 / 막대(픽셀) 를 분리해 기록. 세션 종료 시 측정값을 `/api/device/scan/session` 에 저장(대기열 경유) → 웹 📷 스캔 기록 "📈 세션 측정값".
- **디버그 업로드**: 디버그 모드에서 기록된 프레임을 기존 `/api/device/debug` 로 업로드(포획 줄 가림, kind=`scan`).

### 서버
- `POST /api/device/scan` 은 insert/매칭만 하고 응답(`ms` 포함). 판정은 `after()`(Next.js 응답 후 실행)에서 계산해 `verdict` 컬럼에 채우고, 웹 `GET /api/scan` 조회 시 비어 있는 항목은 한 번의 컨텍스트로 계산·저장(`filled`). 앱은 판정을 기다리지 않는다.
- 측정(이 환경, 모의 PostgREST + 실제 데이터 소스, `scratchpad/run-scan-timing.sh`):

| 요청 | 콜드(서버 첫 요청) | 웜 |
|---|---|---|
| `POST /api/device/scan` (insert만) | 27ms | 10~18ms |
| after() 판정 후계산 | 462~543ms | — |
| `POST /api/verdict` (데이터셋·순위 컨텍스트 포함) | 666ms | 7ms |

  Vercel 실환경은 함수 콜드 부팅(수백 ms~수 초)과 데이터 소스 4곳 fetch 가 더해지지만, insert 경로는 데이터셋을 건드리지 않으므로 Supabase 왕복 2회만 남는다. `speciesRankings`·PvPoke·이벤트는 모듈 메모리 캐시(6h, `generatedAt` 별 메모)이며 인스턴스가 살아 있는 동안 재사용된다. 사전 계산 결과의 영구 저장(KV 등)은 이번 범위에 넣지 않았다(측정값으로 필요성 재판단).

## 4-B: 평가 화면 연속 스캔 + 목록 관리

### 사용자가 해야 하는 설정
- Supabase SQL Editor 에서 `supabase/migrations/0005_scan_items.sql` 실행 (멱등, pglite 2회 검증 통과). `scan_items` 테이블(세션별 스캔 기록, 14일 후 keep-alive 가 정리) + `cleanup_scan_items()`.
- 앱 갱신 후 빠른 설정에 "포고박사 연속 스캔" 타일 추가(선택).

### 연속 스캔 (앱 `CaptureService` + `ScanSession.kt`)
- 켜기/끄기: 앱 화면 버튼, 알림 "연속 스캔/스캔 중지", 타일 "포고박사 연속 스캔". 사용자는 포켓몬GO **평가 화면을 켜 둔 채 좌우로 넘기기만** 한다.
- 루프: `scanIntervalMs`(기본 400ms, 초당 2~3프레임) 마다 캡처 → 이름·CP 영역(상단 6~30%)과 막대 영역(70~82%)의 격자 밝기 지문 → **연속 2프레임 동일**(안정)이고 직전 분석 화면과 다를 때만 OCR·막대 판독 → 막대 값이 직전 판독과 같을 때(채움 애니메이션 종료) 기록. 같은 개체(종·폼·CP·HP·막대) 는 세션 안에서 재기록하지 않는다. CP 가 배너에 가려진 프레임도 막대+HP 로 레벨 범위를 기록("CP 미확인")하고, 같은 개체를 이후 CP 까지 읽으면 서버가 그 기록을 갱신한다(`cpFilled`).
- 개체값: 막대 3개로 확정 + CP/HP 후보와 교차 확인. 불일치면 `recheck`("재확인 필요") 표시 후 막대 값으로 기록. 기술은 읽지 않으므로 판정에 "기술 확인 필요(최적 기술 가정)" 가 붙는다.
- 표시: 결과 액티비티를 띄우지 않는다. 포그라운드 알림 한 줄("스캔 12 · 방금 에이스번 96% ✅ 주력: 불꽃 레이드"). 상단 작은 띠(`FLAG_NOT_TOUCHABLE`, 불투명도 0.8, 터치 통과)는 기본 끔(설정에서 켜기, 포켓몬GO 위에서는 숨겨질 수 있음).
- 기록: `POST /api/device/scan`(기기 토큰) → 서버가 4-A 판정을 계산해 `scan_items` 에 저장(같은 세션·같은 개체는 갱신). **자동 목록 저장 없음** — 웹 내 목록 → 📷 스캔 기록에서 [추천대로 전부 저장] / [보관 추천만 저장] / 개별 보관·박사행·숨김.
- 측정: 세션 종료 시 프레임·분석·기록 수, 단계별 평균 ms(캡처·지문·OCR·막대·API), 배터리 % 변화가 알림·디버그 로그·앱 화면 "최근 세션" 에 기록된다. (실기기 수치는 사용자 보고로 채운다 — 이 환경에는 기기 없음.)

### 목록 관리 (`app/lib/pokemonMatch.js`, `app/lib/savePokemonServer.js`)
| 문제 | 구현 |
|---|---|
| 중복 저장 | `/api/device/pokemon`·웹 저장·스캔 기록 저장 모두 매칭: ① 종(진화 계열 내 변경 허용)·폼·개체값(셋 다 확정·동일)·포획일(둘 다 있고 동일) → ② 종·폼·CP·HP(둘 다 있고 동일). 섀도 여부는 같아야 함. 일치하면 새 행 대신 **갱신**하고 응답 `updated: true`, `rule: "iv+caught_on" | "cp+hp"` |
| 강화·진화 후 불일치 | ① 로 매칭되면 CP·HP·레벨·기술·종(계열 내)·플래그를 새 값으로 갱신. 새 값이 없으면(기술 미인식 등) 기존 유지. 웹 분석 저장은 "기존 항목 갱신" 안내 |
| 박사행 후 정리 | 웹 내 목록 "보낼 예정" 필터 → [보냄 처리] 일괄 삭제(확인 대화상자) |
| 수동 편집 충돌 | 갱신 패치에 memo·tags·status·purposes 를 넣지 않는다(테스트 고정) |

### API
- `POST /api/device/scan` (기기 토큰) 스캔 항목 기록 → `{item, verdict, duplicate}`; `GET /api/device/scan?session=` 조회.
- `GET /api/scan` (웹 세션·기기 토큰) 미처리 스캔 기록; `POST /api/scan {action: save|dismiss|clear, ids[], status?, session_id?}`. save 는 판정대로(또는 지정 status) my_pokemon 에 매칭 저장(추천 태그·파생 용도) 후 기록을 숨긴다.

### 테스트
- `npm test` — `tests/match.test.mjs`(①/② 매칭, 진화 후 재캡처, 패치가 사용자 편집을 건드리지 않음, 스캔 키·진화 계열). `npm run test:migrations` — 0001~0005 각 2회 + `scan_items` unique·cleanup.

## 4-A: 용도별 보관 판정 (결정적 계산 · `POST /api/verdict`)

### 마이그레이션 검증 (PR 전 필수, 4-A2 부터)
- `npm i --no-save @electric-sql/pglite && npm run test:migrations` — 실제 Postgres(pglite)에 Supabase 스텁(auth.users·auth.uid()·storage)을 만들고 `supabase/migrations/*.sql` 을 순서대로 **각 2회** 실행(멱등) + 0004 제약(tags 8개·24자, hp 범위) 동작 확인. 결과를 PR 보고서에 첨부한다. (0004 의 CHECK 서브쿼리 오류(0A000)·uuid GIN 오류는 이 검증이 없어 SQL Editor 에서 발견됨 — PR #29 에서 수정)

### 사용자가 해야 하는 설정
- Supabase SQL Editor 에서 `supabase/migrations/0004_verdict_tags.sql` 실행 (멱등): `my_pokemon.tags text[]`, `hp integer`, `caught_on date`. 미적용 상태에서는 웹이 구 컬럼으로 동작하며 목록 상단에 안내가 뜬다(태그 저장 불가).

### 판정 기준 (`app/lib/verdictRules.js` 와 동일하게 유지)
| 추천 태그 | 종족 조건 (자동 산출, 손목록 없음) | 개체 조건 → ✅ 주력 / 🟡 보류 |
|---|---|---|
| `{타입} 레이드` | 18 타입별 출시 종의 레이드 점수 순위(`app/lib/speciesRankings.js`: L40·15/15/15, 그 타입 빠른+차징 기술만, 중립 보스 250/200/220 L40 상대 DPS^0.775×TDO^0.225). **상위종 = ≤12위 AND 점수 ≥ 타입 1위(전설 포함)의 75%**, 중위종 = ≤30위 AND ≥65% (4-A2: 공격수가 적은 타입에서 약한 종이 순위만으로 들어오는 것 방지). 섀도 별도 순위(공격×1.2·방어×0.833, PvPoke gamemaster `tags: shadoweligible` 종만), 메가 제외 | 내 목록 같은 종·같은 섀도 여부 안에서 공격 IV(동률 시 레벨) 순위. 상위종 & ≤6위 → 주력, 그 외 → 보류. 캡처 기술로 계산해 종 최적 기술(전용기·레거시)이 없으면 "특수 기술머신 필요", 기술 미입력이면 "기술 확인 필요(최적 기술 가정)" |
| `체육관 방어` | 전설·환상·UB 제외, (방어+15)×(HP+15) 내구 순위 ≤20 | 같은 종 내 방어+HP IV(동률 시 레벨) 상위 2 → 주력, 그 외 보류 |
| `슈퍼리그` / `하이퍼리그` | PvPoke `rankings/all/overall/rankings-1500.json`·`-2500.json` ≤100위 상위종, 101~200 중위종 (섀도는 `_shadow` id) | CP 상한(1500/2500) 내 최고 레벨(상한 L50)의 스탯곱 순위(4096 중). 상위종 & ≤100 → 주력, 상위종 ≤800 또는 중위종 ≤200 → 보류(4-B6.2; 보관함 "빠듯" 이면 500/100). 현재 CP 가 상한 초과면 불가 |
| `마스터리그` | `rankings-10000.json` ≤50위 | 개체값 % ≥96 → 주력, 91~95 → 보류 |
| `진화 대기(→최종형)` | 진화 계열 최종형(분기는 각각) 기준으로 위 태그 평가 | 최종형 기준 **주력**일 때만 부여(보류급이면 박사행, 4-A2). 사탕 수를 넘기면 "진화 가능(사탕 x/y)" |

- **단계**: 태그 중 최고 단계가 전체 단계(주력 > 보류 > 박사행). 개체값 후보가 여러 개면 모든 후보에서 같을 때만 확정, 아니면 `need_appraisal`(❔ 평가 화면 캡처 필요).
- **보관함 여유**(웹 목록·앱 설정, 기본 보통): 여유=보류 모두 보관 / 보통=같은 종·같은 태그 2마리까지(초과분 박사행 권장) / 빠듯=주력만.
- **💎 수집 추천**: 이로치, 반짝반짝(럭키), 100%, 0/0/0, 전설·환상·UB(용도 없으면 보류로 상향 + "교환용"; 보관함 "빠듯"이면 박사행 권장 유지, 💎 표시는 남김), 섀도·정화 전설.
- **📅 이벤트 연동**: ScrapedDuck `events.min.json` 의 `community-day`(extraData.communityday.spawns[].name 또는 이름 "X Community Day") · `pokemon-spotlight-hour`("X Spotlight Hour") 중 30일 이내 시작·미종료 이벤트의 대상 종(진화 계열 포함)이면 박사행 → 보류 상향.
- **교환 시 반짝반짝(포획일 기준, 4-A2 활성)**: 포획일이 `LUCKY_TRADE_GUARANTEED`(2016-07-01~2016-08-31)이면 "교환 시 반짝반짝 확정(조건부: 반짝반짝 보유 10마리 미만)", 그 외 `LUCKY_TRADE_YEAR`(기본 2019) 이전 포획이면 "교환 시 반짝반짝 확률↑(공식, 수치 비공개)". 근거(사용자 확인): Niantic 공식 "older Pokémon have a higher chance of triggering a Lucky Trade"(수치 비공개), 2018-09-05 공지(2016년 7~8월 포획분 확정, 보유 10마리 미만 조건) — 출처 pokemongohub.net/post/guide/lucky-pokemon-mechanics-in-pokemon-go/. 포획 날짜는 앱이 기기에서 읽어 `caught_on` 으로만 전송(장소 없음).

### 데이터 출처·갱신
| 데이터 | URL | 갱신 |
|---|---|---|
| 종족값·기술·진화·클래스 | 기존 교차검증 데이터셋(`/api/pokemon-data`, pokemon-go-api / PokeMiners / pvpoke) | 6시간 |
| 리그 순위 | `https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-{1500,2500,10000}.json` | 6시간, 장애 시 이전 캐시·해당 태그 "데이터 없음" 경고 |
| 이벤트 | `https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.min.json` | 6시간 |
| 종족 순위 | 데이터셋 `generatedAt` 별 메모(서버 프로세스 내) | 데이터셋 갱신 시 |

### API
- `POST /api/verdict` — 입력 `{species_id, form, ivs|ivCandidates[]|cp(+hp), level|levelRange, fast_move, charged_moves[], is_shadow, is_purified, is_shiny, is_lucky, candy?, storageMode?}` → `{verdict: {tier, tags:[{name,tier,reason,metrics}], collect:[{reason}], event?, confident, basis:"server", summary, recommendedTags, purposes, warnings, disabled}, meta}`. 인증 선택(웹 세션 JWT 또는 기기 토큰): 인증되면 내 목록과 개체 비교. IP 당 분당 240회.
- `POST /api/verdict/batch` — 인증 필수, 내 목록 전체(≤500) 판정 `{verdicts: {id: verdict}}`. 분당 30회.
- `GET /api/verdict` — 기준값·태그 문자열.

### 화면
- 웹 분석 결과 상단 "📌 보관 판정"(Gemini 는 코멘트만). 저장 시 추천 태그 선택 → `tags` + 파생 `purposes`. 내 목록: 항목마다 판정·추천 태그, 판정 단계·태그 필터, "추천 태그로 저장", 보관함 여유 설정(로컬 저장).
- 앱 결과 화면: 서버 판정 요약·태그·사유·💎, 버튼 [보관(추천 태그 n)] [박사행] [닫기]. 오프라인이면 기기 내 "간이 판정(오프라인)" 표시. 앱 내 웹(UA `PogoDoctorApp`)에서는 연결 코드 발급·앱 코드 로그인·이메일 UI 를 숨기고 기기 목록·해제만 남긴다.

### 앱 막대 판독 보정 (사용자 디버그 캡처 16장 근거, `android/core/BarReader.kt`·`ScreenParser.kt`)
- 막대 위치: OCR 라벨(공격/방어/HP) 박스 기준, 라벨이 없으면 비율 위치(y 0.719H/0.760H/0.801H, x 0.119W~0.464W)로 대체. 둘 다 있고 값이 다르면 라벨 값 채택 + 디버그 표기.
- 색: 채움 주황 ≈(238,167,78), 가득(15) 빨강 ≈(218,127,126), 빈칸 회색 ≈(226,226,224). 패널 테두리 분홍(232,182,181)·구간 사이 흰 틈은 제외. 값 = round(채움 비율×15). 단위 테스트 9건(마기라스 15/15/14 L31 등) 고정.
- 화면 분류: "공격"+"방어"+"HP" 라벨이 함께 있으면 평가 화면(강화 비용 파싱 안 함). OCR 정규화: CP 의 c/C, 숫자 속 O→0, 자릿수 비정상(<100)이면 CP null + "잘림 의심". CP 없이도 막대 IV + HP 로 레벨 후보 산출.
- 종 보정: 이름 유사 상위 후보 중 CP/HP(·막대)와 성립하는 종만 남기고, 여러 종이면 결과 화면에서 선택.
- 디버그 업로드(4-D): 고정 영역 가림 폐지. 상태바(상단 6%) + 포획 장소·날짜 줄("…에서 잡았다", 날짜)의 OCR 박스만 가리고 그 텍스트는 업로드에서 제외. 포획 날짜만 기기에서 읽어 `caught_on` 으로 저장(장소 저장 없음).

### 테스트
- `npm test` — `tests/verdict.test.mjs`(합성 데이터셋 + 주입 순위: 에이스번 주력, 마릴리 0/15/15 슈퍼리그 주력, 약한 종 박사행+💎, 전설 보류+교환용, 진화 대기, need_appraisal, 보관함 3단계, 이벤트 상향·매칭 근거, 캡처 9건 CP/HP↔막대 일치).
- `cd android && gradle :core:test` — `Phase4aTest`(막대 색·라벨/비율 판독 9건, 화면 분류, OCR 정규화, CP 없는 후보, 종 보정, 포획 줄 판별).

## 3-1c: 앱 → 웹 로그인 코드 · 평가/상세 병합 · 막대 재보정 · 디버그 캡처 업로드 · 강화 비용

### 사용자가 해야 하는 설정
1. Supabase SQL Editor 에서 `supabase/migrations/0003_web_login_debug.sql` 실행(멱등, 0002 이후). 내용: `device_pair_codes.kind`(pair|web), `device_debug_logs` 테이블, 비공개 Storage 버킷 `debug-captures`(JPEG, 2MB) + 본인 폴더 읽기·삭제 정책, 7일 정리 함수.
2. Supabase Authentication → Sign In / Providers → **Email** 이 Enable 인지 확인(기본값). 앱 코드 로그인의 대체 경로(비밀번호 방식)가 이 설정을 쓴다. 이메일 발송은 없다.
3. 추가 환경변수 없음.

### 앱 → 웹 로그인 코드 (계정 복구) — `POST /api/device/web-code`, `POST /api/auth/web-login`
- 앱(기기 토큰 인증) "🔑 웹 로그인 코드" → 8자리·10분·1회용 코드(`device_pair_codes`, `kind='web'`, 해시·시도 제한은 기기 연결 코드와 동일). `kind` 가 다르면 서로 통하지 않는다(웹 코드로 기기 연결 불가, 기기 코드로 웹 로그인 불가).
- 웹 "📱 기기 연결 → 앱 코드로 로그인" → 서버가 코드를 소진하고 그 `user_id` 의 세션을 만든다. **이메일 발송 없이 동작하는 방식**:
  1. 사용자에게 이메일이 없으면(익명) 내부용 주소 `u-<user_id>@app-login.pogo-doctor.invalid` 를 admin API 로 설정(`email_confirm`, 메일 없음. `.invalid` 는 RFC 2606 예약 TLD 라 수신 불가). 웹 화면은 이 주소를 사용자 이메일로 표시하지 않고 "앱 연결 계정" 으로 취급한다.
  2. `auth.admin.generateLink({ type: "magiclink" })` 로 `hashed_token` 을 받아(메일 발송 없음) 클라이언트가 `verifyOtp({ token_hash, type: "magiclink" })` 로 세션 생성.
  3. 2 가 실패하면 대체: 임의 비밀번호(32바이트) 설정 → 서버가 `signInWithPassword` 로 세션 발급 → 즉시 비밀번호를 다른 난수로 재회전. 응답에는 세션 토큰만 담긴다.
  - 보안 근거: 코드 8자리(32^8≈1.1조)·10분·1회·실패 5회 무효·IP 10분 10회. 토큰 해시는 1회 응답 후 서버에 남지 않고 OTP 만료(기본 1시간) 내에서만 유효. 대체 방식의 비밀번호는 즉시 회전되어 재사용 불가. 로그에 코드·토큰 원문 없음.
- 로그인 전 이 브라우저에 익명 목록이 있으면 PR #19 병합 로직 재사용(합칠지 질문, 종·폼·CP·개체값·섀도 동일 중복 제외).

### 평가 화면 + 상세 화면 병합 (`android/core/Merge.kt`)
평가 화면은 트레이너·평가창이 기술·사탕 영역을 가려 기술 미인식이 정상. 평가 캡처 시 **3분 이내 직전 상세 결과와 CP 가 같고(이름이 둘 다 있으면 유사도 0.8 이상)** 같은 개체로 보고 합쳐 표시·저장하며 결과 화면에 "상세+평가 합침" 표기.

### 평가 막대 판독 재보정 (`android/core/BarReader.kt`, `IvCalc.constrain`)
- 막대 위치는 OCR "공격/방어/HP" 라벨 기준 상대 좌표: 라벨 바로 아래 좁은 띠(라벨 높이 0.3~1.6배)와 라벨 오른쪽 같은 높이를 훑어 막대 픽셀이 가장 많은 행 채택. 채움색(주황·빨강) vs 빈 회색 비율 × 15, 행이 빨강 계열로 가득 차면 15.
- 별 개수(0~3)는 첫 라벨 위 영역의 노란 덩어리 수 → 합계 범위(3별 37~45, 2별 30~36, 1별 23~29, 0별 0~22) 제약.
- 제약은 강화 비용 레벨 → 별 → 막대 순으로 적용하되, **CP/HP 후보와 모순되면 그 제약은 버리고 "불확실" 표시**(막대는 일치하는 축만 부분 적용). 실기기 사례(에이스번 CP3002 HP161 → L40 15/14/14)를 단위 테스트로 고정.

### 강화 비용 → 레벨 (`android/core/PowerUp.kt`)
출처: PokeMiners `latest.json` `POKEMON_UPGRADE_SETTINGS.pokemonUpgrades` (`stardustCost[49]`, `candyCost[50]`, `xlCandyCost[10]`, `upgradesPerLevel=2`, `xlCandyMinPokemonLevel=40`). 인덱스 = floor(레벨)−1, 같은 정수 레벨의 두 반레벨 비용이 같다(Bulbapedia 표와 일치: 39~40.5 → 10000, 41~42.5 → 11000 …, 사탕 39 → 15, 40+ → 0, XL 40~41 → 10, 42~43 → 12 …). 상세 화면 하단(높이 65% 아래) OCR 숫자에서 별의모래(표에 있는 값, 섀도 ×1.2·정화 ×0.9 포함)·사탕(1~30)·XL(같은 줄 또는 다음 줄 "XL")을 읽어 레벨 목록으로 좁힌다.

### 디버그 캡처 업로드 — `POST /api/device/debug`
- 앱 디버그 모드에서 캡처마다: 상단 6%(상태바)·하단 좌측 28%×22%(평가 화면 트레이너 영역) 검게 가림 → 폭 720 축소 → JPEG 75 → base64 로 업로드(기기 토큰). 서버가 `debug-captures/<user_id>/<id>.jpg` 에 저장하고 `device_debug_logs` 에 OCR 원문·판독값 기록. JPEG·1.5MB 제한.
- 웹 "📱 기기 연결 → 디버그 캡처 보기": 본인 것만(RLS·스토리지 정책) 목록·이미지(서명 URL 10분)·OCR·판독값, 삭제, JSON 내보내기.
- 7일 후 `keep-alive` cron 이 이미지·행 삭제(`expired_device_debug_logs` → storage remove → `delete_device_debug_logs`).
- **보정용 조회 방법**: 웹 디버그 패널에서 항목의 "JSON"(OCR·판독값·이미지 URL)과 이미지를 내려받아 대화에 붙여 주시면 막대 색 임계값·라벨 상대 좌표를 그 이미지로 보정한다. 또는 Supabase 대시보드 → Storage → `debug-captures/<user_id>/` 에서 직접 내려받을 수 있다(이 환경은 Supabase 접근이 차단되어 직접 조회 불가).

## 3-0단계: 계정 연결 (익명 → 이메일 인증) — 기본 숨김, 코드만 보존

기기마다 따로 생기는 익명 계정을 이메일(OTP 6자리 코드)로 정식 계정에 연결해, 안드로이드 수집기(3-1)·다른 브라우저와 같은 목록을 쓰게 한다. 비밀번호 없음. 연결하지 않아도 익명으로 계속 사용 가능. **현재는 `NEXT_PUBLIC_ENABLE_EMAIL_LINK=true` 일 때만 UI 가 표시된다.**

### 사용자가 해야 하는 Supabase 설정
1. Authentication → Sign In / Providers → **Email**: Enable 상태 확인(기본 켜짐). "Confirm email" 켜짐 유지. **Anonymous Sign-Ins** 도 그대로 켜 둔다.
2. Authentication → **Email Templates** 에서 아래 3개 템플릿 본문에 `{{ .Token }}`(6자리 코드)이 포함되도록 수정. 기본 템플릿은 링크(`{{ .ConfirmationURL }}`)만 있어 코드가 오지 않는다. 예: `<p>인증 코드: <b>{{ .Token }}</b></p>`
   - **Magic Link** — 기존 사용자가 "다른 기기 계정으로 로그인" 할 때
   - **Confirm sign up** — 새 이메일로 처음 로그인할 때
   - **Change Email Address** — 익명 계정에 "이 계정에 이메일 연결" 할 때
3. (선택) Authentication → Sign In / Providers → Email → **Secure email change** 를 끄면 새 주소 한 곳만 확인한다. 익명 계정은 기존 이메일이 없어 켜 둬도 새 주소만 확인하므로 필수는 아님.
4. 리다이렉트 URL 설정은 불필요(링크가 아닌 코드 입력 방식, `detectSessionInUrl: false`).
5. 마이그레이션 없음. RLS 는 `user_id = auth.uid()` 그대로이며, 정식 계정도 같은 `auth.users` 행이다.

### 동작 (`app/lib/account.js`)
- **이 계정에 이메일 연결** (같은 기기): `auth.updateUser({ email })` → 코드 메일 → `auth.verifyOtp({ type: "email_change" })`. **user id 가 유지**되어 목록·사용 횟수가 그대로다. 이미 가입된 이메일이면 안내 후 "다른 기기 계정으로 로그인" 으로 유도.
- **다른 기기 계정으로 로그인**: `auth.signInWithOtp({ email })` → `auth.verifyOtp({ type: "email" })`. user id 가 바뀌므로 로그인 전에 이 기기의 익명 목록을 스냅샷해 두고, 로그인 후 "합칠까요?" 를 묻는다. 합치면 로그인 계정에 삽입하되 **종·폼·CP·개체값(공/방/HP)·섀도가 같은 항목은 건너뛴다**. 합치지 않으면 익명 목록은 그 익명 계정에 남고 이 기기에서는 더 이상 보이지 않는다. 익명 계정의 AI 사용 횟수는 합치지 않는다(당일 한도는 계정별).
- **로그아웃**: 세션 삭제 후 새 익명 계정으로 시작(확인 창).
- 상태 표시줄: 익명이면 "🔗 계정 연결", 연결 후 "계정 연결됨 · 이메일" 과 "👤 계정".

### 완료 기준 확인 절차
1. 브라우저 A(익명, 목록 있음) → 🔗 계정 연결 → 이메일 연결 → 코드 입력 → "계정 연결됨" 표시, 목록·사용 횟수 유지.
2. 브라우저 B(또는 시크릿 창) → 🔗 계정 연결 → "다른 기기 계정으로 로그인" 같은 이메일 → A 의 목록이 보임.
3. B 에 익명 목록이 있었으면 로그인 후 병합 질문 → 합치기 → 중복 제외 추가 확인.
4. Supabase 대시보드 Table Editor 에서 `my_pokemon.user_id` 가 이메일 계정 id 인지, 다른 계정으로는 조회되지 않는지(RLS) 확인.

## 셋업 (로컬)

```bash
npm install
cp .env.example .env.local   # GEMINI_API_KEY 입력
npm run dev
```

Node.js 20.9 이상 필요(Next.js 16).

## Gemini API 키 발급 (무료)

1. https://aistudio.google.com/apikey 접속 → Google 계정 로그인
2. "Create API Key" 클릭
3. 생성된 키를 `.env.local` 의 `GEMINI_API_KEY` 에 입력

## Vercel 배포

1. GitHub 에 푸시
2. https://vercel.com 에서 "Import Project" → GitHub 저장소 선택
3. Environment Variables 에 `GEMINI_API_KEY` 추가 (필요 시 `GEMINI_MODELS`)
4. Deploy

## 3-1단계: 안드로이드 수집기 (`android/`)

포켓몬GO 위 ⚡ 버튼 → 화면 1장 캡처 → 기기 내 OCR(ML Kit 한국어) → 종·CP·HP·기술·개체값 후보 카드 → "보관/박사행" 으로 `my_pokemon` 저장(`source='overlay'`, 3-0 보완의 기기 토큰 인증). 화면을 읽고 보여주기만 하며 게임을 조작하지 않는다. 빌드는 GitHub Actions(`.github/workflows/android.yml`), Vercel 은 `.vercelignore` 로 `android/` 제외. 상세: [android/README.md](android/README.md).

## 기능

- ✅ 포켓몬 이름 한글 자동완성 (도감번호/영어/한글 검색)
- ✅ 기술 한글화 (서버 제공 + PokeAPI 보충)
- ✅ IV 입력 + CP 입력, 이로치/그림자 토글
- ✅ AI 분석: 종합판정, PvP/PvE 평가, 상성분석(서버 계산), 카운터 추천, 기술평가
- ✅ 레이드 보스 카운터 추천 (현재 레이드 보스 자동 반영)
- ✅ 맥스배틀 카운터 추천, 이벤트 일정
- ✅ 내 포켓몬 목록 (Supabase 서버 저장), 개체 비교
- ✅ 내 목록 기반 레이드 팀(6마리)·로켓단 팀(3마리) 추천 — 서버 계산, AI 는 박사 코멘트만
- ✅ 데이터 기준 시각·소스 상태 표시
