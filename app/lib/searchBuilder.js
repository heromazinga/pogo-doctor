// 4-B5 정리 도우미: 대상 목록 → 포켓몬GO 검색어 묶음 (게임 조작 없음. 사용자가 붙여넣고 결과 수를 확인한 뒤 직접 선택한다)
// 검색 문법(한국어판, 사용자 확인): "A,B&C,D" = (A 또는 B) 그리고 (C 또는 D) — & 로 나눈 절마다 , 는 OR(CNF). "cp2100-2200" 범위 동작. "(A&B),(C&D)" 불가.
// 형식: "{도감번호 OR 목록}&{hp OR 목록}[&cp범위]" — 이름 대신 도감번호(별명·표기 차이 회피). 예: "700,381&hp154,hp118"
// 교차곱 오선택 방지: 알려진 전체 개체(스캔 기록 + 내 목록)에 대해 검색식이 대상 외 개체를 잡으면 묶음을 쪼갠다(최악의 경우 종별 1식).
//   같은 종·같은 HP 의 비대상 개체는 CP(검증된 값)로 좁히고, 그래도 구분이 안 되면 그 대상은 "안전한 검색식 없음"으로 제외한다.
// 안드로이드 core/SearchBuilder.kt 와 같은 규칙 (단위 테스트로 동일성 유지).
export const DEFAULT_MAX_LEN = 200;
// 예상 수 한계 안내 (박사행 토스트·🧹 패널·앱 목록에 상시 표기)
export const EXPECTED_LIMIT_NOTE = "예상 수는 앱이 아는 개체(스캔 기록 + 내 목록) 기준입니다. 앱이 모르는 같은 종·HP 개체가 게임에 있으면 결과가 더 나옵니다 — 게임 결과 수가 예상과 다르면 보내지 마세요.";

const key = (x) => `${x.species_id}|${x.hp ?? ""}|${x.cp ?? ""}|${x.is_shadow ? 1 : 0}`;

// 검색식이 개체 x 를 잡는가 (도감번호 OR, hp OR, cp 범위 OR 로 판단. 폼·섀도는 검색식에 넣지 않으므로 잡힌다고 본다)
export function matches(query, x) {
  const parts = query.split("&");
  return parts.every((clause) => clause.split(",").some((term) => {
    const t = term.trim();
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
export function buildGroups(targets, population, { maxLen = DEFAULT_MAX_LEN, strict = true } = {}) {
  const targetIds = new Set(targets.map((t) => t.id));
  const usable = [], skipped = [];
  for (const t of targets) {
    if (t.hp == null) { skipped.push({ id: t.id, reason: "HP 없음" }); continue; }
    usable.push(t);
  }
  // 섀도 여부·폼별로 분리(검색식에 섀도·폼 키워드를 쓰지 않으므로 같은 묶음에 섞지 않는다)
  const buckets = new Map();
  for (const t of usable) { const b = `${t.is_shadow ? 1 : 0}|${t.form || "Normal"}`; if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(t); }
  const nonTargets = population.filter((p) => !targetIds.has(p.id));
  const groups = [];
  const overlapOf = (members, withCp) => { const q = buildQuery(members, { withCp }); return nonTargets.filter((p) => matches(q, p)).length; };
  const safe = (members, withCp) => {
    if (withCp && members.some((m) => m.cp == null || !m.cpVerified)) return false;
    const q = buildQuery(members, { withCp });
    if (q.length > maxLen) return false;
    return !nonTargets.some((p) => matches(q, p));
  };
  const fits = (members) => buildQuery(members, { withCp: false }).length <= maxLen;
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => a.species_id - b.species_id || (a.hp ?? 0) - (b.hp ?? 0));
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const withCp = !safe(cur, false) && safe(cur, true);
      const overlap = strict ? 0 : overlapOf(cur, withCp);
      groups.push({ query: buildQuery(cur, { withCp }), expected: cur.length, targetIds: cur.map((m) => m.id), withCp, overlap });
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
export function classify(items) {
  const transfer = [], tags = new Map(), collect = [];
  for (const it of items) {
    const v = it.verdict || {};
    if (Array.isArray(v.collect) && v.collect.length) collect.push(it);
    // 4-B6: 게임 태그가 이미 달린 개체는 박사행 대상에서 제외 (사용자가 용도를 정해 둔 것)
    if (v.tier === "transfer" && !it.recheck && !(v.collect || []).length && !it.is_shiny && !it.is_lucky && !it.legendary && !(it.game_tags || []).length) transfer.push(it);
    if (v.tier === "main" || v.tier === "hold") for (const tg of v.recommendedTags || []) { if (!tags.has(tg)) tags.set(tg, []); tags.get(tg).push(it); }
  }
  return { transfer, tags, collect };
}

// 전체 결과: [{category:"transfer"|"tag:불꽃 레이드"|"collect", label, groups, skipped}]
export function buildCleanup(items, population, opts = {}) {
  const c = classify(items);
  const out = [];
  const add = (category, label, list, strict) => { if (!list.length) return; const r = buildGroups(list, population, { ...opts, strict }); out.push({ category, label, count: list.length, strict, ...r }); };
  add("transfer", "❌ 박사행", c.transfer, true);
  for (const [tg, list] of [...c.tags.entries()].sort((a, b) => b[1].length - a[1].length)) add(`tag:${tg}`, `🏷 ${tg}`, list, false);
  add("collect", "💎 수집 추천(보관)", c.collect, false);
  return out;
}
