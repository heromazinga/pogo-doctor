import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { rateLimit, clientIp, validDate } from "../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../lib/deviceServer";
import { scanKey } from "../../../lib/pokemonMatch";
import { computeVerdict } from "../../../lib/verdict";
import { buildVerdictContext } from "../../../lib/verdictContext";

export const dynamic = "force-dynamic";
const isInt = (v) => Number.isInteger(v);
const optInt = (v, a, b) => v == null || (isInt(v) && v >= a && v <= b);

// 4-B 연속 스캔 기록: 앱 → 스캔 항목 1건 (판정은 서버가 계산해 저장). 같은 세션·같은 개체(scan_key)는 갱신(duplicate:true). 자동 저장 없음.
export async function POST(req) {
  const rl = rateLimit(`device-scan:${clientIp(req)}`, { limit: 300, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const errors = [];
  if (typeof b.session_id !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(b.session_id)) errors.push("session_id 는 4~40자 영숫자");
  if (!isInt(b.species_id) || b.species_id < 1 || b.species_id > 2000) errors.push("species_id");
  if (typeof b.name_kr !== "string" || !b.name_kr.trim()) errors.push("name_kr");
  if (!optInt(b.cp, 10, 9999)) errors.push("cp"); if (!optInt(b.hp, 10, 999)) errors.push("hp");
  const ivs = [b.atk_iv, b.def_iv, b.sta_iv]; const anyIv = ivs.some((v) => v != null);
  if (anyIv && !ivs.every((v) => isInt(v) && v >= 0 && v <= 15)) errors.push("개체값");
  if (b.level != null && !(typeof b.level === "number" && b.level >= 1 && b.level <= 51)) errors.push("level");
  if (!optInt(b.stars, 0, 3)) errors.push("stars");
  if (b.caught_on != null && !validDate(b.caught_on)) errors.push("caught_on");
  if (errors.length) return NextResponse.json({ error: "필드 검증 실패", details: errors }, { status: 400 });

  const item = {
    user_id: auth.userId, device_id: auth.deviceId, session_id: b.session_id,
    species_id: b.species_id, form: (b.form || "Normal").trim() || "Normal", name_kr: b.name_kr.trim().slice(0, 60),
    cp: b.cp ?? null, hp: b.hp ?? null, atk_iv: anyIv ? b.atk_iv : null, def_iv: anyIv ? b.def_iv : null, sta_iv: anyIv ? b.sta_iv : null,
    level: b.level ?? null, stars: b.stars ?? null, is_shadow: Boolean(b.is_shadow), caught_on: b.caught_on || null, recheck: Boolean(b.recheck),
  };
  item.scan_key = scanKey(item);
  // 판정 (기기 토큰 인증 → 내 목록 비교). 기술은 연속 모드에서 읽지 않으므로 "기술 확인 필요" 가 붙는다
  let verdict = null;
  try {
    const { ctx } = await buildVerdictContext(req);
    const v = computeVerdict({ species_id: item.species_id, form: item.form, cp: item.cp, hp: item.hp, level: item.level,
      ivs: anyIv ? { atk: item.atk_iv, def: item.def_iv, sta: item.sta_iv } : null, ivCandidates: Array.isArray(b.ivCandidates) ? b.ivCandidates.slice(0, 300) : undefined,
      is_shadow: item.is_shadow, caught_on: item.caught_on, storageMode: ctx.storageMode }, ctx);
    verdict = { tier: v.tier, summary: v.summary, recommendedTags: v.recommendedTags, purposes: v.purposes, collect: v.collect, event: v.event?.note || null, confident: v.confident, tags: v.tags.map((t) => ({ name: t.name, tier: t.tier, reason: t.reason })) };
  } catch (e) { verdict = { tier: "need_appraisal", summary: `판정 실패: ${e.message}`, recommendedTags: [], purposes: [] }; }
  item.verdict = verdict;
  const { data: existing } = await sb.from("scan_items").select("id").eq("user_id", auth.userId).eq("session_id", item.session_id).eq("scan_key", item.scan_key).maybeSingle();
  let data, error;
  if (existing) ({ data, error } = await sb.from("scan_items").update(item).eq("id", existing.id).select("*").single());
  else ({ data, error } = await sb.from("scan_items").insert(item).select("*").single());
  if (error) return NextResponse.json({ error: `스캔 기록 실패: ${error.message}` }, { status: 500 });
  return NextResponse.json({ item: data, verdict, duplicate: Boolean(existing) });
}

// 앱 → 세션 스캔 기록 조회 (?session=… 없으면 최근 200)
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  const session = new URL(req.url).searchParams.get("session");
  let q = sb.from("scan_items").select("*").eq("user_id", auth.userId).eq("dismissed", false).order("created_at", { ascending: false }).limit(200);
  if (session) q = q.eq("session_id", session);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
