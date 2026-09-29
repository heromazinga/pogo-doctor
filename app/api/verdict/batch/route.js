import { NextResponse } from "next/server";
import { computeVerdict, inputFromRow } from "../../../lib/verdict.js";
import { buildVerdictContext } from "../../../lib/verdictContext.js";
import { rateLimit, clientIp } from "../../../lib/deviceAuth";

export const dynamic = "force-dynamic";
const MAX = 500;

// POST /api/verdict/batch — 내 목록 일괄 판정 (최대 500건). 인증 필수(웹 세션 또는 기기 토큰).
// 본문: { storageMode?, ids?: [] } — ids 가 없으면 내 목록 전체(최대 500). 개체 비교는 내 목록 전체 기준.
export async function POST(req) {
  const rl = rateLimit(`verdict-batch:${clientIp(req)}`, { limit: 30, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  try {
    const { ctx, meta, user } = await buildVerdictContext(req, { storageMode: body?.storageMode });
    if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
    const ids = Array.isArray(body?.ids) ? new Set(body.ids.map(String)) : null;
    const rows = ctx.myRows.filter((r) => !ids || ids.has(String(r.id))).slice(0, MAX);
    const started = Date.now();
    const verdicts = {};
    for (const r of rows) {
      try { verdicts[r.id] = computeVerdict(inputFromRow(r, ctx.storageMode), ctx); }
      catch (e) { verdicts[r.id] = { tier: "need_appraisal", tags: [], collect: [], confident: false, basis: "server", summary: `계산 실패: ${e.message}`, warnings: [e.message] }; }
    }
    return NextResponse.json({ verdicts, count: rows.length, truncated: ctx.myRows.length > MAX, ms: Date.now() - started, meta });
  } catch (e) {
    console.error(`[verdict/batch] 실패: ${e.message}`);
    return NextResponse.json({ error: `일괄 판정 실패: ${e.message}` }, { status: 500 });
  }
}
