// 4-B 목록 매칭 규칙 (앱 저장 /api/device/pokemon 과 웹 저장 공용, 순수 함수 → 테스트)
//  ① 종(진화 계열 내 변경 허용)·폼·개체값(공/방/HP 셋 다 확정·동일)·포획일(둘 다 있고 동일)
//  ② 종·폼·CP·HP (둘 다 있고 동일)  — 개체값 미확정·포획일 없을 때
//  ③ (4-C) 강화·진화 후 갱신: 같은 진화 계열·폼·그림자, 개체값 3개 확정·동일, 새 레벨 ≥ 기존 레벨(레벨이 없으면 CP 로 비교).
//     후보가 2개 이상이면 병합하지 않고 { ambiguous:true, candidates } 를 돌려준다(호출측이 재확인 표시).
//  일치하면 새 행 대신 갱신: CP·HP·레벨·기술·종(계열 내)·플래그를 새 값으로, 사용자가 편집한 memo·tags·status·purposes·game_tags 는 유지.
const hasIv = (r) => [r.atk_iv, r.def_iv, r.sta_iv].every((v) => Number.isInteger(v));
const sameForm = (a, b) => (a.form || "Normal") === (b.form || "Normal");
const sameIv = (a, b) => hasIv(a) && hasIv(b) && a.atk_iv === b.atk_iv && a.def_iv === b.def_iv && a.sta_iv === b.sta_iv;
const caughtCompatible = (a, b) => !a.caught_on || !b.caught_on || a.caught_on === b.caught_on;
// 새 값이 기존 이상인가: 레벨 둘 다 있으면 레벨, 아니면 CP 둘 다 있으면 CP, 둘 다 없으면 비교 불가(null)
export function notDowngraded(existing, incoming) {
  const el = existing.level != null ? Number(existing.level) : null, il = incoming.level != null ? Number(incoming.level) : null;
  if (el != null && il != null) return il >= el;
  if (existing.cp != null && incoming.cp != null) return incoming.cp >= existing.cp;
  return null;
}

// familyOf(speciesId) → Set<number> (진화 계열). 없으면 같은 종만
export function findMatch(rows, incoming, familyOf = null) {
  const fam = familyOf ? familyOf(incoming.species_id) : null;
  const sameFamily = (r) => r.species_id === incoming.species_id || (fam instanceof Set && fam.has(r.species_id));
  const shadowEq = (r) => Boolean(r.is_shadow) === Boolean(incoming.is_shadow);
  // ① 개체값 + 포획일
  if (hasIv(incoming) && incoming.caught_on) {
    const m = (rows || []).find((r) => sameFamily(r) && sameForm(r, incoming) && shadowEq(r) && sameIv(r, incoming) && r.caught_on === incoming.caught_on);
    if (m) return { row: m, rule: "iv+caught_on" };
  }
  // ② CP + HP (같은 종만 — 진화하면 CP 가 바뀌므로 계열 확장 없음)
  if (incoming.cp && incoming.hp) {
    const m = (rows || []).find((r) => r.species_id === incoming.species_id && sameForm(r, incoming) && shadowEq(r) && r.cp === incoming.cp && r.hp === incoming.hp);
    if (m) return { row: m, rule: "cp+hp" };
  }
  // ③ 계열·폼·그림자·개체값 동일 + 강화·진화(레벨/CP 비감소). 포획일이 둘 다 있고 다르면 다른 개체
  if (hasIv(incoming)) {
    const cands = (rows || []).filter((r) => sameFamily(r) && sameForm(r, incoming) && shadowEq(r) && sameIv(r, incoming) && caughtCompatible(r, incoming) && notDowngraded(r, incoming) === true);
    if (cands.length === 1) return { row: cands[0], rule: "iv+level" };
    if (cands.length > 1) return { row: null, rule: "iv+level", ambiguous: true, candidates: cands };
  }
  return null;
}

// 4-C 스캔 기록 대체(superseded): 새 기록과 같은 개체(규칙 ③ 조건)인 과거 기록(다른 세션 포함)을 찾는다.
// 반환 { superseded: [...과거 기록], ambiguous } — 후보가 2개 이상이면 대체하지 않고 ambiguous(호출측이 새 기록에 recheck 표시)
export function findSuperseded(priorItems, incoming, familyOf = null) {
  if (!hasIv(incoming)) return { superseded: [], ambiguous: false };
  const fam = familyOf ? familyOf(incoming.species_id) : null;
  const sameFamily = (r) => r.species_id === incoming.species_id || (fam instanceof Set && fam.has(r.species_id));
  const cands = (priorItems || []).filter((r) => r.id !== incoming.id && sameFamily(r) && sameForm(r, incoming) && Boolean(r.is_shadow) === Boolean(incoming.is_shadow) && sameIv(r, incoming) && caughtCompatible(r, incoming) && notDowngraded(r, incoming) === true);
  // 완전히 같은 값(같은 종·CP·HP·레벨)은 같은 개체의 재기록 → 대체. 서로 다른 과거 기록이 2개 이상이면 구분 불가
  const distinct = new Set(cands.map((r) => `${r.species_id}|${r.cp ?? ""}|${r.hp ?? ""}|${r.level ?? ""}`));
  if (distinct.size > 1) return { superseded: [], ambiguous: true, candidates: cands };
  return { superseded: cands, ambiguous: false };
}

// 갱신 패치: 새 캡처 값으로 덮되 사용자 편집(memo·tags·status·purposes)은 유지. 새 값이 null 이면 기존 유지
export function mergePatch(existing, incoming) {
  const pick = (k) => (incoming[k] === undefined || incoming[k] === null || (Array.isArray(incoming[k]) && !incoming[k].length) ? existing[k] : incoming[k]);
  const patch = {
    species_id: incoming.species_id, form: incoming.form || existing.form || "Normal", name_kr: incoming.name_kr || existing.name_kr,
    cp: pick("cp"), hp: pick("hp"), level: pick("level"),
    atk_iv: hasIv(incoming) ? incoming.atk_iv : existing.atk_iv, def_iv: hasIv(incoming) ? incoming.def_iv : existing.def_iv, sta_iv: hasIv(incoming) ? incoming.sta_iv : existing.sta_iv,
    fast_move: pick("fast_move"), charged_moves: pick("charged_moves"),
    caught_on: pick("caught_on"),
    is_shadow: Boolean(incoming.is_shadow ?? existing.is_shadow), is_purified: Boolean(incoming.is_purified ?? existing.is_purified),
    is_shiny: Boolean(incoming.is_shiny || existing.is_shiny), is_lucky: Boolean(incoming.is_lucky || existing.is_lucky),
  };
  if (incoming.source) patch.source = incoming.source;
  // 4-B6 게임 태그: 새로 읽은 값이 있으면 합집합(사용자가 게임에서 단 태그는 없어지지 않는다고 가정), 없으면 기존 유지
  if (Array.isArray(incoming.game_tags) && incoming.game_tags.length) patch.game_tags = [...new Set([...(existing.game_tags || []), ...incoming.game_tags])].slice(0, 8);
  return patch;
}

// 스캔 기록 중복 키: 같은 개체(종·폼·CP·HP·막대) 재분석·재기록 방지
export function scanKey(x) {
  return [x.species_id, x.form || "Normal", x.cp ?? "", x.hp ?? "", x.atk_iv ?? "", x.def_iv ?? "", x.sta_iv ?? "", x.is_shadow ? 1 : 0].join("|");
}

// 종 목록(evolutions 포함)으로 진화 계열 조회 함수 생성 (서버 데이터셋·웹 allPokemon 공용)
export function familyOfFactory(pokemonList) {
  const byId = new Map(); const parents = new Map();
  for (const p of pokemonList || []) { if (!byId.has(p.id)) byId.set(p.id, p); for (const e of p.evolutions || []) if (!parents.has(e.id)) parents.set(e.id, p.id); }
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const set = new Set([id]);
    let cur = id; for (let i = 0; i < 5 && parents.has(cur); i++) { cur = parents.get(cur); set.add(cur); }
    const stack = [...set];
    while (stack.length) { const x = stack.pop(); for (const e of byId.get(x)?.evolutions || []) if (!set.has(e.id)) { set.add(e.id); stack.push(e.id); } }
    cache.set(id, set); return set;
  };
}
