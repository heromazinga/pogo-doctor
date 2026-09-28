// 포켓몬 종족값·기술 데이터를 여러 소스에서 받아 교차검증한 뒤 하나의 데이터셋으로 만든다.
//
// 소스 우선순위
//   1. pokemon-go-api  (종족값·기술·한국어명·타입)
//   2. PvPoke gamemaster (종족값·기술·타입)
//   3. pogoapi.net     (기존 소스, 보조)
//   참고. PokeMiners game master (게임 원본, 분쟁 시 최종 기준 — 서버에서만 사용)
//
// 교차검증 규칙
//   - 값(종족값/타입/기술)은 2개 이상 소스가 일치하면 채택
//   - 전부 다르면 PokeMiners 원본 기준, PokeMiners도 없으면 우선순위가 높은 소스
//   - 불일치는 dataWarnings 로 남기고 서버 로그에 기록
//   - 소스 하나가 실패해도 나머지로 동작

const SIX_HOURS = 6 * 60 * 60 * 1000;

export const SOURCE_DEFS = {
  pokemonGoApi: {
    name: "pokemon-go-api",
    url: "https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json",
    priority: 1,
  },
  pvpoke: {
    name: "pvpoke",
    url: "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json",
    priority: 2,
  },
  pogoapi: {
    name: "pogoapi",
    url: "https://pogoapi.net/api/v1/pokemon_stats.json",
    movesUrl: "https://pogoapi.net/api/v1/current_pokemon_moves.json",
    priority: 3,
  },
  pokeminers: {
    name: "pokeminers",
    url: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
    priority: 4,
    referee: true, // 분쟁 시 최종 기준
  },
};

const SOURCE_ORDER = ["pokemonGoApi", "pvpoke", "pogoapi", "pokeminers"];

// ─── 유틸 ───

const REGIONAL_FORM_MAP = {
  "": "Normal", NORMAL: "Normal",
  ALOLA: "Alola", ALOLAN: "Alola",
  GALARIAN: "Galarian", GALAR: "Galarian",
  HISUIAN: "Hisuian", HISUI: "Hisuian",
  PALDEA: "Paldea", PALDEAN: "Paldea",
};

const SKIP_FORM_RE = /^(SHADOW|PURIFIED|MEGA(_[XY])?|GIGANTAMAX|PRIMAL|COPY_2019|FALL_2019|VS_2019)$/;

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// "RAICHU_ALOLA" + "RAICHU" → "Alola", "PIKACHU_NORMAL" → "Normal", "MEGA" 등은 null(제외)
function formFromSuffix(formId, pokemonId) {
  if (!formId) return "Normal";
  let suffix = formId;
  if (pokemonId && formId.startsWith(pokemonId + "_")) suffix = formId.slice(pokemonId.length + 1);
  else if (pokemonId && formId === pokemonId) suffix = "";
  suffix = suffix.toUpperCase();
  // NIDORAN_NORMAL(pokemonId=NIDORAN_FEMALE) 처럼 접두사가 다른 기본 폼
  if (suffix.endsWith("NORMAL")) suffix = "NORMAL";
  if (SKIP_FORM_RE.test(suffix)) return null;
  if (suffix in REGIONAL_FORM_MAP) return REGIONAL_FORM_MAP[suffix];
  return titleCase(suffix);
}

// pogoapi 의 form 문자열 → 통일 표기
function formFromLabel(label) {
  if (!label) return "Normal";
  const up = String(label).replace(/\s+/g, "_").toUpperCase();
  if (SKIP_FORM_RE.test(up)) return null;
  if (up in REGIONAL_FORM_MAP) return REGIONAL_FORM_MAP[up];
  return titleCase(label);
}

// 기술 이름 비교용 키: "Thunder Shock" / "THUNDER_SHOCK_FAST" / "Mud-Slap" → "thundershock" / "mudslap"
function moveKey(nameOrId) {
  const k = String(nameOrId || "")
    .replace(/_FAST$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // PvPoke 는 잠재파워를 타입별 16개로 펼쳐 놓는다 → 하나로 합침
  if (k.startsWith("hiddenpower")) return "hiddenpower";
  // "Weather Ball (Normal)" / WEATHER_BALL_NORMAL ↔ "Weather Ball" 표기 차이 통일
  if (k === "weatherballnormal") return "weatherball";
  if (k === "technoblastnormal") return "technoblast";
  // PvPoke 는 테크노버스터를 드라이브 이름(Douse/Shock/Burn/Chill)으로, 게임 원본은 타입명으로 부른다
  const techno = { technoblastdouse: "technoblastwater", technoblastshock: "technoblastelectric", technoblastburn: "technoblastfire", technoblastchill: "technoblastice" };
  if (techno[k]) return techno[k];
  return k;
}

function normType(t) {
  if (!t) return null;
  const s = String(typeof t === "object" ? t.type || t.name || "" : t).replace(/^POKEMON_TYPE_/i, "").toLowerCase();
  return s && s !== "none" ? s : null;
}

function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "object") return Object.values(v);
  return [];
}

function dedupe(arr) {
  return [...new Set(arr)];
}

// ─── 소스별 정규화 ───
// 각 소스는 { records: Map<key, record>, moveNames: Map<moveKey, {name, nameKr?}> } 형태로 반환
// record: { key, id, form, name, nameKr, atk, def, sta, types, fast:[moveKey], charged:[moveKey], eliteFast, eliteCharged, hasMoves }

function parsePokemonGoApi(json) {
  const records = new Map();
  const moveNames = new Map();
  if (!Array.isArray(json)) throw new Error("pokedex.json 이 배열이 아님");

  const registerMoves = (moves, out) => {
    for (const m of asList(moves)) {
      if (!m) continue;
      const id = m.id || m.moveId || "";
      const en = m.names?.English || m.name || titleCase(id.replace(/_FAST$/, ""));
      const key = moveKey(id || en);
      if (!key) continue;
      if (!moveNames.has(key)) moveNames.set(key, { name: en, nameKr: m.names?.Korean || null });
      out.push(key);
    }
  };

  const addEntry = (p) => {
    if (!p || !p.dexNr) return;
    const form = formFromSuffix(p.formId || p.id, p.id);
    if (!form) return;
    const key = `${p.dexNr}:${form}`;
    if (records.has(key)) return;
    const fast = [], charged = [], eliteFast = [], eliteCharged = [];
    registerMoves(p.quickMoves, fast);
    registerMoves(p.cinematicMoves, charged);
    registerMoves(p.eliteQuickMoves, eliteFast);
    registerMoves(p.eliteCinematicMoves, eliteCharged);
    records.set(key, {
      key, id: p.dexNr, form,
      name: p.names?.English || titleCase(p.id),
      nameKr: p.names?.Korean || null,
      atk: p.stats?.attack, def: p.stats?.defense, sta: p.stats?.stamina,
      types: [normType(p.primaryType), normType(p.secondaryType)].filter(Boolean),
      fast, charged, eliteFast, eliteCharged,
      hasMoves: fast.length + charged.length > 0,
    });
  };

  for (const p of json) {
    addEntry(p);
    for (const rf of asList(p.regionForms)) addEntry(rf);
  }
  return { records, moveNames };
}

function parsePvpoke(json) {
  const records = new Map();
  const moveNames = new Map();
  if (!json || !Array.isArray(json.pokemon)) throw new Error("gamemaster.json 형식 불일치");

  const moveById = new Map();
  for (const m of json.moves || []) {
    if (!m?.moveId) continue;
    moveById.set(m.moveId, m);
    const key = moveKey(m.moveId);
    if (!moveNames.has(key)) moveNames.set(key, { name: m.name || titleCase(m.moveId) });
  }

  for (const p of json.pokemon) {
    if (!p?.dex || !p.speciesName) continue;
    // "Raichu (Alolan)", "Rattata (Alolan) (Shadow)", "Charizard (Mega X)"
    const labels = [...p.speciesName.matchAll(/\(([^)]+)\)/g)].map((x) => x[1].trim());
    const baseName = p.speciesName.replace(/\s*\([^)]*\)/g, "").trim();
    let form = "Normal";
    if (labels.length) {
      const mapped = labels.map(formFromLabel);
      if (mapped.some((f) => !f)) continue; // Shadow / Mega 등 제외
      form = mapped.join(" ");
    }
    const key = `${p.dex}:${form}`;
    if (records.has(key)) continue;

    const elite = new Set([...(p.eliteMoves || []), ...(p.legacyMoves || [])]);
    const fastAll = (p.fastMoves || []).filter(Boolean);
    const chargedAll = (p.chargedMoves || []).filter(Boolean);
    const fast = fastAll.filter((id) => !elite.has(id)).map(moveKey);
    const eliteFast = fastAll.filter((id) => elite.has(id)).map(moveKey);
    const charged = chargedAll.filter((id) => !elite.has(id)).map(moveKey);
    const eliteCharged = chargedAll.filter((id) => elite.has(id)).map(moveKey);

    records.set(key, {
      key, id: p.dex, form,
      name: baseName, nameKr: null,
      atk: p.baseStats?.atk, def: p.baseStats?.def, sta: p.baseStats?.hp,
      types: (p.types || []).map(normType).filter(Boolean),
      fast, charged, eliteFast, eliteCharged,
      hasMoves: fastAll.length + chargedAll.length > 0,
    });
  }
  return { records, moveNames };
}

function parsePogoapi(statsJson, movesJson) {
  const records = new Map();
  const moveNames = new Map();
  if (!Array.isArray(statsJson)) throw new Error("pokemon_stats.json 이 배열이 아님");
  const moves = Array.isArray(movesJson) ? movesJson : [];

  const movesMap = new Map();
  for (const mv of moves) {
    const form = formFromLabel(mv.form);
    if (!form) continue;
    const key = `${mv.pokemon_id}:${form}`;
    if (!movesMap.has(key)) movesMap.set(key, mv);
  }
  const reg = (names) =>
    (names || []).map((n) => {
      const key = moveKey(n);
      if (key && !moveNames.has(key)) moveNames.set(key, { name: n });
      return key;
    }).filter(Boolean);

  for (const s of statsJson) {
    const form = formFromLabel(s.form);
    if (!form || !s.pokemon_id) continue;
    const key = `${s.pokemon_id}:${form}`;
    if (records.has(key)) continue;
    const mv = movesMap.get(key) || (form === "Normal" ? null : movesMap.get(`${s.pokemon_id}:Normal`)) || {};
    const fast = reg(mv.fast_moves), charged = reg(mv.charged_moves);
    const eliteFast = reg(mv.elite_fast_moves), eliteCharged = reg(mv.elite_charged_moves);
    records.set(key, {
      key, id: s.pokemon_id, form,
      name: s.pokemon_name, nameKr: null,
      atk: s.base_attack, def: s.base_defense, sta: s.base_stamina,
      types: [], // pogoapi stats 파일에는 타입 정보 없음
      fast, charged, eliteFast, eliteCharged,
      hasMoves: fast.length + charged.length > 0,
    });
  }
  return { records, moveNames };
}

function parsePokeminers(json) {
  const records = new Map();
  const moveNames = new Map();
  if (!Array.isArray(json)) throw new Error("game master 가 배열이 아님");

  // 코스튬 폼 목록 (FORMS_ 템플릿의 isCostume)
  const costume = new Set();
  for (const t of json) {
    const fs = t?.data?.formSettings;
    if (!fs?.forms) continue;
    for (const f of fs.forms) if (f?.isCostume && f.form) costume.add(f.form);
  }

  for (const t of json) {
    const tid = t?.templateId || t?.data?.templateId || "";
    const ps = t?.data?.pokemonSettings;
    if (!ps) continue;
    const m = tid.match(/^V(\d{4})_POKEMON_/);
    if (!m) continue;
    const dex = parseInt(m[1], 10);
    const pokemonId = ps.pokemonId;
    const formId = ps.form || "";
    if (formId && costume.has(formId)) continue;
    const form = formFromSuffix(formId, pokemonId);
    if (!form) continue;
    const key = `${dex}:${form}`;
    // 폼이 명시된 템플릿(예: PIKACHU_NORMAL)을 폼 없는 기본 템플릿보다 우선
    if (records.has(key) && !(formId && !records.get(key)._explicitForm)) continue;

    const reg = (ids) => (ids || []).map((id) => {
      const key = moveKey(id);
      if (key && !moveNames.has(key)) moveNames.set(key, { name: titleCase(String(id).replace(/_FAST$/, "")) });
      return key;
    }).filter(Boolean);
    const fast = reg(ps.quickMoves), charged = reg(ps.cinematicMoves);
    const eliteFast = reg(ps.eliteQuickMove), eliteCharged = reg(ps.eliteCinematicMove);
    records.set(key, {
      key, id: dex, form,
      name: titleCase(pokemonId), nameKr: null,
      atk: ps.stats?.baseAttack, def: ps.stats?.baseDefense, sta: ps.stats?.baseStamina,
      types: [normType(ps.type), normType(ps.type2)].filter(Boolean),
      fast, charged, eliteFast, eliteCharged,
      hasMoves: fast.length + charged.length > 0,
      _explicitForm: Boolean(formId),
    });
  }
  return { records, moveNames };
}

// ─── fetch ───

async function fetchJson(url, { timeoutMs = 10000, revalidate, fetchImpl = fetch } = {}) {
  const opts = { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "PoGoDoctor/1.0 (+vercel)" } };
  // 2MB 이하 응답만 Next.js 데이터 캐시 대상. 큰 파일은 no-store 로 두고 모듈 메모리 캐시에 의존.
  if (revalidate) opts.next = { revalidate };
  else opts.cache = "no-store";
  const res = await fetchImpl(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
// 주의: pokemon-go-api pokedex.json 은 약 15MB, PokeMiners latest.json 은 약 20MB 로 Next fetch 캐시(2MB) 대상이 아니다.

function disabledSources() {
  return new Set((process.env.POGO_DISABLE_SOURCES || "").split(",").map((s) => s.trim()).filter(Boolean));
}

async function loadSource(sourceKey, fetchImpl) {
  const def = SOURCE_DEFS[sourceKey];
  const meta = { name: def.name, url: def.url, fetchedAt: new Date().toISOString(), ok: false, count: 0, sizeBytes: 0 };
  if (disabledSources().has(def.name) || disabledSources().has(sourceKey)) {
    meta.error = "POGO_DISABLE_SOURCES 로 비활성화됨";
    return { meta, parsed: null };
  }
  try {
    let parsed;
    if (sourceKey === "pokemonGoApi") {
      parsed = parsePokemonGoApi(await fetchJson(def.url, { fetchImpl, timeoutMs: 12000 }));
    } else if (sourceKey === "pvpoke") {
      parsed = parsePvpoke(await fetchJson(def.url, { fetchImpl, revalidate: 6 * 3600 }));
    } else if (sourceKey === "pogoapi") {
      const [stats, moves] = await Promise.all([
        fetchJson(def.url, { fetchImpl, revalidate: 6 * 3600 }),
        fetchJson(def.movesUrl, { fetchImpl, revalidate: 6 * 3600 }).catch((e) => {
          console.warn(`[pokemonData] pogoapi moves 실패: ${e.message}`);
          return null;
        }),
      ]);
      parsed = parsePogoapi(stats, moves);
    } else if (sourceKey === "pokeminers") {
      parsed = parsePokeminers(await fetchJson(def.url, { fetchImpl, timeoutMs: 20000 }));
    }
    meta.ok = true;
    meta.count = parsed.records.size;
    return { meta, parsed };
  } catch (e) {
    meta.error = e?.message || String(e);
    console.warn(`[pokemonData] ${def.name} 실패: ${meta.error}`);
    return { meta, parsed: null };
  }
}

// ─── 교차검증 ───

function pickValue(values /* [{src, value}] */, refereeName) {
  const valid = values.filter((v) => v.value !== undefined && v.value !== null && v.value !== "");
  if (valid.length === 0) return { value: null, agreed: true };
  const counts = new Map();
  for (const v of valid) {
    const k = JSON.stringify(v.value);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const allSame = counts.size === 1;
  if (allSame) return { value: valid[0].value, agreed: true };
  // 2개 이상 일치하는 값
  let best = null, bestCount = 0;
  for (const [k, c] of counts) if (c > bestCount) { best = k; bestCount = c; }
  if (bestCount >= 2) return { value: JSON.parse(best), agreed: false, by: "majority" };
  // 전부 다르면 PokeMiners 기준
  const ref = valid.find((v) => v.src === refereeName);
  if (ref) return { value: ref.value, agreed: false, by: "referee" };
  return { value: valid[0].value, agreed: false, by: "priority" };
}

function mergeMoves(entries /* [{src, list, elite}] */, refereeName) {
  // entries 는 기술 목록을 제공하는 소스만
  const providers = entries.filter((e) => e.hasMoves);
  if (providers.length === 0) return { regular: [], elite: [], unverified: [], warnings: [] };
  const votes = new Map(); // moveKey → { srcs:Set, eliteVotes:number }
  for (const e of providers) {
    for (const k of e.list) {
      if (!votes.has(k)) votes.set(k, { srcs: new Set(), eliteVotes: 0 });
      votes.get(k).srcs.add(e.src);
    }
    for (const k of e.elite) {
      if (!votes.has(k)) votes.set(k, { srcs: new Set(), eliteVotes: 0 });
      votes.get(k).srcs.add(e.src);
      votes.get(k).eliteVotes += 1;
    }
  }
  const regular = [], elite = [], unverified = [], warnings = [];
  for (const [k, v] of votes) {
    const n = v.srcs.size;
    // 검증됨: 2개 이상 소스 일치, 소스가 하나뿐, 또는 PokeMiners(게임 원본)에 존재
    const verified = n >= 2 || providers.length === 1 || v.srcs.has(refereeName);
    if (!verified) {
      // 1개 소스에만 있는 기술은 버리지 않고 "미검증"으로 노출
      unverified.push(k);
      warnings.push({ move: k, srcs: [...v.srcs], action: "unverified" });
      continue;
    }
    if (n < providers.length && providers.length > 1) warnings.push({ move: k, srcs: [...v.srcs], action: "majority" });
    if (v.eliteVotes * 2 >= n) elite.push(k);
    else regular.push(k);
  }
  return { regular, elite, unverified, warnings };
}

function crossValidate(loaded /* {sourceKey: {meta, parsed}} */) {
  const refereeName = SOURCE_DEFS.pokeminers.name;
  const active = SOURCE_ORDER.filter((k) => loaded[k]?.parsed).map((k) => ({ key: k, name: SOURCE_DEFS[k].name, ...loaded[k].parsed }));

  // 기술 표시명/한국어명 레지스트리 (우선순위: pokemon-go-api → pvpoke → pogoapi → pokeminers)
  const moveRegistry = new Map();
  for (const s of active) {
    for (const [k, v] of s.moveNames) {
      const cur = moveRegistry.get(k);
      if (!cur) moveRegistry.set(k, { name: v.name, nameKr: v.nameKr || null, candidates: [v.name] });
      else {
        if (!cur.nameKr && v.nameKr) cur.nameKr = v.nameKr;
        cur.candidates.push(v.name);
      }
    }
  }
  // 표시명 충돌 해소: pokemon-go-api 는 "Weather Ball (Rock)" 류 변형을 전부 "Weather Ball" 로 부르므로
  // 같은 이름을 쓰는 키가 2개 이상이면 후순위 소스의 구분 가능한 이름(예: PvPoke "Weather Ball (Rock)")을 쓴다
  const nameUse = new Map();
  for (const [k, v] of moveRegistry) nameUse.set(v.name, (nameUse.get(v.name) || 0) + 1);
  for (const [, v] of moveRegistry) {
    if (nameUse.get(v.name) > 1) {
      const alt = v.candidates.find((n) => n !== v.name && !nameUse.has(n));
      if (alt) v.name = alt;
    }
    delete v.candidates;
  }
  const moveDisplay = (k) => moveRegistry.get(k)?.name || k;

  const allKeys = new Set();
  for (const s of active) for (const k of s.records.keys()) allKeys.add(k);

  const pokemon = [];
  const warnings = [];
  // 유형별 집계: stat(종족값 실제 차이) / type(타입 차이) / moveMajority(다수결 채택, 일부 소스 누락) / moveUnverified(1개 소스만 보유)
  const counts = { stat: 0, type: 0, moveMajority: 0, moveUnverified: 0 };
  let statDisputes = 0, moveDisputes = 0, typeDisputes = 0;

  for (const key of allKeys) {
    const recs = active.map((s) => ({ src: s.name, rec: s.records.get(key) })).filter((r) => r.rec);
    const first = recs[0].rec;

    const stat = (field) => {
      const r = pickValue(recs.map((x) => ({ src: x.src, value: x.rec[field] })), refereeName);
      if (!r.agreed) {
        statDisputes++;
        warnings.push(`[stat] ${key} ${first.name} ${field}: ${recs.map((x) => `${x.src}=${x.rec[field]}`).join(", ")} → ${r.value} (${r.by})`);
      }
      return r.value;
    };
    const atk = stat("atk"), def = stat("def"), sta = stat("sta");

    // 타입은 순서와 무관하게 비교(정렬 후 투표)하고, 표기 순서는 채택된 집합을 가진 첫 소스를 따른다
    const typeRecs = recs.filter((x) => x.rec.types.length);
    const typeVote = pickValue(typeRecs.map((x) => ({ src: x.src, value: [...x.rec.types].sort() })), refereeName);
    const typeWinner = typeVote.value ? typeRecs.find((x) => [...x.rec.types].sort().join("/") === typeVote.value.join("/"))?.rec.types : [];
    if (!typeVote.agreed) {
      typeDisputes++;
      warnings.push(`[type] ${key} ${first.name}: ${recs.map((x) => `${x.src}=${x.rec.types.join("/") || "-"}`).join(", ")} → ${(typeWinner || []).join("/")} (${typeVote.by})`);
    }

    const fastM = mergeMoves(recs.map((x) => ({ src: x.src, list: x.rec.fast, elite: x.rec.eliteFast, hasMoves: x.rec.hasMoves })), refereeName);
    const chM = mergeMoves(recs.map((x) => ({ src: x.src, list: x.rec.charged, elite: x.rec.eliteCharged, hasMoves: x.rec.hasMoves })), refereeName);
    for (const w of [...fastM.warnings, ...chM.warnings]) {
      moveDisputes++;
      if (w.action === "unverified") counts.moveUnverified++;
      else counts.moveMajority++;
      warnings.push(`[move:${w.action}] ${key} ${first.name} "${moveDisplay(w.move)}" (있음: ${w.srcs.join(",")})`);
    }

    const nameRec = recs.find((x) => x.rec.name)?.rec;
    const krRec = recs.find((x) => x.rec.nameKr)?.rec;
    const [id, form] = [first.id, first.form];
    pokemon.push({
      id, name: nameRec?.name || first.name, nameKr: krRec?.nameKr || nameRec?.name || first.name, form,
      baseAttack: atk, baseDefense: def, baseStamina: sta,
      types: typeWinner || [],
      fast: fastM.regular.map(moveDisplay), charged: chM.regular.map(moveDisplay),
      eliteFast: fastM.elite.map(moveDisplay), eliteCharged: chM.elite.map(moveDisplay),
      // 1개 소스(PokeMiners 제외)에만 있는 기술 — 게임 반영 미확인
      unverifiedFast: fastM.unverified.map(moveDisplay), unverifiedCharged: chM.unverified.map(moveDisplay),
      sources: recs.map((x) => x.src),
    });
  }
  counts.stat = statDisputes;
  counts.type = typeDisputes;

  pokemon.sort((a, b) => a.id - b.id || (a.form === "Normal" ? -1 : b.form === "Normal" ? 1 : a.form.localeCompare(b.form)));

  const moveNamesKr = {};
  for (const [, v] of moveRegistry) if (v.nameKr) moveNamesKr[v.name] = v.nameKr;

  return { pokemon, moveNamesKr, warnings, counts, disputes: statDisputes + typeDisputes + moveDisputes };
}

// ─── 데이터셋 빌드 + 메모리 캐시 ───

// PokeMiners(약 20MB)는 1~3순위 소스 간 불일치가 있을 때만 조회하고, 파싱 결과를 별도로 오래 캐시한다
const PRIMARY_SOURCES = ["pokemonGoApi", "pvpoke", "pogoapi"];
const pokeminersMemo = { result: null, at: 0 };

async function loadPokeminersCached(fetchImpl) {
  const ttl = Number(process.env.POKEMINERS_TTL_MS) || 24 * 60 * 60 * 1000;
  const disabled = disabledSources().has("pokeminers");
  if (!disabled && pokeminersMemo.result?.parsed && Date.now() - pokeminersMemo.at < ttl) {
    return { ...pokeminersMemo.result, meta: { ...pokeminersMemo.result.meta, cached: true } };
  }
  const result = await loadSource("pokeminers", fetchImpl);
  if (result.parsed) {
    pokeminersMemo.result = result;
    pokeminersMemo.at = Date.now();
  } else if (!disabled && pokeminersMemo.result?.parsed) {
    // 재조회 실패 시 이전 파싱 결과 유지
    return { ...pokeminersMemo.result, meta: { ...pokeminersMemo.result.meta, cached: true, error: result.meta.error } };
  }
  return result;
}

export async function buildDataset({ fetchImpl = fetch } = {}) {
  const startedAt = Date.now();
  const results = await Promise.all(PRIMARY_SOURCES.map((k) => loadSource(k, fetchImpl)));
  const loaded = {};
  PRIMARY_SOURCES.forEach((k, i) => { loaded[k] = results[i]; });

  let cv = crossValidate(loaded);
  const primaryOk = PRIMARY_SOURCES.filter((k) => loaded[k].parsed).length;

  // 불일치가 있거나 정상 소스가 2개 미만이면 PokeMiners 원본으로 재검증
  const needReferee = cv.disputes > 0 || primaryOk < 2;
  if (needReferee) {
    loaded.pokeminers = await loadPokeminersCached(fetchImpl);
    if (loaded.pokeminers.parsed) cv = crossValidate(loaded);
  } else {
    loaded.pokeminers = { meta: { name: SOURCE_DEFS.pokeminers.name, url: SOURCE_DEFS.pokeminers.url, fetchedAt: null, ok: null, skipped: true, count: 0, reason: "1~3순위 소스 불일치 없음 → 조회 생략" }, parsed: null };
  }

  const { pokemon, moveNamesKr, warnings, counts } = cv;
  const dataSources = SOURCE_ORDER.map((k) => loaded[k].meta);
  const okCount = dataSources.filter((s) => s.ok).length;

  const extra = [];
  if (!loaded.pokemonGoApi.parsed) extra.push("[source] pokemon-go-api 실패 → 한국어 이름 미제공(영문 표기)");
  if (okCount < 2) extra.push(`[source] 정상 소스 ${okCount}개 → 교차검증 불가, 단일 소스 값 사용`);
  if (needReferee && !loaded.pokeminers.parsed) extra.push("[source] PokeMiners 조회 실패 → 불일치 항목은 우선순위 소스 값 사용");
  const allWarnings = [...extra, ...warnings];

  if (allWarnings.length) {
    console.warn(`[pokemonData] 경고 ${allWarnings.length}건 (stat ${counts.stat}, type ${counts.type}, move 다수결 ${counts.moveMajority}, move 미검증 ${counts.moveUnverified})`);
    for (const w of allWarnings.slice(0, 200)) console.warn("[pokemonData] " + w);
  }

  return {
    generatedAt: new Date().toISOString(),
    buildMs: Date.now() - startedAt,
    pokemon,
    moveNamesKr,
    dataSources,
    dataWarnings: allWarnings.slice(0, 100),
    dataWarningCount: allWarnings.length,
    dataWarningCounts: counts,
  };
}

const memo = { data: null, builtAt: 0, building: null };

export async function getPokemonDataset({ force = false, fetchImpl } = {}) {
  const ttl = Number(process.env.POKEMON_DATA_TTL_MS) || SIX_HOURS;
  if (!force && memo.data && Date.now() - memo.builtAt < ttl) return memo.data;
  if (memo.building) return memo.building;
  memo.building = buildDataset({ fetchImpl: fetchImpl || fetch })
    .then((d) => {
      if (d.pokemon.length > 0) {
        memo.data = d;
        memo.builtAt = Date.now();
        return d;
      }
      // 전부 실패: 이전 데이터가 있으면 그대로 사용
      if (memo.data) {
        return { ...memo.data, stale: true, dataWarnings: ["[source] 모든 소스 실패 → 이전 캐시 데이터 사용", ...memo.data.dataWarnings] };
      }
      return d;
    })
    .catch((e) => {
      if (memo.data) return { ...memo.data, stale: true };
      throw e;
    })
    .finally(() => { memo.building = null; });
  return memo.building;
}

export function findPokemon(dataset, { id, form, name } = {}) {
  if (!dataset?.pokemon) return null;
  const list = dataset.pokemon;
  if (id) {
    const byForm = form ? list.find((p) => p.id === Number(id) && p.form === form) : null;
    if (byForm) return byForm;
    const normal = list.find((p) => p.id === Number(id) && p.form === "Normal");
    if (normal) return normal;
    const any = list.find((p) => p.id === Number(id));
    if (any) return any;
  }
  if (name) {
    const q = String(name).toLowerCase();
    return list.find((p) => p.form === "Normal" && (p.name.toLowerCase() === q || p.nameKr.toLowerCase() === q)) || null;
  }
  return null;
}
