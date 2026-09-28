import { NextResponse } from "next/server";
import { getPokemonDataset, findPokemon } from "../../lib/pokemonData";
import { analyzeDefender } from "../../lib/typeChart";

export const maxDuration = 60;

const SYSTEM_PROMPT = `당신은 포켓몬GO 최고 권위자 "포고박사"입니다.
초보자에게는 친절하되, 별의 모래와 사탕 낭비를 막기 위해 아주 단호하고 냉철하게(팩트 폭격) 분석하세요.
가독성을 위해 핵심 스탯과 결론은 **표(Table)나 글머리 기호**를 적극 활용하고, 부연 설명은 자연스러운 대화체로 풀어주세요.

## 🧠 분석 및 추론 원리 (매우 중요: 자체 데이터를 바탕으로 유연하게 판단할 것)
단순한 숫자가 아닌, 포켓몬의 '종족값'과 '최대 CP'를 바탕으로 예외 상황을 스스로 판단하세요.

### STEP 1: PvP 개체값의 유연한 판별 (XL사탕 예외 처리)
- 해당 포켓몬의 **레벨 50 기준 최대 CP**를 자체적으로 떠올리세요.
- **예외 상황 (100%가 좋은 경우):** 최대 CP가 출전하려는 리그의 제한(1500 또는 2500)에 **못 미치거나 턱걸이**하는 포켓몬인가요? (예: 하이퍼리그 블키/파이어로/만타인, 슈퍼리그 마자용 등) 
  -> 이런 경우 방어/체력뿐만 아니라 **공격력도 높은 15/15/15(100%)**에 가까울수록 최적입니다! XL사탕이 필수라는 점을 강조하세요.
- **일반 상황:** 최대 CP가 리그 제한을 **여유 있게 넘는** 포켓몬인가요?
  -> **공격이 낮고(0~3) 방어/HP가 높은(13~15)** 개체가 최적입니다. 공격이 10 이상이면 CP 제한 리그에서는 내구 손해가 크다고 경고하세요.

### STEP 2: PvE(레이드) 판별
- 종족값 자체가 레이드 메타에 쓰이는지 판단하세요. (비메타 포켓몬은 개체값이 100%라도 레이드용이 아님을 확실히 짚어주세요).
- 공격 15가 최우선입니다. 14 이하면 아쉬움을 지적하되, 타협 가능한 수준(총합 93% 이상)인지 판단하세요.

### STEP 3: 기술 및 시너지 평가
- 대단한 기술머신(레거시 기술)이 필수인지 점검하고, 무턱대고 진화시키지 말라고 경고하세요.
- 그림자는 '화력 20% 증가 / 내구 20% 감소'를 고려해, 이 개체의 스탯(예: 방어가 너무 낮으면 유리대포가 됨)과 시너지가 맞는지 평가하세요.

## 📋 응답 구조 (반드시 이 순서와 양식을 지킬 것, 마크다운 표 절대 사용 금지)

1. **박사의 첫인상** (흥미로운 리액션 또는 한 줄 팩트 폭격)
2. **📊 스탯 정밀 분석 (표 대신 깔끔한 리스트 사용)**
   - 🎯 **주력 용도:** [PvP / PvE / 관상용] 등 핵심만 단답형으로
   - 🧬 **개체값 분석:** (수치 평가 및 예외 상황 추론 내용)
   - 📈 **강화 효율:** (XL 사탕 필요 여부 등)
3. **⚔️ 기술 및 세팅 진단** (현재 기술 평가 및 추천 기술)
4. **판정:** [🟢 영구 보존 / 🟡 보류 / 🔴 사탕행 / 🔵 PvP용 킵] ← 이 줄은 마크다운 없이 정확히 이 텍스트 그대로 포함할 것
5. **💡 박사의 최종 처방전** (강화, 진화 등 구체적인 행동 지침을 짧고 명확하게)
6. **추천 카운터 / 상성 TOP 3** (이름과 이유만 한 줄씩 간결하게)

한국어로 답변하세요.`;

const RAID_SYSTEM_PROMPT = `당신은 포켓몬GO 레이드 전투 지휘관이자 전문가 "포고박사"입니다.
답답한 건 못 참는 성격이며, 유저가 레이드 패스를 날리지 않도록 **확신에 찬 어조와 열정적인 팩트 폭격**으로 지휘하세요. (예: "이 보스는 혼자 절대 못 잡습니다!", "바위 타입으로 뼈도 못 추리게 만드세요!")
모바일 앱 가독성을 위해 추천 카운터는 반드시 **표(Table)**로 정리하세요.

## 🧠 분석 및 추천 원리 (자체 메타 데이터 활용)
- **이중 약점(4배 데미지)**이 있다면 무조건 그 타입을 최우선으로 강조하세요.
- **DPS(초당 데미지)와 TDO(총 누적 데미지)**를 속으로 계산하여, 무조건 오래 버티는 녀석보다 빨리 잡는 그림자/메가 위주로 추천하세요.
- 사용자 보유목록이 주어지면, 그 중에서 쓸만한 녀석을 골라주되, **보유 덱이 너무 처참하면 팩트 폭격**을 날리고 야생에서 흔히 구하는 '가성비 카운터'를 대안으로 제시하세요.

## 📋 응답 구조 (반드시 이 순서와 양식을 지킬 것)

1. **⚠️ 레이드 브리핑** (보스의 타입, 핵심 약점, 한 줄 난이도 평)
2. **⚔️ 박사의 카운터 추천 TOP 6 (표 활용)**
   - [순위 / 포켓몬 이름 / 추천 빠른기술 & 차징기술 / 역할(메가버프, 유리대포, 든든한 국밥 등)] 형식의 표를 작성하세요.
   - 사용자 보유목록에 카운터가 있다면 표에 **(보유중)** 표시를 달아주세요.
3. **👥 권장 인원 및 난이도**
   - "최소 ○명, 안정권 ○명" 식으로 현실적인 인원을 명시하세요.
4. **💡 실전 전술 가이드**
   - 날씨 부스트 활용법, 보스의 까다로운 기술(예: "보스가 솔라빔을 쓰면 물/땅 타입은 피하세요") 등 실전 팁을 대화체로 조언하세요.

한국어로 답변하세요.`;

const COMPARE_SYSTEM_PROMPT = `당신은 포켓몬GO 포켓몬 비교 전문가이자 냉혹한 판사 "포고박사"입니다.
유저의 소중한 '별의 모래'와 '사탕'이 낭비되지 않도록, 두 개체를 비교해 **확실한 승자를 선언**하세요. "이건 고민할 필요도 없습니다" 혹은 "둘 다 하자가 있습니다" 식으로 명쾌하고 단호하게 대화체로 말하세요.
모바일 앱 가독성을 위해 두 개체의 스탯 비교는 반드시 **표(Table)**로 정리하세요.

## 🧠 비교 및 추론 원리
- **레이드용:** 방어/체력이 조금 높아도 **공격력이 15인 쪽이 무조건 승리**입니다. (예: 15/10/10 > 14/15/15)
- **PvP용:** 각 리그의 한계 CP를 추론하고, 내구(방어/HP)가 높은 쪽을 승리자로 판정하세요. 단, XL사탕이 필요한 예외 메타 포켓몬은 15/15/15에 가까운 쪽이 이깁니다.
- **용도 분리:** A는 레이드용으로 좋고 B는 PvP용으로 좋다면, "승자를 가릴 수 없는 각자의 영역이 있다"고 명확히 분리해서 판정하세요.

## 📋 응답 구조 (반드시 이 순서와 양식을 지킬 것)

1. **🏆 박사의 최종 판정 (승자 선언)** - [A 승리 / B 승리 / 용도별 무승부 / 둘 다 사탕행] 중 하나를 확실히 선언하는 한 줄 평.
2. **📊 스탯 정밀 비교 (표 활용)**
   - [항목 / 대상 A / 대상 B / 우위 판정] 형식의 표를 작성하여 개체값(공격/방어/HP)과 CP를 직관적으로 비교하세요.
3. **⚔️ 심층 분석 (왜 이겼는가?)**
   - 기술 세팅의 차이, IV가 실전에 미치는 영향(예: "공격 14는 미러전에서 선공을 뺏깁니다")을 팩트 기반으로 설명하세요.
4. **💡 최종 처방전**
   - A를 강화하고 진화시킬지, B를 교환 재료로 쓸지, 둘 다 버리고 새로운 개체를 잡을지 구체적인 행동(Action)을 지시하세요.

한국어로 답변하세요.`;

const MAX_BATTLE_SYSTEM_PROMPT = `당신은 포켓몬GO 맥스배틀 전문 지휘관 "포고박사"입니다.
맥스배틀은 일반 레이드와 완전히 다른 시스템입니다. 유저가 맥스 파티클과 시간을 낭비하지 않도록 **정확하고 열정적인 팩트**로 지휘하세요.

## ⚡ 맥스배틀 핵심 규칙 (반드시 숙지)
- **다이맥스/거다이맥스 포켓몬만** 참가 가능. 일반 포켓몬은 절대 불가.
- 빠른기술의 타입 = 맥스어택의 타입. 따라서 **빠른기술 타입이 보스에게 효과적인 포켓몬**을 추천하세요.
- 맥스배틀은 2페이즈: 1페이즈(일반 배틀) → 게이지 차면 → 2페이즈(다이맥스 3턴)
- 1페이즈엔 내구 높은 탱커, 2페이즈엔 화력 높은 어태커 전략이 기본.
- 최대 4명이서 협동. 거다이맥스는 최대 100명(4명씩 팀).

## 🧠 추천 원리
- 타입 상성이 최우선. **이중 약점(4배)** 있으면 무조건 강조.
- 현재 포켓몬GO에 존재하는 다이맥스/거다이맥스 포켓몬 기준으로 추천.
- 사용자 보유목록이 있다면 보유 다이맥스 포켓몬 우선 추천.

## 📋 응답 구조

1. **⚡ 맥스배틀 브리핑** (보스 타입, 약점, 거다이맥스 여부, 난이도 한 줄 평)
2. **⚔️ 추천 다이맥스 카운터 TOP 5 (표 활용)**
   - [순위 / 포켓몬 / 추천 빠른기술(타입) / 역할] 형식
   - 보유목록 있으면 **(보유중)** 표시
3. **👥 권장 인원**
   - 티어별 현실적인 인원 ("거다이맥스는 최소 10명 이상 권장" 등)
4. **💡 실전 팁**
   - 맥스배틀 특유의 전략 (탱커/어태커 역할 분담, 맥스기술 타이밍 등) 간결하게

한국어로 답변하세요.`;

// 기본 폴백 순서 (전부 무료 티어). 환경변수 GEMINI_MODELS(쉼표 구분)로 교체 가능.
// - gemini-2.0-flash: 2026-06-01 종료 → 삭제
// - gemini-2.5-pro: 무료 티어 미제공 + 2026-10-16 종료 → 삭제
// - gemini-3.1-flash-lite-preview: 2026-05-25 종료 → 정식 gemini-3.1-flash-lite 로 교체
const DEFAULT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
];

function getModels() {
  const fromEnv = (process.env.GEMINI_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_MODELS;
}

// ─── 최신성 규칙: 오늘 날짜 + "제공 데이터 우선" 을 모든 시스템 프롬프트에 덧붙인다 ───
function todayKST() {
  const now = new Date();
  const iso = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
  const human = now.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" });
  return `${iso} (${human})`;
}

function freshnessBlock(dataset) {
  const stamp = dataset?.generatedAt ? new Date(dataset.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "확인 불가";
  const okSources = (dataset?.dataSources || []).filter((s) => s.ok).map((s) => s.name).join(", ") || "없음";
  return `

## 📅 데이터 최신성 규칙 (최우선 준수)
- 오늘 날짜: ${todayKST()} 기준 한국 시간. 당신의 학습 지식은 이 날짜보다 오래되었을 수 있습니다.
- 사용자 메시지에 포함된 **"교차검증 데이터"**(종족값, 타입, 기술 목록, 상성, CP)가 당신의 학습 지식과 다르면 **반드시 제공된 데이터를 따르세요.** 학습 지식으로 덮어쓰지 마세요.
- 제공된 데이터에 없는 내용(현재 메타 순위, 진행 중 이벤트, 최근 밸런스 변경, 신규 기술 등)은 단정하지 말고 **"데이터 없음"**이라고 명시한 뒤 일반 원칙만 설명하세요. 추측 금지.
- "미검증 기술"은 교차검증 소스가 1개뿐이라는 뜻이며 **미출시라는 뜻이 아닙니다.** 추천에서 배제하지 말고, 언급할 때 반드시 "(미검증)"이라고 표시하세요. 주력 추천은 검증된 기술을 우선하세요.
- 데이터 기준 시각: ${stamp} / 정상 소스: ${okSources}`;
}

// 데이터셋 조회 (실패해도 분석은 계속 진행)
async function loadDatasetSafe() {
  try {
    return await getPokemonDataset();
  } catch (e) {
    console.warn(`[analyze] 데이터셋 로드 실패: ${e.message}`);
    return null;
  }
}

function verifiedBlock(label, p) {
  if (!p) return `## ${label}\n- 데이터 없음 (서버 교차검증 데이터에서 찾지 못함)`;
  const t = analyzeDefender(p.types);
  const lines = [
    `## ${label} (서버 교차검증 데이터 — 소스: ${(p.sources || []).join(", ")})`,
    `- 이름: ${p.nameKr} (${p.name}) #${p.id} / 폼: ${p.form}`,
    `- 종족값: 공격 ${p.baseAttack} / 방어 ${p.baseDefense} / 체력 ${p.baseStamina}`,
    `- 타입: ${(p.types || []).join("/") || "데이터 없음"}`,
    `- 빠른기술(일반, 일반 기술머신으로 습득 가능): ${(p.fast || []).join(", ") || "데이터 없음"}`,
    `- 차징기술(일반, 일반 기술머신으로 습득 가능): ${(p.charged || []).join(", ") || "데이터 없음"}`,
    `- 레거시 기술(대단한 기술머신 필요): ${[...(p.eliteFast || []), ...(p.eliteCharged || [])].join(", ") || "없음"}`,
    `- 전용기(아이템·폼 체인지로만 습득, 기술머신 불가): ${[...(p.signatureFast || []), ...(p.signatureCharged || [])].join(", ") || "없음"}`,
    `- 미검증 기술(교차검증 소스 1개 — 미출시라는 뜻이 아님): ${[...(p.unverifiedFast || []), ...(p.unverifiedCharged || [])].join(", ") || "없음"}`,
    `- ⚠️ 위 구분을 그대로 따르세요. "일반" 기술을 대단한 기술머신 필요라고 안내하지 마세요.`,
  ];
  if (t) {
    lines.push(`- 약점(받는 피해 증가, 서버 계산): ${t.weaknesses.join(", ") || "없음"}`);
    lines.push(`- 저항(받는 피해 감소, 서버 계산): ${t.resistances.join(", ") || "없음"}`);
  }
  return lines.join("\n");
}

function metaHeader(dataset, extra = {}) {
  const meta = {
    generatedAt: dataset?.generatedAt || null,
    stale: Boolean(dataset?.stale),
    dataSources: (dataset?.dataSources || []).map((s) => ({ name: s.name, ok: s.ok, fetchedAt: s.fetchedAt })),
    dataWarningCount: dataset?.dataWarningCount || 0,
    ...extra,
  };
  return encodeURIComponent(JSON.stringify(meta));
}

// ─── CP 계산 (서버에서 미리 계산해서 AI 환각 방지) ───
const CPM_40 = 0.7903;
const CPM_50 = 0.84029999;

function calcCP(baseAtk, baseDef, baseSta, atkIv, defIv, staIv, cpm) {
  return Math.floor(
    ((baseAtk + atkIv) * Math.sqrt(baseDef + defIv) * Math.sqrt(baseSta + staIv) * cpm * cpm) / 10
  );
}

function analyzeForLeague(pokemonData, atkIv, defIv, staIv) {
  if (!pokemonData.baseAttack) return null;
  const ba = pokemonData.baseAttack, bd = pokemonData.baseDefense, bs = pokemonData.baseStamina;

  const maxCP40 = calcCP(ba, bd, bs, 15, 15, 15, CPM_40);
  const maxCP50 = calcCP(ba, bd, bs, 15, 15, 15, CPM_50);
  const thisCP40 = calcCP(ba, bd, bs, atkIv, defIv, staIv, CPM_40);
  const thisCP50 = calcCP(ba, bd, bs, atkIv, defIv, staIv, CPM_50);

  // PvP GL 최적 CP (이 IV로 1500 이하 최대 레벨)
  let glMaxCP = null, ulMaxCP = null;
  const cpmTable = [];
  for (let lvl = 1; lvl <= 51; lvl += 0.5) {
    // 간략 CPM 테이블 (주요 레벨만)
    const cpm = 0.094 * Math.sqrt(lvl) + 0.006 * lvl; // 근사치
    cpmTable.push({ lvl, cpm });
  }
  // 정확도를 위해 Lv40, Lv50 실제값 사용
  const glCP = thisCP40 <= 1500 ? thisCP40 : (thisCP50 <= 1500 ? thisCP50 : null);
  const ulCP = thisCP40 <= 2500 ? thisCP40 : (thisCP50 <= 2500 ? thisCP50 : null);

  const leagues = [];
  if (maxCP50 <= 1500) leagues.push("그레이트리그 전용");
  else if (maxCP50 <= 2500) leagues.push("그레이트리그/울트라리그");
  else leagues.push("울트라리그/마스터리그");

  if (maxCP40 <= 1500) leagues.push("(Lv40 기준 GL 전용)");

  return {
    maxCP40, maxCP50, thisCP40, thisCP50,
    leagues: leagues.join(" "),
    glFit: thisCP50 <= 1500 ? "GL 가능" : thisCP40 <= 1500 ? "GL 가능 (Lv40 이하)" : "GL 초과",
    ulFit: thisCP50 <= 2500 ? "UL 가능" : thisCP40 <= 2500 ? "UL 가능 (Lv40 이하)" : "UL 초과",
  };
}

export async function POST(req) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY가 설정되지 않았습니다" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { userInput, collection, mode, raidBoss, compareA, compareB } = body;
    let { pokemonData } = body;

    const dataset = await loadDatasetSafe();
    let verifiedCount = 0;

    let systemPrompt, userMessage;

    if (mode === "maxbattle") {
      systemPrompt = MAX_BATTLE_SYSTEM_PROMPT;

      const boss = dataset ? findPokemon(dataset, { id: raidBoss?.id, form: raidBoss?.form, name: raidBoss?.name }) : null;
      if (boss) verifiedCount++;
      // snacknap 이 준 타입이 있으면 우선, 없으면 교차검증 데이터의 타입
      const bossTypes = raidBoss?.types?.length ? raidBoss.types : boss?.types || [];
      const bossBlock = verifiedBlock("맥스배틀 보스 교차검증 데이터", boss ? { ...boss, types: bossTypes } : null);

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%)`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유 포켓몬 (${collection.length}마리)\n${relevant}\n→ 이 중 다이맥스/거다이맥스 가능한 포켓몬이 있다면 우선 추천해주세요.`;
      }

      userMessage = `## 맥스배틀 보스 정보 (snacknap)
${JSON.stringify(raidBoss, null, 2)}

${bossBlock}
${collectionContext}

이 맥스배틀 보스의 최적 다이맥스 카운터를 추천해주세요. 맥스배틀 규칙(다이맥스 포켓몬만 가능)을 반드시 고려하세요.
약점/저항은 위 "서버 계산" 값을 그대로 사용하세요.`;
    } else if (mode === "raid") {
      systemPrompt = RAID_SYSTEM_PROMPT;

      const boss = dataset ? findPokemon(dataset, { id: raidBoss?.id, form: raidBoss?.form, name: raidBoss?.name }) : null;
      if (boss) verifiedCount++;
      const bossBlock = verifiedBlock("레이드 보스 교차검증 데이터", boss);

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%/${c.verdict})`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유 포켓몬 (${collection.length}마리)\n${relevant}\n→ 가능하면 보유 포켓몬 중에서 카운터를 우선 추천해주세요. 보유하지 않은 추천 포켓몬도 함께 알려주세요.`;
      }

      userMessage = `## 레이드 보스 정보 (사용자 선택)
${JSON.stringify(raidBoss, null, 2)}

${bossBlock}
${collectionContext}

이 레이드 보스의 최적 카운터를 추천해주세요. 보스의 타입/약점은 위 "서버 계산" 값을 그대로 사용하고, 초보자도 이해하기 쉽게 설명해주세요.`;
    } else if (mode === "compare") {
      systemPrompt = COMPARE_SYSTEM_PROMPT;

      const vA = dataset ? findPokemon(dataset, { id: compareA?.id, form: compareA?.form, name: compareA?.enName }) : null;
      const vB = dataset ? findPokemon(dataset, { id: compareB?.pokemonId, form: compareB?.form, name: compareB?.enName }) : null;
      if (vA) verifiedCount++;
      if (vB) verifiedCount++;

      userMessage = `## 비교 대상 A (현재 분석 중)
${JSON.stringify(compareA, null, 2)}

${verifiedBlock("A 교차검증 데이터", vA)}

## 비교 대상 B (보유목록)
${JSON.stringify(compareB, null, 2)}

${verifiedBlock("B 교차검증 데이터", vB)}

이 두 포켓몬을 비교 분석해주세요. 어느 쪽을 키워야 할지, 둘 다 킵해야 할지 판정해주세요.`;
    } else {
      systemPrompt = SYSTEM_PROMPT;

      // 클라이언트가 보낸 값 대신 서버 교차검증 데이터를 우선 사용 (종족값·기술·타입)
      const verified = dataset ? findPokemon(dataset, { id: pokemonData?.id, form: pokemonData?.form, name: pokemonData?.name }) : null;
      if (verified) {
        verifiedCount++;
        pokemonData = {
          ...pokemonData,
          name: verified.name, nameKr: verified.nameKr, id: verified.id, form: verified.form,
          baseAttack: verified.baseAttack, baseDefense: verified.baseDefense, baseStamina: verified.baseStamina,
          types: verified.types, fast: verified.fast, charged: verified.charged,
          eliteFast: verified.eliteFast, eliteCharged: verified.eliteCharged,
          signatureFast: verified.signatureFast, signatureCharged: verified.signatureCharged,
          unverifiedFast: verified.unverifiedFast, unverifiedCharged: verified.unverifiedCharged,
          dataSources: verified.sources,
        };
      }
      const typeInfo = analyzeDefender(pokemonData?.types);
      // 기술 구분(일반/레거시/전용기/미검증)을 명시적으로 전달
      const moveCategoryLines = pokemonData ? [
        `- 일반 기술(일반 기술머신 가능): ${[...(pokemonData.fast || []), ...(pokemonData.charged || [])].join(", ") || "데이터 없음"}`,
        `- 레거시 기술(대단한 기술머신 필요): ${[...(pokemonData.eliteFast || []), ...(pokemonData.eliteCharged || [])].join(", ") || "없음"}`,
        `- 전용기(아이템·폼 체인지로만 습득, 기술머신 불가): ${[...(pokemonData.signatureFast || []), ...(pokemonData.signatureCharged || [])].join(", ") || "없음"}`,
        `- 미검증 기술(교차검증 소스 1개, 미출시 아님): ${[...(pokemonData.unverifiedFast || []), ...(pokemonData.unverifiedCharged || [])].join(", ") || "없음"}`,
        `- ⚠️ 위 구분을 그대로 따르세요. "일반" 기술을 대단한 기술머신 필요라고 안내하지 마세요.`,
      ].join("\n") : "";

      let collectionContext = "";
      if (collection && collection.length > 0) {
        const relevant = collection
          .map((c) => `${c.name}(CP${c.cp}/IV${c.ivPercent}%/${c.verdict})`)
          .join(", ");
        collectionContext = `\n\n## 사용자 보유목록 (${collection.length}마리)\n${relevant}\n→ 이미 보유 중인 포켓몬과 비교해서 판정에 반영해주세요.`;
      }

      userMessage = `## 교차검증 데이터 (${verified ? `서버 교차검증 완료 — 소스: ${verified.sources.join(", ")}` : "서버 데이터 없음 — 클라이언트 값"})
${JSON.stringify(pokemonData, null, 2)}
${typeInfo ? `- 약점(받는 피해 증가, 서버 계산): ${typeInfo.weaknesses.join(", ") || "없음"}
- 저항(받는 피해 감소, 서버 계산): ${typeInfo.resistances.join(", ") || "없음"}` : "- 타입/상성: 데이터 없음"}

## 기술 구분 (서버 교차검증 데이터 기준)
${moveCategoryLines}

## 사용자 입력
- 포켓몬: ${userInput.name}
- 폼: ${pokemonData.form || "Normal"}
- CP: ${userInput.cp || "미입력"}
- 개체값: 공격 ${userInput.atkIv} / 방어 ${userInput.defIv} / 체력 ${userInput.staIv} (${userInput.ivPercent}%)
- 빠른기술: ${userInput.fastMove || "미선택"}
- 차징기술: ${userInput.chargedMove || "미선택"}
- 이로치: ${userInput.isShiny ? "예" : "아니오"}
- 그림자: ${userInput.isShadow ? "예" : "아니오"}
- PvP IV 참고: ${userInput.pvpIvTag || "해당없음"}

## 서버에서 미리 계산한 정확한 CP 데이터 (이 값을 그대로 사용하세요, 직접 계산하지 마세요!)
${(() => {
  const cpInfo = analyzeForLeague(pokemonData, userInput.atkIv, userInput.defIv, userInput.staIv);
  if (!cpInfo) return "- CP 계산 불가 (종족값 없음)";
  return `- 이 개체 Lv40 최대CP: ${cpInfo.thisCP40}
- 이 개체 Lv50 최대CP: ${cpInfo.thisCP50}
- 100% 개체 Lv40 최대CP: ${cpInfo.maxCP40}
- 100% 개체 Lv50 최대CP: ${cpInfo.maxCP50}
- 리그 적합: ${cpInfo.leagues}
- GL(1500): ${cpInfo.glFit}
- UL(2500): ${cpInfo.ulFit}`;
})()}${collectionContext}

위 교차검증 데이터를 기반으로 이 포켓몬을 분석해주세요. 기술 목록·종족값·상성은 위 데이터를 그대로 사용하세요.
CP를 기반으로 어떤 리그에 적합한지, 강화가 필요한지도 분석해주세요.
PvP 메타 포켓몬이면 PvP 기준으로, PvE 메타면 PvE 기준으로 IV를 평가하세요.
"**판정:**" 줄은 반드시 포함하세요.
⚠️ 핵심만 간결하게. 너무 길지 않게 답변하세요.`;
    }

    systemPrompt += freshnessBlock(dataset);
    const metaValue = metaHeader(dataset, { verified: verifiedCount });
    if (process.env.POGO_DEBUG_PROMPT) {
      console.log("[analyze] system prompt tail:\n" + systemPrompt.slice(-600));
      console.log("[analyze] user message:\n" + userMessage);
    }

    const errors = []; // 모델별 실패 사유 (전부 실패 시 한 번에 보여준다)

    // thinking 수준을 낮춰 thinking 토큰 소모를 줄인다 (Gemini 3.x: generationConfig.thinkingConfig.thinkingLevel).
    // 환경변수 GEMINI_THINKING_LEVEL 로 조정, "off" 면 파라미터 자체를 보내지 않는다.
    const thinkingLevel = (process.env.GEMINI_THINKING_LEVEL || "low").trim().toLowerCase();
    const callGemini = (model, withThinking) => {
      const generationConfig = {
        temperature: 0.8,
        // Gemini 3.x 는 생각(thinking) 토큰도 이 한도에 포함되므로 2000 이면 본문이 중간에 잘린다 (안전장치로 8192 유지)
        maxOutputTokens: 8192,
      };
      if (withThinking) generationConfig.thinkingConfig = { thinkingLevel };
      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userMessage }] }],
            generationConfig,
          }),
        }
      );
    };

    for (const model of getModels()) {
      try {
        // Use Gemini streaming SSE endpoint
        let res = await callGemini(model, thinkingLevel !== "off");

        if (!res.ok && thinkingLevel !== "off" && res.status === 400) {
          // 모델이 thinkingConfig/thinkingLevel 을 지원하지 않으면 파라미터 없이 한 번 더 시도
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error?.message || "";
          if (/thinking/i.test(msg)) {
            console.warn(`[analyze] ${model}: thinkingLevel 미지원 → 파라미터 없이 재시도 (${msg})`);
            res = await callGemini(model, false);
          } else {
            errors.push(`${model}: ${msg || res.statusText} (HTTP ${res.status})`);
            continue;
          }
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          errors.push(`${model}: ${errData?.error?.message || res.statusText} (HTTP ${res.status})`);
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
            let finishReason = null;
            let usage = null;
            const handleLine = (line) => {
              if (!line.startsWith("data:")) return;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr || jsonStr === "[DONE]") return;
              try {
                const parsed = JSON.parse(jsonStr);
                const cand = parsed?.candidates?.[0];
                // 생각(thought) 파트는 제외하고 텍스트 파트를 전부 이어 붙인다 (parts[0] 만 읽으면 본문이 누락됨)
                for (const part of cand?.content?.parts || []) {
                  if (part?.thought) continue;
                  if (part?.text) controller.enqueue(encoder.encode(part.text));
                }
                if (cand?.finishReason) finishReason = cand.finishReason;
                if (parsed?.usageMetadata) usage = parsed.usageMetadata;
              } catch {}
            };
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) handleLine(line);
              }
              buffer += decoder.decode();
              if (buffer.trim()) handleLine(buffer);
            } catch (e) {
              controller.enqueue(encoder.encode(`\n__ERROR__:스트리밍 중 오류 발생`));
            }
            if (finishReason && finishReason !== "STOP") {
              console.warn(`[analyze] ${model} finishReason=${finishReason} usage=${JSON.stringify(usage)}`);
              if (finishReason === "MAX_TOKENS") controller.enqueue(encoder.encode("\n\n⚠️ 응답이 출력 길이 제한으로 잘렸습니다. 다시 시도해 주세요."));
            } else if (process.env.POGO_DEBUG_PROMPT) {
              console.log(`[analyze] ${model} finishReason=${finishReason} usage=${JSON.stringify(usage)}`);
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache",
            // 데이터 기준 시각·소스 상태 (URL 인코딩된 JSON)
            "X-Pogo-Meta": metaValue,
          },
        });
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
      }
    }

    console.error("[analyze] 모든 Gemini 모델 실패: " + errors.join(" | "));
    return NextResponse.json({ error: `Gemini 오류: ${errors.join(" / ")}` }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ error: `서버 오류: ${e.message}` }, { status: 500 });
  }
}
