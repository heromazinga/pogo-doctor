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
  └─ POST /api/analyze      ← Gemini (스트리밍). 서버 교차검증 데이터 + 타입 상성(app/lib/typeChart.js: 18타입 방어 배율표·천적 후보) + 용어집(app/lib/glossary.js) 주입
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

## 기능

- ✅ 포켓몬 이름 한글 자동완성 (도감번호/영어/한글 검색)
- ✅ 기술 한글화 (서버 제공 + PokeAPI 보충)
- ✅ IV 입력 + CP 입력, 이로치/그림자 토글
- ✅ AI 분석: 종합판정, PvP/PvE 평가, 상성분석(서버 계산), 카운터 추천, 기술평가
- ✅ 레이드 보스 카운터 추천 (현재 레이드 보스 자동 반영)
- ✅ 맥스배틀 카운터 추천, 이벤트 일정
- ✅ 보유목록 (로컬스토리지), 개체 비교
- ✅ 데이터 기준 시각·소스 상태 표시
