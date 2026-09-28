// 기술 한국어명 수동 매핑 (최종 폴백).
// 우선순위: pokemon-go-api names.Korean → PokeAPI move_names.csv(ko) → 이 파일.
// 2026-09-28 기준 PokeAPI 로 전부 보완되어 실제 폴백은 발생하지 않지만, PokeAPI 조회 실패 시를 대비해
// 전용기·GO 전용 변형 기술을 여기 둔다. 값은 포켓몬 공식 한국어 기술명(PokeAPI move_names.csv, language_id=3) 기준.
export const MOVE_NAMES_KR_MANUAL = {
  "Dragon Ascent": "화룡점정",
  "Freeze Shock": "프리즈볼트",
  "Ice Burn": "콜드플레어",
  "Sunsteel Strike": "메테오드라이브",
  "Moongeist Beam": "섀도레이",
  "Behemoth Blade": "거수참",
  "Behemoth Bash": "거수탄",
  "Roar of Time": "시간의포효",
  "Spacial Rend": "공간절단",
  "Secret Sword": "신비의칼",
  "Techno Blast (Normal)": "테크노버스터",
  "Weather Ball (Normal)": "웨더볼",
};
