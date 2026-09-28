// 기술 한국어명 수동 매핑 (최종 폴백).
// 우선순위: pokemon-go-api names.Korean → 이 파일(명시 매핑) → PokeAPI move_names.csv(ko, 기본 기술명 + 접미사 규칙).
// 값은 포켓몬 공식 한국어 기술명(PokeAPI move_names.csv, language_id=3) 기준. PokeAPI 조회 실패 시에도 전용기 표기가 유지되도록 둔다.
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
  // GO 전용 변형 (PokeAPI 에 없는 표기) — 기본 기술의 공식 한국어명 + 구분
  "Vise Grip": "집게",
  "Aura Wheel Dark": "오라휠(악)",
  "Aura Wheel Electric": "오라휠(전기)",
  "Hydro Pump Blastoise": "하이드로펌프(거북왕)",
  "Water Gun Fast Blastoise": "물대포(거북왕)",
  "Gulp Missile (Arrokuda)": "그대로의미사일(치갈치)",
  "Gulp Missile (Pikachu)": "그대로의미사일(피카츄)",
};
