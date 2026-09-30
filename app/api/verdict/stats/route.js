import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { resolveUser, buildVerdictContext } from "../../../lib/verdictContext";
import { computeVerdict, inputFromRow } from "../../../lib/verdict";
import { verdictForItem } from "../../../lib/scanVerdict";
import { RULES, RULES_VERSION } from "../../../lib/verdictRules";
import { buildReserveRanks } from "../../../lib/reserveRanks";
import { fetchActiveScanItems } from "../../../lib/scanQuery";

export const dynamic = "force-dynamic";

// 4-B6 판정 분포 (수정 전후 비교용). 인증 필수. ?RAID_MIN_ATK_IV=0&RAID_MAIN_MIN_ATK_IV=0 처럼 기준값을 덮어써 "수정 전" 분포를 얻는다.
// 대상: 내 목록(my_pokemon) + 미처리 스캔 기록. 반환 { tiers:{main,hold,transfer,need_appraisal}, holdReasons:{태그명:n}, mainTags:{}, total, override }
// 4-B6.2: LEAGUE_* 도 덮어쓰기 가능 (예: ?LEAGUE_HOLD_PRODUCT_RANK=500&LEAGUE_MID_HOLD_PRODUCT_RANK=100 → 완화 전 분포). 판정은 항상 현재 규칙으로 새로 계산한다(저장값 미사용)
// 4-F: ?BEGINNER_RULES=0 → 초보자 기준(가성비 상위종·레이드 예비·리그 예비) 적용 전 분포. BUDGET_RAID_TOP_RANK·RESERVE_RAID_TOP_N·LEAGUE_RESERVE_PRODUCT_RANK 도 덮어쓰기 가능
const OVERRIDABLE = ["RAID_MIN_ATK_IV", "RAID_MAIN_MIN_ATK_IV", "RAID_TOP_SCORE_PCT", "RAID_MID_SCORE_PCT",
  "LEAGUE_MAIN_PRODUCT_RANK", "LEAGUE_HOLD_PRODUCT_RANK", "LEAGUE_MID_HOLD_PRODUCT_RANK", "LEAGUE_HOLD_PRODUCT_RANK_TIGHT", "LEAGUE_MID_HOLD_PRODUCT_RANK_TIGHT",
  "BEGINNER_RULES", "BUDGET_RAID_TOP_RANK", "RESERVE_RAID_TOP_N", "LEAGUE_RESERVE_PRODUCT_RANK", "LEAGUE_CANDIDATE_PRODUCT_RANK", "LEAGUE_CANDIDATE_SPECIES_RANK"];
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const override = {};
  for (const k of OVERRIDABLE) if (sp.get(k) != null) override[k] = Number(sp.get(k));
  let scans = [], truncated = false;
  try { ({ items: scans, truncated } = await fetchActiveScanItems(sb, user.userId)); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); } // 4-D: 활성 전부(≤3000)
  const { ctx } = await buildVerdictContext(req, { scanItems: scans });
  ctx.rulesOverride = override;
  // 4-F: 예비 순위 상수를 덮어쓰면 보관함 상대 순위도 그 값으로 다시 계산
  if (["RESERVE_RAID_TOP_N", "LEAGUE_RESERVE_PRODUCT_RANK", "RAID_MIN_ATK_IV"].some((k) => override[k] != null)) ctx.reserve = buildReserveRanks(ctx.dataset, ctx.myRows || [], scans, { rules: { ...RULES, ...override } });
  const tiers = { main: 0, hold: 0, transfer: 0, need_appraisal: 0 };
  const holdReasons = {}, mainTags = {};
  const tally = (v) => {
    tiers[v.tier] = (tiers[v.tier] || 0) + 1;
    for (const t of v.tags || []) { if (t.tier === "hold") holdReasons[t.name] = (holdReasons[t.name] || 0) + 1; if (t.tier === "main") mainTags[t.name] = (mainTags[t.name] || 0) + 1; }
  };
  for (const r of ctx.myRows || []) { try { tally(computeVerdict(inputFromRow(r, ctx.storageMode), ctx)); } catch {} }
  for (const it of scans || []) { const v = verdictForItem(it, ctx); if (!v.error) tally(v); }
  return NextResponse.json({ total: (ctx.myRows || []).length + (scans || []).length, rows: (ctx.myRows || []).length, scans: (scans || []).length, truncated, override, rulesVersion: RULES_VERSION, storageMode: ctx.storageMode, tiers, holdReasons, mainTags });
}
