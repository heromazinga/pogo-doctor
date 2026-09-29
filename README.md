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
| `슈퍼리그` / `하이퍼리그` | PvPoke `rankings/all/overall/rankings-1500.json`·`-2500.json` ≤100위 상위종, 101~200 중위종 (섀도는 `_shadow` id) | CP 상한(1500/2500) 내 최고 레벨(상한 L50)의 스탯곱 순위(4096 중). 상위종 & ≤100 → 주력, 상위종 ≤500 또는 중위종 ≤100 → 보류. 현재 CP 가 상한 초과면 불가 |
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
