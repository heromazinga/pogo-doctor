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
* **🚨 처방:** 현재 기술 평가, 최적 기술 추천, 커뮤데이 한정기술 경고, 강화 우선순위

## 원칙
- 재미있고 친근하게, 정보는 정확하게
- 제공된 API 데이터를 기반으로 답변
- 레이드/체육관 우선, PvP도 언급
- 초보 기준 설명
- 한국어`;

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  try {
    const { pokemonData, userInput } = await req.json();

    const userMessage = `## API에서 가져온 정확한 데이터
${JSON.stringify(pokemonData, null, 2)}

## 사용자 입력
- 포켓몬: ${userInput.name}
- CP: ${userInput.cp || "미입력"}
- 개체값: 공격 ${userInput.atkIv} / 방어 ${userInput.defIv} / 체력 ${userInput.staIv} (${userInput.ivPercent}%)
- 빠른기술: ${userInput.fastMove || "미선택"}
- 차징기술: ${userInput.chargedMove || "미선택"}
- 이로치: ${userInput.isShiny ? "예" : "아니오"}
- 그림자: ${userInput.isShadow ? "예" : "아니오"}

위 API 데이터를 기반으로 이 포켓몬을 분석해주세요.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userMessage }] }],
        }),
      }
    );

    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ error: `Gemini 오류: ${data.error.message || JSON.stringify(data.error)}` }, { status: 500 });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return NextResponse.json({ error: `AI 응답 파싱 실패. 응답: ${JSON.stringify(data).slice(0, 300)}` }, { status: 500 });
    }

    return NextResponse.json({ result: text });
  } catch (e) {
    return NextResponse.json({ error: `서버 오류: ${e.message}` }, { status: 500 });
  }
}
