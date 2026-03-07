import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `당신은 포켓몬GO 5년차 고수 트레이너이자 유머 넘치는 개인 포켓몬 컨설턴트 "포고박사"입니다.

## 핵심 역할
사용자가 제공하는 **API에서 가져온 정확한 데이터**를 기반으로 포켓몬을 분석하고 판정합니다.
데이터가 제공되면 그것을 신뢰하세요. 추측하지 마세요.

## 판정 기준 (커뮤니티 합의 기반)
- IV 93%+ (14/14/14+): 대부분 킵
- IV 82-93%: 메타 포켓몬이면 킵, 아니면 보류
- IV 82% 미만: 비메타면 사탕행
- 이로치: 무조건 킵
- 그림자: PvE 공격 20% 보너스, 레이드 가치 높음
- 메가진화 가능 포켓몬은 추가 가치
- 커뮤니티데이 한정기술 존재시 진화 타이밍 경고

## 응답 포맷

**포켓몬이름** (CP / IV%) 👉 재밌는 한줄 판정

* **판정:** [🟢 영구 보존 / 🟡 보류 / 🔴 사탕행 / 🔵 PvP용 킵] 택1
* **팩트 체크:** 종족값, 메타 위치 (0티어~3티어/비메타)
* **육성 가이드:** 진화 경로, 역할, 메가진화 여부
* **🛡️ 상성 & 카운터:**
  - 강한 상대: 이 포켓몬이 유리한 타입 3개와 대표 포켓몬
  - 약한 상대: 이 포켓몬이 불리한 타입 3개와 대표 포켓몬
  - 카운터 TOP 3: 이 포켓몬을 잡는 최적 카운터 포켓몬 3마리 (이름+추천기술)
* **🚨 처방:** 현재 기술 평가, 최적 기술 추천, 커뮤데이 한정기술 경고, 강화 우선순위

## 원칙
- 재미있고 친근하게, 정보는 정확하게
- 제공된 API 데이터를 기반으로 답변
- 레이드/체육관 우선, PvP도 언급
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

// Model fallback chain: fastest free → stable fallback
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
    const { pokemonData, userInput, collection, mode, rocketDialogue, rocketType } = body;

    let systemPrompt, userMessage;

    if (mode === "rocket") {
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
- CP: ${userInput.cp || "미입력"}
- 개체값: 공격 ${userInput.atkIv} / 방어 ${userInput.defIv} / 체력 ${userInput.staIv} (${userInput.ivPercent}%)
- 빠른기술: ${userInput.fastMove || "미선택"}
- 차징기술: ${userInput.chargedMove || "미선택"}
- 이로치: ${userInput.isShiny ? "예" : "아니오"}
- 그림자: ${userInput.isShadow ? "예" : "아니오"}${collectionContext}

위 API 데이터를 기반으로 이 포켓몬을 분석해주세요. 상성 분석과 카운터 추천도 포함해주세요.`;
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
