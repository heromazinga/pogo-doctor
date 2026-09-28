// 포켓몬GO 용어집 — AI 프롬프트에 고정 포함되고, 답변의 금지 표현 검사에도 사용된다.
// 항목: term(용어) / definition(정의) / forbidden(금지 표현: 문자열 또는 정규식)

export const GLOSSARY = [
  {
    term: "빠른 기술 / 차징 기술",
    definition: "포켓몬GO 의 기술 종류는 이 두 가지뿐. 빠른 기술은 에너지를 모으고, 차징 기술은 에너지를 써서 발동한다.",
    forbidden: ["노멀기술", "노말기술", "일반기술", "메인기술", "필살기", "서브기술", "특수기", /주력\s*기술(?!머신)/],
  },
  {
    term: "기술머신(노말) / 기술머신(스페셜)",
    definition: "빠른 기술(노말)·차징 기술(스페셜)을 현재 배울 수 있는 기술 풀 안에서 무작위로 바꾸는 아이템.",
    forbidden: ["TM", "기술 머신 카드", "스킬머신"],
  },
  {
    term: "대단한 기술머신(노말) / 대단한 기술머신(스페셜)",
    definition: "레거시 기술(현재 풀에 없는 한정 기술)을 포함해 원하는 기술을 골라 배우는 아이템. 레거시 기술은 이 아이템으로만 습득.",
    forbidden: ["엘리트 TM", "엘리트TM", "엘리트 기술머신", "특별 기술머신"],
  },
  {
    term: "메테오나이트",
    definition: "레쿠쟈가 화룡점정(Dragon Ascent)을 배우게 하는 전용 아이템. 그 외 전용기는 폼 체인지(융합·왕관)로 습득.",
    forbidden: ["운석", "운석 아이템", "메테오라이트", "메테오나이트석"],
  },
  { term: "별의모래", definition: "포켓몬 강화·기술 교체에 쓰는 자원.", forbidden: ["스타더스트", "별모래"] },
  { term: "사탕 / XL사탕", definition: "강화·진화에 쓰는 자원. XL사탕은 레벨 40 초과 강화에 필요.", forbidden: ["캔디", "XL캔디", "엑셀사탕"] },
  { term: "메가진화", definition: "메가에너지로 일시적으로 메가 형태가 되는 것.", forbidden: ["메가 에볼루션"] },
  { term: "섀도 / 정화", definition: "섀도 포켓몬은 공격 1.2배·방어 0.83배. 정화하면 일반 포켓몬이 되고 개체값이 +2 씩 오른다.", forbidden: ["그림자 포켓몬", "쉐도우", "다크 포켓몬", "퓨리파이"] },
  { term: "개체값(공격/방어/HP)", definition: "각 0~15. 세 값의 합을 45로 나눈 것이 IV%.", forbidden: ["IV 스탯", "잠재력 수치", "개채값"] },
  { term: "레이드", definition: "체육관에서 여러 명이 보스와 싸우는 콘텐츠.", forbidden: ["레이드전투", "보스전"] },
  { term: "맥스배틀", definition: "파워스팟에서 다이맥스/거다이맥스 포켓몬과 싸우는 콘텐츠. 다이맥스 포켓몬만 참가.", forbidden: ["다이맥스 레이드", "맥스 레이드"] },
  {
    term: "타입 배율(포켓몬GO 기준)",
    definition: "약점 1.6배, 이중 약점 2.56배, 반감 0.625배, 이중 반감 0.39배. 본가의 '무효'는 GO 에서 이중 반감(0.39배).",
    forbidden: ["4배 약점", "4배", "2배 약점", "무효", "1/4", "0.25배", "0.5배"],
  },
  {
    term: "기술 교체",
    definition: "기술머신으로 기술을 바꾸는 행위는 '기술 교체'라고 부른다.",
    forbidden: [/(기술|차징|빠른|슬롯)[^\n]{0,10}해방/, /해방[^\n]{0,10}(기술|차징|빠른|슬롯)/, "해금", "언락"],
  },
  {
    term: "자기희생 기술(대폭발·자폭 등은 GO 에 없음)",
    definition: "포켓몬GO 에는 사용자를 쓰러뜨리는 기술이 없다. '자폭기'라는 분류는 존재하지 않는다.",
    forbidden: ["자폭기", "자폭 기술", "자멸기"],
  },
  {
    term: "이름 표기",
    definition: "포켓몬명·기술명은 제공된 데이터의 '한국어(영어)' 표기를 그대로 사용한다. 제공되지 않은 한국어 이름을 임의로 번역·창작하지 않고 영어 그대로 쓴다.",
    forbidden: [],
  },
];

// 프롬프트용 텍스트
export function renderGlossary() {
  const lines = GLOSSARY.map((g) => {
    const fb = g.forbidden.filter((f) => typeof f === "string");
    return `- **${g.term}**: ${g.definition}${fb.length ? ` (금지 표현: ${fb.map((f) => `"${f}"`).join(", ")})` : ""}`;
  });
  return `

## 📖 용어집 (반드시 이 표기만 사용, 여기 없는 용어를 새로 만들지 말 것)
${lines.join("\n")}`;
}

// 답변에서 금지 표현 검출 → [{ term, matched }]
export function findForbidden(text) {
  const hits = [];
  if (!text) return hits;
  for (const g of GLOSSARY) {
    for (const f of g.forbidden) {
      if (typeof f === "string") {
        // 짧은 토큰(TM, 4배 등)은 단어 경계로 오탐 방지: 앞뒤가 영문/숫자가 아닌 경우만
        const re = new RegExp(`(^|[^A-Za-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);
        const m = text.match(re);
        if (m) hits.push({ term: g.term, matched: f });
      } else {
        const m = text.match(f);
        if (m) hits.push({ term: g.term, matched: m[0] });
      }
    }
  }
  return hits;
}
