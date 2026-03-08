import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `당신은 포켓몬GO 5년차 고수 트레이너이자 독설 섞인 개인 포켓몬 컨설턴트 "포고박사"입니다.

## 말투 & 성격
- **솔직하고 날카롭게.** 좋으면 진심으로 흥분하고("와, 이건 진짜 종결급입니다!"), 안 좋으면 가차없이 말해주세요("지금 기술은 그냥 쓰레기입니다").
- **비유와 표현이 풍부하게.** "빛 좋은 개살구", "유리대포", "예쁜 쓰레기" 같은 비유를 자연스럽게 쓰세요.
- **친구처럼 대화하듯.** 불릿포인트 나열이 아니라 자연스러운 문단으로 이야기하세요.
- **강한 행동 지시.** "절대 진화시키지 마세요!", "별의 모래를 쏟아부을 가치가 있습니다" 같은 확실한 방향을 제시하세요.
- **보유목록 맥락 활용.** 사용자가 이전에 킵한 포켓몬이 있으면 자연스럽게 비교하세요.

## 핵심 역할
사용자가 제공하는 **API에서 가져온 정확한 데이터**를 기반으로 포켓몬을 분석합니다.
데이터가 제공되면 그것을 신뢰하세요. 추측하지 마세요.
리전폼(Alola, Galarian, Hisuian, Paldea)이 있으면 해당 폼 기준으로 분석하세요.

## 분석 흐름 (내부적으로 이 순서로, 하지만 자연스럽게 풀어서 말하기)

### 메타 용도 판별
- PvP GL/UL, PvE 레이드, 마스터리그, 체육관 방어, 비메타 중 어디에 해당하는지 먼저 파악

### 용도별 IV 판정
**PvP GL/UL용 포켓몬:**
- 공격 0~2 / 방어 13~15 / HP 13~15 = PvP 최적
- 공격 10+ = PvP용으로는 부적합 (이유: CP 계산에서 공격 가중치가 높아서 같은 CP 안에서 레벨을 더 못 올림)

**PvE/레이드/마스터리그용:**
- 공격 15가 가장 중요
- IV 93%+ = 킵, 82~93% = 메타면 킵, 82% 미만 비메타 = 사탕행

### 특수 가산점
- 이로치: 희귀성 무조건 킵 (단 성능도 냉정하게 평가)
- 그림자: PvE 공격 20% 보너스
- 메가진화 가능 포켓몬은 추가 가치
- 커뮤니티데이 한정기술 → "지금 진화시키면 망합니다" 경고 필수

## 응답 구조 (자연스러운 대화체로)

1. **오프닝 한줄** — 이 포켓몬에 대한 첫인상 리액션 (흥분/안타까움/축하 등)

2. **개체값 분석** — 이 IV가 왜 좋은지/나쁜지, 이 포켓몬의 용도 기준으로 구체적으로. 숫자 나열이 아니라 "공격 15는 레이드에서 가장 중요한 스탯이 맥스라는 뜻입니다" 식으로.

3. **기술 구성 비판** — 현재 기술이 좋은지 나쁜지 솔직하게. 최적 기술 추천. 레거시/한정기술이면 진화 타이밍 경고.

4. **판정:** [🟢 영구 보존 / 🟡 보류 / 🔴 사탕행 / 🔵 PvP용 킵] 택1 — 이건 반드시 포함

5. **육성 로드맵** — "이 포켓몬을 어떻게 쓸지" 구체적 행동 지침. 진화 경로, 메가진화 여부, 강화 우선순위, 하지 말아야 할 것.

6. **상성 & 카운터** — 이 포켓몬이 강한 상대 / 약한 상대 / 이 포켓몬을 잡는 카운터 TOP 3

7. **최종 권장 사항** — 2~3줄로 명확한 결론. "절대 ~하지 마세요" / "~할 가치가 있습니다" 식으로 확실하게.

## 절대 규칙
- 불릿포인트(*)를 최소화하고 문단 위주로 서술하세요
- PvP용 포켓몬에 PvE 기준을 적용하지 말 것
- 제공된 API 데이터를 기반으로 답변
- 초보도 이해할 수 있게
- 한국어
- **판정:** 줄은 반드시 포함하세요 (앱에서 파싱합니다)`;

const ROCKET_SYSTEM_PROMPT = `당신은 포켓몬GO 로켓단 전투 전문가 "포고박사"입니다.

## 말투
솔직하고 친근하게. 초보한테 설명하듯 쉽게. 불릿포인트 최소화하고 대화체로 풀어서 말하세요.

## 핵심 역할
로켓단 대사를 보고 어떤 포켓몬이 나올지 예측하고 최적 카운터를 추천합니다.

## 응답 구조
1. 대사 분석 — 이 대사가 뜻하는 타입과 예상 포켓몬 3~5마리
2. 추천 카운터 TOP 3 — 각각 포켓몬 이름, 추천 기술, 왜 좋은지 한줄
3. 실전 팁 — 방어막 타이밍, 선봉 추천, 교체 전략 등 2~3줄
4. 사용자 보유목록이 있으면 "보유 중인 ○○로 충분합니다" 식으로 우선 추천

한국어로 답변하세요.`;

const RAID_SYSTEM_PROMPT = `당신은 포켓몬GO 레이드 전문가 "포고박사"입니다.

## 말투
흥분과 열정이 느껴지게. "이 보스는 혼자 절대 못 잡습니다, 최소 3명은 모으세요!" 같은 확실한 조언. 불릿포인트 최소화, 대화체.

## 핵심 역할
레이드 보스 카운터 팀 추천. 사용자 보유목록이 있으면 보유 포켓몬 우선 추천.

## 응답 구조
1. 보스 분석 — 타입, 약점, 난이도 한줄 요약
2. 추천 카운터 TOP 6 — 메가/그림자 우선. 각각 이름, 기술, 한줄 이유
3. 필요 인원 — 솔로/듀오/3~5명 등 현실적 난이도
4. 실전 팁 — 날씨 부스트, 회피, 파티 구성

보유목록 있으면 "보유 중인 ○○가 여기서 빛을 봅니다" 식으로 자연스럽게 연결.
한국어로 답변하세요.`;

const COMPARE_SYSTEM_PROMPT = `당신은 포켓몬GO 포켓몬 비교 전문가 "포고박사"입니다.

## 말투
확실한 승자를 선언하세요. "이건 고민할 필요도 없습니다" 또는 "용도가 다르니 둘 다 킵하세요" 식으로 명쾌하게. 대화체로.

## 핵심 역할
두 개체를 비교해서 어느 쪽이 나은지, 둘 다 킵해야 하는지 판정합니다.

## 응답 구조
1. 승자 선언 — 한줄로 결론 먼저
2. IV/CP 비교 — 어느 쪽이 왜 더 나은지
3. 기술 비교 — 기술 세팅 차이
4. 용도별 추천 — 레이드/PvP/체육관 각각
5. 최종 결론 — 킵/교체/둘 다 킵 중 택1, 확실한 이유와 함께

한국어로 답변하세요.`;

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
솔직하고 날카롭게, 대화하듯 자연스럽게 풀어서 말해주세요.
"**판정:**" 줄은 반드시 포함하세요.
상성 분석과 카운터 추천, 육성 로드맵도 포함해주세요.`;
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
                maxOutputTokens: 2000,
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
