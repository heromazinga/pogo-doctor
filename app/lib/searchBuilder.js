// 4-B5 정리 도우미: 대상 목록 → 포켓몬GO 검색어 묶음 (게임 조작 없음. 사용자가 붙여넣고 결과 수를 확인한 뒤 직접 선택한다)
// 검색 문법(한국어판, 사용자 확인): "A,B&C,D" = (A 또는 B) 그리고 (C 또는 D) — & 로 나눈 절마다 , 는 OR(CNF). "cp2100-2200" 범위 동작. "(A&B),(C&D)" 불가.
// 형식: "{도감번호 OR 목록}&{hp OR 목록}[&cp범위]" — 이름 대신 도감번호(별명·표기 차이 회피). 예: "700,381&hp154,hp118"
// 교차곱 오선택 방지: 알려진 전체 개체(스캔 기록 + 내 목록)에 대해 검색식이 대상 외 개체를 잡으면 묶음을 쪼갠다(최악의 경우 종별 1식).
//   같은 종·같은 HP 의 비대상 개체는 CP(검증된 값)로 좁히고, 그래도 구분이 안 되면 그 대상은 "안전한 검색식 없음"으로 제외한다.
// 안드로이드 core/SearchBuilder.kt 와 같은 규칙 (단위 테스트로 동일성 유지).
export const DEFAULT_MAX_LEN = 200;
// 예상 수 한계 안내 (박사행 토스트·🧹 패널·앱 목록에 상시 표기)
export const EXPECTED_LIMIT_NOTE = "예상 수는 앱이 아는 개체(스캔 기록 + 내 목록) 기준입니다. 앱이 모르는 같은 종·HP 개체가 게임에 있으면 결과가 더 나옵니다 — 게임 결과 수가 예상과 다르면 보내지 마세요.";
// 4-F.6 D: 게임 결과가 예상보다 적을 때(보호 속성 개체가 섞임) 안내
export const FEWER_NOTE = "게임 결과가 예상보다 적으면 보호 속성(색이 다른·반짝반짝·XXL·XXS·배경·코스튬) 개체가 섞였을 수 있습니다 → 나온 것만 보내고 '보호' 스캔(게임 검색 \"색이 다른,반짝반짝,xxl,xxs,배경,특별\" 후 보호 모드로 넘기기)을 한 번 실행하세요.";
// 4-C.2 박사행 보호 조건 안내: 보호 대상(태그·이로치·반짝반짝·XXL·배경)은 검색에서 빠지므로 결과는 예상 이하
// 4-F.5: 태그 보호는 "앱이 관리하지 않는 태그"만(각각 &!#태그명). 앱 관리 태그(수집·진화 후보·슈퍼리그·○○ 레이드 …)가 달린 박사행 개체는 묶음에 포함된다
export const PROTECT_NOTE = "박사행 검색어에는 보호 조건(&!색이 다른&!반짝반짝&!xxl&!xxs&!배경&!특별&!다이맥스 + 사용자 고유 태그 &!#태그명)이 항상 붙습니다(이로치·반짝반짝·XXL·XXS·배경·코스튬·다이맥스·사용자 태그 제외. 앱이 추천한 태그는 제외하지 않음). 게임 결과 ≤ 예상 N마리 — 적으면 보호 대상이 빠진 것, 많으면 보내지 마세요(앱이 모르는 같은 종·HP 개체).";
export function protectNote(userTags = []) { return PROTECT_NOTE + (userTags.length ? ` 이번 사용자 고유 태그: ${userTags.map((t) => "#" + t).join(", ")}.` : " 사용자 고유 태그 없음."); }
// 앱이 관리하는 태그(추천 태그 이름): 이 태그가 달린 개체는 판정이 박사행이면 묶음에 포함 (사용자가 게임에서 태그를 일괄 해제할 수 없으므로)
const TYPES_KR_LIST = ["노말", "불꽃", "물", "전기", "풀", "얼음", "격투", "독", "땅", "비행", "에스퍼", "벌레", "바위", "고스트", "드래곤", "악", "강철", "페어리"];
export const APP_TAGS = new Set([...TYPES_KR_LIST.map((t) => `${t} 레이드`), "체육관 방어", "슈퍼리그", "하이퍼리그", "마스터리그", "수집", "수집(종 대표)", "진화 후보", "교환용", "메가 진화용"]);
const normTag = (t) => String(t || "").replace(/\s+/g, "").replace(/^#/, "");
const isAppTag = (t) => [...APP_TAGS].some((a) => normTag(a) === normTag(t));
// 개체의 사용자 고유 태그(앱 관리 태그 제외)
export const userTagsOfItem = (x) => (x.game_tags || []).filter((t) => !isAppTag(t));
// 알려진 개체 전체에서 관측된 사용자 고유 태그 목록(정렬, 중복 제거). 예: 다이맥스, 즐겨찾기
export function userTagsOf(population) { return [...new Set(population.flatMap((x) => userTagsOfItem(x)))].sort(); }

const key = (x) => `${x.species_id}|${x.hp ?? ""}|${x.cp ?? ""}|${x.is_shadow ? 1 : 0}`;

// 검색식이 개체 x 를 잡는가 (도감번호 OR, hp OR, cp 범위 OR 로 판단. 폼·그림자는 검색식에 넣지 않으므로 잡힌다고 본다)
// 4-C.2 박사행 보호 조건(항상 적용): 태그 없음·이로치 아님·반짝반짝 아님·XXL 아님·배경 없음. 검색어 길이 계산에 포함.
//   한국어판 동작은 사용자 확인("색이 다른" 띄어쓰기 포함). 코스튬은 검색어가 없어 사용자가 태그로 보호한다.
// 4-D2: !특별 = 코스튬. 4-D3: !다이맥스 = 맥스배틀 개체(한국어판 검색어, 사용자 확인). 거다이맥스가 "다이맥스" 검색에 포함되지 않으면 "!거다이맥스" 추가 예정(사용자 확인 후)
// 4-F.5: "!#"(태그 전체 제외) 폐지 → 사용자 고유 태그마다 "!#태그명". 기본 절(PROTECT_CLAUSES)은 태그 절이 없다
export const PROTECT_CLAUSES = ["!색이 다른", "!반짝반짝", "!xxl", "!xxs", "!배경", "!특별", "!다이맥스"]; // 4-D3: !xxs(한국어판 동작 확인), !다이맥스
export const PROTECT_SUFFIX = "&" + PROTECT_CLAUSES.join("&");
export const NO_TAG_CLAUSE = "!#";
// 사용자 고유 태그 목록 → 보호 접미사 "&!#태그1&!#태그2&!색이 다른…". 게임 "#태그명" 검색이 띄어쓰기 포함 태그에서 동작하는지는 사용자 실기 확인 항목
export function protectSuffix(userTags = []) { return (userTags.length ? "&" + userTags.map((t) => `!#${t}`).join("&") : "") + PROTECT_SUFFIX; }
// 검색어가 개체 x 를 잡는가. 부정 절: !# → game_tags 없음, !색이 다른 → 이로치 아님, !반짝반짝 → 럭키 아님, !xxl·!배경 → 앱이 모르는 정보(잡힌다고 봄)
export function matches(query, x) {
  const parts = query.split("&");
  // 4-F.6 D: 보호 모드 기록(is_protected)은 보호 절(!색이 다른 … !특별)이 하나라도 있는 검색어에 잡히지 않는다(속성 종류는 몰라도 전체 보호 절이 모두 붙으므로)
  if (x.is_protected && parts.some((c) => PROTECT_CLAUSES.includes(c.trim()))) return false;
  return parts.every((clause) => clause.split(",").some((term) => {
    const t = term.trim();
    if (t === NO_TAG_CLAUSE) return !(x.game_tags || []).length;
    if (t.startsWith("!#")) { const name = normTag(t.slice(2)); return !(x.game_tags || []).some((g) => normTag(g) === name); }
    if (t === "!색이 다른") return !x.is_shiny;
    if (t === "!반짝반짝") return !x.is_lucky;
    if (t === "!xxl" || t === "!xxs" || t === "!배경" || t === "!특별" || t === "!다이맥스" || t === "!거다이맥스") return true;
    if (/^\d+$/.test(t)) return String(x.species_id) === t;
    if (/^hp\d+$/.test(t)) return x.hp != null && `hp${x.hp}` === t;
    const m = t.match(/^cp(\d+)(?:-(\d+))?$/);
    if (m) { if (x.cp == null) return false; const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo; return x.cp >= lo && x.cp <= hi; }
    return false;
  }));
}

export function buildQuery(members, { withCp = false } = {}) {
  const dex = [...new Set(members.map((m) => m.species_id))].sort((a, b) => a - b).join(",");
  const hps = [...new Set(members.map((m) => m.hp))].sort((a, b) => a - b).map((h) => `hp${h}`).join(",");
  let q = `${dex}&${hps}`;
  if (withCp) q += "&" + [...new Set(members.map((m) => m.cp))].sort((a, b) => a - b).map((c) => `cp${c}`).join(",");
  return q;
}

// targets: [{id, species_id, hp, cp, cpVerified, is_shadow, form}], population: 알려진 전체 개체(대상 포함)
// 반환 { groups: [{query, expected, targetIds, withCp}], skipped: [{id, reason}] }
// strict=false(태그용): 충돌이 있어도 묶음을 만들고 overlap(알려진 비대상 중 잡히는 최대 수)을 표기. strict=true(박사행): 충돌 묶음은 쪼개고 구분 불가 대상은 제외
// suffix(4-C.2): 묶음 검색어 끝에 붙는 고정 절(박사행 보호 조건). 길이 상한 계산에 포함
export function buildGroups(targets, population, { maxLen = DEFAULT_MAX_LEN, strict = true, suffix = "" } = {}) {
  const targetIds = new Set(targets.map((t) => t.id));
  const usable = [], skipped = [];
  for (const t of targets) {
    if (t.hp == null) { skipped.push({ id: t.id, reason: "HP 없음" }); continue; }
    usable.push(t);
  }
  // 그림자 여부·폼별로 분리(검색식에 그림자·폼 키워드를 쓰지 않으므로 같은 묶음에 섞지 않는다)
  const buckets = new Map();
  for (const t of usable) { const b = `${t.is_shadow ? 1 : 0}|${t.form || "Normal"}`; if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(t); }
  const nonTargets = population.filter((p) => !targetIds.has(p.id));
  const groups = [];
  const overlapOf = (members, withCp) => { const q = buildQuery(members, { withCp }); return nonTargets.filter((p) => matches(q, p)).length; };
  const safe = (members, withCp) => {
    if (withCp && members.some((m) => m.cp == null || !m.cpVerified)) return false;
    const q = buildQuery(members, { withCp }) + suffix;
    if (q.length > maxLen) return false;
    return !nonTargets.some((p) => matches(q, p));
  };
  const fits = (members) => (buildQuery(members, { withCp: false }) + suffix).length <= maxLen;
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => a.species_id - b.species_id || (a.hp ?? 0) - (b.hp ?? 0));
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const withCp = !safe(cur, false) && safe(cur, true);
      const overlap = strict ? 0 : overlapOf(cur, withCp);
      groups.push({ query: buildQuery(cur, { withCp }) + suffix, expected: cur.length, targetIds: cur.map((m) => m.id), withCp, overlap });
      cur = [];
    };
    for (const t of sorted) {
      if (strict) {
        // 단독으로도 안전하지 않은 대상(같은 종·HP·CP 의 비대상 존재)은 제외
        if (!safe([t], false) && !safe([t], true)) { skipped.push({ id: t.id, reason: "같은 종·HP(·CP) 의 보관 개체와 구분 불가" }); continue; }
        const next = [...cur, t];
        if (cur.length === 0 || safe(next, false) || safe(next, true)) cur = next; else { flush(); cur = [t]; }
      } else {
        // 느슨: 길이 상한만 지키고 충돌은 overlap 으로 표기 (태그는 되돌릴 수 있음)
        const next = [...cur, t];
        if (cur.length === 0 || fits(next)) cur = next; else { flush(); cur = [t]; }
      }
    }
    flush();
  }
  return { groups, skipped };
}

// 판정 결과로 대상 분류. items: [{id, species_id, hp, cp, cpVerified, is_shadow, form, verdict:{tier, recommendedTags, collect}, recheck, is_shiny, is_lucky, legendary}]
// 4-C.2: "수집" 태그(recommendedTags 에 "수집": 100%·0%·반짝반짝·오래 전 포획)는 등급과 무관하게 태그 묶음으로. 이로치·배경·XXL 은 게임 검색어(고정 묶음)
export const COLLECT_TAG = "수집";
export const COLLECT_FIXED_QUERIES = [
  { query: "색이 다른", label: "이로치(색이 다른)" },
  { query: "배경", label: "배경 있음" },
  { query: "xxl", label: "XXL" },
];
// 4-F.5: 기본 태그 작업 목록에서 접어 두는(선택) 태그 — 종 대표는 판정상 박사행 금지라 보호용 태그가 필요 없다
export const OPTIONAL_TAGS = new Set(["수집(종 대표)"]);
export function classify(items) {
  const transfer = [], tags = new Map(), collect = [];
  for (const it of items) {
    const v = it.verdict || {};
    const rec = v.recommendedTags || [];
    if (Array.isArray(v.collect) && v.collect.length && !it.recheck) collect.push(it);
    // 4-B6: 게임 태그가 이미 달린 개체는 박사행 대상에서 제외 → 4-F.5: 사용자 고유 태그만 제외(앱이 추천한 태그는 판정이 바뀌면 박사행 묶음에 포함)
    if (v.tier === "transfer" && !it.recheck && !(v.collect || []).length && !it.is_shiny && !it.is_lucky && !it.legendary && !userTagsOfItem(it).length) transfer.push(it);
    // 4-C.3: 재확인(recheck) 기록은 태그·수집 묶음에서도 제외 (개체값 충돌 = 막대 오판독 의심)
    if (it.recheck) continue;
    for (const tg of rec) {
      if (tg !== COLLECT_TAG && v.tier !== "main" && v.tier !== "hold") continue;
      if (!tags.has(tg)) tags.set(tg, []); tags.get(tg).push(it);
    }
  }
  return { transfer, tags, collect };
}

// 전체 결과: [{category:"transfer"|"tag:불꽃 레이드"|"collect", label, groups, skipped, protect?}]
// 박사행 묶음에는 보호 조건(PROTECT_SUFFIX)이 항상 붙는다 → 게임 결과 ≤ 예상 N마리(적으면 보호 대상이 빠진 것, 많으면 보내지 말 것)
export function buildCleanup(items, population, opts = {}) {
  const c = classify(items);
  const out = [];
  const userTags = userTagsOf(population); // 4-F.5 관측된 사용자 고유 태그 → 박사행 보호 절
  const add = (category, label, list, strict, suffix = "", extra = {}) => { if (!list.length) return; const r = buildGroups(list, population, { ...opts, strict, suffix }); out.push({ category, label, count: list.length, strict, protect: Boolean(suffix), ...extra, ...r }); };
  add("transfer", "❌ 박사행", c.transfer, true, protectSuffix(userTags), { userTags });
  for (const [tg, list] of [...c.tags.entries()].sort((a, b) => (OPTIONAL_TAGS.has(a[0]) ? 1 : 0) - (OPTIONAL_TAGS.has(b[0]) ? 1 : 0) || b[1].length - a[1].length)) add(`tag:${tg}`, `🏷 ${tg}${OPTIONAL_TAGS.has(tg) ? " (선택)" : ""}`, list, false, "", { optional: OPTIONAL_TAGS.has(tg) });
  // 수집: 앱이 아는 개체(100%·0%·반짝반짝·오래 전 포획)는 위 "tag:수집" 묶음, 이로치·배경·XXL 은 게임 검색어(예상 수 없음 — 앱이 모르는 정보)
  out.push({ category: "collect", label: "💎 수집(게임 검색어)", count: 0, strict: false, fixed: true, groups: COLLECT_FIXED_QUERIES.map((q) => ({ query: q.query, label: q.label, expected: null, targetIds: [], withCp: false, overlap: 0 })), skipped: [] });
  return out;
}
