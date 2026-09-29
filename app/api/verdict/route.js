import { NextResponse } from "next/server";
import { computeVerdict, validateVerdictInput } from "../../lib/verdict.js";
import { buildVerdictContext } from "../../lib/verdictContext.js";
import { rateLimit, clientIp } from "../../lib/deviceAuth";
import { RULES, TAG, TIER_LABEL } from "../../lib/verdictRules.js";

export const dynamic = "force-dynamic";

// POST /api/verdict — 용도별 보관 판정 (결정적 계산). 인증 선택(웹 세션 또는 기기 토큰): 인증되면 내 목록과 비교
export async function POST(req) {
  const rl = rateLimit(`verdict:${clientIp(req)}`, { limit: 240, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const v = validateVerdictInput(body);
  if (v.errors.length) return NextResponse.json({ error: "입력 검증 실패", details: v.errors }, { status: 400 });
  try {
    const { ctx, meta } = await buildVerdictContext(req, { storageMode: body.storageMode });
    const verdict = computeVerdict({ ...body, form: body.form || "Normal" }, ctx);
    return NextResponse.json({ verdict, meta });
  } catch (e) {
    console.error(`[verdict] 계산 실패: ${e.message}`);
    return NextResponse.json({ error: `판정 계산 실패: ${e.message}` }, { status: 500 });
  }
}

// GET /api/verdict — 기준값·태그 목록 (README 표와 동일 출처)
export async function GET() {
  return NextResponse.json({ rules: RULES, tags: { gym: TAG.gym, great: TAG.great, ultra: TAG.ultra, master: TAG.master }, tierLabel: TIER_LABEL });
}
