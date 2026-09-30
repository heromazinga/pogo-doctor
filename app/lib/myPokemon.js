"use client";
// 내 포켓몬 목록 (my_pokemon) 클라이언트 CRUD — RLS 로 본인 행만 접근된다
import { getSupabase } from "./supabaseClient";

export const STATUS_LABELS = { keep: "보관", transfer: "박사에게 보낼 예정" };
export const PURPOSE_LABELS = { raid: "레이드", great: "슈퍼리그", ultra: "하이퍼리그", master: "마스터리그" };

const COLUMNS = "id,species_id,form,name_kr,cp,atk_iv,def_iv,sta_iv,level,fast_move,charged_moves,is_shadow,is_purified,is_shiny,is_lucky,status,purposes,tags,hp,caught_on,game_tags,source,memo,created_at,updated_at";
// 마이그레이션 0004(tags/hp/caught_on) 미적용 DB 호환: 컬럼 오류면 구 컬럼으로 재시도
const COLUMNS_LEGACY = COLUMNS.replace("tags,hp,caught_on,game_tags,", "");
const NEW_COLS = ["tags", "hp", "caught_on", "game_tags"];
const isColumnError = (e) => /column|schema cache/i.test(String(e?.message || ""));
const stripNew = (row) => { const r = { ...row }; for (const k of NEW_COLS) delete r[k]; return r; };
export let schemaLegacy = false;

export async function listMyPokemon() {
  const sb = getSupabase();
  if (!sb) return { rows: [], error: "미설정" };
  // 4-F.6: "이미 없음" 으로 숨긴 행(hidden_reason)은 제외. 0012 미적용이면 컬럼 오류 → 필터 없이 재조회
  let { data, error } = await sb.from("my_pokemon").select(COLUMNS).is("hidden_reason", null).order("species_id", { ascending: true }).order("created_at", { ascending: true });
  if (error && isColumnError(error)) ({ data, error } = await sb.from("my_pokemon").select(COLUMNS).order("species_id", { ascending: true }).order("created_at", { ascending: true }));
  if (error && isColumnError(error)) {
    schemaLegacy = true;
    ({ data, error } = await sb.from("my_pokemon").select(COLUMNS_LEGACY).order("species_id", { ascending: true }).order("created_at", { ascending: true }));
  }
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: null, legacy: schemaLegacy };
}

export async function insertMyPokemon(row) {
  const sb = getSupabase();
  if (!sb) return { row: null, error: "미설정" };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { row: null, error: "세션 없음" };
  let { data, error } = await sb.from("my_pokemon").insert({ ...row, user_id: user.id }).select(COLUMNS).single();
  if (error && isColumnError(error)) { schemaLegacy = true; ({ data, error } = await sb.from("my_pokemon").insert({ ...stripNew(row), user_id: user.id }).select(COLUMNS_LEGACY).single()); }
  if (error) return { row: null, error: error.message };
  return { row: data, error: null };
}

export async function updateMyPokemon(id, patch) {
  const sb = getSupabase();
  if (!sb) return { row: null, error: "미설정" };
  let { data, error } = await sb.from("my_pokemon").update(patch).eq("id", id).select(COLUMNS).single();
  if (error && isColumnError(error)) { schemaLegacy = true; ({ data, error } = await sb.from("my_pokemon").update(stripNew(patch)).eq("id", id).select(COLUMNS_LEGACY).single()); }
  if (error) return { row: null, error: error.message };
  return { row: data, error: null };
}

export async function deleteMyPokemon(id) {
  const sb = getSupabase();
  if (!sb) return { error: "미설정" };
  const { error } = await sb.from("my_pokemon").delete().eq("id", id);
  return { error: error ? error.message : null };
}

// 기존 localStorage 보유목록(pogo-collection) 1회 이전. 성공 시 키 이름을 pogo-collection-migrated 로 바꾼다(삭제하지 않음)
export async function migrateLocalCollection() {
  let raw = null;
  try { raw = localStorage.getItem("pogo-collection"); } catch { return { migrated: 0, skipped: true }; }
  if (!raw) return { migrated: 0, skipped: true };
  let items;
  try { items = JSON.parse(raw); } catch { return { migrated: 0, error: "기존 목록 JSON 파싱 실패" }; }
  if (!Array.isArray(items) || items.length === 0) {
    try { localStorage.setItem("pogo-collection-migrated", raw); localStorage.removeItem("pogo-collection"); } catch {}
    return { migrated: 0, skipped: true };
  }
  const sb = getSupabase();
  if (!sb) return { migrated: 0, error: "미설정" };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { migrated: 0, error: "세션 없음" };

  const rows = items.filter((c) => c && c.pokemonId).map((c) => {
    const ivPct = Number(c.ivPercent) || 0;
    // 기존 목록은 개체값 합계(%)만 있고 개별 값이 없을 수 있음 → 개별 값이 있으면 사용, 없으면 null
    const has = (k) => Number.isInteger(c[k]);
    return {
      user_id: user.id,
      species_id: Number(c.pokemonId),
      form: c.form || "Normal",
      name_kr: String(c.name || "").replace(/\s*\(.*\)\s*$/, "") || `#${c.pokemonId}`,
      cp: Number(c.cp) || null,
      atk_iv: has("atkIv") ? c.atkIv : null,
      def_iv: has("defIv") ? c.defIv : null,
      sta_iv: has("staIv") ? c.staIv : null,
      fast_move: c.fastMoveEn || c.fastMove || null,
      charged_moves: (c.chargedMoveEn || c.chargedMove) ? [c.chargedMoveEn || c.chargedMove] : [],
      is_shadow: Boolean(c.isShadow),
      is_shiny: Boolean(c.isShiny),
      status: "keep",
      purposes: [],
      source: "import",
      memo: ivPct && !has("atkIv") ? `가져오기: IV ${ivPct}%` : null, // 개별 개체값이 없으면 합계만 메모로 보존 (verdict 는 버림)
    };
  });
  if (rows.length === 0) return { migrated: 0, skipped: true };
  const { error } = await sb.from("my_pokemon").insert(rows);
  if (error) return { migrated: 0, error: error.message };
  try { localStorage.setItem("pogo-collection-migrated", raw); localStorage.removeItem("pogo-collection"); } catch {}
  return { migrated: rows.length };
}

// 오늘 AI 사용 횟수 (본인 행만 조회 가능)
export async function getTodayUsage(usageDate) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("ai_usage").select("count").eq("usage_date", usageDate).maybeSingle();
  if (error) return null;
  return data?.count ?? 0;
}
