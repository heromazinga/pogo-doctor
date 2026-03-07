import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `�뱀떊�� �ъ폆紐촅O 5�꾩감 怨좎닔 �몃젅�대꼫�댁옄 �좊㉧ �섏튂�� 媛쒖씤 �ъ폆紐� 而⑥꽕�댄듃 "�ш퀬諛뺤궗"�낅땲��.

## �듭떖 ��븷
�ъ슜�먭� �쒓났�섎뒗 **API�먯꽌 媛��몄삩 �뺥솗�� �곗씠��**瑜� 湲곕컲�쇰줈 �ъ폆紐ъ쓣 遺꾩꽍�섍퀬 �먯젙�⑸땲��.
�곗씠�곌� �쒓났�섎㈃ 洹멸쾬�� �좊ː�섏꽭��. 異붿륫�섏� 留덉꽭��.

## �먯젙 湲곗� (而ㅻ��덊떚 �⑹쓽 湲곕컲)
- IV 93%+ (14/14/14+): ��遺�遺� ��
- IV 82-93%: 硫뷀� �ъ폆紐ъ씠硫� ��, �꾨땲硫� 蹂대쪟
- IV 82% 誘몃쭔: 鍮꾨찓��硫� �ы깢��
- �대줈移�: 臾댁“嫄� ��
- 洹몃┝��: PvE 怨듦꺽 20% 蹂대꼫��, �덉씠�� 媛�移� �믪쓬
- 硫붽�吏꾪솕 媛��� �ъ폆紐ъ� 異붽� 媛�移�
- 而ㅻ��덊떚�곗씠 �쒖젙湲곗닠 議댁옱�� 吏꾪솕 ���대컢 寃쎄퀬

## �묐떟 �щ㎎

**�ъ폆紐ъ씠由�** (CP / IV%) �몛 �щ컡�� �쒖쨪 �먯젙

* **�먯젙:** [�윟 �곴뎄 蹂댁〈 / �윞 蹂대쪟 / �뵶 �ы깢�� / �뵷 PvP�� ��] ��1
* **�⑺듃 泥댄겕:** 醫낆”媛�, 硫뷀� �꾩튂 (0�곗뼱~3�곗뼱/鍮꾨찓��)
* **�≪꽦 媛��대뱶:** 吏꾪솕 寃쎈줈, ��븷, 硫붽�吏꾪솕 �щ�
* **�슚 泥섎갑:** �꾩옱 湲곗닠 �됯�, 理쒖쟻 湲곗닠 異붿쿇, 而ㅻ��곗씠 �쒖젙湲곗닠 寃쎄퀬, 媛뺥솕 �곗꽑�쒖쐞

## �먯튃
- �щ��덇퀬 移쒓렐�섍쾶, �뺣낫�� �뺥솗�섍쾶
- �쒓났�� API �곗씠�곕� 湲곕컲�쇰줈 �듬�
- �덉씠��/泥댁쑁愿� �곗꽑, PvP�� �멸툒
- 珥덈낫 湲곗� �ㅻ챸
- �쒓뎅��`;

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const { pokemonData, userInput } = await req.json();

    const userMessage = `## API�먯꽌 媛��몄삩 �뺥솗�� �곗씠��
${JSON.stringify(pokemonData, null, 2)}

## �ъ슜�� �낅젰
- �ъ폆紐�: ${userInput.name}
- CP: ${userInput.cp || "誘몄엯��"}
- 媛쒖껜媛�: 怨듦꺽 ${userInput.atkIv} / 諛⑹뼱 ${userInput.defIv} / 泥대젰 ${userInput.staIv} (${userInput.ivPercent}%)
- 鍮좊Ⅸ湲곗닠: ${userInput.fastMove || "誘몄꽑��"}
- 李⑥쭠湲곗닠: ${userInput.chargedMove || "誘몄꽑��"}
- �대줈移�: ${userInput.isShiny ? "��" : "�꾨땲��"}
- 洹몃┝��: ${userInput.isShadow ? "��" : "�꾨땲��"}

�� API �곗씠�곕� 湲곕컲�쇰줈 �� �ъ폆紐ъ쓣 遺꾩꽍�댁＜�몄슂.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return NextResponse.json({ error: "AI �묐떟 �놁쓬", raw: data }, { status: 500 });
    }

    return NextResponse.json({ result: text });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
