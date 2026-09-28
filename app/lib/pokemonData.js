// 포켓몬 종족값·기술 데이터를 여러 소스에서 받아 교차검증한 뒤 하나의 데이터셋으로 만든다.
//
// 소스 우선순위
//   1. pokemon-go-api  (종족값·기술·한국어명·타입)
//   2. PvPoke gamemaster (종족값·기술·타입)
//   3. pogoapi.net     (기존 소스, 보조)
//   참고. PokeMiners game master (게임 원본. 불일치가 있을 때만 추가 투표용으로 조회, 서버에서만 사용)
//
// 교차검증 규칙
//   - 값(종족값/타입/기술)은 2개 이상 소스가 일치하면 채택
//   - 전부 다르면 PokeMiners 원본 기준, PokeMiners도 없으면 우선순위가 높은 소스
//   - 불일치는 dataWarnings 로 남기고 서버 로그에 기록
//   - 소스 하나가 실패해도 나머지로 동작

import { MOVE_NAMES_KR_MANUAL } from "./moveNamesKrManual.js";

const SIX_HOURS = 6 * 60 * 60 * 1000;

// 기술 한국어명 보조 소스 (투표에는 참여하지 않음): PokeAPI CSV (moves.csv + move_names.csv, language_id 3 = 한국어)
const POKEAPI_CSV = {
  name: "pokeapi-csv",
  movesUrl: "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv",
  namesUrl: "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv",
};

async function fetchText(url, fetchImpl, timeoutMs = 8000) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: 24 * 3600 }, headers: { "User-Agent": "PoGoDoctor/1.0 (+vercel)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// "Weather Ball (Rock)" → "weather-ball", "Mud-Slap" → "mud-slap", "X-Scissor" → "x-scissor"
function pokeapiSlug(en) {
  return String(en || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/'/g, "").trim().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function loadPokeapiKoreanNames(fetchImpl) {
  const meta = { name: POKEAPI_CSV.name, url: POKEAPI_CSV.namesUrl, fetchedAt: new Date().toISOString(), ok: false, count: 0, role: "names" };
  if (disabledSources().has(POKEAPI_CSV.name)) { meta.error = "POGO_DISABLE_SOURCES 로 비활성화됨"; return { meta, slugKr: new Map() }; }
  try {
    const [movesCsv, namesCsv] = await Promise.all([fetchText(POKEAPI_CSV.movesUrl, fetchImpl), fetchText(POKEAPI_CSV.namesUrl, fetchImpl)]);
    const slugById = new Map();
    for (const line of movesCsv.split("\n").slice(1)) {
      const [id, slug] = line.split(",");
      if (id && slug) slugById.set(Number(id), slug.trim());
    }
    const slugKr = new Map();
    for (const line of namesCsv.split("\n").slice(1)) {
      const parts = line.split(",");
      if (parts[1] !== "3") continue; // 3 = 한국어
      const slug = slugById.get(Number(parts[0]));
      const kr = parts.slice(2).join(",").trim();
      if (slug && kr) slugKr.set(slug, kr);
    }
    meta.ok = true;
    meta.count = slugKr.size;
    return { meta, slugKr };
  } catch (e) {
    meta.error = e?.message || String(e);
    console.warn(`[pokemonData] pokeapi-csv 실패: ${meta.error}`);
    return { meta, slugKr: new Map() };
  }
}

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
    hashesUrl: "https://pogoapi.net/api/v1/api_hashes.json",
    priority: 3,
  },
  pokeminers: {
    name: "pokeminers",
    url: "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
    commitsUrl: "https://api.github.com/repos/PokeMiners/game_masters/commits?path=latest/latest.json&per_page=1",
    priority: 4, // 게임 원본이지만 "latest" 가 항상 최신은 아니어서 특별 취급하지 않음 (동률 시 갱신 시각으로 판단)
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
    // PvPoke 는 방패폼 개검의 빠른기술을 AEGISLASH_CHARGE_PSYCHO_CUT 처럼 별도 ID 로 둔다 → 원래 기술로 통일
    .replace(/^AEGISLASH_CHARGE_/i, "")
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

  const moveKinds = new Map();
  const registerMoves = (moves, out, kind) => {
    for (const m of asList(moves)) {
      if (!m) continue;
      const id = m.id || m.moveId || "";
      const en = m.names?.English || m.name || titleCase(id.replace(/_FAST$/, ""));
      const key = moveKey(id || en);
      if (!key) continue;
      if (!moveNames.has(key)) moveNames.set(key, { name: en, nameKr: m.names?.Korean || null });
      if (kind && !moveKinds.has(key)) moveKinds.set(key, kind);
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
    registerMoves(p.quickMoves, fast, "fast");
    registerMoves(p.cinematicMoves, charged, "charged");
    registerMoves(p.eliteQuickMoves, eliteFast, "fast");
    registerMoves(p.eliteCinematicMoves, eliteCharged, "charged");
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
  return { records, moveNames, moveKinds };
}

function parsePvpoke(json) {
  const records = new Map();
  const moveNames = new Map();
  if (!json || !Array.isArray(json.pokemon)) throw new Error("gamemaster.json 형식 불일치");

  const moveKinds = new Map();
  const moveStats = new Map(); // PvP 수치(위력·쿨다운 ms) — PokeMiners PvE 수치가 없을 때 폴백
  for (const m of json.moves || []) {
    if (!m?.moveId) continue;
    const key = moveKey(m.moveId);
    if (!moveNames.has(key)) moveNames.set(key, { name: (m.name || titleCase(m.moveId)).replace(/^Aegislash Charge\s+/i, "") });
    // 빠른기술은 에너지를 얻고(energyGain>0), 차징기술은 에너지를 쓴다(energy>0)
    const kind = (m.energyGain || 0) > 0 || (m.energy || 0) === 0 ? "fast" : "charged";
    if (!moveKinds.has(key)) moveKinds.set(key, kind);
    if (!moveStats.has(key) && typeof m.power === "number" && m.cooldown) {
      moveStats.set(key, { type: normType(m.type), kind, power: m.power, durationMs: m.cooldown, energy: kind === "fast" ? m.energyGain || 0 : m.energy || 0 });
    }
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
      released: typeof p.released === "boolean" ? p.released : null, // PvPoke 출시 여부
    });
  }
  return { records, moveNames, moveKinds, moveStats };
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

  // 기술 템플릿: 숫자 ID → 기술 ID 매핑 (일부 포켓몬은 cinematicMoves 에 497 같은 숫자로 들어 있음), 빠른/차징 종류, PvE 수치
  const moveIdByNumber = new Map();
  const moveKinds = new Map();
  const moveStats = new Map(); // moveKey → { type, kind, power, durationMs, energy }
  for (const t of json) {
    const mt = String(t?.templateId || "").match(/^V(\d{4})_MOVE_(.+)$/);
    if (!mt) continue;
    moveIdByNumber.set(Number(mt[1]), mt[2]);
    const kind = /_FAST$/.test(mt[2]) ? "fast" : "charged";
    moveKinds.set(moveKey(mt[2]), kind);
    const ms = t?.data?.moveSettings;
    if (ms && typeof ms.power === "number" && ms.durationMs) {
      moveStats.set(moveKey(mt[2]), { type: normType(ms.pokemonType), kind, power: ms.power, durationMs: ms.durationMs, energy: Math.abs(ms.energyDelta || 0) });
    }
  }
  // 폼 체인지(융합·왕관 등)로만 얻는 전용기: pokemonSettings.formChange[].moveReassignment → 대상 폼(availableForm)의 전용기
  const reassignByForm = new Map(); // formId → { fast:Set, charged:Set }
  for (const t of json) {
    const ps = t?.data?.pokemonSettings;
    for (const fc of ps?.formChange || []) {
      const mr = fc?.moveReassignment;
      if (!mr) continue;
      for (const formId of fc.availableForm || []) {
        if (!reassignByForm.has(formId)) reassignByForm.set(formId, { fast: new Set(), charged: new Set() });
        const slot = reassignByForm.get(formId);
        for (const r of mr.cinematicMoves || []) for (const m of r?.replacementMoves || []) slot.charged.add(m);
        for (const r of mr.quickMoves || []) for (const m of r?.replacementMoves || []) slot.fast.add(m);
      }
    }
  }
  let unresolvedNumeric = 0;
  const resolveMove = (id) => {
    if (typeof id === "number" || /^\d+$/.test(String(id))) {
      const name = moveIdByNumber.get(Number(id));
      if (!name) { unresolvedNumeric++; return null; } // 매핑 실패한 숫자 ID 는 제외
      return name;
    }
    return id;
  };

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

    const reg = (ids) => (ids || []).map(resolveMove).filter(Boolean).map((id) => {
      const key = moveKey(id);
      if (key && !moveNames.has(key)) moveNames.set(key, { name: titleCase(String(id).replace(/_FAST$/, "")) });
      return key;
    }).filter(Boolean);
    const fast = reg(ps.quickMoves), charged = reg(ps.cinematicMoves);
    // 레거시(대단한 기술머신 필요)
    const eliteFast = reg(ps.eliteQuickMove);
    const eliteCharged = reg(ps.eliteCinematicMove);
    // 전용기: nonTmCinematicMoves(메테오나이트 등 아이템으로만 습득) + 폼 체인지 moveReassignment(융합·왕관 등)
    const reassign = reassignByForm.get(formId) || reassignByForm.get(pokemonId) || { fast: new Set(), charged: new Set() };
    const signatureFast = reg([...reassign.fast]);
    const signatureCharged = dedupe([...reg(ps.nonTmCinematicMoves), ...reg([...reassign.charged])]);
    records.set(key, {
      key, id: dex, form,
      name: titleCase(pokemonId), nameKr: null,
      atk: ps.stats?.baseAttack, def: ps.stats?.baseDefense, sta: ps.stats?.baseStamina,
      types: [normType(ps.type), normType(ps.type2)].filter(Boolean),
      fast, charged, eliteFast, eliteCharged, signatureFast, signatureCharged,
      hasMoves: fast.length + charged.length > 0,
      _explicitForm: Boolean(formId),
    });
  }
  if (unresolvedNumeric) console.warn(`[pokemonData] pokeminers: 이름을 찾지 못한 숫자 기술 ID ${unresolvedNumeric}건 제외`);
  return { records, moveNames, moveKinds, moveStats };
}

// ─── fetch ───

async function fetchJson(url, { timeoutMs = 10000, revalidate, fetchImpl = fetch } = {}) {
  const opts = { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "PoGoDoctor/1.0 (+vercel)", Accept: "application/json" } };
  // 2MB 이하 응답만 Next.js 데이터 캐시 대상. 큰 파일은 no-store 로 두고 모듈 메모리 캐시에 의존.
  if (revalidate) opts.next = { revalidate };
  else opts.cache = "no-store";
  const res = await fetchImpl(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // 소스 갱신 시각 판단용 Last-Modified (없으면 null)
  const lm = typeof res.headers?.get === "function" ? res.headers.get("last-modified") : null;
  const lastModified = lm && !isNaN(Date.parse(lm)) ? new Date(lm).toISOString() : null;
  return { json, lastModified };
}

// 소스 갱신 시각: 값이 동률일 때 "가장 최근 갱신된 소스" 를 고르는 기준
function toIso(v) {
  if (!v) return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
// 주의: pokemon-go-api pokedex.json 은 약 15MB, PokeMiners latest.json 은 약 20MB 로 Next fetch 캐시(2MB) 대상이 아니다.

function disabledSources() {
  return new Set((process.env.POGO_DISABLE_SOURCES || "").split(",").map((s) => s.trim()).filter(Boolean));
}

async function loadSource(sourceKey, fetchImpl) {
  const def = SOURCE_DEFS[sourceKey];
  // updatedAt: 소스 데이터의 갱신 시각, updatedAtFrom: 그 근거 (timestamp 필드 / api_hashes / Last-Modified / 없음)
  const meta = { name: def.name, url: def.url, fetchedAt: new Date().toISOString(), ok: false, count: 0, updatedAt: null, updatedAtFrom: null };
  if (disabledSources().has(def.name) || disabledSources().has(sourceKey)) {
    meta.error = "POGO_DISABLE_SOURCES 로 비활성화됨";
    return { meta, parsed: null };
  }
  const setUpdated = (iso, from) => { if (iso && !meta.updatedAt) { meta.updatedAt = iso; meta.updatedAtFrom = from; } };
  try {
    let parsed;
    if (sourceKey === "pokemonGoApi") {
      const r = await fetchJson(def.url, { fetchImpl, timeoutMs: 12000 });
      parsed = parsePokemonGoApi(r.json);
      setUpdated(r.lastModified, "Last-Modified");
    } else if (sourceKey === "pvpoke") {
      const r = await fetchJson(def.url, { fetchImpl, revalidate: 6 * 3600 });
      parsed = parsePvpoke(r.json);
      // PvPoke timestamp 는 "YYYY-MM-DD HH:mm:ss" 로 시간대 표기가 없다(빌드 서버 로컬 시각). UTC 로 간주해 저장하되 표기해 둔다.
      setUpdated(toIso(String(r.json?.timestamp || "").replace(" ", "T") + (/(Z|[+-]\d\d:?\d\d)$/.test(String(r.json?.timestamp || "")) ? "" : "Z")), "gamemaster.timestamp (시간대 미표기)");
      if (meta.updatedAt && !r.lastModified) meta.updatedAtTzUnknown = true;
      setUpdated(r.lastModified, "Last-Modified");
    } else if (sourceKey === "pogoapi") {
      const [stats, moves, hashes] = await Promise.all([
        fetchJson(def.url, { fetchImpl, revalidate: 6 * 3600 }),
        fetchJson(def.movesUrl, { fetchImpl, revalidate: 6 * 3600 }).catch((e) => {
          console.warn(`[pokemonData] pogoapi moves 실패: ${e.message}`);
          return null;
        }),
        fetchJson(def.hashesUrl, { fetchImpl, revalidate: 6 * 3600 }).catch(() => null),
      ]);
      parsed = parsePogoapi(stats.json, moves?.json);
      // api_hashes.json: { "pokemon_stats.json": { last_modified: "2026-..." } }
      setUpdated(toIso(hashes?.json?.["pokemon_stats.json"]?.last_modified), "api_hashes.last_modified");
      setUpdated(stats.lastModified, "Last-Modified");
    } else if (sourceKey === "pokeminers") {
      // raw.githubusercontent 는 Last-Modified 를 주지 않으므로 GitHub commits API 로 최신 커밋 시각을 보완 (무인증 60회/시간, 24h 캐시로 충분)
      const [r, commits] = await Promise.all([
        fetchJson(def.url, { fetchImpl, timeoutMs: 20000 }),
        fetchJson(def.commitsUrl, { fetchImpl, timeoutMs: 8000, revalidate: 6 * 3600 }).catch((e) => {
          console.warn(`[pokemonData] pokeminers commits API 실패: ${e.message}`);
          return null;
        }),
      ]);
      parsed = parsePokeminers(r.json);
      const c = Array.isArray(commits?.json) ? commits.json[0] : null;
      setUpdated(toIso(c?.commit?.committer?.date || c?.commit?.author?.date), "GitHub commits API");
      setUpdated(r.lastModified, "Last-Modified");
    }
    meta.ok = true;
    meta.count = parsed.records.size;
    if (!meta.updatedAt) meta.updatedAtFrom = "unknown";
    return { meta, parsed };
  } catch (e) {
    meta.error = e?.message || String(e);
    console.warn(`[pokemonData] ${def.name} 실패: ${meta.error}`);
    return { meta, parsed: null };
  }
}

// ─── 교차검증 ───

// 규칙: 2개 이상 일치하는 값 채택(다수결). 최다 득표가 동률이거나 전부 다르면 가장 최근 갱신된 소스의 값.
// updatedAtOf(srcName) → epoch ms (알 수 없으면 0)
function pickValue(values /* [{src, value}] */, updatedAtOf) {
  const valid = values.filter((v) => v.value !== undefined && v.value !== null && v.value !== "");
  if (valid.length === 0) return { value: null, agreed: true };
  const groups = new Map(); // JSON → { value, srcs }
  for (const v of valid) {
    const k = JSON.stringify(v.value);
    if (!groups.has(k)) groups.set(k, { value: v.value, srcs: [] });
    groups.get(k).srcs.push(v.src);
  }
  if (groups.size === 1) return { value: valid[0].value, agreed: true };
  const ranked = [...groups.values()]
    .map((g) => ({ ...g, count: g.srcs.length, newest: Math.max(...g.srcs.map((s) => updatedAtOf(s) || 0)) }))
    .sort((a, b) => b.count - a.count || b.newest - a.newest);
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].count === top.count;
  if (top.count >= 2 && !tie) return { value: top.value, agreed: false, by: "majority" };
  return { value: top.value, agreed: false, by: top.newest ? "newest" : "priority" };
}

function mergeMoves(entries /* [{src, list, elite}] */) {
  // entries 는 기술 목록을 제공하는 소스만
  const providers = entries.filter((e) => e.hasMoves);
  if (providers.length === 0) return { regular: [], elite: [], signature: [], unverified: [], unverifiedElite: [], warnings: [] };
  const votes = new Map(); // moveKey → { srcs:Set, eliteVotes:number, signatureVotes:number }
  const add = (k, src, field) => {
    if (!votes.has(k)) votes.set(k, { srcs: new Set(), eliteVotes: 0, signatureVotes: 0 });
    votes.get(k).srcs.add(src);
    if (field) votes.get(k)[field] += 1;
  };
  for (const e of providers) {
    for (const k of e.list) add(k, e.src, null);
    for (const k of e.elite) add(k, e.src, "eliteVotes");
    for (const k of e.signature || []) add(k, e.src, "signatureVotes");
  }
  const regular = [], elite = [], signature = [], unverified = [], unverifiedElite = [], warnings = [];
  for (const [k, v] of votes) {
    const n = v.srcs.size;
    // 검증됨: 2개 이상 소스 일치(또는 기술 목록을 주는 소스가 하나뿐)
    const verified = n >= 2 || providers.length === 1;
    if (!verified) {
      // 1개 소스에만 있는 기술은 버리지 않고 "미검증"으로 노출 (미출시로 판단하지 않는다).
      // 그 소스가 한정기(elite/전용)로 표시했으면 "한정기(미검증)" 로 구분
      (v.eliteVotes + v.signatureVotes > 0 ? unverifiedElite : unverified).push(k);
      warnings.push({ move: k, srcs: [...v.srcs], action: "unverified" });
      continue;
    }
    if (n < providers.length && providers.length > 1) warnings.push({ move: k, srcs: [...v.srcs], action: "majority" });
    // 분류: 전용기(아이템·폼체인지 전용, 게임 원본 필드로만 판별) > 레거시(대단한 기술머신) > 일반
    if (v.signatureVotes > 0) signature.push(k);
    else if (v.eliteVotes * 2 >= n) elite.push(k);
    else regular.push(k);
  }
  return { regular, elite, signature, unverified, unverifiedElite, warnings };
}

// 갱신 시각이 SOURCE_STALE_DAYS(기본 60일) 이상 지난 소스는 투표에서 제외한다. 갱신 시각을 모르는 소스는 판단 불가 → 제외하지 않음.
function staleDays() {
  const n = Number(process.env.SOURCE_STALE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 60;
}
function markStale(meta) {
  if (!meta?.ok || !meta.updatedAt) { if (meta) meta.stale = false; return; }
  const ageDays = (Date.now() - Date.parse(meta.updatedAt)) / 86400000;
  meta.ageDays = Math.round(ageDays);
  meta.stale = ageDays >= staleDays();
}

// 미출시 포켓몬의 자리표시 기술: SPLASH(빠른) / STRUGGLE(차징) 만 있으면 미출시로 본다
const PLACEHOLDER_MOVES = new Set(["splash", "struggle"]);
function isPlaceholderOnly(fastM, chM) {
  const all = [...fastM.regular, ...fastM.elite, ...fastM.signature, ...fastM.unverified, ...fastM.unverifiedElite,
    ...chM.regular, ...chM.elite, ...chM.signature, ...chM.unverified, ...chM.unverifiedElite];
  return all.length > 0 && all.every((k) => PLACEHOLDER_MOVES.has(k));
}

function crossValidate(loaded /* {sourceKey: {meta, parsed}} */) {
  for (const k of SOURCE_ORDER) markStale(loaded[k]?.meta);
  let usable = SOURCE_ORDER.filter((k) => loaded[k]?.parsed && !loaded[k].meta.stale);
  const excluded = SOURCE_ORDER.filter((k) => loaded[k]?.parsed && loaded[k].meta.stale).map((k) => SOURCE_DEFS[k].name);
  // 투표 가능한 소스가 하나도 없으면 오래된 소스라도 사용(서비스 중단 방지)
  const fallbackToStale = usable.length === 0 && excluded.length > 0;
  if (fallbackToStale) usable = SOURCE_ORDER.filter((k) => loaded[k]?.parsed);
  const active = usable.map((k) => ({ key: k, name: SOURCE_DEFS[k].name, ...loaded[k].parsed }));
  const updatedMs = {};
  for (const k of SOURCE_ORDER) {
    const iso = loaded[k]?.meta?.updatedAt;
    updatedMs[SOURCE_DEFS[k].name] = iso ? Date.parse(iso) || 0 : 0;
  }
  const updatedAtOf = (srcName) => updatedMs[srcName] || 0;

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

  // 기술 수치: PokeMiners(PvE) 우선, 없으면 PvPoke(PvP) — 화력 점수 계산용
  const statsByKey = new Map();
  for (const name of ["pokeminers", "pvpoke"]) {
    const s = active.find((x) => x.name === name);
    for (const [k, v] of s?.moveStats || []) if (!statsByKey.has(k)) statsByKey.set(k, { ...v, source: name });
  }

  // 기술 종류(빠른/차징) 전역 판정: 소스별 목록 위치가 아니라 기술 자체의 종류를 다수결로 정한다
  const kindVotes = new Map();
  for (const s of active) {
    for (const [k, kind] of s.moveKinds || []) {
      if (!kindVotes.has(k)) kindVotes.set(k, { fast: 0, charged: 0 });
      kindVotes.get(k)[kind]++;
    }
  }
  const kindOf = (k, fallback) => {
    const v = kindVotes.get(k);
    if (!v || v.fast === v.charged) return fallback;
    return v.fast > v.charged ? "fast" : "charged";
  };
  // 소스 레코드의 fast/charged/elite 목록을 전역 종류 기준으로 재배치
  const normalizeLists = (rec) => {
    const out = { Fast: [], Charged: [], eliteFast: [], eliteCharged: [], signatureFast: [], signatureCharged: [] };
    const place = (list, fallback, tier) => {
      for (const k of list || []) {
        const kind = kindOf(k, fallback);
        out[tier + (kind === "fast" ? "Fast" : "Charged")].push(k);
      }
    };
    place(rec.fast, "fast", ""); place(rec.charged, "charged", "");
    place(rec.eliteFast, "fast", "elite"); place(rec.eliteCharged, "charged", "elite");
    place(rec.signatureFast, "fast", "signature"); place(rec.signatureCharged, "charged", "signature");
    // tier "" 는 키 이름이 "Fast"/"Charged" 가 되므로 정리
    return {
      ...rec,
      fast: dedupe(out.Fast), charged: dedupe(out.Charged),
      eliteFast: dedupe(out.eliteFast), eliteCharged: dedupe(out.eliteCharged),
      signatureFast: dedupe(out.signatureFast), signatureCharged: dedupe(out.signatureCharged),
    };
  };

  const allKeys = new Set();
  for (const s of active) for (const k of s.records.keys()) allKeys.add(k);

  const pokemon = [];
  const warnings = [];
  // 유형별 집계: stat(종족값 실제 차이) / type(타입 차이) / moveMajority(다수결 채택, 일부 소스 누락) / moveUnverified(1개 소스만 보유)
  const counts = { stat: 0, type: 0, moveMajority: 0, moveUnverified: 0 };
  let statDisputes = 0, moveDisputes = 0, typeDisputes = 0;

  for (const key of allKeys) {
    const recs = active.map((s) => ({ src: s.name, rec: s.records.get(key) })).filter((r) => r.rec).map((r) => ({ src: r.src, rec: normalizeLists(r.rec) }));
    const first = recs[0].rec;

    const stat = (field) => {
      const r = pickValue(recs.map((x) => ({ src: x.src, value: x.rec[field] })), updatedAtOf);
      if (!r.agreed) {
        statDisputes++;
        warnings.push(`[stat] ${key} ${first.name} ${field}: ${recs.map((x) => `${x.src}=${x.rec[field]}`).join(", ")} → ${r.value} (${r.by})`);
      }
      return r.value;
    };
    const atk = stat("atk"), def = stat("def"), sta = stat("sta");

    // 타입은 순서와 무관하게 비교(정렬 후 투표)하고, 표기 순서는 채택된 집합을 가진 첫 소스를 따른다
    const typeRecs = recs.filter((x) => x.rec.types.length);
    const typeVote = pickValue(typeRecs.map((x) => ({ src: x.src, value: [...x.rec.types].sort() })), updatedAtOf);
    const typeWinner = typeVote.value ? typeRecs.find((x) => [...x.rec.types].sort().join("/") === typeVote.value.join("/"))?.rec.types : [];
    if (!typeVote.agreed) {
      typeDisputes++;
      warnings.push(`[type] ${key} ${first.name}: ${recs.map((x) => `${x.src}=${x.rec.types.join("/") || "-"}`).join(", ")} → ${(typeWinner || []).join("/")} (${typeVote.by})`);
    }

    const fastM = mergeMoves(recs.map((x) => ({ src: x.src, list: x.rec.fast, elite: x.rec.eliteFast, signature: x.rec.signatureFast, hasMoves: x.rec.hasMoves })));
    const chM = mergeMoves(recs.map((x) => ({ src: x.src, list: x.rec.charged, elite: x.rec.eliteCharged, signature: x.rec.signatureCharged, hasMoves: x.rec.hasMoves })));
    for (const w of [...fastM.warnings, ...chM.warnings]) {
      moveDisputes++;
      if (w.action === "unverified") counts.moveUnverified++;
      else counts.moveMajority++;
      warnings.push(`[move:${w.action}] ${key} ${first.name} "${moveDisplay(w.move)}" (있음: ${w.srcs.join(",")})`);
    }

    const nameRec = recs.find((x) => x.rec.name)?.rec;
    const krRec = recs.find((x) => x.rec.nameKr)?.rec;
    const releasedRec = recs.find((x) => typeof x.rec.released === "boolean");
    const [id, form] = [first.id, first.form];
    pokemon.push({
      id, name: nameRec?.name || first.name, nameKr: krRec?.nameKr || nameRec?.name || first.name, form,
      baseAttack: atk, baseDefense: def, baseStamina: sta,
      types: typeWinner || [],
      fast: fastM.regular.map(moveDisplay), charged: chM.regular.map(moveDisplay),
      // 레거시: 대단한 기술머신 필요
      eliteFast: fastM.elite.map(moveDisplay), eliteCharged: chM.elite.map(moveDisplay),
      // 전용기: 아이템(메테오나이트 등)·폼 체인지(융합·왕관)로만 습득, 기술머신 불가
      signatureFast: fastM.signature.map(moveDisplay), signatureCharged: chM.signature.map(moveDisplay),
      // 교차검증 소스 1개 — 미출시라는 뜻은 아님
      unverifiedFast: fastM.unverified.map(moveDisplay), unverifiedCharged: chM.unverified.map(moveDisplay),
      // 한정기(미검증): 1개 소스만 보고했고 그 소스가 한정기/전용기로 표시 (예: PvPoke 만 가진 Roar of Time)
      unverifiedEliteFast: fastM.unverifiedElite.map(moveDisplay), unverifiedEliteCharged: chM.unverifiedElite.map(moveDisplay),
      // 출시 여부: PvPoke released 가 있으면 그 값. 없으면 기술이 자리표시(Splash/Struggle)뿐인 경우만 false, 그 외 null(출시 미확인)
      released: releasedRec ? releasedRec.rec.released : (isPlaceholderOnly(fastM, chM) ? false : null),
      sources: recs.map((x) => x.src),
    });
  }
  counts.stat = statDisputes;
  counts.type = typeDisputes;

  pokemon.sort((a, b) => a.id - b.id || (a.form === "Normal" ? -1 : b.form === "Normal" ? 1 : a.form.localeCompare(b.form)));

  const moveNamesKr = {};
  const moveNamesAll = []; // 한국어명 보완 대상 파악용 (영문 표시명 전체)
  const moveStats = {}; // 표시명 → { type, kind, power, durationMs, energy, source }
  for (const [k, v] of moveRegistry) {
    moveNamesAll.push(v.name);
    if (v.nameKr) moveNamesKr[v.name] = v.nameKr;
    const st = statsByKey.get(k);
    if (st) moveStats[v.name] = st;
  }

  return {
    pokemon, moveNamesKr, moveNamesAll, moveStats, warnings, counts,
    disputes: statDisputes + typeDisputes + moveDisputes,
    votableCount: fallbackToStale ? 0 : active.length,
    excludedStale: excluded,
    fallbackToStale,
  };
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

  // 불일치가 있거나 정상 소스가 2개 미만이면 PokeMiners 를 추가 투표 소스로 조회
  const needReferee = cv.disputes > 0 || primaryOk < 2 || cv.votableCount < 2;
  if (needReferee) {
    loaded.pokeminers = await loadPokeminersCached(fetchImpl);
    if (loaded.pokeminers.parsed) cv = crossValidate(loaded);
  } else {
    loaded.pokeminers = { meta: { name: SOURCE_DEFS.pokeminers.name, url: SOURCE_DEFS.pokeminers.url, fetchedAt: null, ok: null, skipped: true, count: 0, reason: "1~3순위 소스 불일치 없음 → 조회 생략" }, parsed: null };
  }

  const { pokemon, moveNamesKr, moveNamesAll, moveStats, warnings, counts, votableCount, excludedStale, fallbackToStale } = cv;
  const dataSources = SOURCE_ORDER.map((k) => loaded[k].meta);

  // 기술 한국어명 보완: pokemon-go-api → PokeAPI CSV → 수동 매핑. 그래도 없으면 목록에 남긴다.
  const missingBefore = moveNamesAll.filter((en) => !moveNamesKr[en]);
  const pokeapi = missingBefore.length ? await loadPokeapiKoreanNames(fetchImpl) : { meta: { name: POKEAPI_CSV.name, ok: null, skipped: true, role: "names", count: 0, reason: "누락 없음 → 조회 생략" }, slugKr: new Map() };
  // GO 전용 변형("Aura Wheel Dark", "Hydro Pump Blastoise", "Weather Ball (Rock)")은 기본 기술명으로 찾고 접미사를 붙인다
  const TYPE_KR = { normal: "노말", fire: "불꽃", water: "물", electric: "전기", grass: "풀", ice: "얼음", fighting: "격투", poison: "독", ground: "땅", flying: "비행", psychic: "에스퍼", bug: "벌레", rock: "바위", ghost: "고스트", dragon: "드래곤", dark: "악", steel: "강철", fairy: "페어리" };
  const lookupKr = (en) => {
    const direct = pokeapi.slugKr.get(pokeapiSlug(en)) || pokeapi.slugKr.get(pokeapiSlug(en).replace(/^vise-/, "vice-"));
    if (direct) return direct;
    const paren = en.match(/^(.*?)\s*\((.+)\)\s*$/);
    const words = paren ? [paren[1], paren[2]] : null;
    // "Aura Wheel Dark" → base "Aura Wheel" + suffix "Dark" / "Water Gun Fast Blastoise" → base "Water Gun" + suffix "Blastoise"
    const parts = en.replace(/\bFast\b/g, "").trim().split(/\s+/);
    for (let cut = parts.length - 1; cut >= 1; cut--) {
      const base = words ? words[0] : parts.slice(0, cut).join(" ");
      const suffix = words ? words[1] : parts.slice(cut).join(" ");
      const kr = pokeapi.slugKr.get(pokeapiSlug(base));
      if (kr) return `${kr}(${TYPE_KR[suffix.toLowerCase()] || suffix})`;
      if (words) break;
    }
    return null;
  };
  let filledByPokeapi = 0, filledByManual = 0;
  for (const en of missingBefore) {
    if (MOVE_NAMES_KR_MANUAL[en]) { moveNamesKr[en] = MOVE_NAMES_KR_MANUAL[en]; filledByManual++; continue; }
    const kr = lookupKr(en);
    if (kr) { moveNamesKr[en] = kr; filledByPokeapi++; }
  }
  const moveNamesKrMissing = moveNamesAll.filter((en) => !moveNamesKr[en]).sort();
  const nameSources = [pokeapi.meta, { name: "manual", ok: true, role: "names", count: Object.keys(MOVE_NAMES_KR_MANUAL).length }];
  if (missingBefore.length) console.warn(`[pokemonData] 기술 한국어명 누락 ${missingBefore.length}건 → PokeAPI ${filledByPokeapi}건, 수동 매핑 ${filledByManual}건 보완, 잔여 ${moveNamesKrMissing.length}건${moveNamesKrMissing.length ? ": " + moveNamesKrMissing.join(", ") : ""}`);
  const okCount = dataSources.filter((s) => s.ok).length;

  const extra = [];
  if (!loaded.pokemonGoApi.parsed) extra.push("[source] pokemon-go-api 실패 → 한국어 이름 미제공(영문 표기)");
  if (excludedStale.length) extra.push(`[source] 갱신 ${staleDays()}일 이상 경과로 투표 제외: ${excludedStale.join(", ")}`);
  if (fallbackToStale) extra.push("[source] 투표 가능 소스 0개 → 오래된 소스 값을 임시 사용");
  else if (votableCount < 2) extra.push(`[source] 투표 가능 소스 ${votableCount}개 → 교차검증 불가, 단일 소스 값 사용`);
  else if (okCount < 2) extra.push(`[source] 정상 소스 ${okCount}개 → 교차검증 불가, 단일 소스 값 사용`);
  if (needReferee && !loaded.pokeminers.parsed) extra.push("[source] PokeMiners 조회 실패 → 불일치 항목은 다수결·최신 갱신 소스 기준으로만 판단");
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
    moveNamesKrMissing,
    moveStats,
    nameSources,
    dataSources,
    dataWarnings: allWarnings.slice(0, 100),
    dataWarningCount: allWarnings.length,
    dataWarningCounts: counts,
    votableCount,
    staleDays: staleDays(),
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
