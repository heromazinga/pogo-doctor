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

## 3-0단계: 계정 연결 (익명 → 이메일 인증)

기기마다 따로 생기는 익명 계정을 이메일(OTP 6자리 코드)로 정식 계정에 연결해, 안드로이드 수집기(3-1)·다른 브라우저와 같은 목록을 쓰게 한다. 비밀번호 없음. 연결하지 않아도 익명으로 계속 사용 가능.

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
