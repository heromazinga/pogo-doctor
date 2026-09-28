import { NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { validatePokemonBody, rateLimit, clientIp } from "../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../lib/deviceServer";

const COLUMNS = "id,species_id,form,name_kr,cp,atk_iv,def_iv,sta_iv,level,fast_move,charged_moves,is_shadow,is_purified,is_shiny,is_lucky,status,purposes,source,memo,created_at,updated_at";

// 앱 → my_pokemon 저장 (source='overlay'). 본문의 user_id/id/source 는 무시하고 서버가 정한다.
export async function POST(req) {
  const rl = rateLimit(`device-pokemon:${clientIp(req)}`, { limit: 120, windowMs: 60 * 1000 });
  if (!rl.ok) return NextResponse.json({ error: "요청이 너무 많습니다" }, { status: 429 });
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다 — 앱에서 다시 연결하세요" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON 본문이 필요합니다" }, { status: 400 }); }
  const v = validatePokemonBody(body);
  if (v.errors.length) return NextResponse.json({ error: "필드 검증 실패", details: v.errors }, { status: 400 });

  const { data, error } = await sb.from("my_pokemon").insert({ ...v.row, user_id: auth.userId }).select(COLUMNS).single();
  if (error) return NextResponse.json({ error: `저장 실패: ${error.message}` }, { status: 500 });
  return NextResponse.json({ row: data });
}

// 앱 → 연결 상태 확인 (토큰 유효성)
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  const { count } = await sb.from("my_pokemon").select("id", { count: "exact", head: true }).eq("user_id", auth.userId);
  return NextResponse.json({ ok: true, deviceId: auth.deviceId, pokemonCount: count ?? null });
}
