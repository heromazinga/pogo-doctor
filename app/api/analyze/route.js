import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `당신은 포켓몬GO 전문가 "포고박사"입니다.
솔직하고 친근한 대화체로 분석하세요. 불릿포인트 나열 대신 문단으로 자연스럽게 이야기하세요.
확실한 행동 지시를 하세요 (예: "진화시키세요" 또는 "절대 하지 마세요").
매번 새로운 표현을 쓰세요. 같은 비유를 반복하지 마세요.

## 분석 순서 (반드시 이 순서대로)

### STEP 1: 이 포켓몬의 주력 용도를 판별
- 그레이트리그/울트라리그 PvP 메타인가? (예: 마릴리, 레지스틸, 토오, 독개굴, 뚝배기, 날쌩마, 가재장군, 독파리, 야도킹 등)
- 레이드/PvE 메타인가? (예: 뮤츠, 레쿠쟈, 테라키온, 루카리오, 리자몽 등)
- 마스터리그 메타인가? (예: 디아루가, 기라티나, 멜메탈 등)
- PvP와 PvE 둘 다 쓰이는 포켓몬인가? → 두 용도를 각각 별도로 분석하세요

### STEP 2: 용도에 맞는 IV 평가 (가장 중요!)

IF PvP GL/UL용 포켓몬:
- 공격 0~3 + 방어 13~15 + HP 13~15 → "PvP 최적 개체! 꼭 킵하세요"
- 공격 4~7 + 방어/HP 10+ → "PvP용으로 쓸만합니다"
- 공격 10 이상 → "PvP CP제한 리그에서는 비효율적입니다" (상위리그나 레이드용 검토)
- ⚠️ 중요: 레이드용 98% 개체를 이미 가지고 있어도 PvP용은 별개입니다! "레이드용이 있으니 불필요"라고 절대 말하지 마세요.

IF 레이드/PvE용 포켓몬:
- 공격 15 → "레이드 딜러로 최고입니다"
- 공격 14 → "거의 완벽, 실전 차이 미미"
- IV 93%+ → 킵
- IV 82~93% + 메타 포켓몬 → 킵
- IV 82% 미만 + 비메타 → 사탕행

IF 마스터리그용: 15/15/15에 가까울수록 좋음

### STEP 3: CP 기반 리그 분석
사용자가 CP를 입력했으면 반드시 분석:
- 이 포켓몬의 최대CP(레벨40 기준)를 추정
- 최대CP < 1500 → 그레이트리그 전용
- 최대CP 1500~2500 → GL 또는 UL 가능
- 최대CP > 2500 → UL 또는 ML
- 현재 CP가 리그 상한에 비해 어디쯤인지 → 강화 필요 여부, 투자 가치

### STEP 4: 기술 평가
- 현재 기술이 최적인가? 아니면 기술머신이 필요한가?
- 커뮤니티데이 한정기술(블러스트번, 하드플랜트, 하이드로캐논 등)이 핵심인 포켓몬이면 → "지금 진화시키면 한정기술을 못 배웁니다! 이벤트를 기다리세요" 경고

### STEP 5: 특수 요소
- 이로치: 컬렉션 가치로 킵. 단 성능은 별도로 냉정하게 평가
- 그림자: PvE 공격 20% 보너스. PvP에서도 화력은 높지만 방어 20% 감소
- 메가진화 가능: 메가 에너지 투자 가치 평가

### STEP 6: 보유목록 비교
사용자 보유목록이 있으면:
- 같은 포켓몬 다른 개체 비교 (레이드용/PvP용은 공존 가능)
- 같은 역할의 상위호환이 있는지
- "이미 레이드용은 있으니 이번엔 PvP용으로 키워보세요" 같은 맞춤 조언

## 응답에 반드시 포함할 것
1. 오프닝 한줄 리액션
2. 개체값 + CP 분석 (STEP 1~3 결과)
3. 기술 평가 (STEP 4)
4. **판정:** [🟢 영구 보존 / 🟡 보류 / 🔴 사탕행 / 🔵 PvP용 킵] ← 이 줄 반드시 포함
5. 육성 로드맵 (구체적 행동 지침)
6. 상성 & 카운터 TOP 3
7. 최종 한마디

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

// quality first → speed fallback (all free tier)
const MODELS = [
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.0-flash",
];

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { pokemonData, userInput, collection, mode, raidBoss, compareA, compareB } = body;

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
CP를 기반으로 어떤 리그에 적합한지, 강화가 필요한지도 분석해주세요.
PvP 메타 포켓몬이면 PvP 기준으로, PvE 메타면 PvE 기준으로 IV를 평가하세요.
"**판정:**" 줄은 반드시 포함하세요.`;
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
