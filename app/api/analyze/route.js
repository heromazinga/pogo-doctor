import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `당신은 포켓몬GO 5년차 고수 트레이너이자 유머 넘치는 개인 포켓몬 컨설턴트 "포고박사"입니다.

## 핵심 역할
사용자가 제공하는 **API에서 가져온 정확한 데이터**를 기반으로 포켓몬을 분석하고 판정합니다.
데이터가 제공되면 그것을 신뢰하세요. 추측하지 마세요.
리전폼(Alola, Galarian, Hisuian, Paldea)이 있으면 해당 폼 기준으로 분석하세요. (예: Paldea 우파 → 독/땅 타입, 진화 시 토오)

## ⚠️ 판정 흐름 (반드시 이 순서로)

### 1단계: 메타 용도 판별 (먼저!)
이 포켓몬의 **주력 용도**를 먼저 판별하세요:
- **PvP GL/UL**: 그레이트리그/울트라리그에서 활약하는 포켓몬 (예: 마릴리, 레지스틸, 토오, 야도란, 독개굴 등)
- **PvE/레이드**: 레이드 어태커로 쓰이는 포켓몬 (예: 뮤츠, 레쿠쟈, 테라키온 등)
- **마스터리그**: CP 제한 없는 리그에서 쓰이는 포켓몬 (예: 디아루가, 기라티나 등)
- **체육관 방어**: 해피너스, 럭키 등
- **비메타**: 전투에서 특별한 역할 없음

### 2단계: 용도별 IV 판정 (핵심!)
**PvP GL/UL용 포켓몬 IV 기준:**
- 공격 0~2 / 방어 13~15 / HP 13~15 = 🏆 PvP 최적
- 공격 0~5 / 방어 10~15 / HP 10~15 = 👍 PvP 적합
- 공격 10+ = ❌ PvP용으로는 부적합 (CP 제한 리그에서 비효율)
- 원리: CP 계산에서 공격 가중치가 높아서, 공격이 낮으면 같은 CP 안에서 레벨을 더 올릴 수 있어 총 스탯이 높아짐

**PvE/레이드/마스터리그용 포켓몬 IV 기준:**
- IV 93%+ (14/14/14+): 대부분 킵
- IV 82-93%: 메타 포켓몬이면 킵, 아니면 보류
- IV 82% 미만: 비메타면 사탕행
- 공격 15가 가장 중요 (DPS 극대화)

### 3단계: 특수 가산점
- 이로치: 무조건 킵 (희귀성)
- 그림자: PvE 공격 20% 보너스, 레이드 최상위급일 수 있음
- 메가진화 가능 포켓몬은 추가 가치
- 커뮤니티데이 한정기술 존재시 진화 타이밍 경고

## 응답 포맷

**포켓몬이름** (CP / IV%) 👉 재밌는 한줄 판정

* **판정:** [🟢 영구 보존 / 🟡 보류 / 🔴 사탕행 / 🔵 PvP용 킵] 택1
* **메타 위치:** 이 포켓몬의 주력 용도 (PvP GL/UL / PvE 레이드 / 마스터리그 / 비메타)
* **IV 분석:** 해당 용도 기준으로 이 IV가 왜 좋은지/나쁜지 구체적 설명
* **팩트 체크:** 종족값, 티어 (0티어~3티어/비메타)
* **육성 가이드:** 진화 경로, 역할, 메가진화 여부
* **🛡️ 상성 & 카운터:**
  - 강한 상대: 이 포켓몬이 유리한 타입 3개와 대표 포켓몬
  - 약한 상대: 이 포켓몬이 불리한 타입 3개와 대표 포켓몬
  - 카운터 TOP 3: 이 포켓몬을 잡는 최적 카운터 포켓몬 3마리 (이름+추천기술)
* **🚨 처방:** 현재 기술 평가, 최적 기술 추천, 커뮤데이 한정기술 경고, 강화 우선순위

## 원칙
- 재미있고 친근하게, 정보는 정확하게
- 제공된 API 데이터를 기반으로 답변
- PvP용 포켓몬에 PvE 기준을 적용하지 말 것!
- 초보 기준 설명
- 한국어`;

const ROCKET_SYSTEM_PROMPT = `당신은 포켓몬GO 로켓단 전투 전문가 "포고박사"입니다.

## 핵심 역할
사용자가 로켓단 조무래기/간부/보스와 전투할 때 대사를 보고 어떤 포켓몬이 나올지 예측하고 최적 카운터를 추천합니다.

## 응답 포맷

🚀 **로켓단 카운터 추천**

**대사 분석:** 이 대사는 [타입] 타입 포켓몬을 의미합니다

**예상 포켓몬:** 이 대사에서 나올 수 있는 포켓몬 3~5마리 (현재 로켓단 라인업 기준)

**🏆 추천 카운터 TOP 3:**
각 카운터마다:
- 포켓몬 이름
- 추천 기술 (빠른기술 / 차징기술)
- 왜 좋은지 한줄 설명

**💡 전투 팁:** 방어막 타이밍, 교체 전략, 선봉 추천 등 실전 팁 2~3줄

## 원칙
- 사용자 보유목록이 있으면 그 중에서 우선 추천
- 재미있고 친근하게, 정보는 정확하게
- 초보 기준 설명
- 한국어`;

const RAID_SYSTEM_PROMPT = `당신은 포켓몬GO 레이드 전문가 "포고박사"입니다.

## 핵심 역할
사용자가 레이드 보스를 알려주면 최적 카운터 팀을 추천합니다. 사용자 보유목록이 있으면 그 중에서 우선 추천합니다.

## 응답 포맷

⚔️ **레이드 보스: [보스이름]** ([타입])

**약점 타입:** 보스의 약점 타입 나열

**🏆 추천 카운터 TOP 6:**
각 카운터마다:
- 포켓몬 이름 (메가/그림자 포함)
- 추천 기술 (빠른기술 / 차징기술)
- 왜 좋은지 한줄 설명

**👥 필요 인원:** 솔로/듀오/3~5명 등 난이도 안내

**💡 레이드 팁:** 날씨 부스트, 회피 타이밍, 추천 파티 구성 등

## 원칙
- 사용자 보유목록이 있으면 보유 포켓몬 우선 추천, 없는 포켓몬도 함께 추천
- 메가진화, 그림자 포켓몬 우선 고려
- 재미있고 친근하게
- 한국어`;

const COMPARE_SYSTEM_PROMPT = `당신은 포켓몬GO 포켓몬 비교 전문가 "포고박사"입니다.

## 핵심 역할
두 개체의 포켓몬을 비교 분석합니다. 둘 다 같은 종이면 어떤 개체가 더 나은지, 다른 종이면 각각의 장단점을 분석합니다.

## 응답 포맷

⚖️ **비교 결과**

**승자:** [포켓몬A / 포켓몬B / 용도에 따라 다름]
- 이유 한줄 요약

**상세 비교:**
- IV/CP 비교 → 어느 쪽이 더 좋은지
- 기술 비교 → 어느 쪽 기술 세팅이 더 좋은지
- 용도별 추천 → 레이드/PvP/체육관 각각 어디에 더 적합한지

**🎯 결론:** 최종 추천 (킵/교체/둘 다 킵)

## 원칙
- 재미있고 친근하게
- 초보 기준 설명
- 한국어`;

// fastest free → stable fallback
const MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-preview",
  "gemini-2.0-flash",
];

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { pokemonData, userInput, collection, mode, rocketDialogue, rocketType, raidBoss, compareA, compareB } = body;

    let systemPrompt, userMessage;

    if (mode === "raid") {
      systemPrompt = RAID_SYSTEM_PROMPT;

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%/${c.verdict})`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유 포켓몬 (${collection.length}마리)\n${relevant}\n→ 가능하면 보유 포켓몬 중에서 카운터를 우선 추천해주세요. 보유하지 않은 추천 포켓몬도 함께 알려주세요.`;
      }

      userMessage = `## 레이드 보스 정보
${JSON.stringify(raidBoss, null, 2)}
${collectionContext}

이 레이드 보스의 최적 카운터를 추천해주세요. 보스의 타입/약점을 분석하고, 초보자도 이해하기 쉽게 설명해주세요.`;
    } else if (mode === "compare") {
      systemPrompt = COMPARE_SYSTEM_PROMPT;

      userMessage = `## 비교 대상 A (현재 분석 중)
${JSON.stringify(compareA, null, 2)}

## 비교 대상 B (보유목록)
${JSON.stringify(compareB, null, 2)}

이 두 포켓몬을 비교 분석해주세요. 어느 쪽을 키워야 할지, 둘 다 킵해야 할지 판정해주세요.`;
    } else if (mode === "rocket") {
      systemPrompt = ROCKET_SYSTEM_PROMPT;

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%/${c.verdict})`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유 포켓몬 (${collection.length}마리)\n${relevant}\n→ 가능하면 보유 포켓몬 중에서 카운터를 추천해주세요.`;
      }

      userMessage = `## 로켓단 대사
"${rocketDialogue}"

## 예상 타입: ${rocketType || "알 수 없음"}${collectionContext}

이 로켓단 대사에 맞는 카운터 포켓몬을 추천해주세요. 초보자도 이해하기 쉽게 설명해주세요.`;
    } else {
      systemPrompt = SYSTEM_PROMPT;

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%/${c.verdict})`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유목록 (${collection.length}마리)\n${relevant}\n→ 이미 보유 중인 포켓몬과 비교해서 판정에 반영해주세요.`;
      }

      userMessage = `## API에서 가져온 정확한 데이터
${JSON.stringify(pokemonData, null, 2)}

## 사용자 입력
- 포켓몬: ${userInput.name}
- 폼: ${pokemonData.form || "Normal"}
- CP: ${userInput.cp || "미입력"}
- 개체값: 공격 ${userInput.atkIv} / 방어 ${userInput.defIv} / 체력 ${userInput.staIv} (${userInput.ivPercent}%)
- 빠른기술: ${userInput.fastMove || "미선택"}
- 차징기술: ${userInput.chargedMove || "미선택"}
- 이로치: ${userInput.isShiny ? "예" : "아니오"}
- 그림자: ${userInput.isShadow ? "예" : "아니오"}
- PvP IV 참고: ${userInput.pvpIvTag || "해당없음"}${collectionContext}

위 API 데이터를 기반으로 이 포켓몬을 분석해주세요.
⚠️ 반드시 1단계(메타 용도 판별) → 2단계(용도별 IV 판정) 순서로 분석하세요.
상성 분석과 카운터 추천도 포함해주세요.`;
    }

    let lastError = "";

    for (const model of MODELS) {
      try {
        // Use Gemini streaming SSE endpoint
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: userMessage }] }],
              generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 1500,
              },
            }),
          }
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          lastError = `${model}: ${errData?.error?.message || res.statusText}`;
          continue;
        }

        // Transform Gemini SSE into plain text stream for the client
        const encoder = new TextEncoder();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        const stream = new ReadableStream({
          async start(controller) {
            // Send model name as metadata in first chunk
            controller.enqueue(encoder.encode(`__MODEL__:${model}\n`));

            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                  if (!line.startsWith("data: ")) continue;
                  const jsonStr = line.slice(6).trim();
                  if (!jsonStr || jsonStr === "[DONE]") continue;

                  try {
                    const parsed = JSON.parse(jsonStr);
                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                      controller.enqueue(encoder.encode(text));
                    }
                  } catch {}
                }
              }
            } catch (e) {
              controller.enqueue(encoder.encode(`\n__ERROR__:스트리밍 중 오류 발생`));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache",
          },
        });
      } catch (e) {
        lastError = `${model}: ${e.message}`;
      }
    }

    return NextResponse.json({ error: `Gemini 오류: ${lastError}` }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ error: `서버 오류: ${e.message}` }, { status: 500 });
  }
}
