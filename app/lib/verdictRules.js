// 4-A 용도별 보관 판정 기준값 — 한 곳에서 관리 (README "판정 기준" 표와 동일하게 유지)
// 판정은 결정적 계산이며 AI 를 쓰지 않는다. 저장하지 않고 볼 때마다 계산한다.

export const RULES = {
  // 종족 순위 (자동 산출) — 타입별 레이드: teamScore 의 DPS^0.775 × TDO^0.225, 그 타입 기술만 사용, 중립 보스 가정
  RAID_TOP_RANK: 12,        // 12위 이내 = 상위종
  RAID_MID_RANK: 30,        // 13~30위 = 중위종
  RAID_MAIN_INDIV_RANK: 6,  // 내 목록 같은 종·같은 용도 안에서 공격 스탯 순위 ≤ 6 → 주력 (상위종일 때)
  RAID_BOSS: { baseAttack: 250, baseDefense: 200, baseStamina: 220 }, // 중립 보스 가정(타입 없음, L40·15/15/15)
  RAID_MEMBER_LEVEL: 40,    // 종족 순위 산출 시 개체 가정: L40, 15/15/15

  // 체육관 방어: 전설·환상·UB 제외, 방어×HP 내구 순위
  GYM_TOP_RANK: 20,
  GYM_MAIN_INDIV_RANK: 2,   // 같은 종 내 상위 2 → 주력

  // 리그 (PvPoke rankings/all/overall)
  LEAGUE_TOP_RANK: 100,     // 상위종
  LEAGUE_MID_RANK: 200,     // 중위종
  LEAGUE_CAPS: { great: 1500, ultra: 2500 },
  LEAGUE_MAX_LEVEL: 50,     // 스탯곱 계산 레벨 상한 (51 옵션)
  LEAGUE_MAIN_PRODUCT_RANK: 100,  // 스탯곱 4096 중 순위: 상위종 & ≤100 → 주력
  LEAGUE_HOLD_PRODUCT_RANK: 500,  // 상위종 ≤500 → 보류
  LEAGUE_MID_HOLD_PRODUCT_RANK: 100, // 중위종 ≤100 → 보류
  MASTER_TOP_RANK: 50,
  MASTER_MAIN_PCT: 96,      // 전체 % ≥ 96 → 주력
  MASTER_HOLD_PCT: 91,      // 91~95 → 보류

  // 보관함 여유: 보류 항목을 같은 종·같은 태그로 몇 마리까지 보관 권장하는지
  STORAGE_HOLD_LIMIT: { relaxed: Infinity, normal: 2, tight: 0 },
  STORAGE_DEFAULT: "normal",

  // 이벤트 연동: 며칠 이내 이벤트를 볼지
  EVENT_WINDOW_DAYS: 30,
  EVENT_TYPES: { "community-day": "커뮤니티 데이", "pokemon-spotlight-hour": "스포트라이트 아워" },

  // 수집 추천
  COLLECT_HUNDO_PCT: 100,
  COLLECT_NUNDO_SUM: 0,
  // 교환 시 반짝반짝(럭키) 확률 기준 연도: 공식 근거(Niantic 도움말·pokemongo.com)를 이 환경에서 확인할 수 없어 비활성 (README 근거)
  LUCKY_TRADE_YEAR: null,
};

// 태그 문자열 (게임에서 그대로 쓸 수 있는 한국어)
export const TAG = {
  raid: (typeKr) => `${typeKr} 레이드`,
  gym: "체육관 방어",
  great: "슈퍼리그",
  ultra: "하이퍼리그",
  master: "마스터리그",
  evolve: (finalKr) => `진화 대기(→${finalKr})`,
};

export const TIER_LABEL = { main: "✅ 주력", hold: "🟡 보류", transfer: "❌ 박사행", need_appraisal: "❔ 평가 화면 캡처 필요" };

// 태그 → 기존 purposes 파생 (raid/great/ultra/master)
export function purposesFromTags(tags) {
  const out = new Set();
  for (const t of tags || []) {
    if (/레이드$/.test(t)) out.add("raid");
    else if (t === TAG.great) out.add("great");
    else if (t === TAG.ultra) out.add("ultra");
    else if (t === TAG.master) out.add("master");
  }
  return [...out];
}
