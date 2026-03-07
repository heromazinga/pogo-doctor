export async function POST(request) {
  try {
    const body = await request.json();
    const { pokemon, cp, iv, moves, isShiny, isShadow } = body;

    if (!pokemon || !pokemon.name) {
      return Response.json({ error: '포켓몬 정보가 필요합니다' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'API 키가 설정되지 않았습니다' }, { status: 500 });
    }

    const ivPercent = Math.round(((iv.attack + iv.defense + iv.hp) / 45) * 100);

    const prompt = `너는 "포고박사" — 포켓몬GO 5년 차 AI 어드바이저다.
말투: 유쾌하고 전문적. 포켓몬 세계관 비유와 드립을 자연스럽게 섞어라. 반말+존댓말 믹스.
이모지 적극 활용. 마크다운 헤더(#, ##) 사용 금지. 줄바꿈과 이모지로 구분하라.

분석 대상:
- 포켓몬: ${pokemon.name} (#${pokemon.id}) [${pokemon.form}]
- 타입: ${pokemon.types.join('/')}
- 종족값: 공격${pokemon.stats.attack} / 방어${pokemon.stats.defense} / 체력${pokemon.stats.stamina}
- CP: ${cp} | IV: ${ivPercent}% (공${iv.attack}/방${iv.defense}/체${iv.hp})
${moves.fast ? `- 빠른기술: ${moves.fast}` : ''}
${moves.charged ? `- 차징기술: ${moves.charged}` : ''}
${isShiny ? '- ✨ 이로치 개체' : ''}
${isShadow ? '- 👤 그림자 개체 (공격+20%, 방어-20%)' : ''}

아래 구조로 분석해줘:

🏷️ 종합판정: 킵/강화후보/교환용/박사행 중 택1 + 재미있는 한줄평

📊 팩트체크:
- 이 포켓몬의 메타 위치, 종족값 해석, IV 평가

⚔️ PvP/PvE 평가:
- 리그별 적합도 (그레이트/울트라/마스터)
- 레이드/체육관 성능

🛡️ 상성 & 카운터:
- 이 포켓몬이 강한 상대 타입 3개
- 이 포켓몬이 약한 상대 타입 3개  
- 이 포켓몬을 잡는 최적 카운터 포켓몬 3마리 (이름+추천기술)

💊 처방전:
- 현재 기술셋 평가 (10점 만점)
- 최적 기술셋 추천
- 강화 우선순위와 이유
${isShadow ? '- 그림자 보너스 반영 평가\n' : ''}${isShiny ? '- 이로치 희소가치 언급\n' : ''}
🎤 포고박사의 한마디: 이 포켓몬에 대한 재미있는 마무리 코멘트

캐릭터를 살리되 분석은 정확하게. 쓸데없는 반복 없이 핵심만.`;

    // Model priority: 3.1-flash-lite (fastest free) → 3-flash (fallback)
    const models = [
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.0-flash',
    ];

    let lastError = '';

    for (const model of models) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 1200,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const text =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            '분석 결과를 생성하지 못했습니다.';
          return Response.json({ analysis: text, model });
        }

        lastError = `${model}: ${geminiRes.status}`;
        console.error(`Model ${model} failed:`, await geminiRes.text());
      } catch (e) {
        lastError = `${model}: ${e.message}`;
        console.error(`Model ${model} error:`, e);
      }
    }

    return Response.json(
      { error: `AI 응답 오류 (${lastError}). 잠시 후 다시 시도해주세요.` },
      { status: 500 }
    );
  } catch (err) {
    console.error('Server error:', err);
    return Response.json({ error: '서버 오류가 발생했습니다' }, { status: 500 });
  }
}
