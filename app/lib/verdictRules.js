// 4-A 용도별 보관 판정 기준값 — 한 곳에서 관리 (README "판정 기준" 표와 동일하게 유지)
// 판정은 결정적 계산이며 AI 를 쓰지 않는다. 저장하지 않고 볼 때마다 계산한다.

// 4-B6.2 판정 규칙 버전: 저장된 판정(scan_items.verdict.rulesVersion)이 이 값과 다르면 조회 시 다시 계산해 저장한다.
// 기준값(RULES)이나 판정 로직을 바꿀 때 반드시 올린다 (실DB 검증: 규칙 변경이 정리 도우미에 반영되지 않던 결함).
export const RULES_VERSION = "2026-09-30.2"; // 4-D2: 스캔 모드(섀도/정화) 기록이 일반 기록을 대체(백필 1회), 보호 조건에 !특별(코스튬)

export const RULES = {
  // 종족 순위 (자동 산출) — 타입별 레이드: teamScore 의 DPS^0.775 × TDO^0.225, 그 타입 기술만 사용, 중립 보스 가정
  RAID_TOP_RANK: 12,        // 12위 이내 = 상위종
  RAID_MID_RANK: 30,        // 13~30위 = 중위종
  RAID_TOP_SCORE_PCT: 75,   // 4-A2: 상위종 = 순위 조건 AND 점수 ≥ 그 타입 1위(전설 포함 전체 1위) 점수의 75%
  RAID_MID_SCORE_PCT: 65,   // 중위종 = 순위 ≤30 AND ≥65% (공격수가 적은 타입에서 약한 종이 순위만으로 들어오는 것 방지)
  RAID_MAIN_INDIV_RANK: 6,  // 내 목록 같은 종·같은 용도 안에서 공격 스탯 순위 ≤ 6 → 주력 (상위종일 때)
  RAID_MIN_ATK_IV: 10,      // 4-B6: 공격 IV 미만이면 레이드 태그 없음 (실측: 저승갓숭 공격 0 이 격투 레이드 묶음에 포함됨)
  RAID_MAIN_MIN_ATK_IV: 12, // 4-B6: 주력 등급의 최소 공격 IV (섀도도 같은 기준)
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
  LEAGUE_HOLD_PRODUCT_RANK: 800,  // 4-B6.2: 상위종 ≤800 → 보류 (실DB 검증: 저승갓숭 0/11/14 스탯곱 594위가 박사행이 됨. 가방 여유·박사행 비가역)
  LEAGUE_MID_HOLD_PRODUCT_RANK: 200, // 4-B6.2: 중위종 ≤200 → 보류
  LEAGUE_HOLD_PRODUCT_RANK_TIGHT: 500,  // 보관함 "빠듯" 이면 기존 기준 유지
  LEAGUE_MID_HOLD_PRODUCT_RANK_TIGHT: 100,
  LEAGUE_CANDIDATE_PRODUCT_RANK: 41, // 4-C.2: 스탯곱 순위 ≤41(상위 1%)이면 보류(리그 후보). 사례: 찌르꼬 0/15/14
  LEAGUE_CANDIDATE_SPECIES_RANK: 300, // 4-D: 리그 후보는 그 리그 PvPoke 순위 ≤300 인 종만 (도치마론 1080위·롱스톤 906위 제외)
  LEAGUE_CAP_REACH_PCT: 0.97,        // 4-D: 보류(리그 후보·일반 보류)는 상한 도달 개체만 — 상한 도달 레벨 < 50 AND 상한 레벨 CP ≥ 상한×0.97
  EVOLVE_CANDY_HOLD: 200,            // 4-C.2: 진화 후보의 필요 사탕 ≥200 이면 등급 상한 보류. 사례: 잉어킹 사탕 400
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
  // 교환 시 반짝반짝(럭키) — 4-A2 활성. 근거(사용자 확인): Niantic 공식 "older Pokémon have a higher chance of triggering a Lucky Trade"(수치 비공개),
  // 2018-09-05 공지: 2016년 7~8월 포획분은 교환 시 반짝반짝 확정(반짝반짝 보유 10마리 미만 조건). 출처 pokemongohub.net/post/guide/lucky-pokemon-mechanics-in-pokemon-go/
  LUCKY_TRADE_YEAR: 2019,                       // 이 연도 이전(미만) 포획 → "확률↑"
  LUCKY_TRADE_GUARANTEED: { from: "2016-07-01", to: "2016-08-31" }, // 포획일 범위 → "확정(조건부)"
};

// 태그 문자열 (게임에서 그대로 쓸 수 있는 한국어)
export const TAG = {
  raid: (typeKr) => `${typeKr} 레이드`,
  gym: "체육관 방어",
  great: "슈퍼리그",
  ultra: "하이퍼리그",
  master: "마스터리그",
  evolve: () => "진화 후보",                      // 4-C.2 "진화 대기"→"진화 후보". 4-D: 태그 하나로 단일화(진화형·사탕은 사유에 — 카테고리 50개+ 방지)
  collect: "수집",                                 // 4-C.2: 100%·0%·반짝반짝·오래 전 포획(교환 시 반짝반짝)
  dynamax: "다이맥스",                              // 4-C.2: 맥스배틀 종 → 판정 대신 태그 권장 안내
};
export const EVOLVE_PREFIX = "진화 후보";

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
