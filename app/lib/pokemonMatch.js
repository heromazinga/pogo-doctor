// 4-B 목록 매칭 규칙 (앱 저장 /api/device/pokemon 과 웹 저장 공용, 순수 함수 → 테스트)
//  ① 종(진화 계열 내 변경 허용)·폼·개체값(공/방/HP 셋 다 확정·동일)·포획일(둘 다 있고 동일)
//  ② 종·폼·CP·HP (둘 다 있고 동일)  — 개체값 미확정·포획일 없을 때
//  일치하면 새 행 대신 갱신: CP·HP·레벨·기술·종(계열 내)·플래그를 새 값으로, 사용자가 편집한 memo·tags·status·purposes 는 유지.
const hasIv = (r) => [r.atk_iv, r.def_iv, r.sta_iv].every((v) => Number.isInteger(v));
const sameForm = (a, b) => (a.form || "Normal") === (b.form || "Normal");

// familyOf(speciesId) → Set<number> (진화 계열). 없으면 같은 종만
export function findMatch(rows, incoming, familyOf = null) {
  const fam = familyOf ? familyOf(incoming.species_id) : null;
  const sameFamily = (r) => r.species_id === incoming.species_id || (fam instanceof Set && fam.has(r.species_id));
  const shadowEq = (r) => Boolean(r.is_shadow) === Boolean(incoming.is_shadow);
  // ① 개체값 + 포획일
  if (hasIv(incoming) && incoming.caught_on) {
    const m = (rows || []).find((r) => sameFamily(r) && sameForm(r, incoming) && shadowEq(r) && hasIv(r) && r.atk_iv === incoming.atk_iv && r.def_iv === incoming.def_iv && r.sta_iv === incoming.sta_iv && r.caught_on === incoming.caught_on);
    if (m) return { row: m, rule: "iv+caught_on" };
  }
  // ② CP + HP (같은 종만 — 진화하면 CP 가 바뀌므로 계열 확장 없음)
  if (incoming.cp && incoming.hp) {
    const m = (rows || []).find((r) => r.species_id === incoming.species_id && sameForm(r, incoming) && shadowEq(r) && r.cp === incoming.cp && r.hp === incoming.hp);
    if (m) return { row: m, rule: "cp+hp" };
  }
  return null;
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
