import { NextResponse, after } from "next/server";
import { getServiceClient } from "../../../lib/supabaseServer";
import { rateLimit, clientIp, validDate, validTags } from "../../../lib/deviceAuth";
import { userFromDeviceToken } from "../../../lib/deviceServer";
import { scanKey, findSuperseded } from "../../../lib/pokemonMatch";
import { getFamilyOf } from "../../../lib/savePokemonServer";
import { getPokemonDataset, findPokemon } from "../../../lib/pokemonData";
import { cpConsistentLevel } from "../../../lib/ivCalc";
import { CONFLICT_REASON, planRescanRecovery } from "../../../lib/scanBackfill";
import { fetchActiveScanItems } from "../../../lib/scanQuery";
import { isTrustedVersion } from "../../../lib/appVersion";
import { buildVerdictContext, invalidateReserveCache } from "../../../lib/verdictContext";
import { verdictForItem } from "../../../lib/scanVerdict";

export const dynamic = "force-dynamic";
const isInt = (v) => Number.isInteger(v);
const optInt = (v, a, b) => v == null || (isInt(v) && v >= a && v <= b);

// 4-B 연속 스캔 기록: 앱 → 스캔 항목 1건 (판정은 서버가 계산해 저장). 같은 세션·같은 개체(scan_key)는 갱신(duplicate:true). 자동 저장 없음.
export async function POST(req) {
  const started = Date.now();
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
  if (b.game_tags != null && !validTags(b.game_tags)) errors.push("game_tags 는 1~24자 문자열 최대 8개");
  if (b.recheck_reason != null && !(typeof b.recheck_reason === "string" && b.recheck_reason.length <= 80)) errors.push("recheck_reason 은 80자 이하");
  if (b.app_version != null && !(typeof b.app_version === "string" && /^v?\d+\.\d+(\.\d+)?/.test(b.app_version) && b.app_version.length <= 20)) errors.push("app_version 형식");
  if (errors.length) return NextResponse.json({ error: "필드 검증 실패", details: errors }, { status: 400 });

  const item = {
    user_id: auth.userId, device_id: auth.deviceId, session_id: b.session_id,
    species_id: b.species_id, form: (b.form || "Normal").trim() || "Normal", name_kr: b.name_kr.trim().slice(0, 60),
    cp: b.cp ?? null, hp: b.hp ?? null, atk_iv: anyIv ? b.atk_iv : null, def_iv: anyIv ? b.def_iv : null, sta_iv: anyIv ? b.sta_iv : null,
    level: b.level ?? null, stars: b.stars ?? null, is_shadow: Boolean(b.is_shadow), caught_on: b.caught_on || null, recheck: Boolean(b.recheck), dismissed: false,
    game_tags: Array.isArray(b.game_tags) ? b.game_tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [],
    recheck_reason: b.recheck && typeof b.recheck_reason === "string" && b.recheck_reason.trim() ? b.recheck_reason.trim() : null, // 4-C.4 앱이 보낸 재확인 사유(막대 판독 불일치 등)
    app_version: typeof b.app_version === "string" ? b.app_version.trim().slice(0, 20) : null, // 4-D 기록한 앱 버전(≥0.1.38 신뢰 기록)
    is_purified: Boolean(b.is_purified), // 4-D 스캔 모드 "정화"
  };
  const trustedNew = isTrustedVersion(item.app_version);
  // 4-C.2 A. CP 자리수 누락 방지: 종·개체값·HP 로 가능한 레벨의 CP 와 맞지 않으면 CP 를 null 로 저장 (예: 괴력몬 2634 → 263 오판독)
  let cpRejected = null;
  if (item.cp != null && anyIv) {
    try {
      const dataset = await getPokemonDataset();
      const p = findPokemon(dataset, { id: item.species_id, form: item.form });
      if (p && cpConsistentLevel({ atk: p.baseAttack, def: p.baseDefense, sta: p.baseStamina }, item.cp, item.hp, { atk: item.atk_iv, def: item.def_iv, sta: item.sta_iv }) == null) { cpRejected = item.cp; item.cp = null; }
    } catch (e) { console.warn(`[scan] CP 검증 건너뜀: ${e.message}`); }
  }
  item.scan_key = scanKey(item);
  // 4-B2: 응답은 insert/매칭만(목표 300ms 이하). 판정은 응답 후 after() 에서 계산해 verdict 컬럼에 채운다(웹 조회 시 비어 있으면 그때 계산).
  item.verdict = null;
  let { data: existing } = await sb.from("scan_items").select("id").eq("user_id", auth.userId).eq("session_id", item.session_id).eq("scan_key", item.scan_key).maybeSingle();
  // CP 미확인으로 기록된 같은 개체(같은 세션·종·폼·막대·HP, cp null)를 이후 CP 까지 읽으면 그 기록을 갱신
  let cpFilled = false;
  if (!existing && item.cp != null && anyIv) {
    let q = sb.from("scan_items").select("id").eq("user_id", auth.userId).eq("session_id", item.session_id).eq("species_id", item.species_id).eq("form", item.form)
      .eq("atk_iv", item.atk_iv).eq("def_iv", item.def_iv).eq("sta_iv", item.sta_iv).is("cp", null).eq("is_shadow", item.is_shadow).order("created_at", { ascending: false }).limit(1);
    if (item.hp != null) q = q.eq("hp", item.hp);
    const { data: prev } = await q;
    if (prev?.length) { existing = prev[0]; cpFilled = true; }
  }
  // 4-C 규칙 ③: 강화·진화 후 같은 개체(같은 계열·폼·그림자·개체값, 레벨/CP 비감소)의 과거 기록(다른 세션 포함)을 superseded 로 표시.
  //   과거 후보가 서로 다른 2개 이상이면 대체하지 않고 새 기록에 recheck 표시
  let superseded = 0, recovered = 0;
  if (!existing && anyIv) {
    const fam = await getFamilyOf();
    const famIds = fam ? [...fam(item.species_id)] : [item.species_id];
    const { data: prior } = await sb.from("scan_items").select("id,species_id,form,cp,hp,level,atk_iv,def_iv,sta_iv,is_shadow,session_id,caught_on,app_version").eq("user_id", auth.userId).eq("dismissed", false).eq("superseded", false)
      .in("species_id", famIds).eq("form", item.form).eq("is_shadow", item.is_shadow).eq("atk_iv", item.atk_iv).eq("def_iv", item.def_iv).eq("sta_iv", item.sta_iv).limit(50);
    // 4-D: 신뢰 기록(앱 ≥0.1.38)이 들어오면 같은 종·개체값의 미신뢰 이전 기록은 레벨과 무관하게 대체. 신뢰 기록끼리는 규칙 ③
    const untrusted = trustedNew ? (prior || []).filter((x) => !isTrustedVersion(x.app_version)) : [];
    const r = findSuperseded((prior || []).filter((x) => !untrusted.includes(x)), item, fam);
    if (r.ambiguous) item.recheck = true;
    const ids = [...(r.ambiguous ? [] : r.superseded.map((x) => x.id)), ...untrusted.map((x) => x.id)];
    if (ids.length) item._supersedes = ids;
  }
  // 4-C.3 개체값 충돌: 같은 종·폼·그림자·CP·HP 인데 개체값이 다른 활성 기록이 있으면(막대 오판독 의심) 새 기록과 그 기록 모두 recheck "재스캔 필요"
  let conflictIds = [];
  if (!existing && anyIv && item.cp != null && item.hp != null) {
    const { data: same } = await sb.from("scan_items").select("id,atk_iv,def_iv,sta_iv,app_version").eq("user_id", auth.userId).eq("dismissed", false).eq("superseded", false)
      .eq("species_id", item.species_id).eq("form", item.form).eq("is_shadow", item.is_shadow).eq("cp", item.cp).eq("hp", item.hp).limit(20);
    const diff = (same || []).filter((x) => x.atk_iv !== item.atk_iv || x.def_iv !== item.def_iv || x.sta_iv !== item.sta_iv);
    // 4-D: 새 기록이 신뢰 기록이면 미신뢰(구 앱) 충돌 기록은 대체, 신뢰 기록끼리 충돌할 때만 둘 다 재확인
    const oldOnes = trustedNew ? diff.filter((x) => !isTrustedVersion(x.app_version)) : [];
    conflictIds = diff.filter((x) => !oldOnes.includes(x)).map((x) => x.id);
    if (oldOnes.length) item._supersedes = [...new Set([...(item._supersedes || []), ...oldOnes.map((x) => x.id)])];
    if (conflictIds.length) { item.recheck = true; item.recheck_reason = CONFLICT_REASON; item._supersedes = undefined; }
  }
  // 4-D2: 스캔 모드(그림자/정화) 신뢰 기록은 같은 종·폼·CP·HP·개체값의 "일반 모드" 활성 기록을 대체 (반대 방향 없음)
  //   4-D3: 모드 기록 CP 가 null 이면 종·폼·HP·개체값 일치(CP 무관)로 대체, CP 가 있으면 CP 같거나 없는 일반 기록만
  if (!existing && anyIv && trustedNew && (item.is_shadow || item.is_purified) && item.hp != null) {
    let nq = sb.from("scan_items").select("id,cp").eq("user_id", auth.userId).eq("dismissed", false).eq("superseded", false)
      .eq("species_id", item.species_id).eq("form", item.form).eq("is_shadow", false).eq("is_purified", false).eq("hp", item.hp)
      .eq("atk_iv", item.atk_iv).eq("def_iv", item.def_iv).eq("sta_iv", item.sta_iv).limit(20);
    if (item.cp != null) nq = nq.or(`cp.eq.${item.cp},cp.is.null`);
    const { data: normals } = await nq;
    if (normals?.length) item._supersedes = [...new Set([...(item._supersedes || []), ...normals.map((x) => x.id)])];
  }
  // 4-F.5 B①: 보냄/없음 처리로 숨긴 기록과 같은 개체(종·폼·그림자·개체값, CP·HP 같거나 한쪽 없음)가 다시 스캔되면 그 숨김 기록을 새 기록으로 대체 → 새 기록이 활성으로 복구된 셈
  if (!existing && anyIv) {
    const { data: hidden } = await sb.from("scan_items").select("id,cp,hp,species_id,form,is_shadow,atk_iv,def_iv,sta_iv,dismissed,superseded").eq("user_id", auth.userId).eq("dismissed", true).eq("superseded", false)
      .eq("species_id", item.species_id).eq("form", item.form).eq("is_shadow", item.is_shadow).eq("atk_iv", item.atk_iv).eq("def_iv", item.def_iv).eq("sta_iv", item.sta_iv).limit(20);
    const hit = planRescanRecovery(hidden, item);
    if (hit.length) { item._supersedes = [...new Set([...(item._supersedes || []), ...hit])]; recovered = hit.length; }
  }
  const supersedes = item._supersedes || []; delete item._supersedes;
  let data, error;
  if (existing) ({ data, error } = await sb.from("scan_items").update(item).eq("id", existing.id).select("*").single());
  else ({ data, error } = await sb.from("scan_items").insert(item).select("*").single());
  if (error) return NextResponse.json({ error: `스캔 기록 실패: ${error.message}` }, { status: 500 });
  if (supersedes.length) {
    const { error: e2 } = await sb.from("scan_items").update({ superseded: true, superseded_by: data.id }).eq("user_id", auth.userId).in("id", supersedes);
    if (!e2) superseded = supersedes.length; else console.warn(`[scan] superseded 표시 실패: ${e2.message}`);
  }
  if (conflictIds.length) {
    const { error: e3 } = await sb.from("scan_items").update({ recheck: true, recheck_reason: CONFLICT_REASON }).eq("user_id", auth.userId).in("id", conflictIds);
    if (e3) console.warn(`[scan] 충돌 recheck 표시 실패: ${e3.message}`);
  }
  const ivCandidates = Array.isArray(b.ivCandidates) ? b.ivCandidates.slice(0, 300) : undefined;
  after(async () => {
    try {
      const t0 = Date.now();
      invalidateReserveCache(auth.userId); // 4-F.5 E: 새 기록을 포함한 예비 순위로 계산(캐시 무효). 이후 같은 종 기록이 더 들어오면 웹 조회 시 지문 불일치로 다시 계산
      const { ctx } = await buildVerdictContext(req);
      const v = verdictForItem(data, ctx, ivCandidates);
      await sb.from("scan_items").update({ verdict: v }).eq("id", data.id);
      console.log(`[scan] verdict after-response ${Date.now() - t0}ms ${data.id}`);
    } catch (e) { console.warn(`[scan] 판정 후계산 실패: ${e.message}`); }
  });
  return NextResponse.json({ item: data, duplicate: Boolean(existing) && !cpFilled, cpFilled, superseded, recovered, cpRejected, conflicts: conflictIds.length, ms: Date.now() - started });
}

// 앱 → 세션 스캔 기록 조회 (?session=… 없으면 최근 200)
export async function GET(req) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "서버 Supabase 미설정" }, { status: 503 });
  const auth = await userFromDeviceToken(sb, req);
  if (!auth) return NextResponse.json({ error: "기기 토큰이 없거나 해제되었습니다" }, { status: 401 });
  const session = new URL(req.url).searchParams.get("session");
  try {
    const { items, truncated } = await fetchActiveScanItems(sb, auth.userId); // 4-D: 활성 전부(≤3000)
    return NextResponse.json({ items: session ? items.filter((it) => it.session_id === session) : items, truncated });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
