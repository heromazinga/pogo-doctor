// 서버 전용: my_pokemon 저장 with 4-B 매칭(중복이면 갱신). 앱 저장·스캔 기록 저장 공용
import { findMatch, mergePatch, familyOfFactory } from "./pokemonMatch.js";
import { getPokemonDataset } from "./pokemonData.js";

const COLUMNS = "id,species_id,form,name_kr,cp,hp,atk_iv,def_iv,sta_iv,level,fast_move,charged_moves,is_shadow,is_purified,is_shiny,is_lucky,status,purposes,tags,caught_on,game_tags,source,memo,created_at,updated_at";
const NEW_COLS = ["tags", "hp", "caught_on", "game_tags"];
const isColumnError = (e) => /column|schema cache/i.test(String(e?.message || ""));
const strip = (o) => { const r = { ...o }; for (const k of NEW_COLS) delete r[k]; return r; };

let familyOf = null, familyAt = null;
async function getFamilyOf() {
  try {
    const d = await getPokemonDataset();
    if (!familyOf || familyAt !== d.generatedAt) { familyOf = familyOfFactory(d.pokemon); familyAt = d.generatedAt; }
  } catch { /* 데이터셋 실패 시 같은 종만 매칭 */ }
  return familyOf;
}

// 반환 { row, updated, rule, error }
export async function upsertMyPokemon(sb, userId, incoming) {
  const { data: rows, error: e0 } = await sb.from("my_pokemon").select("*").eq("user_id", userId).limit(2000);
  if (e0) return { row: null, updated: false, error: e0.message };
  const fam = await getFamilyOf();
  const m = findMatch(rows || [], incoming, fam);
  if (m) {
    const patch = mergePatch(m.row, incoming);
    let { data, error } = await sb.from("my_pokemon").update(patch).eq("id", m.row.id).select(COLUMNS).single();
    if (error && isColumnError(error)) ({ data, error } = await sb.from("my_pokemon").update(strip(patch)).eq("id", m.row.id).select(COLUMNS.replace("hp,", "").replace("tags,caught_on,game_tags,", "")).single());
    if (error) return { row: null, updated: false, error: error.message };
    return { row: data, updated: true, rule: m.rule };
  }
  let { data, error } = await sb.from("my_pokemon").insert({ ...incoming, user_id: userId }).select(COLUMNS).single();
  if (error && isColumnError(error)) ({ data, error } = await sb.from("my_pokemon").insert({ ...strip(incoming), user_id: userId }).select(COLUMNS.replace("hp,", "").replace("tags,caught_on,game_tags,", "")).single());
  if (error) return { row: null, updated: false, error: error.message };
  return { row: data, updated: false, rule: null };
}
