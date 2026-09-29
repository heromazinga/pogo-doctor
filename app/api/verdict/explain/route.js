import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { resolveUser, buildVerdictContext } from "../../../lib/verdictContext";
import { computeVerdict, inputFromRow, leagueProductTable } from "../../../lib/verdict";
import { findPokemon } from "../../../lib/pokemonData";
import { leagueRankOf } from "../../../lib/pvpokeRankings";
import { RULES } from "../../../lib/verdictRules";

export const dynamic = "force-dynamic";

// 4-B6 판정 설명: ?scan=<scan_items.id> 또는 ?row=<my_pokemon.id> → 개체 입력, 리그별 PvPoke 순위·스탯곱 순위·상한 레벨/CP·현재 CP, 후보별 태그. (저승갓숭 하이퍼리그 미판정 조사용)
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const { ctx } = await buildVerdictContext(req);
  let input = null, source = null;
  if (sp.get("scan")) {
    const { data } = await sb.from("scan_items").select("*").eq("user_id", user.userId).eq("id", sp.get("scan")).maybeSingle();
    if (!data) return NextResponse.json({ error: "스캔 항목 없음" }, { status: 404 });
    source = data;
    input = { species_id: data.species_id, form: data.form || "Normal", cp: data.cp, hp: data.hp, level: data.level != null ? Number(data.level) : null, ivs: Number.isInteger(data.atk_iv) ? { atk: data.atk_iv, def: data.def_iv, sta: data.sta_iv } : null, is_shadow: Boolean(data.is_shadow), caught_on: data.caught_on, storageMode: ctx.storageMode };
  } else if (sp.get("row")) {
    const r = (ctx.myRows || []).find((x) => String(x.id) === sp.get("row"));
    if (!r) return NextResponse.json({ error: "내 목록 항목 없음" }, { status: 404 });
    source = r; input = inputFromRow(r, ctx.storageMode);
  } else return NextResponse.json({ error: "scan 또는 row 필요" }, { status: 400 });
  const p = findPokemon(ctx.dataset, { id: input.species_id, form: input.form });
  const v = computeVerdict(input, ctx);
  const leagues = {};
  for (const league of ["great", "ultra", "master"]) {
    const rank = leagueRankOf(ctx.leagueRankings, league, p?.pvpokeId, input.is_shadow);
    const cap = RULES.LEAGUE_CAPS[league];
    let product = null;
    if (p && cap && input.ivs) { const t = leagueProductTable(p, cap, RULES.LEAGUE_MAX_LEVEL); product = t.rank.get(`${input.ivs.atk},${input.ivs.def},${input.ivs.sta}`) || null; }
    leagues[league] = { pvpokeRank: rank?.rank ?? null, pvpokeScore: rank?.score ?? null, cap: cap || null, productRank: product?.rank ?? null, levelAtCap: product?.level ?? null, cpAtCap: product?.cp ?? null, currentCp: input.cp, currentLevelRange: v.levelRange };
  }
  return NextResponse.json({ source, input, species: p ? { id: p.id, nameKr: p.nameKr, pvpokeId: p.pvpokeId, base: [p.baseAttack, p.baseDefense, p.baseStamina] } : null, leagues, verdict: v,
    rules: { LEAGUE_TOP_RANK: RULES.LEAGUE_TOP_RANK, LEAGUE_MID_RANK: RULES.LEAGUE_MID_RANK, LEAGUE_MAIN_PRODUCT_RANK: RULES.LEAGUE_MAIN_PRODUCT_RANK, LEAGUE_HOLD_PRODUCT_RANK: RULES.LEAGUE_HOLD_PRODUCT_RANK, LEAGUE_MID_HOLD_PRODUCT_RANK: RULES.LEAGUE_MID_HOLD_PRODUCT_RANK, RAID_MIN_ATK_IV: RULES.RAID_MIN_ATK_IV, RAID_MAIN_MIN_ATK_IV: RULES.RAID_MAIN_MIN_ATK_IV } });
}
