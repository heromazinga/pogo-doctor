"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { ensureAnonymousSession, authHeader, supabaseConfigured } from "./lib/supabaseClient";
import { listMyPokemon, insertMyPokemon, updateMyPokemon, deleteMyPokemon, migrateLocalCollection, getTodayUsage, STATUS_LABELS, PURPOSE_LABELS } from "./lib/myPokemon";
import { usageDate } from "./lib/aiUsage";
import { getAccountState, requestLinkEmail, verifyLinkEmail, snapshotAnonymousRows, requestSignInEmail, verifySignInEmail, mergeRowsIntoCurrent, signOutAccount, loginWithAppCode } from "./lib/account";
import { listDevices, revokeDevice, listDebugLogs, debugImageUrl, deleteDebugLog } from "./lib/devices";
import { TIER_LABEL, RULES, purposesFromTags } from "./lib/verdictRules";
import { findMatch, mergePatch, familyOfFactory } from "./lib/pokemonMatch";

// 4-A 보관함 여유 설정 (기기 로컬 저장, 판정 API 에 전달)
const STORAGE_MODE_LABELS = { relaxed: "여유", normal: "보통", tight: "빠듯" };
const TIER_COLORS = { main: "#4ecdc4", hold: "#ffd93d", transfer: "#ff6b6b", need_appraisal: "#a890f0" };

// 이메일 계정 연결 UI 는 기본 숨김 (Supabase 기본 발송은 템플릿 수정 불가·발송 제약 → 사용 안 함). 코드는 유지.
const EMAIL_LINK_ENABLED = process.env.NEXT_PUBLIC_ENABLE_EMAIL_LINK === "true";

// my_pokemon 행 → 화면/AI 용 항목 (판정은 저장하지 않으므로 없음)
function toEntry(r) {
  const ivs = [r.atk_iv, r.def_iv, r.sta_iv];
  const raw = { id: r.id, species_id: r.species_id, form: r.form, name_kr: r.name_kr, cp: r.cp, atk_iv: r.atk_iv, def_iv: r.def_iv, sta_iv: r.sta_iv, level: r.level, fast_move: r.fast_move, charged_moves: r.charged_moves || [], is_shadow: !!r.is_shadow, is_purified: !!r.is_purified, is_shiny: !!r.is_shiny, is_lucky: !!r.is_lucky, status: r.status, purposes: r.purposes || [], tags: r.tags || [], hp: r.hp ?? null, caught_on: r.caught_on || null, game_tags: r.game_tags || [], source: r.source, memo: r.memo, created_at: r.created_at, updated_at: r.updated_at };
  const hasIv = ivs.every((v) => Number.isInteger(v));
  return {
    id: r.id, pokemonId: r.species_id, form: r.form || "Normal",
    name: (r.name_kr || `#${r.species_id}`) + (r.form && r.form !== "Normal" ? ` (${r.form})` : ""),
    nameKr: r.name_kr, cp: r.cp || 0,
    atkIv: r.atk_iv, defIv: r.def_iv, staIv: r.sta_iv,
    ivPercent: hasIv ? Math.round(((r.atk_iv + r.def_iv + r.sta_iv) / 45) * 100) : null,
    fastMove: r.fast_move || "", chargedMove: (r.charged_moves || [])[0] || "",
    isShiny: !!r.is_shiny, isShadow: !!r.is_shadow, isPurified: !!r.is_purified, isLucky: !!r.is_lucky,
    status: r.status || "keep", purposes: r.purposes || [], tags: r.tags || [], memo: r.memo || "", source: r.source || "web",
    raw,
  };
}

export default function Home() {
  const [allPokemon, setAllPokemon] = useState([]);
  const [moveNamesKr, setMoveNamesKr] = useState({});
  const [pokemonName, setPokemonName] = useState("");
  const [selectedPokemon, setSelectedPokemon] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const [cp, setCp] = useState("");
  const [atkIv, setAtkIv] = useState(15);
  const [defIv, setDefIv] = useState(15);
  const [staIv, setStaIv] = useState(15);
  const [fastMove, setFastMove] = useState("");
  const [chargedMove, setChargedMove] = useState("");
  const [isShiny, setIsShiny] = useState(false);
  const [isShadow, setIsShadow] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── 내 포켓몬 목록 (Supabase my_pokemon) ───
  const [collection, setCollection] = useState([]);
  const [showCollection, setShowCollection] = useState(false);
  const [currentKept, setCurrentKept] = useState(false);
  const [usedModel, setUsedModel] = useState("");
  const [session, setSession] = useState(null);
  const [sessionNotice, setSessionNotice] = useState(null);
  // ─── 3-0 계정 연결 ───
  const [account, setAccount] = useState(null); // { email, anonymous }
  const [showAccount, setShowAccount] = useState(false);
  const [acct, setAcct] = useState({ mode: null, email: "", code: "", step: "email", busy: false, error: null, info: null }); // mode: "link" | "signin"
  const [pendingMerge, setPendingMerge] = useState(null); // { rows } 로그인 전 익명 목록 스냅샷
  // ─── 3-0 보완: 기기 연결 (코드 → 앱 토큰) ───
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState([]);
  const [pairCode, setPairCode] = useState(null); // { code, expiresAt }
  const [devError, setDevError] = useState(null);
  const [devBusy, setDevBusy] = useState(false);
  // 3-1c: 앱 코드로 로그인(계정 복구) · 디버그 캡처
  const [appCode, setAppCode] = useState("");
  const [appLoginInfo, setAppLoginInfo] = useState(null);
  const [appMerge, setAppMerge] = useState(null); // 로그인 전 익명 목록 스냅샷 (합칠지 질문)
  const [showDebug, setShowDebug] = useState(false);
  const [debugRows, setDebugRows] = useState([]);
  const [debugUrls, setDebugUrls] = useState({});
  const [debugError, setDebugError] = useState(null);
  const [usageCount, setUsageCount] = useState(null);
  const [saveOpts, setSaveOpts] = useState({ open: false, status: "keep", purposes: [], tags: [], memo: "" });
  const [saving, setSaving] = useState(false);
  const [collError, setCollError] = useState(null);
  const [collStatusFilter, setCollStatusFilter] = useState("all");
  const [collPurposeFilter, setCollPurposeFilter] = useState("all");
  // 4-A 판정 (저장하지 않고 볼 때마다 서버 계산)
  const [verdicts, setVerdicts] = useState({}); // id → verdict
  const [verdictMeta, setVerdictMeta] = useState(null);
  const [verdictLoading, setVerdictLoading] = useState(false);
  const [collTierFilter, setCollTierFilter] = useState("all");
  const [collTagFilter, setCollTagFilter] = useState("all");
  const [storageMode, setStorageMode] = useState("normal");
  const [analysisVerdict, setAnalysisVerdict] = useState(null); // 분석 화면 판정 { verdict, meta } | { error }
  const [inApp, setInApp] = useState(false); // 앱 내 WebView(UA PogoDoctorApp): 코드 발급·앱 코드 로그인·이메일 UI 숨김
  // 4-B: 스캔 기록 패널, 저장 시 기존 항목 갱신 안내
  const [showScans, setShowScans] = useState(false);
  const [scans, setScans] = useState([]);
  const [scanSessions, setScanSessions] = useState([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  // 4-B5 정리 도우미
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleanup, setCleanup] = useState(null); // { categories, names, population }
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupError, setCleanupError] = useState(null);
  const [cleanupDone, setCleanupDone] = useState({}); // query → true
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(null); // { id, status, purposes, memo }
  const [thinking, setThinking] = useState(false); // 첫 텍스트 도착 전(모델 thinking 구간)
  const [pendingReanalyze, setPendingReanalyze] = useState(false);
  const [ivMissing, setIvMissing] = useState(false); // 이전된 항목 등 개체값이 없는 경우: 입력 전 분석 금지
  const [fallbackNotice, setFallbackNotice] = useState(null); // 폴백 모델로 답한 경우 안내

  // ─── 2단계: 내 목록 기반 팀 추천 (서버 결정적 계산, AI 는 코멘트만) ───
  const [teamResult, setTeamResult] = useState(null); // /api/team 응답 (mode raid|rocket)
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState(null);
  const [doctorComment, setDoctorComment] = useState(null); // 🧠 박사 코멘트 (AI, 버튼 시 1회)
  const [doctorModel, setDoctorModel] = useState("");
  const [rocketLineups, setRocketLineups] = useState(null); // /api/rocket-lineups
  const [rocketError, setRocketError] = useState(null);
  const [rocketLoading, setRocketLoading] = useState(false);
  const [selectedLineup, setSelectedLineup] = useState(null);

  // ─── 데이터 기준 시각 / 소스 상태 (서버 교차검증 메타) ───
  const [dataMeta, setDataMeta] = useState(null);
  const [analysisMeta, setAnalysisMeta] = useState(null);

  // ─── Streaming ───
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);
  const resultRef = useRef(null);

  // ─── Tab / Mode ───
  const [activeTab, setActiveTab] = useState("analyze"); // "analyze" | "raid" | "events"

  // ─── Raid counter ───
  const [raidBossName, setRaidBossName] = useState("");
  const [raidSelectedPoke, setRaidSelectedPoke] = useState(null);
  const [raidSuggestions, setRaidSuggestions] = useState([]);
  const [showRaidSugg, setShowRaidSugg] = useState(false);
  const [raidResult, setRaidResult] = useState(null);
  const [raidModel, setRaidModel] = useState("");

  // ─── Current raid bosses (raw from API) ───
  const [currentRaidBosses, setCurrentRaidBosses] = useState([]);
  const [raidBossesLoading, setRaidBossesLoading] = useState(false);
  const [raidBossesExpanded, setRaidBossesExpanded] = useState(false);

  // ─── Raid bosses enriched with Korean names ───
  const [enrichedRaidBosses, setEnrichedRaidBosses] = useState([]);

  // ─── 외부 소스 장애 안내 (해당 기능만 비활성화, 나머지는 정상 동작) ───
  const [raidBossesError, setRaidBossesError] = useState(null);
  const [eventsError, setEventsError] = useState(null);
  const [maxBattlesError, setMaxBattlesError] = useState(null);
  const pokeapiDownRef = useRef(false); // PokeAPI 한국어 기술명 폴백이 죽었으면 더 이상 호출하지 않음

  // ─── Events ───
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false); // 진행중 접기
  const [upcomingExpanded, setUpcomingExpanded] = useState(false); // 예정 접기
  const [maxBattlesExpanded, setMaxBattlesExpanded] = useState(false); // 맥스배틀 접기

  // ─── Max Battles ───
  const [maxBattles, setMaxBattles] = useState([]);
  const [maxBattlesLoading, setMaxBattlesLoading] = useState(false);
  const [maxBattleResult, setMaxBattleResult] = useState(null);
  const [maxBattleModel, setMaxBattleModel] = useState("");
  const [selectedMaxBoss, setSelectedMaxBoss] = useState(null);

  // ─── Compare ───
  const [showCompare, setShowCompare] = useState(false);
  const [compareTarget, setCompareTarget] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [compareModel, setCompareModel] = useState("");

  // 개체값을 하나라도 입력하면 "미입력" 상태 해제
  const setAtkIvU = (v) => { setIvMissing(false); setAtkIv(v); };
  const setDefIvU = (v) => { setIvMissing(false); setDefIv(v); };
  const setStaIvU = (v) => { setIvMissing(false); setStaIv(v); };
  const ivPercent = Math.round(((atkIv + defIv + staIv) / 45) * 100);
  const getIvColor = () => ivPercent >= 93 ? "#4ecdc4" : ivPercent >= 82 ? "#ffd93d" : "#ff6b6b";
  const getIvLabel = () => ivPercent >= 98 ? "거의 완벽!" : ivPercent >= 93 ? "매우 우수" : ivPercent >= 82 ? "괜찮음" : ivPercent >= 67 ? "보통" : "별로";

  const getPvpTag = () => {
    if (atkIv <= 3 && defIv >= 13 && staIv >= 13) return { text: "🏆 PvP 최적 (그레이트/울트라)", color: "#a890f0" };
    if (atkIv <= 7 && defIv >= 11 && staIv >= 11) return { text: "👍 PvP 적합", color: "#7c8db5" };
    if (atkIv >= 14 && defIv >= 14 && staIv >= 14) return { text: "⚔️ 레이드/마스터리그 최적", color: "#ff9f43" };
    if (atkIv >= 13) return { text: "⚔️ PvE 우선", color: "#8899aa" };
    return null;
  };

  const krMove = (engName) => moveNamesKr[engName] || engName;

  // 개체값 미입력 항목을 위쪽에 모으고, 그 안에서는 도감번호순
  const filteredCollection = collection
    .filter((item) =>
      (collStatusFilter === "all" || item.status === collStatusFilter) &&
      (collPurposeFilter === "all" || (item.purposes || []).includes(collPurposeFilter)) &&
      (collTierFilter === "all" || (verdicts[item.id]?.tier || "none") === collTierFilter) &&
      (collTagFilter === "all" || (item.tags || []).includes(collTagFilter) || (verdicts[item.id]?.recommendedTags || []).includes(collTagFilter))
    )
    .sort((a, b) => (a.ivPercent === null ? 0 : 1) - (b.ivPercent === null ? 0 : 1) || a.pokemonId - b.pokemonId);
  const ivMissingCount = collection.filter((i) => i.ivPercent === null).length;

  // AI 에 넘기는 내 포켓몬 목록 (verdict 없음, status·purposes 전달)
  const collectionForAI = () => collection.map((c) => ({ name: c.name, pokemonId: c.pokemonId, cp: c.cp, ivPercent: c.ivPercent, status: c.status, purposes: c.purposes, isShiny: c.isShiny, isShadow: c.isShadow }));

  const reloadCollection = async () => {
    const { rows, error, legacy } = await listMyPokemon();
    if (error && error !== "미설정") setCollError(`목록 불러오기 실패: ${error}`);
    else { setCollError(legacy ? "마이그레이션 0004 미적용: 태그·HP 컬럼 없이 동작 중 (Supabase SQL Editor 에서 supabase/migrations/0004_verdict_tags.sql 실행)" : null); setCollection(rows.map(toEntry)); }
  };

  // ─── 4-A 판정: 내 목록 일괄 (POST /api/verdict/batch) ───
  const loadVerdicts = async (mode = storageMode) => {
    if (!session) return;
    setVerdictLoading(true);
    try {
      const res = await fetch("/api/verdict/batch", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ storageMode: mode }) });
      const data = await res.json();
      if (!res.ok) { setCollError(`판정 실패: ${data.error || res.status}`); return; }
      setVerdicts(data.verdicts || {}); setVerdictMeta({ ...data.meta, ms: data.ms, count: data.count });
    } catch (e) { setCollError(`판정 요청 오류: ${e.message}`); }
    finally { setVerdictLoading(false); }
  };
  const changeStorageMode = (m) => { setStorageMode(m); try { localStorage.setItem("pogo-storage-mode", m); } catch {} loadVerdicts(m); };
  useEffect(() => { try { const m = localStorage.getItem("pogo-storage-mode"); if (m && RULES.STORAGE_HOLD_LIMIT[m] !== undefined) setStorageMode(m); } catch {} try { setInApp(/PogoDoctorApp/.test(navigator.userAgent)); } catch {} }, []);
  useEffect(() => { if (showCollection && session) loadVerdicts(); }, [showCollection, session, collection.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 분석 화면 판정 (POST /api/verdict) — Gemini 는 코멘트만
  const fetchAnalysisVerdict = async () => {
    if (!selectedPokemon) { setAnalysisVerdict(null); return; }
    setAnalysisVerdict({ loading: true });
    try {
      const body = { species_id: selectedPokemon.id, form: selectedPokemon.form || "Normal", cp: parseInt(cp) || null, ivs: { atk: atkIv, def: defIv, sta: staIv }, fast_move: fastMove || null, charged_moves: chargedMove ? [chargedMove] : [], is_shadow: isShadow, is_shiny: isShiny, storageMode };
      const res = await fetch("/api/verdict", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setAnalysisVerdict({ error: data.error || `HTTP ${res.status}` }); return; }
      setAnalysisVerdict({ verdict: data.verdict, meta: data.meta });
      setSaveOpts((o) => ({ ...o, tags: data.verdict.recommendedTags || [], status: data.verdict.tier === "transfer" ? "transfer" : "keep" }));
    } catch (e) { setAnalysisVerdict({ error: e.message }); }
  };
  // 목록 항목: 추천 태그로 저장 (status keep + tags + 파생 purposes)
  const applyRecommended = async (item) => {
    const v = verdicts[item.id]; if (!v) return;
    const tags = v.recommendedTags || [];
    const { row, error } = await updateMyPokemon(item.id, { status: v.tier === "transfer" ? "transfer" : "keep", tags, purposes: purposesFromTags(tags) });
    if (error) { setCollError(`저장 실패: ${error}`); return; }
    setCollection((prev) => prev.map((e) => (e.id === row.id ? toEntry(row) : e)));
  };
  const toggleTag = (list, t) => (list.includes(t) ? list.filter((x) => x !== t) : list.length < 8 ? [...list, t] : list);

  // ─── 4-B 스캔 기록 (연속 스캔, 앱이 서버에 기록. 저장은 여기서 사용자가 확정) ───
  const loadScans = async () => {
    if (!session) return;
    setScanBusy(true); setScanError(null);
    try {
      const res = await fetch("/api/scan", { headers: { ...(await authHeader()) } });
      const data = await res.json();
      if (!res.ok) { setScanError(data.error || `HTTP ${res.status}`); return; }
      setScans(data.items || []); setScanSessions(data.sessions || []);
    } catch (e) { setScanError(e.message); } finally { setScanBusy(false); }
  };
  const scanAction = async (action, ids, extra = {}) => {
    setScanBusy(true); setScanError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ action, ids, ...extra }) });
      const data = await res.json();
      if (!res.ok) { setScanError(data.error || `HTTP ${res.status}`); return; }
      if (action === "save") {
        const upd = (data.results || []).filter((r) => r.updated).length, err = (data.results || []).filter((r) => r.error).length;
        setSaveNotice(`스캔 ${(data.results || []).length - err}건 저장 (기존 항목 갱신 ${upd}건${err ? `, 실패 ${err}건` : ""})`);
        await reloadCollection();
      }
      await loadScans();
    } catch (e) { setScanError(e.message); } finally { setScanBusy(false); }
  };
  const openScans = async () => { setShowScans(true); await loadScans(); };
  const loadCleanup = async () => {
    if (!session) return;
    setCleanupBusy(true); setCleanupError(null);
    try {
      const res = await fetch("/api/cleanup", { headers: { ...(await authHeader()) } });
      const data = await res.json();
      if (!res.ok) { setCleanupError(data.error || `HTTP ${res.status}`); return; }
      setCleanup(data);
    } catch (e) { setCleanupError(e.message); } finally { setCleanupBusy(false); }
  };
  const openCleanup = async () => { setShowCleanup(true); await loadCleanup(); };
  const copyQuery = async (g) => {
    try { await navigator.clipboard.writeText(g.query); setCopied(g.query); } catch { setCleanupError("클립보드 복사 실패 — 검색어를 직접 선택해 복사하세요"); }
  };
  const cleanupGroupDone = async (cat, g) => {
    const isTransfer = cat.category === "transfer";
    const rows = g.targetIds.filter((x) => x.startsWith("row:")).length;
    const msg = isTransfer ? `이 묶음 ${g.expected}마리를 게임에서 박사에게 보냈습니까? 스캔 기록을 정리하고${rows ? ` 내 목록 ${rows}건을 삭제합니다` : ""}. 계속할까요?` : `이 묶음 ${g.expected}마리에 게임에서 태그를 달았습니까? 스캔 기록을 정리합니다(내 목록은 유지).`;
    if (!window.confirm(msg)) return;
    setCleanupBusy(true);
    try {
      const res = await fetch("/api/cleanup", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ action: "done", targetIds: g.targetIds, deleteRows: isTransfer }) });
      const data = await res.json();
      if (!res.ok) { setCleanupError(data.error || `HTTP ${res.status}`); return; }
      setCleanupDone((d) => ({ ...d, [g.query]: true }));
      if (isTransfer && rows) await reloadCollection();
    } catch (e) { setCleanupError(e.message); } finally { setCleanupBusy(false); }
  };
  // 박사행 후 정리: "보낼 예정" 항목 일괄 삭제 (확인 대화상자)
  const purgeTransferred = async () => {
    const targets = collection.filter((c) => c.status === "transfer");
    if (!targets.length) return;
    if (!window.confirm(`박사에게 보낼 예정 ${targets.length}마리를 목록에서 삭제합니다 (게임에서 실제로 보낸 뒤 누르세요). 계속할까요?`)) return;
    let fail = 0;
    for (const t of targets) { const { error } = await deleteMyPokemon(t.id); if (error) fail++; }
    await reloadCollection();
    setCollError(fail ? `${fail}건 삭제 실패` : null);
  };
  const refreshUsage = async () => { const n = await getTodayUsage(usageDate()); if (n !== null) setUsageCount(n); };

  // ─── 포켓몬 데이터 로드 ───
  useEffect(() => {
    fetch("/api/pokemon-data")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllPokemon(data); // 구버전 응답 호환
        } else if (data && Array.isArray(data.pokemon)) {
          setAllPokemon(data.pokemon);
          // 서버가 모아준 한국어 기술명 (pokemon-go-api) → PokeAPI 호출 최소화
          if (data.moveNamesKr) setMoveNamesKr((prev) => ({ ...data.moveNamesKr, ...prev }));
          setDataMeta({ generatedAt: data.generatedAt, stale: data.stale, dataSources: data.dataSources || [], dataWarningCount: data.dataWarningCount || 0, dataWarningCounts: data.dataWarningCounts || {}, votableCount: data.votableCount });
        } else if (data && data.error) {
          setError(`포켓몬 데이터 로드 실패: ${data.error}`);
          if (data.dataSources) setDataMeta({ generatedAt: null, dataSources: data.dataSources, dataWarningCount: 0 });
        }
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  // ─── 익명 세션 → 기존 브라우저 목록 1회 이전 → 내 목록·사용 횟수 로드 ───
  useEffect(() => {
    (async () => {
      if (!supabaseConfigured) { setSessionNotice("서버 저장 미설정 (Supabase 환경변수 없음) · 목록 기능 비활성화"); return; }
      // 4-0 앱 내 웹 화면 자동 로그인: 앱이 URL 해시(#applogin=<코드>&uid=<user_id>)로 1회용 코드를 넘긴다.
      // 해시는 서버로 전송되지 않으며 즉시 URL 에서 지운다. 이미 같은 user_id 세션이면 코드를 쓰지 않는다.
      try {
        const h = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
        const code = h.get("applogin"), uid = h.get("uid");
        if (code) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          const cur = await getAccountState();
          if (!(uid && cur.user?.id === uid)) {
            const snap = await snapshotAnonymousRows();
            const { error, user } = await loginWithAppCode(code);
            if (error) setSessionNotice(`앱 자동 로그인 실패: ${error}`);
            else if (snap?.rows?.length > 0 && user?.id !== snap.userId) { setAppMerge(snap); setAppLoginInfo(`앱 계정으로 로그인했습니다. 이 화면의 익명 목록 ${snap.rows.length}건을 합칠까요?`); setShowDevices(true); }
          }
        }
      } catch (e) { setSessionNotice(`앱 자동 로그인 오류: ${e.message}`); }
      const s = await ensureAnonymousSession();
      if (!s) { setSessionNotice("서버 저장 연결 실패 · 목록 기능 비활성화"); return; }
      setSession(s);
      setAccount(await getAccountState());
      const mig = await migrateLocalCollection();
      if (mig.migrated > 0) setSessionNotice(`기존 브라우저 목록 ${mig.migrated}건을 내 목록으로 옮겼습니다`);
      else if (mig.error) setSessionNotice(`기존 목록 이전 실패: ${mig.error} (원본 유지)`);
      await reloadCollection();
      await refreshUsage();
    })();
  }, []);

  // ─── 레이드 보스 로드 ───
  useEffect(() => {
    setRaidBossesLoading(true);
    fetch("/api/raid-bosses")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCurrentRaidBosses(data);
        else setRaidBossesError(data?.error || "응답 형식 오류");
        setRaidBossesLoading(false);
      })
      .catch(() => { setRaidBossesError("네트워크 오류"); setRaidBossesLoading(false); });
  }, []);

  // ─── 이벤트 로드 ───
  useEffect(() => {
    setEventsLoading(true);
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEvents(data);
        else setEventsError(data?.error || "응답 형식 오류");
        setEventsLoading(false);
      })
      .catch(() => { setEventsError("네트워크 오류"); setEventsLoading(false); });
  }, []);

  // ─── 맥스배틀 로드 (1회) ───
  const [rawMaxBattles, setRawMaxBattles] = useState([]);
  useEffect(() => {
    setMaxBattlesLoading(true);
    fetch("/api/max-battles")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRawMaxBattles(data);
        else setMaxBattlesError(data?.error || "응답 형식 오류");
        setMaxBattlesLoading(false);
      })
      .catch(() => { setMaxBattlesError("네트워크 오류"); setMaxBattlesLoading(false); });
  }, []);

  // ─── 맥스배틀 보스에 한국어 이름 매칭 (allPokemon 로드 후, 재요청 없이) ───
  useEffect(() => {
    if (rawMaxBattles.length === 0) return;
    const enriched = rawMaxBattles.map((b) => {
      if (b.id && allPokemon.length > 0) {
        const match = allPokemon.find((p) => p.id === b.id);
        if (match) return { ...b, nameKr: match.nameKr };
      }
      return b;
    });
    setMaxBattles(enriched);
  }, [allPokemon, rawMaxBattles]);

  // ─── 레이드 보스에 한국어 이름 매칭 (allPokemon 로드 후) ───
  // ScrapedDuck은 영어 이름만 제공하므로 dex ID로 매칭
  useEffect(() => {
    if (currentRaidBosses.length === 0) return;
    if (allPokemon.length === 0) {
      setEnrichedRaidBosses(currentRaidBosses);
      return;
    }
    const enriched = currentRaidBosses.map((boss) => {
      if (boss.id) {
        const match = allPokemon.find((p) => p.id === boss.id);
        if (match) return { ...boss, nameKr: match.nameKr };
      }
      return boss;
    });
    setEnrichedRaidBosses(enriched);
  }, [allPokemon, currentRaidBosses]);

  const handleNameChange = (val) => {
    setPokemonName(val);
    setSelectedPokemon(null);
    setFastMove("");
    setChargedMove("");
    if (val.length >= 1) {
      const q = val.toLowerCase();
      const REGIONAL_FORMS = ["Alola", "Galarian", "Hisuian", "Paldea"];
      const matches = allPokemon
        .filter((p) => {
          const isNormal = p.form === "Normal";
          const isRegional = REGIONAL_FORMS.includes(p.form);
          if (!isNormal && !isRegional) return false;
          const formLabel = isRegional ? p.form.toLowerCase() : "";
          return p.nameKr.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || formLabel.includes(q);
        })
        .slice(0, 10);
      setSuggestions(matches);
      setShowSugg(matches.length > 0);
    } else {
      setSuggestions([]);
      setShowSugg(false);
    }
  };

  const selectPokemon = (poke) => {
    const formLabel = poke.form !== "Normal" ? ` (${poke.form})` : "";
    setPokemonName(poke.nameKr + formLabel);
    setSelectedPokemon(poke);
    setSuggestions([]);
    setShowSugg(false);

    const allMoves = [...(poke.fast || []), ...(poke.charged || []), ...(poke.eliteFast || []), ...(poke.eliteCharged || []), ...(poke.signatureFast || []), ...(poke.signatureCharged || []), ...(poke.unverifiedEliteFast || []), ...(poke.unverifiedEliteCharged || []), ...(poke.unverifiedFast || []), ...(poke.unverifiedCharged || [])];
    // 서버(pokemon-go-api)가 준 한국어 기술명이 없을 때만 PokeAPI 로 보충
    const toFetch = allMoves.filter((m) => !moveNamesKr[m]);
    if (toFetch.length > 0 && !pokeapiDownRef.current) {
      Promise.allSettled(
        toFetch.map(async (engName) => {
          const slug = engName.toLowerCase().replace(/[()'']/g, "").replace(/\s+/g, "-").replace(/--+/g, "-");
          try {
            const r = await fetch(`https://pokeapi.co/api/v2/move/${slug}`);
            if (!r.ok) return;
            const d = await r.json();
            const kr = d.names?.find((n) => n.language.name === "ko");
            if (kr) return { eng: engName, kr: kr.name };
          } catch { pokeapiDownRef.current = true; }
        })
      ).then((results) => {
        const newNames = {};
        results.forEach((r) => { if (r.status === "fulfilled" && r.value) newNames[r.value.eng] = r.value.kr; });
        if (Object.keys(newNames).length > 0) setMoveNamesKr((prev) => ({ ...prev, ...newNames }));
      });
    }
  };

  // ─── Streaming fetch helper ───
  const streamFetch = async (body, onChunk, onModel, onDone, onError) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setThinking(true);
    const rawOnChunk = onChunk;
    onChunk = (t) => { setThinking(false); rawOnChunk(t); };
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const contentType = res.headers.get("content-type") || "";
      try {
        const metaRaw = res.headers.get("x-pogo-meta");
        setAnalysisMeta(metaRaw ? JSON.parse(decodeURIComponent(metaRaw)) : null);
      } catch { setAnalysisMeta(null); }
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.error) { onError(data.error); return; }
        if (data.result) { onChunk(data.result); onModel(data.model || ""); }
        onDone(); return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      // 제어 마커(__MODEL__/__ERROR__/__RESET__/__USAGE__)는 항상 한 줄로 온다. 마커가 없는 조각은 그대로 본문.
      const processChunk = (chunk) => {
        if (!/__(MODEL|ERROR|RESET|USAGE|FALLBACK)__/.test(chunk)) {
          accumulated += chunk; if (accumulated.trim()) onChunk(accumulated); return;
        }
        const lines = chunk.split("\n");
        let textBuf = [];
        const flushText = () => { if (textBuf.length) { accumulated += textBuf.join("\n"); textBuf = []; if (accumulated.trim()) onChunk(accumulated); } };
        for (const line of lines) {
          if (line.startsWith("__MODEL__:")) { flushText(); onModel(line.replace("__MODEL__:", "").trim()); }
          else if (line.startsWith("__ERROR__:")) { flushText(); onError(line.replace("__ERROR__:", "").trim()); }
          else if (line.startsWith("__RESET__")) {
            // 비정상 응답 → 서버가 다른 모델로 다시 생성: 지금까지 받은 본문을 버린다
            flushText(); accumulated = ""; setThinking(true); onChunk("🔄 응답이 비정상이라 다른 모델로 다시 생성 중…\n");
          }
          else if (line.startsWith("__USAGE__:")) { flushText(); const n = Number(line.replace("__USAGE__:", "")); if (Number.isFinite(n)) setUsageCount(n); }
          else if (line.startsWith("__FALLBACK__:")) {
            flushText();
            const [reason, primary, used, fbMode] = line.replace("__FALLBACK__:", "").split("|");
            const short = (m) => (m || "").replace("gemini-", "").replace("-preview", "");
            setFallbackNotice(
              // 박사 코멘트는 기본 모델(GEMINI_MODELS_TEAM)로 고정되어 있어 "고급 모델" 문구를 쓰지 않는다
              fbMode === "team" ? `코멘트 모델(${short(primary)}) ${reason === "quota_minute" ? "분당 한도 초과" : reason === "quota_day" || reason === "quota" ? "오늘 한도 소진" : `응답 실패(${reason})`} → ${short(used)}로 코멘트 중`
              : reason === "quota_minute" ? `고급 모델(${short(primary)}) 분당 한도 초과 → 기본 모델(${short(used)})로 분석 중 · 잠시 후 고급 모델로 자동 복귀`
              : reason === "quota_day" || reason === "quota" ? `오늘 고급 모델(${short(primary)}) 한도 소진 → 기본 모델(${short(used)})로 분석 중`
              : `고급 모델(${short(primary)}) 응답 실패(${reason}) → 기본 모델(${short(used)})로 분석 중`
            );
          }
          else textBuf.push(line);
        }
        flushText();
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processChunk(decoder.decode(value, { stream: true }));
      }
      onDone();
    } catch (e) { if (e.name !== "AbortError") onError("네트워크 오류입니다. 다시 시도해주세요."); }
    setThinking(false);
    abortRef.current = null;
  };

  // ─── Raid boss search ───
  const handleRaidBossSearch = (val) => {
    setRaidBossName(val);
    setRaidSelectedPoke(null);
    if (val.length >= 1) {
      const q = val.toLowerCase();
      const REGIONAL_FORMS = ["Alola", "Galarian", "Hisuian", "Paldea"];
      const matches = allPokemon
        .filter((p) => (p.form === "Normal" || REGIONAL_FORMS.includes(p.form)) && (p.nameKr.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)))
        .slice(0, 10);
      setRaidSuggestions(matches);
      setShowRaidSugg(matches.length > 0);
    } else { setRaidSuggestions([]); setShowRaidSugg(false); }
  };

  const [autoAnalyzeRaid, setAutoAnalyzeRaid] = useState(false);

  const selectCurrentRaidBoss = (boss) => {
    const match = allPokemon.find((p) => p.id === boss.id && (p.form === boss.form || p.form === "Normal"));
    if (match) {
      setRaidBossName(match.nameKr);
      setRaidSelectedPoke(match);
    } else {
      setRaidBossName(boss.nameKr || boss.name);
      setRaidSelectedPoke(null);
    }
    setRaidSuggestions([]);
    setShowRaidSugg(false);
    setActiveTab("raid");
    setAutoAnalyzeRaid(true);
  };

  useEffect(() => {
    if (autoAnalyzeRaid && (raidSelectedPoke || raidBossName)) {
      setAutoAnalyzeRaid(false);
      setTimeout(() => {
        const poke = raidSelectedPoke;
        if (!poke && !raidBossName.trim()) return;
        setLoading(true); setStreaming(true); setError(null); setRaidResult(null); setRaidModel("");
        const raidBoss = poke ? { name: poke.name, nameKr: poke.nameKr, id: poke.id, form: poke.form, types: poke.types, baseAttack: poke.baseAttack, baseDefense: poke.baseDefense, baseStamina: poke.baseStamina } : { name: raidBossName };
        streamFetch(
          { mode: "raid", raidBoss, collection: collectionForAI() },
          (text) => setRaidResult(text), (model) => setRaidModel(model),
          () => { setLoading(false); setStreaming(false); },
          (err) => { setError(err); setLoading(false); setStreaming(false); }
        );
      }, 50);
    }
  }, [autoAnalyzeRaid, raidSelectedPoke, raidBossName]);

  useEffect(() => {
    if (streaming && resultRef.current) resultRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [result, streaming, raidResult, compareResult]);

  const analyze = useCallback(async () => {
    if (!pokemonName.trim()) { setError("포켓몬 이름을 입력해주세요!"); return; }
    if (ivMissing) { setError("개체값 미입력 — 공격/방어/HP 를 입력한 뒤 분석하세요"); return; }
    setLoading(true); setStreaming(true); setError(null); setResult(null); setCurrentKept(false); setUsedModel(""); setFallbackNotice(null);
    fetchAnalysisVerdict();

    const pokemonData = selectedPokemon
      ? { name: selectedPokemon.name, nameKr: selectedPokemon.nameKr, id: selectedPokemon.id, form: selectedPokemon.form, types: selectedPokemon.types, baseAttack: selectedPokemon.baseAttack, baseDefense: selectedPokemon.baseDefense, baseStamina: selectedPokemon.baseStamina, fast: selectedPokemon.fast, charged: selectedPokemon.charged, eliteFast: selectedPokemon.eliteFast, eliteCharged: selectedPokemon.eliteCharged, signatureFast: selectedPokemon.signatureFast, signatureCharged: selectedPokemon.signatureCharged, unverifiedEliteFast: selectedPokemon.unverifiedEliteFast, unverifiedEliteCharged: selectedPokemon.unverifiedEliteCharged, unverifiedFast: selectedPokemon.unverifiedFast, unverifiedCharged: selectedPokemon.unverifiedCharged }
      : { name: pokemonName, note: "API에서 매칭 안됨" };

    const fastMoveDisplay = fastMove ? `${krMove(fastMove)} (${fastMove})` : "";
    const chargedMoveDisplay = chargedMove ? `${krMove(chargedMove)} (${chargedMove})` : "";
    const pvpTag = getPvpTag();

    await streamFetch(
      { pokemonData, userInput: { name: selectedPokemon ? displayName : pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove: fastMoveDisplay || fastMove, chargedMove: chargedMoveDisplay || chargedMove, isShiny, isShadow, pvpIvTag: pvpTag ? pvpTag.text : null }, collection: collectionForAI() },
      (text) => setResult(text),
      (model) => setUsedModel(model),
      () => { setLoading(false); setStreaming(false); },
      (err) => { setError(err); setLoading(false); setStreaming(false); }
    );
  }, [pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove, chargedMove, isShiny, isShadow, selectedPokemon, moveNamesKr, collection, ivMissing, storageMode, session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingReanalyze && selectedPokemon) { setPendingReanalyze(false); analyze(); }
  }, [pendingReanalyze, selectedPokemon, analyze]);

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setPokemonName(""); setCp(""); setAtkIv(15); setDefIv(15); setStaIv(15);
    setIvMissing(false); setFallbackNotice(null);
    setFastMove(""); setChargedMove(""); setIsShiny(false); setIsShadow(false);
    setResult(null); setSelectedPokemon(null); setError(null); setCurrentKept(false); setUsedModel(""); setAnalysisVerdict(null);
    setStreaming(false); setLoading(false); setShowCompare(false); setCompareResult(null); setCompareTarget(null);
  };

  const resetForReanalyze = () => {
    if (abortRef.current) abortRef.current.abort();
    setCp(""); setAtkIv(15); setDefIv(15); setStaIv(15);
    setFastMove(""); setChargedMove(""); setIsShiny(false); setIsShadow(false);
    setResult(null); setError(null); setCurrentKept(false); setUsedModel("");
    setIvMissing(false);
    setStreaming(false); setLoading(false); setShowCompare(false); setCompareResult(null); setCompareTarget(null);
  };

  const analyzeRaid = useCallback(async () => {
    const poke = raidSelectedPoke;
    if (!poke && !raidBossName.trim()) { setError("레이드 보스를 선택해주세요!"); return; }
    setLoading(true); setStreaming(true); setError(null); setRaidResult(null); setRaidModel("");
    const raidBoss = poke ? { name: poke.name, nameKr: poke.nameKr, id: poke.id, form: poke.form, types: poke.types, baseAttack: poke.baseAttack, baseDefense: poke.baseDefense, baseStamina: poke.baseStamina } : { name: raidBossName };
    await streamFetch(
      { mode: "raid", raidBoss, collection: collectionForAI() },
      (text) => setRaidResult(text), (model) => setRaidModel(model),
      () => { setLoading(false); setStreaming(false); },
      (err) => { setError(err); setLoading(false); setStreaming(false); }
    );
  }, [raidSelectedPoke, raidBossName, collection]);

  const resetRaid = () => {
    if (abortRef.current) abortRef.current.abort();
    setRaidResult(null); setRaidModel(""); setError(null); setStreaming(false); setLoading(false);
  };

  const analyzeMaxBattle = useCallback(async (boss) => {
    setSelectedMaxBoss(boss);
    setLoading(true); setStreaming(true); setError(null); setMaxBattleResult(null); setMaxBattleModel("");
    const raidBoss = { name: boss.name, nameKr: boss.nameKr, id: boss.id, isGmax: boss.isGmax, tier: boss.tier, types: boss.types, cpMin: boss.cpMin, cpMax: boss.cpMax };
    await streamFetch(
      { mode: "maxbattle", raidBoss, collection: collectionForAI() },
      (text) => setMaxBattleResult(text), (model) => setMaxBattleModel(model),
      () => { setLoading(false); setStreaming(false); },
      (err) => { setError(err); setLoading(false); setStreaming(false); }
    );
  }, [collection]);

  const resetMaxBattle = () => {
    if (abortRef.current) abortRef.current.abort();
    setMaxBattleResult(null); setMaxBattleModel(""); setSelectedMaxBoss(null); setError(null); setStreaming(false); setLoading(false);
  };

  const runCompare = useCallback(async (targetEntry) => {
    if (!selectedPokemon || !targetEntry) return;
    setCompareTarget(targetEntry); setShowCompare(true);
    setLoading(true); setStreaming(true); setError(null); setCompareResult(null); setCompareModel("");
    const compareA = { name: selectedPokemon.nameKr, enName: selectedPokemon.name, id: selectedPokemon.id, cp: parseInt(cp) || 0, atkIv, defIv, staIv, ivPercent: Math.round(((atkIv + defIv + staIv) / 45) * 100), fastMove: fastMove ? krMove(fastMove) : "", chargedMove: chargedMove ? krMove(chargedMove) : "", isShiny, isShadow, baseAttack: selectedPokemon.baseAttack, baseDefense: selectedPokemon.baseDefense, baseStamina: selectedPokemon.baseStamina };
    const compareB = { name: targetEntry.name, pokemonId: targetEntry.pokemonId, form: targetEntry.form, cp: targetEntry.cp, atkIv: targetEntry.atkIv, defIv: targetEntry.defIv, staIv: targetEntry.staIv, ivPercent: targetEntry.ivPercent, fastMove: targetEntry.fastMove ? `${krMove(targetEntry.fastMove)} (${targetEntry.fastMove})` : "", chargedMove: targetEntry.chargedMove ? `${krMove(targetEntry.chargedMove)} (${targetEntry.chargedMove})` : "", isShiny: targetEntry.isShiny, isShadow: targetEntry.isShadow, status: targetEntry.status, purposes: targetEntry.purposes, memo: targetEntry.memo || undefined };
    await streamFetch(
      { mode: "compare", compareA, compareB },
      (text) => setCompareResult(text), (model) => setCompareModel(model),
      () => { setLoading(false); setStreaming(false); },
      (err) => { setError(err); setLoading(false); setStreaming(false); }
    );
  }, [selectedPokemon, cp, atkIv, defIv, staIv, fastMove, chargedMove, isShiny, isShadow, krMove]);

  // ─── 내 목록에 저장 (Supabase my_pokemon). 판정 결과는 저장하지 않는다 ───
  const saveToMyList = async () => {
    if (!selectedPokemon || currentKept || saving) return;
    if (!session) { setCollError("서버 저장이 연결되지 않아 저장할 수 없습니다"); return; }
    setSaving(true);
    // 4-B 매칭: 기존 항목(①종 계열·폼·개체값·포획일 ②종·폼·CP·HP)과 일치하면 새 행 대신 갱신
    const incoming = {
      species_id: selectedPokemon.id, form: selectedPokemon.form || "Normal", name_kr: selectedPokemon.nameKr, cp: parseInt(cp) || null, hp: null,
      atk_iv: atkIv, def_iv: defIv, sta_iv: staIv, fast_move: fastMove || null, charged_moves: chargedMove ? [chargedMove] : [], is_shadow: isShadow, is_shiny: isShiny, caught_on: null, source: "web",
    };
    const matched = findMatch(collection.map((c) => c.raw), incoming, familyOfFactory(allPokemon));
    if (matched) {
      const { row: r2, error: e2 } = await updateMyPokemon(matched.row.id, mergePatch(matched.row, incoming));
      setSaving(false);
      if (e2) { setCollError(`갱신 실패: ${e2}`); return; }
      setCollection((prev) => prev.map((e) => (e.id === r2.id ? toEntry(r2) : e)));
      setCurrentKept(true); setSaveNotice(`기존 항목 갱신 (${matched.rule === "cp+hp" ? "종·CP·HP 일치" : "개체값·포획일 일치"}) — 메모·태그·상태는 유지`);
      setSaveOpts({ open: false, status: "keep", purposes: [], tags: [], memo: "" });
      return;
    }
    setSaveNotice(null);
    const { row, error } = await insertMyPokemon({
      species_id: selectedPokemon.id,
      form: selectedPokemon.form || "Normal",
      name_kr: selectedPokemon.nameKr,
      cp: parseInt(cp) || null,
      atk_iv: atkIv, def_iv: defIv, sta_iv: staIv,
      fast_move: fastMove || null,
      charged_moves: chargedMove ? [chargedMove] : [],
      is_shadow: isShadow, is_shiny: isShiny,
      status: saveOpts.status, purposes: [...new Set([...saveOpts.purposes, ...purposesFromTags(saveOpts.tags)])], tags: saveOpts.tags, memo: saveOpts.memo.trim() || null,
      source: "web",
    });
    setSaving(false);
    if (error) { setCollError(`저장 실패: ${error}`); return; }
    setCollection((prev) => [...prev, toEntry(row)].sort((a, b) => a.pokemonId - b.pokemonId));
    setCurrentKept(true);
    setSaveOpts({ open: false, status: "keep", purposes: [], tags: [], memo: "" });
  };

  // 내 목록 JSON 백업 다운로드 (서버 목록 기준, 가져오기는 범위 밖)
  const exportCollection = () => {
    // 서버 행 구조(my_pokemon 컬럼)로 내보내기. 향후 가져오기 호환용 schemaVersion 포함
    const data = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), count: collection.length, items: collection.map((c) => c.raw) }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `포고박사_내포켓몬목록_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePurpose = (list, p) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

  const removeFromCollection = async (entryId) => {
    const { error } = await deleteMyPokemon(entryId);
    if (error) { setCollError(`삭제 실패: ${error}`); return; }
    setCollection((prev) => prev.filter((e) => e.id !== entryId));
  };

  const saveEdit = async () => {
    if (!editing) return;
    // 개체값: 셋 다 비어 있으면 미입력(null) 유지, 하나라도 입력했으면 셋 다 0~15 정수여야 함
    const ivRaw = [editing.atk, editing.def, editing.sta].map((v) => String(v ?? "").trim());
    const anyIv = ivRaw.some((v) => v !== "");
    const ivs = ivRaw.map((v) => (v === "" ? null : Number(v)));
    if (anyIv && ivs.some((v) => !Number.isInteger(v) || v < 0 || v > 15)) { setCollError("개체값은 공격/방어/HP 모두 0~15 정수로 입력하세요"); return; }
    const cpRaw = String(editing.cp ?? "").trim();
    const cpVal = cpRaw === "" ? null : Number(cpRaw);
    if (cpRaw !== "" && (!Number.isInteger(cpVal) || cpVal < 10 || cpVal > 9999)) { setCollError("CP 는 10~9999 정수로 입력하세요"); return; }
    const { row, error } = await updateMyPokemon(editing.id, {
      status: editing.status, purposes: [...new Set([...editing.purposes, ...purposesFromTags(editing.tags || [])])], tags: editing.tags || [], memo: editing.memo.trim() || null,
      cp: cpVal, atk_iv: anyIv ? ivs[0] : null, def_iv: anyIv ? ivs[1] : null, sta_iv: anyIv ? ivs[2] : null,
      // 기술: 빠른기술 1 + 차징기술 최대 2 (빈 값은 미입력)
      fast_move: editing.fast || null,
      charged_moves: (editing.charged || []).filter(Boolean).slice(0, 2),
    });
    if (error) { setCollError(`수정 실패: ${error}`); return; }
    setCollection((prev) => prev.map((e) => (e.id === row.id ? toEntry(row) : e)));
    setEditing(null);
  };

  // 목록 항목으로 다시 분석: 저장된 값으로 입력 폼을 채우고 새로 판정 (저장된 판정 없음)
  const reanalyzeEntry = (item) => {
    const match = allPokemon.find((p) => p.id === item.pokemonId && p.form === item.form) || allPokemon.find((p) => p.id === item.pokemonId);
    if (!match) { setCollError("포켓몬 데이터에서 해당 종을 찾지 못했습니다"); return; }
    if (abortRef.current) abortRef.current.abort();
    selectPokemon(match);
    setCp(item.cp ? String(item.cp) : "");
    const hasIv = [item.atkIv, item.defIv, item.staIv].every((v) => Number.isInteger(v));
    if (hasIv) { setAtkIv(item.atkIv); setDefIv(item.defIv); setStaIv(item.staIv); setIvMissing(false); }
    else { setAtkIv(15); setDefIv(15); setStaIv(15); setIvMissing(true); } // 이전된 항목: 개체값 없음 → 입력 후 분석
    setFastMove(item.fastMove || ""); setChargedMove(item.chargedMove || "");
    setIsShiny(item.isShiny); setIsShadow(item.isShadow);
    setResult(null); setError(null); setCurrentKept(false); setUsedModel("");
    setShowCollection(false); setEditing(null); setActiveTab("analyze");
    if (hasIv) setPendingReanalyze(true);
    else setError("개체값 미입력 — 공격/방어/HP 를 입력한 뒤 분석하세요");
  };

  // 목록 항목의 종 데이터 (기술 편집용)
  const speciesOf = (item) => allPokemon.find((p) => p.id === item.pokemonId && p.form === item.form) || allPokemon.find((p) => p.id === item.pokemonId);

  // 기술 선택 옵션 (일반 / 한정기 / 전용기 / 한정기·확인 필요 / 미검증) — 분석 폼과 목록 편집에서 공용
  const moveOptions = (poke, kind) => {
    if (!poke) return null;
    const g = kind === "fast"
      ? [["", poke.fast, ""], ["── 한정기술 ──", poke.eliteFast, "⭐ "], ["── 전용기 (아이템/폼체인지) ──", poke.signatureFast, "🔑 "], ["── 한정기 · 확인 필요 ──", poke.unverifiedEliteFast, "⭐❔ "], ["── 미검증 (교차검증 소스 1개) ──", poke.unverifiedFast, "❔ "]]
      : [["", poke.charged, ""], ["── 한정기술 ──", poke.eliteCharged, "⭐ "], ["── 전용기 (아이템/폼체인지) ──", poke.signatureCharged, "🔑 "], ["── 한정기 · 확인 필요 ──", poke.unverifiedEliteCharged, "⭐❔ "], ["── 미검증 (교차검증 소스 1개) ──", poke.unverifiedCharged, "❔ "]];
    return g.map(([label, list, mark]) => {
      if (!list?.length) return null;
      const opts = list.map((m) => <option key={m} value={m}>{mark}{krMove(m)} ({m})</option>);
      return label ? <optgroup key={label} label={label}>{opts}</optgroup> : opts;
    });
  };

  // ─── 2단계: 팀 추천 (서버 계산) ───
  const requestTeam = async (payload) => {
    if (collection.length === 0) { setTeamError("내 목록이 비어 있습니다 — 먼저 포켓몬을 저장하세요"); return; }
    setTeamLoading(true); setTeamError(null); setTeamResult(null); setDoctorComment(null); setDoctorModel("");
    try {
      const res = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, myPokemon: collection.map((c) => c.raw) }) });
      const data = await res.json();
      if (!res.ok || data.error) setTeamError(data.error || `팀 계산 실패 (HTTP ${res.status})`);
      else setTeamResult(data);
    } catch (e) { setTeamError("네트워크 오류 — 팀 계산 실패"); }
    setTeamLoading(false);
  };
  const recommendRaidTeam = () => {
    const poke = raidSelectedPoke;
    if (!poke) { setTeamError("레이드 보스를 목록에서 선택하거나 검색해서 지정하세요"); return; }
    requestTeam({ mode: "raid", boss: { id: poke.id, form: poke.form, name: poke.name, types: poke.types } });
  };
  const recommendRocketTeam = (lineup) => {
    setSelectedLineup(lineup);
    requestTeam({ mode: "rocket", lineup });
  };
  const loadRocketLineups = async () => {
    if (rocketLineups || rocketLoading) return;
    setRocketLoading(true); setRocketError(null);
    try {
      const res = await fetch("/api/rocket-lineups");
      const data = await res.json();
      if (!res.ok || data.error) setRocketError(data.error || `HTTP ${res.status}`);
      else setRocketLineups(data.lineups || []);
    } catch { setRocketError("네트워크 오류"); }
    setRocketLoading(false);
  };
  // 🧠 박사 코멘트: 서버가 확정한 팀을 그대로 AI 에 넘겨 3~5줄 코멘트만 받는다 (AI 는 팀을 바꾸지 않음, 사용 횟수 1회 차감)
  const askDoctorComment = async () => {
    if (!teamResult || loading) return;
    setLoading(true); setStreaming(true); setDoctorComment(""); setDoctorModel(""); setTeamError(null);
    await streamFetch(
      { mode: "team", team: teamResult },
      (text) => setDoctorComment(text), (model) => setDoctorModel(model),
      () => { setLoading(false); setStreaming(false); },
      (err) => { setTeamError(err); setLoading(false); setStreaming(false); }
    );
  };
  const clearTeam = () => { setTeamResult(null); setTeamError(null); setDoctorComment(null); setDoctorModel(""); setSelectedLineup(null); };
  const lineupGroup = (l) => (l.name === "Giovanni" ? "boss" : ["Cliff", "Arlo", "Sierra"].includes(l.name) ? "leader" : "grunt");
  const TYPE_KR = { normal: "노말", fire: "불꽃", water: "물", electric: "전기", grass: "풀", ice: "얼음", fighting: "격투", poison: "독", ground: "땅", flying: "비행", psychic: "에스퍼", bug: "벌레", rock: "바위", ghost: "고스트", dragon: "드래곤", dark: "악", steel: "강철", fairy: "페어리" };
  const typeKr = (t) => TYPE_KR[String(t || "").toLowerCase()] || t;
  // 로켓단 라인업 포켓몬(영어명) → 한국어명 (데이터셋 영어명 매칭, 없으면 영어)
  const rocketNameKr = (en) => { const q = String(en || "").toLowerCase(); const m = allPokemon.find((p) => p.name.toLowerCase() === q) || allPokemon.find((p) => q.includes(p.name.toLowerCase())); return m ? m.nameKr : en; };

  // ─── 3-0 계정 연결 핸들러 ───
  const acctSet = (patch) => setAcct((a) => ({ ...a, ...patch }));
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
  const afterAuthChange = async () => {
    setAccount(await getAccountState());
    const s = await ensureAnonymousSession();
    setSession(s);
    await reloadCollection();
    setUsageCount(null); await refreshUsage();
  };
  const acctRequestCode = async () => {
    const email = acct.email.trim();
    if (!validEmail(email)) { acctSet({ error: "이메일 주소를 확인하세요" }); return; }
    acctSet({ busy: true, error: null, info: null });
    if (acct.mode === "signin") setPendingMerge(await snapshotAnonymousRows()); // 로그인 전 익명 목록 보관 (병합 질문용)
    const { error } = acct.mode === "link" ? await requestLinkEmail(email) : await requestSignInEmail(email);
    if (error) { acctSet({ busy: false, error }); return; }
    acctSet({ busy: false, step: "code", info: `${email} 로 6자리 코드를 보냈습니다. 메일이 안 오면 스팸함을 확인하세요` });
  };
  const acctVerifyCode = async () => {
    const email = acct.email.trim(), code = acct.code.trim();
    if (!/^\d{6,8}$/.test(code)) { acctSet({ error: "메일의 숫자 코드를 입력하세요" }); return; }
    acctSet({ busy: true, error: null });
    if (acct.mode === "link") {
      const { error } = await verifyLinkEmail(email, code);
      if (error) { acctSet({ busy: false, error }); return; }
      await afterAuthChange();
      acctSet({ busy: false, step: "done", info: "이메일이 연결되었습니다. 목록·사용 횟수는 그대로 유지됩니다 (같은 계정)" });
      setSessionNotice(null);
    } else {
      const { error, user } = await verifySignInEmail(email, code);
      if (error) { acctSet({ busy: false, error }); return; }
      await afterAuthChange();
      const snap = pendingMerge;
      const sameUser = snap?.userId && user?.id === snap.userId;
      if (snap?.rows?.length > 0 && !sameUser) acctSet({ busy: false, step: "merge", info: `로그인했습니다. 이 기기의 익명 목록 ${snap.rows.length}건을 이 계정으로 합칠까요? (종·CP·개체값이 같은 항목은 건너뜀)` });
      else { setPendingMerge(null); acctSet({ busy: false, step: "done", info: "로그인했습니다. 같은 이메일로 연결된 목록이 표시됩니다" }); }
      setSessionNotice(null);
    }
  };
  const acctMerge = async (yes) => {
    if (!yes) { setPendingMerge(null); acctSet({ step: "done", info: "익명 목록은 합치지 않았습니다 (이 기기에서는 더 이상 보이지 않습니다)" }); return; }
    acctSet({ busy: true, error: null });
    const r = await mergeRowsIntoCurrent(pendingMerge?.rows || []);
    setPendingMerge(null);
    if (r.error) { acctSet({ busy: false, step: "done", error: `병합 실패: ${r.error}` }); return; }
    await reloadCollection();
    acctSet({ busy: false, step: "done", info: `병합 완료: ${r.inserted}건 추가, 중복 ${r.skipped}건 건너뜀` });
  };
  const acctSignOut = async () => {
    if (!confirm("로그아웃하면 이 기기는 새 익명 계정으로 시작합니다. 이메일로 다시 로그인하면 목록을 볼 수 있습니다. 계속할까요?")) return;
    acctSet({ busy: true, error: null });
    await signOutAccount();
    await afterAuthChange();
    setAcct({ mode: null, email: "", code: "", step: "email", busy: false, error: null, info: "로그아웃했습니다 · 새 익명 계정" });
  };

  // ─── 3-0 보완: 기기 연결 핸들러 ───
  const reloadDevices = async () => {
    const { rows, error } = await listDevices();
    if (error) setDevError(`기기 목록 불러오기 실패: ${error}${/relation|does not exist|permission/i.test(error) ? " — 마이그레이션 0002 적용 여부 확인" : ""}`);
    else { setDevError(null); setDevices(rows); }
  };
  const openDevices = async () => { setShowDevices(true); setPairCode(null); setDevError(null); await reloadDevices(); };
  const issuePairCode = async () => {
    setDevBusy(true); setDevError(null); setPairCode(null);
    try {
      const res = await fetch("/api/device/pair-code", { method: "POST", headers: { ...(await authHeader()) } });
      const data = await res.json();
      if (!res.ok || data.error) setDevError(data.error || `코드 발급 실패 (HTTP ${res.status})`);
      else setPairCode({ code: data.code, expiresAt: data.expiresAt });
    } catch { setDevError("네트워크 오류 — 코드 발급 실패"); }
    setDevBusy(false);
  };
  // 앱 "웹 로그인 코드" 로 이 브라우저를 앱이 연결된 계정으로 전환. 익명 목록이 있으면 PR #19 병합 로직 재사용
  const loginWithApp = async () => {
    const code = appCode.replace(/[\s-]/g, "").toUpperCase();
    if (code.length !== 8) { setDevError("앱에서 받은 8자리 코드를 입력하세요"); return; }
    setDevBusy(true); setDevError(null); setAppLoginInfo(null);
    const snap = await snapshotAnonymousRows();
    const { error, user } = await loginWithAppCode(code);
    if (error) { setDevError(error); setDevBusy(false); return; }
    await afterAuthChange();
    setAppCode("");
    const sameUser = snap?.userId && user?.id === snap.userId;
    if (snap?.rows?.length > 0 && !sameUser) { setAppMerge(snap); setAppLoginInfo(`로그인했습니다. 이 브라우저의 익명 목록 ${snap.rows.length}건을 이 계정으로 합칠까요? (종·CP·개체값이 같은 항목은 건너뜀)`); }
    else setAppLoginInfo("로그인했습니다 — 앱이 연결된 계정의 내 목록이 표시됩니다");
    await reloadDevices();
    setDevBusy(false);
  };
  const appMergeDecide = async (yes) => {
    const snap = appMerge; setAppMerge(null);
    if (!yes) { setAppLoginInfo("익명 목록은 합치지 않았습니다 (이 브라우저에서는 더 이상 보이지 않습니다)"); return; }
    setDevBusy(true);
    const r = await mergeRowsIntoCurrent(snap?.rows || []);
    if (r.error) setDevError(`병합 실패: ${r.error}`); else { await reloadCollection(); setAppLoginInfo(`병합 완료: ${r.inserted}건 추가, 중복 ${r.skipped}건 건너뜀`); }
    setDevBusy(false);
  };
  const openDebug = async () => {
    setShowDebug(true); setDebugError(null);
    const { rows, error } = await listDebugLogs(30);
    if (error) { setDebugError(`디버그 기록 불러오기 실패: ${error}${/relation|does not exist|permission/i.test(error) ? " — 마이그레이션 0003 적용 여부 확인" : ""}`); return; }
    setDebugRows(rows);
    const urls = {};
    for (const r of rows) if (r.image_path) urls[r.id] = await debugImageUrl(r.image_path);
    setDebugUrls(urls);
  };
  const removeDebug = async (row) => {
    const { error } = await deleteDebugLog(row);
    if (error) setDebugError(`삭제 실패: ${error}`); else setDebugRows((rows) => rows.filter((r) => r.id !== row.id));
  };
  const exportDebug = (row) => {
    const data = JSON.stringify({ id: row.id, kind: row.kind, created_at: row.created_at, result: row.result, ocr: row.ocr, image_url: debugUrls[row.id] || null }, null, 2);
    const blob = new Blob([data], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `pogo-debug-${row.id.slice(0, 8)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const doRevokeDevice = async (d) => {
    if (!confirm(`"${d.name}" 연결을 해제할까요? 해제 후 그 기기의 저장 요청은 거부됩니다.`)) return;
    setDevBusy(true);
    const { error } = await revokeDevice(d.id);
    if (error) setDevError(`해제 실패: ${error}`);
    await reloadDevices();
    setDevBusy(false);
  };

  const renderBold = (text) => {
    return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i} style={{ color: "#e0e0e0" }}>{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>
    );
  };

  const formatResult = (text) => text.split("\n").map((line, i) => {
    // 마크다운 제목(#, ##, ###...) → 제목 스타일
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      return <div key={i} style={{ ...s.resultTitle, fontSize: level <= 2 ? 17 : level === 3 ? 15 : 14, marginTop: 10 }}>{renderBold(heading[2].replace(/\s+#+\s*$/, ""))}</div>;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return <div key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }} />;
    if (line.startsWith("**") && line.includes("👉")) return <div key={i} style={s.resultTitle}>{line.replace(/\*\*/g, "")}</div>;
    if (line.includes("**판정:**") || line.includes("**판정:")) {
      const color = line.includes("영구 보존") || line.includes("킵") ? "#4ecdc4" : line.includes("보류") ? "#ffd93d" : line.includes("사탕행") ? "#ff6b6b" : "#a890f0";
      return <div key={i} style={{ ...s.verdictLine, borderLeftColor: color }}>{renderBold(line)}</div>;
    }
    if (line.includes("🚨")) return <div key={i} style={s.warningLine}>{renderBold(line)}</div>;
    if (line.includes("🛡️") || line.includes("🏆") || line.includes("💡")) return <div key={i} style={s.counterLine}>{renderBold(line)}</div>;
    if (line.trim().startsWith("*")) return <div key={i} style={s.bulletLine}>{renderBold(line.replace(/^\*\s*/, ""))}</div>;
    if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
    return <div key={i} style={{ padding: "2px 0", fontSize: 13 }}>{renderBold(line)}</div>;
  });

  // ─── 이벤트 시간 포맷 ───
  const formatEventTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const formatEventDuration = (event) => {
    const now = Date.now();
    if (event.isActive && event.end) {
      const diff = event.end - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (days > 0) return `${days}일 ${hours}시간 남음`;
      if (hours > 0) return `${hours}시간 남음`;
      return "곧 종료";
    }
    if (event.isUpcoming && event.start) {
      const diff = event.start - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (days > 0) return `${days}일 후 시작`;
      if (hours > 0) return `${hours}시간 후 시작`;
      return "곧 시작";
    }
    return "";
  };

  // ─── 데이터 기준 시각 표시 ───
  const fmtStamp = (iso) => {
    if (!iso) return "확인 불가";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "확인 불가";
    // 연도 포함, 브라우저 로컬 시간대
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const sourceStatus = (src) => {
    if (src.skipped) return `${src.name} 생략`;
    if (!src.ok) return `${src.name} ✗`;
    if (src.stale) return `${src.name} 오래됨(투표 제외, 갱신 ${fmtStamp(src.updatedAt)}, ${src.ageDays}일 경과)`;
    if (!src.updatedAt) return `${src.name} ✓ (갱신 시각 미상)`;
    return `${src.name} ✓ (갱신 ${fmtStamp(src.updatedAt)}${src.updatedAtTzUnknown ? " · 시간대 미표기" : ""})`;
  };
  const modelLine = (model) => `⚡ ${model.replace("gemini-", "").replace("-preview", "")}${analysisMeta?.generatedAt ? ` · 데이터 ${fmtStamp(analysisMeta.generatedAt)}${analysisMeta.verified ? " ✓검증" : ""}` : ""}`;

  // ─── 팀 추천 패널 (레이드 6마리 / 로켓단 3마리) ───
  const memberFlags = (m) => [m.levelAssumed ? "레벨 추정" : m.levelExact ? null : "레벨 근사", m.ivAssumed ? "개체값 추정" : null, m.movesAssumed ? "기술 가정" : null, m.cpOverMax ? "CP 최대치 초과(입력 확인)" : null].filter(Boolean);
  const renderTeamPanel = () => {
    if (!teamResult) return null;
    const isRaid = teamResult.mode === "raid";
    return (
      <div style={s.teamPanel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#4ecdc4" }}>
            {isRaid ? `📋 내 목록 팀 — vs ${teamResult.boss?.nameKr || teamResult.boss?.name} (${(teamResult.boss?.types || []).map(typeKr).join("/")})` : `📋 내 목록 팀 — vs ${teamResult.lineup?.title || teamResult.lineup?.name}`}
          </div>
          <button onClick={clearTeam} style={{ background: "none", border: "none", color: "#8899aa", fontSize: 12, cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>✕ 닫기</button>
        </div>
        <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 8 }}>
          서버 계산(AI 미사용) · 후보 {teamResult.candidates}마리{teamResult.excludedTransfer ? ` · 보낼 예정 ${teamResult.excludedTransfer}마리 제외` : ""}{teamResult.skipped ? ` · 데이터 없음 ${teamResult.skipped}마리 제외` : ""}
          {isRaid ? " · 점수 = DPS^0.775 × TDO^0.225 (L40 보스 15/15/15 가정)" : ` · ${teamResult.note}`}
        </div>
        {teamResult.team.length === 0 && <div style={s.sourceNotice}>내 목록에서 계산 가능한 포켓몬이 없습니다 (종 데이터 또는 기술 수치 없음)</div>}
        {teamResult.team.map((m, i) => {
          const chosen = isRaid ? m : m.chosen;
          return (
            <div key={m.id + "-" + i} style={s.teamRow}>
              <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${m.speciesId}.png`} alt="" style={{ width: 36, height: 36, imageRendering: "pixelated" }} onError={(e) => { e.target.style.display = "none"; }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>
                  <span style={{ color: "#ffd93d", marginRight: 6 }}>{isRaid ? `${i + 1}` : `슬롯${m.slot}`}</span>
                  {m.shadow ? "👤" : ""}{m.nameKr || m.name}{m.form && m.form !== "Normal" ? ` (${m.form})` : ""}
                  <span style={{ fontSize: 10, color: "#8899aa", marginLeft: 6 }}>CP{m.cp || "?"} · L{m.level}</span>
                </div>
                <div style={{ fontSize: 11, color: "#8899aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {krMove(chosen.fast)} + {krMove(chosen.charged)}
                  {isRaid
                    ? ` · 차징 ×${chosen.multCharged} · DPS ${chosen.dps} · TDO ${chosen.tdo} · 점수 ${chosen.score}`
                    : ` · 공격 ×${chosen.offMult} · 피격 ×${chosen.defMult} · 점수 ${chosen.score} · 커버 ${(m.covers || []).map((c) => `${c}번`).join(",")}`}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                  {isRaid && m.vulnerable && <span style={{ ...s.tagBadge, color: "#ff6b6b" }}>⚠️ 보스 자속에 약점 ×{m.vulnMult}</span>}
                  {memberFlags(m).map((f) => <span key={f} style={{ ...s.tagBadge, color: "#ffd93d" }}>{f}</span>)}
                </div>
              </div>
            </div>
          );
        })}
        {isRaid && teamResult.fill?.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#a890f0", marginBottom: 4 }}>구하면 좋은 포켓몬 (목록 부족분 {teamResult.fill.length}마리 · 서버 천적 후보)</div>
            {teamResult.fill.map((c, i) => (
              <div key={`${c.id}-${c.form}-${i}`} style={{ fontSize: 11, color: "#c8d6e5", padding: "2px 0" }}>
                · {c.nameKr || c.name}{c.form && c.form !== "Normal" ? ` (${c.form})` : ""} — {krMove(c.fastMove)} + {krMove(c.chargedMove)} · ×{c.mult}{c.releasedUnknown ? " (출시 미확인)" : ""}
              </div>
            ))}
          </div>
        )}
        {teamResult.warnings?.length > 0 && (
          <div style={{ ...s.sourceNotice, marginTop: 8, marginBottom: 0 }}>{teamResult.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}</div>
        )}
        {teamResult.team.length > 0 && doctorComment === null && (
          <button onClick={askDoctorComment} disabled={loading} style={{ ...s.keepBtn, marginTop: 10, padding: 10, fontSize: 13 }}>🧠 박사 코멘트 (AI 1회 사용)</button>
        )}
        {teamError && teamResult && <div style={{ ...s.error, marginTop: 8, marginBottom: 0 }}>{teamError}</div>}
        {doctorComment !== null && (
          <div style={{ ...s.collAnalysis, marginTop: 10, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4ecdc4", marginBottom: 4 }}>🧠 박사 코멘트 <span style={{ fontWeight: 400, color: "#8899aa" }}>(팀 구성은 서버 계산 그대로)</span></div>
            {streaming && thinking && <div style={s.thinking}>🧠 박사가 생각 중…</div>}
            {formatResult(doctorComment)}
            {streaming && <span style={s.cursor}>▌</span>}
            {doctorModel && !streaming && <div style={{ fontSize: 10, color: "#576574", textAlign: "right", marginTop: 4 }}>{modelLine(doctorModel)}</div>}
          </div>
        )}
      </div>
    );
  };

  const hasFast = selectedPokemon && selectedPokemon.fast && selectedPokemon.fast.length > 0;
  const hasCharged = selectedPokemon && selectedPokemon.charged && selectedPokemon.charged.length > 0;
  const displayName = selectedPokemon ? selectedPokemon.nameKr + (selectedPokemon.form !== "Normal" ? ` (${selectedPokemon.form})` : "") : pokemonName;

  return (
    <div style={s.container}>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      <div style={s.inner}>
        <div style={s.header}>
          <span style={s.logoIcon}>⚡</span>
          <div>
            <h1 style={s.title}>포고박사</h1>
            <p style={s.subtitle}>킵? 버려? 냅둬? AI가 판정해드립니다</p>
          </div>
        </div>
        <div style={s.statusBar}>
          <span>{usageCount === null ? (session ? "오늘 AI 사용 —회" : "AI 사용 횟수 기록 안 됨") : `오늘 AI 사용 ${usageCount}회`}{fallbackNotice ? <span style={{ color: "#ffd93d", marginLeft: 8 }}>· {fallbackNotice}</span> : null}</span>
          <span style={{ opacity: 0.7, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {sessionNotice || (session ? (account && !account.anonymous ? `계정 연결됨 · ${account.email}` : "이 기기에 저장됨 · 브라우저 데이터를 지우면 목록이 사라질 수 있음") : "")}
            {session && EMAIL_LINK_ENABLED && !inApp && <button onClick={() => { setShowAccount(true); setAcct({ mode: null, email: "", code: "", step: "email", busy: false, error: null, info: null }); }} style={s.linkBtn}>{account && !account.anonymous ? "👤 계정" : "🔗 계정 연결"}</button>}
            {session && <button onClick={openDevices} style={s.linkBtn}>📱 기기 연결</button>}
          </span>
        </div>

        {/* ─── Tab Switcher (결과 표시 중에는 숨김) ─── */}
        {!result && !raidResult && (
          <div style={s.tabRow}>
            <button onClick={() => { setActiveTab("analyze"); setError(null); }} style={activeTab === "analyze" ? s.tabActive : s.tab}>🔍 분석</button>
            <button onClick={() => { setActiveTab("raid"); setError(null); }} style={activeTab === "raid" ? s.tabActive : s.tab}>⚔️ 레이드</button>
            <button onClick={() => { setActiveTab("rocket"); setError(null); loadRocketLineups(); }} style={activeTab === "rocket" ? s.tabActive : s.tab}>🚀 로켓단</button>
            <button onClick={() => { setActiveTab("events"); setError(null); }} style={activeTab === "events" ? s.tabActive : s.tab}>📅 이벤트</button>
          </div>
        )}

        {/* ═══ ANALYZE TAB ═══ */}
        {activeTab === "analyze" && !result ? (
          <div style={s.card}>
            <div style={s.group}>
              <label style={s.label}>포켓몬 이름 {dataLoading && <span style={{ fontSize: 10, color: "#ffd93d" }}>데이터 로딩중...</span>}</label>
              <div style={{ position: "relative" }}>
                <input style={s.input} value={pokemonName} onChange={(e) => handleNameChange(e.target.value)} onFocus={() => suggestions.length > 0 && setShowSugg(true)} onBlur={() => setTimeout(() => setShowSugg(false), 200)} />
                {selectedPokemon && (
                  <div style={s.miniInfo}>
                    <span style={{ color: "#4ecdc4" }}>✓ #{selectedPokemon.id} {selectedPokemon.nameKr}{selectedPokemon.form !== "Normal" ? ` (${selectedPokemon.form})` : ""}</span>
                    <span style={{ opacity: 0.5 }}>공{selectedPokemon.baseAttack} / 방{selectedPokemon.baseDefense} / 체{selectedPokemon.baseStamina}</span>
                  </div>
                )}
                {showSugg && (
                  <div style={s.suggBox}>
                    {suggestions.map((p, i) => (
                      <div key={`${p.id}-${p.form}-${i}`} style={s.suggItem} onMouseDown={() => selectPokemon(p)}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{p.nameKr}</span>
                          {p.form !== "Normal" && <span style={{ fontSize: 11, color: "#a890f0", marginLeft: 4 }}>({p.form})</span>}
                          {p.nameKr !== p.name && <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 6 }}>{p.name}</span>}
                        </div>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>#{p.id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={s.group}>
              <label style={s.label}>CP (전투력)</label>
              <input style={s.input} type="number" value={cp} onChange={(e) => setCp(e.target.value)} />
            </div>

            <div style={s.group}>
              <label style={s.label}>개체값 (IV) <span style={{ ...s.ivBadge, background: getIvColor() }}>{ivPercent}% — {getIvLabel()}</span></label>
              <div style={s.ivBox}>
                {[{ label: "공격", value: atkIv, set: setAtkIvU }, { label: "방어", value: defIv, set: setDefIvU }, { label: "HP", value: staIv, set: setStaIvU }].map(({ label, value, set }) => (
                  <div key={label} style={s.ivItem}>
                    <div style={s.ivLabelRow}>
                      <span style={s.ivStatLabel}>{label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button onClick={() => set(Math.max(0, value - 1))} style={s.ivStepBtn}>−</button>
                        <span style={{ ...s.ivStatVal, color: value >= 14 ? "#ff6348" : value >= 10 ? "#ffa502" : "#8899aa", minWidth: 20, textAlign: "center" }}>{value}</span>
                        <button onClick={() => set(Math.min(15, value + 1))} style={s.ivStepBtn}>+</button>
                      </div>
                    </div>
                    <div style={s.gaugeOuter}>
                      {[0, 1, 2].map((seg) => {
                        const fill = value <= seg * 5 ? 0 : value >= (seg + 1) * 5 ? 100 : ((value - seg * 5) / 5) * 100;
                        return (
                          <div key={seg} style={s.gaugeSeg}>
                            <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${fill}%`, background: value === 15 ? "linear-gradient(90deg,#ff9f43,#ee5a24)" : "linear-gradient(90deg,#f6b93b,#e58e26)", borderRadius: 3, transition: "width 0.15s" }} />
                          </div>
                        );
                      })}
                    </div>
                    <div style={s.ivQuickRow}>
                      {[0, 5, 10, 13, 15].map((v) => (
                        <button key={v} onClick={() => set(v)} style={value === v ? s.ivQuickBtnActive : s.ivQuickBtn}>{v}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {ivMissing && <div style={{ ...s.sourceNotice, marginTop: 10, marginBottom: 0 }}>⚠️ 개체값 미입력 — 이전된 항목에는 개체값이 없습니다. 공격/방어/HP 를 입력한 뒤 분석하세요.</div>}
              {getPvpTag() && !ivMissing && (
                <div style={s.pvpTag}>
                  <span style={{ color: getPvpTag().color }}>{getPvpTag().text}</span>
                  <span style={s.pvpHint}>PvP는 공격↓ 방어·HP↑가 유리 (CP 제한 리그)</span>
                </div>
              )}
            </div>

            <div style={s.group}>
              <label style={s.label}>현재 기술 {!selectedPokemon && <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.5 }}>(포켓몬 선택 시 목록 표시)</span>}</label>
              <div style={s.moveRow}>
                <div style={{ flex: 1 }}>
                  <div style={s.moveLabel}>빠른기술</div>
                  {hasFast ? (
                    <select style={s.select} value={fastMove} onChange={(e) => setFastMove(e.target.value)}>
                      <option value="">선택</option>
                      {selectedPokemon.fast.map((m) => <option key={m} value={m}>{krMove(m)} ({m})</option>)}
                      {selectedPokemon.eliteFast?.length > 0 && (
                        <optgroup label="── 한정기술 ──">
                          {selectedPokemon.eliteFast.map((m) => <option key={m} value={m}>⭐ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.signatureFast?.length > 0 && (
                        <optgroup label="── 전용기 (아이템/폼체인지) ──">
                          {selectedPokemon.signatureFast.map((m) => <option key={m} value={m}>🔑 {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.unverifiedEliteFast?.length > 0 && (
                        <optgroup label="── 한정기 · 확인 필요 ──">
                          {selectedPokemon.unverifiedEliteFast.map((m) => <option key={m} value={m}>⭐❔ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.unverifiedFast?.length > 0 && (
                        <optgroup label="── 미검증 (교차검증 소스 1개) ──">
                          {selectedPokemon.unverifiedFast.map((m) => <option key={m} value={m}>❔ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                    </select>
                  ) : <input style={s.input} value={fastMove} onChange={(e) => setFastMove(e.target.value)} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={s.moveLabel}>차징기술</div>
                  {hasCharged ? (
                    <select style={s.select} value={chargedMove} onChange={(e) => setChargedMove(e.target.value)}>
                      <option value="">선택</option>
                      {selectedPokemon.charged.map((m) => <option key={m} value={m}>{krMove(m)} ({m})</option>)}
                      {selectedPokemon.eliteCharged?.length > 0 && (
                        <optgroup label="── 한정기술 ──">
                          {selectedPokemon.eliteCharged.map((m) => <option key={m} value={m}>⭐ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.signatureCharged?.length > 0 && (
                        <optgroup label="── 전용기 (아이템/폼체인지) ──">
                          {selectedPokemon.signatureCharged.map((m) => <option key={m} value={m}>🔑 {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.unverifiedEliteCharged?.length > 0 && (
                        <optgroup label="── 한정기 · 확인 필요 ──">
                          {selectedPokemon.unverifiedEliteCharged.map((m) => <option key={m} value={m}>⭐❔ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                      {selectedPokemon.unverifiedCharged?.length > 0 && (
                        <optgroup label="── 미검증 (교차검증 소스 1개) ──">
                          {selectedPokemon.unverifiedCharged.map((m) => <option key={m} value={m}>❔ {krMove(m)} ({m})</option>)}
                        </optgroup>
                      )}
                    </select>
                  ) : <input style={s.input} value={chargedMove} onChange={(e) => setChargedMove(e.target.value)} />}
                </div>
              </div>
            </div>

            <div style={s.toggleRow}>
              <button onClick={() => setIsShiny(!isShiny)} style={{ ...s.toggle, ...(isShiny ? { background: "linear-gradient(135deg,#ffd93d,#f0a500)", borderColor: "#ffd93d", color: "#0a1628" } : {}) }}>✨ 이로치</button>
              <button onClick={() => setIsShadow(!isShadow)} style={{ ...s.toggle, ...(isShadow ? { background: "linear-gradient(135deg,#705898,#4a3370)", borderColor: "#705898", color: "#fff" } : {}) }}>👤 그림자</button>
            </div>

            {error && <div style={s.error}>{error}</div>}
            <button onClick={analyze} style={s.analyzeBtn} disabled={loading}>
              {loading ? <span>⚡ 분석 중...</span> : "🔍 포켓몬 분석하기"}
            </button>
          </div>
        ) : activeTab === "analyze" && result ? (
          <div style={s.resultCard} ref={resultRef}>
            {selectedPokemon && (
              <div style={s.imgContainer}>
                <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${selectedPokemon.id}.png`} alt={displayName} style={s.pokemonImg} onError={(e) => { e.target.style.display = "none"; }} />
                {isShiny && <span style={s.shinyBadge}>✨ 이로치</span>}
                {isShadow && <span style={s.shadowBadge}>👤 그림자</span>}
              </div>
            )}
            <div style={s.ivSummary}>
              {[["공격", atkIv], ["방어", defIv], ["HP", staIv]].map(([l, v]) => (
                <div key={l} style={s.ivSumItem}><span style={{ fontSize: 11, opacity: 0.6 }}>{l}</span><span style={{ fontWeight: 700 }}>{v}</span></div>
              ))}
              <div style={{ ...s.ivSumItem, borderRight: "none" }}><span style={{ fontSize: 11, opacity: 0.6 }}>IV</span><span style={{ fontWeight: 700, color: getIvColor() }}>{ivPercent}%</span></div>
            </div>
            {analysisVerdict && (
              <div style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${TIER_COLORS[analysisVerdict.verdict?.tier] || "#2a3a5c"}55` }}>
                {analysisVerdict.loading ? <div style={{ fontSize: 12, color: "#8899aa" }}>📌 보관 판정 계산 중…</div>
                : analysisVerdict.error ? <div style={{ fontSize: 12, color: "#ff6b6b" }}>📌 보관 판정 실패: {analysisVerdict.error}</div>
                : (() => { const v = analysisVerdict.verdict; return (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TIER_COLORS[v.tier] || "#e0e0e0" }}>📌 {v.summary}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                      {v.tags.map((t) => <span key={t.name} title={t.reason} style={{ ...s.tagBadge, fontSize: 10, color: TIER_COLORS[t.tier] || "#8899aa", border: `1px solid ${TIER_COLORS[t.tier] || "#2a3a5c"}44` }}>{TIER_LABEL[t.tier]?.slice(0, 2) || "·"} {t.name}</span>)}
                    </div>
                    {v.tags.map((t) => <div key={"r" + t.name} style={{ fontSize: 10, color: "#8899aa", marginTop: 3 }}>· {t.name}: {t.reason}</div>)}
                    {v.event && <div style={{ fontSize: 11, color: "#ffd93d", marginTop: 4 }}>{v.event.note}</div>}
                    {v.warnings?.length > 0 && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 4 }}>⚠️ {v.warnings.join(" · ")}</div>}
                    <div style={{ fontSize: 9, color: "#576574", marginTop: 6 }}>결정적 계산(AI 미사용) · 보관함 {STORAGE_MODE_LABELS[storageMode]} · 내 목록 {analysisVerdict.meta?.myRows ?? 0}마리 비교{analysisVerdict.meta?.authenticated ? "" : " (로그인 없음)"} · 기준값 README "판정 기준"</div>
                  </>
                ); })()}
              </div>
            )}
            <div style={s.resultContent}>
              {streaming && thinking && <div style={s.thinking}>🧠 박사가 생각 중…</div>}
              {formatResult(result)}
              {streaming && <span style={s.cursor}>▌</span>}
            </div>
            {usedModel && !streaming && (
              <div style={{ padding: "4px 20px 0", fontSize: 10, color: "#576574", textAlign: "right" }}>
                {modelLine(usedModel)}
              </div>
            )}
            {selectedPokemon && !streaming && (
              <div style={{ padding: "12px 20px 0", display: "flex", gap: 8 }}>
                <button onClick={() => (currentKept ? null : setSaveOpts((o) => ({ ...o, open: !o.open })))} disabled={currentKept || !session} style={{ ...(currentKept ? s.keepBtnKept : s.keepBtn), flex: 1, opacity: session ? 1 : 0.5 }}>
                  {currentKept ? "✅ 내 목록에 저장됨" : "💾 내 목록에 저장"}
                </button>
                {(() => {
                  const sameSpecies = collection.filter((c) => c.pokemonId === selectedPokemon.id && (!c.form || c.form === selectedPokemon.form));
                  if (sameSpecies.length === 0) return null;
                  return (
                    <button onClick={() => setShowCompare(true)} style={{ ...s.keepBtn, flex: 1, borderColor: "#ffd93d", color: "#ffd93d" }}>
                      ⚖️ 비교 ({sameSpecies.length})
                    </button>
                  );
                })()}
              </div>
            )}
            {saveNotice && currentKept && <div style={{ ...s.collNote, margin: "8px 20px 0" }}>{saveNotice}</div>}
            {selectedPokemon && !streaming && saveOpts.open && !currentKept && (
              <div style={s.saveBox}>
                <div style={s.saveRowLabel}>상태</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {Object.entries(STATUS_LABELS).map(([k, label]) => (
                    <button key={k} onClick={() => setSaveOpts((o) => ({ ...o, status: k }))} style={saveOpts.status === k ? s.chipActive : s.chip}>{label}</button>
                  ))}
                </div>
                <div style={s.saveRowLabel}>추천 태그 (게임에서 그대로 사용)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[...new Set([...(analysisVerdict?.verdict?.tags || []).map((t) => t.name), ...saveOpts.tags])].map((t) => (
                    <button key={t} onClick={() => setSaveOpts((o) => ({ ...o, tags: toggleTag(o.tags, t) }))} style={saveOpts.tags.includes(t) ? s.chipActive : s.chip}>{t}</button>
                  ))}
                  {!(analysisVerdict?.verdict?.tags || []).length && !saveOpts.tags.length && <span style={{ fontSize: 11, color: "#576574" }}>추천 태그 없음</span>}
                </div>
                <div style={s.saveRowLabel}>용도 (복수 선택)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(PURPOSE_LABELS).map(([k, label]) => (
                    <button key={k} onClick={() => setSaveOpts((o) => ({ ...o, purposes: togglePurpose(o.purposes, k) }))} style={saveOpts.purposes.includes(k) || purposesFromTags(saveOpts.tags).includes(k) ? s.chipActive : s.chip}>{label}</button>
                  ))}
                </div>
                <input style={{ ...s.input, marginTop: 8, fontSize: 13 }} placeholder="메모 (선택)" value={saveOpts.memo} onChange={(e) => setSaveOpts((o) => ({ ...o, memo: e.target.value }))} />
                {collError && <div style={{ ...s.error, marginTop: 8, marginBottom: 0 }}>{collError}</div>}
                <button onClick={saveToMyList} disabled={saving} style={{ ...s.keepBtn, marginTop: 10 }}>{saving ? "저장 중…" : "저장"}</button>
              </div>
            )}
            {!streaming && (
              <div style={{ padding: "0 20px", display: "flex", gap: 8, marginTop: 20 }}>
                <button onClick={resetForReanalyze} style={{ ...s.resetBtn, margin: 0, flex: 1, borderColor: "#4ecdc4", color: "#4ecdc4" }}>🔄 IV 바꿔서 재분석</button>
                <button onClick={reset} style={{ ...s.resetBtn, margin: 0, flex: 1 }}>🔍 다른 포켓몬</button>
              </div>
            )}
          </div>
        ) : null}

        {/* ═══ RAID TAB ═══ */}
        {activeTab === "raid" && !raidResult && (
          <div style={s.card}>
            <div style={s.sectionHeader}>
              <span style={{ fontSize: 28 }}>⚔️</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e0e0e0" }}>레이드 보스 카운터 추천</div>
                <div style={{ fontSize: 11, color: "#8899aa" }}>보스를 검색하면 AI가 최적 카운터를 추천합니다</div>
              </div>
            </div>
            <div style={s.group}>
              <label style={s.label}>레이드 보스 검색</label>

              {enrichedRaidBosses.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#ff9f43", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ff9f43", animation: "blink 2s ease-in-out infinite" }} />
                      지금 레이드 중
                    </div>
                    <button onClick={() => setRaidBossesExpanded(!raidBossesExpanded)} style={{ background: "none", border: "none", color: "#8899aa", fontSize: 11, cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>
                      {raidBossesExpanded ? "▲ 접기" : `▼ 전체 보기 (${enrichedRaidBosses.length})`}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(raidBossesExpanded ? enrichedRaidBosses : enrichedRaidBosses.filter((b) => b.isPriority)).map((boss, i) => (
                      <button key={`${boss.id}-${boss.tierKey}-${i}`} onClick={() => selectCurrentRaidBoss(boss)}
                        style={{ ...s.raidBossChip, ...(boss.tierKey?.startsWith("shadow") ? { borderColor: "rgba(112,88,152,0.4)" } : boss.tierKey === "mega" ? { borderColor: "rgba(255,107,107,0.4)" } : {}) }}>
                        <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${boss.id}.png`} alt={boss.nameKr} style={{ width: 24, height: 24, imageRendering: "pixelated" }} onError={(e) => { e.target.style.display = "none"; }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>
                          {boss.isShadow ? "👤" : ""}{boss.nameKr}
                        </span>
                        <span style={{ fontSize: 9, color: boss.tierKey?.startsWith("shadow") ? "#a890f0" : boss.tierKey === "mega" ? "#ff6b6b" : "#8899aa" }}>
                          {boss.tier}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {raidBossesLoading && <div style={{ fontSize: 11, color: "#8899aa", marginBottom: 8 }}>레이드 보스 로딩 중...</div>}
              {raidBossesError && (
                <div style={s.sourceNotice}>⚠️ 현재 레이드 보스 목록을 불러오지 못했습니다 (ScrapedDuck: {raidBossesError}). 아래 검색으로 보스를 직접 선택하세요.</div>
              )}

              <div style={{ position: "relative" }}>
                <input style={s.input} value={raidBossName} onChange={(e) => handleRaidBossSearch(e.target.value)} onFocus={() => raidSuggestions.length > 0 && setShowRaidSugg(true)} onBlur={() => setTimeout(() => setShowRaidSugg(false), 200)} placeholder="예: 가이오가, Mewtwo..." />
                {raidSelectedPoke && (
                  <div style={s.miniInfo}>
                    <span style={{ color: "#ff9f43" }}>✓ #{raidSelectedPoke.id} {raidSelectedPoke.nameKr}</span>
                    <span style={{ opacity: 0.5 }}>공{raidSelectedPoke.baseAttack} / 방{raidSelectedPoke.baseDefense} / 체{raidSelectedPoke.baseStamina}</span>
                  </div>
                )}
                {showRaidSugg && (
                  <div style={s.suggBox}>
                    {raidSuggestions.map((p, i) => (
                      <div key={`${p.id}-${i}`} style={s.suggItem} onMouseDown={() => { setRaidBossName(p.nameKr); setRaidSelectedPoke(p); setRaidSuggestions([]); setShowRaidSugg(false); }}>
                        <div><span style={{ fontWeight: 600 }}>{p.nameKr}</span>{p.nameKr !== p.name && <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 6 }}>{p.name}</span>}</div>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>#{p.id}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {collection.length > 0 && <div style={s.collNote}>📋 보유목록 {collection.length}마리 반영 — 내 포켓몬 중 카운터 우선 추천</div>}
            {error && <div style={s.error}>{error}</div>}
            <button onClick={analyzeRaid} style={{ ...s.analyzeBtn, background: "linear-gradient(135deg,#ff9f43,#ee5a24)" }} disabled={loading}>
              {loading ? "⚔️ 분석 중..." : "⚔️ 카운터 추천받기"}
            </button>
            <button onClick={recommendRaidTeam} style={{ ...s.analyzeBtn, marginTop: 10, background: "transparent", border: "2px solid #4ecdc4", color: "#4ecdc4", boxShadow: "none" }} disabled={teamLoading || loading}>
              {teamLoading ? "📋 계산 중..." : "📋 내 목록으로 팀 추천 (AI 미사용)"}
            </button>
            {teamError && !teamResult && <div style={{ ...s.error, marginTop: 10, marginBottom: 0 }}>{teamError}</div>}
            {teamResult?.mode === "raid" && renderTeamPanel()}
          </div>
        )}
        {activeTab === "raid" && raidResult && (
          <div style={s.resultCard} ref={resultRef}>
            <div style={{ ...s.imgContainer, background: "radial-gradient(ellipse at center,rgba(255,159,67,0.12) 0%,transparent 70%)" }}>
              {raidSelectedPoke
                ? <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${raidSelectedPoke.id}.png`} alt={raidSelectedPoke.nameKr} style={s.pokemonImg} onError={(e) => { e.target.style.display = "none"; }} />
                : <div style={{ fontSize: 64 }}>⚔️</div>}
            </div>
            <div style={s.resultContent}>{streaming && thinking && <div style={s.thinking}>🧠 박사가 생각 중…</div>}{formatResult(raidResult)}{streaming && <span style={s.cursor}>▌</span>}</div>
            {raidModel && !streaming && <div style={{ padding: "4px 20px 0", fontSize: 10, color: "#576574", textAlign: "right" }}>{modelLine(raidModel)}</div>}
            {!streaming && <button onClick={resetRaid} style={s.resetBtn}>🔄 다른 보스 분석하기</button>}
          </div>
        )}

        {/* ═══ ROCKET TAB (2단계: 내 목록 기반 간이 추천) ═══ */}
        {activeTab === "rocket" && (
          <div style={s.card}>
            <div style={{ ...s.sectionHeader, background: "rgba(168,144,240,0.08)", borderColor: "rgba(168,144,240,0.2)" }}>
              <span style={{ fontSize: 28 }}>🚀</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e0e0e0" }}>로켓단 대전 팀 추천</div>
                <div style={{ fontSize: 11, color: "#8899aa" }}>내 목록에서 슬롯별 3마리 선정 · 간이 추천 (실드·에너지 단순화)</div>
              </div>
            </div>
            {rocketLoading && <div style={{ fontSize: 11, color: "#8899aa", marginBottom: 8 }}>라인업 로딩 중...</div>}
            {rocketError && <div style={s.sourceNotice}>⚠️ 로켓단 라인업을 불러오지 못했습니다 (ScrapedDuck: {rocketError}). 소스가 복구될 때까지 이 기능은 비활성화됩니다.</div>}
            {collection.length === 0 && !rocketError && <div style={s.sourceNotice}>내 목록이 비어 있습니다 — 분석 후 "내 목록에 저장"으로 포켓몬을 추가하면 팀을 추천합니다</div>}
            {rocketLineups && [["boss", "👑 보스"], ["leader", "🎖️ 간부"], ["grunt", "🧢 조무래기"]].map(([g, label]) => {
              const list = rocketLineups.filter((l) => lineupGroup(l) === g);
              if (!list.length) return null;
              return (
                <div key={g} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#a890f0", marginBottom: 6 }}>{label} ({list.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {list.map((l, i) => (
                      <button key={`${l.name}-${l.type}-${i}`} onClick={() => !teamLoading && recommendRocketTeam(l)}
                        style={{ ...s.raidBossChip, borderColor: selectedLineup === l ? "rgba(168,144,240,0.8)" : "rgba(168,144,240,0.25)", opacity: teamLoading ? 0.6 : 1 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>{g === "grunt" ? (l.type ? `${typeKr(l.type)} 타입` : l.name) : l.name}</span>
                        {g === "grunt" && l.type && <span style={{ fontSize: 9, color: "#8899aa" }}>{l.title?.replace(/-type/i, "").trim() || ""}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {selectedLineup && (
              <div style={{ fontSize: 11, color: "#8899aa", marginBottom: 8 }}>
                상대 라인업 — {[selectedLineup.firstPokemon, selectedLineup.secondPokemon, selectedLineup.thirdPokemon].map((slot, i) => `${i + 1}번: ${(slot || []).map((p) => rocketNameKr(p.name)).join("/") || "?"}`).join(" · ")}
              </div>
            )}
            {teamLoading && <div style={{ fontSize: 12, color: "#8899aa", marginBottom: 8 }}>📋 팀 계산 중...</div>}
            {teamError && !teamResult && <div style={s.error}>{teamError}</div>}
            {teamResult?.mode === "rocket" && renderTeamPanel()}
            <div style={{ fontSize: 10, color: "#576574", textAlign: "right", marginTop: 12 }}>라인업: LeekDuck via ScrapedDuck</div>
          </div>
        )}

        {/* ═══ EVENTS TAB ═══ */}
        {activeTab === "events" && (
          <div style={s.card}>
            <div style={s.sectionHeader}>
              <span style={{ fontSize: 28 }}>📅</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#e0e0e0" }}>이벤트 & 맥스배틀</div>
                <div style={{ fontSize: 11, color: "#8899aa" }}>LeekDuck · snacknap 자동 반영</div>
              </div>
            </div>

            {/* ─── 외부 소스 장애 안내 ─── */}
            {maxBattlesError && (
              <div style={s.sourceNotice}>⚠️ 맥스배틀 정보를 불러오지 못했습니다 (snacknap.com: {maxBattlesError}). 이 기능은 소스가 복구될 때까지 비활성화됩니다.</div>
            )}
            {eventsError && (
              <div style={s.sourceNotice}>⚠️ 이벤트 정보를 불러오지 못했습니다 (ScrapedDuck: {eventsError}).</div>
            )}

            {/* ─── 현재 파워스팟 (맥스배틀) ─── */}
            {(maxBattlesLoading || maxBattles.length > 0) && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#a890f0", marginBottom: maxBattlesExpanded ? 8 : 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#a890f0", animation: "blink 2s ease-in-out infinite" }} />
                  ⚡ 현재 파워스팟 맥스배틀
                  {maxBattlesLoading && <span style={{ fontSize: 10, color: "#576574" }}>로딩 중...</span>}
                  <button onClick={() => setMaxBattlesExpanded(!maxBattlesExpanded)} style={{ background: "none", border: "none", color: "#8899aa", fontSize: 11, cursor: "pointer", fontFamily: "'Outfit',sans-serif", marginLeft: "auto" }}>
                    {maxBattlesExpanded ? `▲ 접기` : `▼ 전체 보기 (${maxBattles.length})`}
                  </button>
                </div>
                {maxBattlesExpanded && (maxBattleResult ? (
                  <div>
                    <div style={{ ...s.resultCard, marginBottom: 12 }} ref={resultRef}>
                      <div style={{ ...s.imgContainer, background: "radial-gradient(ellipse at center,rgba(168,144,240,0.1) 0%,transparent 70%)", padding: "16px 20px 8px" }}>
                        {selectedMaxBoss?.id
                          ? <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${selectedMaxBoss.id}.png`} alt={selectedMaxBoss.nameKr} style={{ ...s.pokemonImg, width: 100, height: 100 }} onError={(e) => { e.target.style.display = "none"; }} />
                          : <div style={{ fontSize: 48 }}>⚡</div>}
                      </div>
                      <div style={{ padding: "4px 16px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(168,144,240,0.15)", color: "#a890f0", fontWeight: 600 }}>
                          {selectedMaxBoss?.isGmax ? "G-Max" : "D-Max"} {selectedMaxBoss?.nameKr}
                        </span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(168,144,240,0.08)", color: "#8899aa" }}>
                          {selectedMaxBoss?.tier}
                        </span>
                      </div>
                      <div style={s.resultContent}>{streaming && thinking && <div style={s.thinking}>🧠 박사가 생각 중…</div>}{formatResult(maxBattleResult)}{streaming && <span style={s.cursor}>▌</span>}</div>
                      {maxBattleModel && !streaming && <div style={{ padding: "4px 20px 0", fontSize: 10, color: "#576574", textAlign: "right" }}>{modelLine(maxBattleModel)}</div>}
                    </div>
                    {!streaming && (
                      <button onClick={resetMaxBattle} style={{ ...s.resetBtn, margin: "0 0 8px 0", width: "100%", borderColor: "#a890f0", color: "#a890f0" }}>
                        🔄 다른 파워스팟 보기
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {maxBattles.map((boss, i) => (
                      <button key={`${boss.id}-${boss.tierKey}-${i}`}
                        onClick={() => !loading && analyzeMaxBattle(boss)}
                        style={{ ...s.raidBossChip, borderColor: boss.isGmax ? "rgba(168,144,240,0.5)" : "rgba(168,144,240,0.25)", opacity: loading ? 0.6 : 1 }}>
                        <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${boss.id}.png`} alt={boss.nameKr} style={{ width: 24, height: 24, imageRendering: "pixelated" }} onError={(e) => { e.target.style.display = "none"; }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e0" }}>
                          {boss.isGmax ? "G✨ " : "D⚡ "}{boss.nameKr}
                        </span>
                        <span style={{ fontSize: 9, color: "#a890f0" }}>{boss.tier}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {eventsLoading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#8899aa", fontSize: 13 }}>이벤트 로딩 중...</div>
            )}

            {!eventsLoading && !eventsError && !maxBattlesError && events.length === 0 && maxBattles.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "#8899aa", fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                현재 진행 중인 이벤트가 없습니다
              </div>
            )}

            {/* 진행 중 */}
            {events.filter(e => e.isActive).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#4ecdc4", marginBottom: eventsExpanded ? 8 : 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#4ecdc4", animation: "blink 2s ease-in-out infinite" }} />
                    진행 중 ({events.filter(e => e.isActive).length})
                  </div>
                  <button onClick={() => setEventsExpanded(!eventsExpanded)} style={{ background: "none", border: "none", color: "#8899aa", fontSize: 11, cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>
                    {eventsExpanded ? "▲ 접기" : "▼ 펼치기"}
                  </button>
                </div>
                {eventsExpanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {events.filter(e => e.isActive).map((event, i) => (
                    <div key={i} style={s.eventCardActive}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e0e0", marginBottom: 4 }}>
                            {event.emoji} {event.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#8899aa" }}>
                            {event.end ? `~ ${formatEventTime(event.end)}` : "종료 미정"}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <span style={s.eventTypeBadge}>{event.label}</span>
                          <span style={{ fontSize: 10, color: "#4ecdc4", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {formatEventDuration(event)}
                          </span>
                        </div>
                      </div>
                      {event.link && (
                        <a href={event.link} target="_blank" rel="noopener noreferrer" style={s.eventLink}>
                          상세 보기 →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* 예정 */}
            {events.filter(e => e.isUpcoming).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ffd93d", marginBottom: upcomingExpanded ? 8 : 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>🔜 예정 ({events.filter(e => e.isUpcoming).length})</span>
                  <button onClick={() => setUpcomingExpanded(!upcomingExpanded)} style={{ background: "none", border: "none", color: "#8899aa", fontSize: 11, cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>
                    {upcomingExpanded ? "▲ 접기" : "▼ 펼치기"}
                  </button>
                </div>
                {upcomingExpanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {events.filter(e => e.isUpcoming).map((event, i) => (
                    <div key={i} style={s.eventCardUpcoming}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#c8d6e5", marginBottom: 4 }}>
                            {event.emoji} {event.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#8899aa" }}>
                            {event.start ? formatEventTime(event.start) : ""}{event.end ? ` ~ ${formatEventTime(event.end)}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          <span style={{ ...s.eventTypeBadge, background: "rgba(255,217,61,0.1)", color: "#ffd93d", borderColor: "rgba(255,217,61,0.2)" }}>{event.label}</span>
                          <span style={{ fontSize: 10, color: "#ffd93d", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {formatEventDuration(event)}
                          </span>
                        </div>
                      </div>
                      {event.link && (
                        <a href={event.link} target="_blank" rel="noopener noreferrer" style={s.eventLink}>
                          상세 보기 →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            <div style={{ fontSize: 10, color: "#576574", textAlign: "right", marginTop: 16 }}>
              이벤트: LeekDuck via ScrapedDuck · 맥스배틀: snacknap.com
            </div>
          </div>
        )}

        <div style={s.footer}>
          <p>포고박사 v1.2</p>
          {dataMeta && (
            <p style={{ fontSize: 10, opacity: 0.7, marginTop: 4, lineHeight: 1.6 }}>
              데이터 기준 시각: {fmtStamp(dataMeta.generatedAt)}{dataMeta.stale ? " (이전 캐시)" : ""}
              <br />
              {dataMeta.dataSources.map(sourceStatus).join(" · ")}
              {typeof dataMeta.votableCount === "number" && dataMeta.votableCount < 2 && (
                <><br /><span style={{ color: "#ff6b6b", fontWeight: 700 }}>⚠️ 투표 가능 소스 {dataMeta.votableCount}개 — 교차검증이 불가하므로 데이터 신뢰도가 낮습니다</span></>
              )}
              {dataMeta.dataWarningCount > 0 ? ` · 소스 불일치 ${dataMeta.dataWarningCount}건 (종족값 ${dataMeta.dataWarningCounts?.stat ?? 0} · 타입 ${dataMeta.dataWarningCounts?.type ?? 0} · 기술 다수결 ${dataMeta.dataWarningCounts?.moveMajority ?? 0} · 기술 미검증 ${dataMeta.dataWarningCounts?.moveUnverified ?? 0})` : ""}
            </p>
          )}
          <p style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>Pokémon GO는 Niantic, Inc.의 상표입니다</p>
        </div>
      </div>

      {/* ─── Collection FAB ─── */}
      <button style={s.fab} onClick={() => setShowCollection(true)}>
        📋
        {collection.length > 0 && <span style={s.fabBadge}>{collection.length}</span>}
      </button>

      {/* ─── 내 포켓몬 목록 Panel ─── */}
      {showCollection && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>📋 내 포켓몬 목록 ({collection.length})</h2>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={openScans} style={{ background: "none", border: "1px solid #2a3a5c", borderRadius: 8, color: "#4ecdc4", fontSize: 11, padding: "4px 8px", cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>📷 스캔 기록</button>
                <button onClick={openCleanup} style={{ background: "none", border: "1px solid #2a3a5c", borderRadius: 8, color: "#ffd93d", fontSize: 11, padding: "4px 8px", cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>🧹 정리 도우미</button>
                {collection.length > 0 && (
                  <button onClick={exportCollection} style={{ background: "none", border: "1px solid #2a3a5c", borderRadius: 8, color: "#8899aa", fontSize: 11, padding: "4px 8px", cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>📤 내보내기</button>
                )}
                <button style={s.collClose} onClick={() => { setShowCollection(false); setEditing(null); setCollStatusFilter("all"); setCollPurposeFilter("all"); setCollTierFilter("all"); setCollTagFilter("all"); }}>✕</button>
              </div>
            </div>
            {sessionNotice && <div style={s.sourceNotice}>{sessionNotice}</div>}
            {collError && <div style={s.error}>{collError}</div>}
            {saveNotice && <div style={s.collNote}>{saveNotice} <button onClick={() => setSaveNotice(null)} style={{ ...s.chip, fontSize: 10, marginLeft: 8, padding: "2px 6px" }}>닫기</button></div>}
            {collStatusFilter === "transfer" && collection.some((c) => c.status === "transfer") && (
              <button onClick={purgeTransferred} style={{ ...s.resetBtn, margin: "0 0 10px", padding: 8, width: "100%", borderColor: "#ff6b6b", color: "#ff6b6b" }}>🗑 보냄 처리 — 보낼 예정 {collection.filter((c) => c.status === "transfer").length}마리 목록에서 삭제</button>
            )}

            {ivMissingCount > 0 && <div style={s.sourceNotice}>개체값 미입력 {ivMissingCount}건이 목록 위쪽에 있습니다 — ✏️ 로 개체값·CP 를 입력하세요</div>}
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: 11, color: "#8899aa" }}>
              <span>📦 보관함 여유</span>
              {Object.entries(STORAGE_MODE_LABELS).map(([k, label]) => (
                <button key={k} onClick={() => changeStorageMode(k)} style={storageMode === k ? s.chipActive : s.chip}>{label}</button>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#576574" }}>
                {verdictLoading ? "판정 계산 중…" : verdictMeta ? `판정 ${verdictMeta.count}건 ${verdictMeta.ms}ms · PvPoke ${verdictMeta.pvpoke?.leagues?.length || 0}/3 리그 · 이벤트 대상 ${verdictMeta.events?.targets ?? 0}` : ""}
              </span>
              <button onClick={() => loadVerdicts()} disabled={verdictLoading} style={{ ...s.chip, fontSize: 10 }}>🔄 다시 판정</button>
            </div>
            {collection.length > 0 && (
              <div style={s.collFilterRow}>
                {[["all", "전체"], ["keep", "보관"], ["transfer", "보낼 예정"]].map(([k, label]) => (
                  <button key={k} onClick={() => setCollStatusFilter(k)} style={collStatusFilter === k ? s.collFilterActive : s.collFilterBtn}>
                    <span style={{ fontSize: 11 }}>{label}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{k === "all" ? collection.length : collection.filter((i) => i.status === k).length}</span>
                  </button>
                ))}
                <span style={{ width: 1, background: "#2a3a5c", margin: "0 2px" }} />
                {[["all", "용도 전체"], ...Object.entries(PURPOSE_LABELS)].map(([k, label]) => (
                  <button key={k} onClick={() => setCollPurposeFilter(k)} style={collPurposeFilter === k ? s.collFilterActive : s.collFilterBtn}>
                    <span style={{ fontSize: 11 }}>{label}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{k === "all" ? collection.length : collection.filter((i) => (i.purposes || []).includes(k)).length}</span>
                  </button>
                ))}
              </div>
            )}
            {collection.length > 0 && Object.keys(verdicts).length > 0 && (
              <div style={s.collFilterRow}>
                {[["all", "판정 전체"], ...Object.entries(TIER_LABEL)].map(([k, label]) => (
                  <button key={k} onClick={() => setCollTierFilter(k)} style={collTierFilter === k ? s.collFilterActive : s.collFilterBtn}>
                    <span style={{ fontSize: 11 }}>{label}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{k === "all" ? collection.length : collection.filter((i) => verdicts[i.id]?.tier === k).length}</span>
                  </button>
                ))}
                <span style={{ width: 1, background: "#2a3a5c", margin: "0 2px" }} />
                <select style={{ ...s.select, fontSize: 11, padding: "6px 28px 6px 8px", width: "auto" }} value={collTagFilter} onChange={(e) => setCollTagFilter(e.target.value)}>
                  <option value="all">태그 전체</option>
                  {[...new Set(collection.flatMap((i) => [...(i.tags || []), ...(verdicts[i.id]?.recommendedTags || [])]))].sort().map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {collection.length === 0 ? (
              <div style={s.collEmpty}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                <div>아직 저장된 포켓몬이 없습니다</div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.5 }}>분석 후 "내 목록에 저장" 버튼을 눌러 추가하세요</div>
              </div>
            ) : (
              <div style={s.collList}>
                {filteredCollection.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "30px 20px", color: "#8899aa", fontSize: 13 }}>조건에 맞는 포켓몬이 없습니다</div>
                ) : filteredCollection.map((item) => (
                  <div key={item.id} style={{ ...s.collItem, flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.pokemonId}.png`} alt={item.name} style={{ width: 40, height: 40, imageRendering: "pixelated" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e0e0" }}>
                          {item.isShiny ? "✨" : ""}{item.isShadow ? "👤" : ""}{item.name}
                          <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>#{item.pokemonId}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#8899aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          CP{item.cp || "?"} {item.ivPercent !== null ? `IV${item.ivPercent}% (${item.atkIv}/${item.defIv}/${item.staIv})` : "개체값 미입력"} | {item.fastMove || item.raw.charged_moves?.length ? `${item.fastMove ? krMove(item.fastMove) : "-"}/${(item.raw.charged_moves || []).map(krMove).join("·") || "-"}` : "기술 미입력"}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                          <span style={{ ...s.tagBadge, color: item.status === "transfer" ? "#ff6b6b" : "#4ecdc4" }}>{STATUS_LABELS[item.status] || item.status}</span>
                          {(item.purposes || []).map((p) => <span key={p} style={{ ...s.tagBadge, color: "#a890f0" }}>{PURPOSE_LABELS[p] || p}</span>)}
                          {(item.tags || []).map((t) => <span key={"t" + t} style={{ ...s.tagBadge, color: "#4ecdc4", border: "1px solid rgba(78,205,196,0.3)" }}>🏷 {t}</span>)}
                          {(item.raw.game_tags || []).length > 0 && <span style={{ ...s.tagBadge, color: "#ffd93d", border: "1px solid rgba(255,217,61,0.3)" }} title={item.raw.game_tags.join(", ")}>🎮 게임 태그 있음</span>}
                          {item.source === "import" && <span style={{ ...s.tagBadge, color: "#8899aa" }}>가져옴</span>}
                          {item.memo && <span style={{ ...s.tagBadge, color: "#ffd93d" }}>📝 {item.memo}</span>}
                        </div>
                        {verdicts[item.id] && (() => { const v = verdicts[item.id]; const sameTags = JSON.stringify([...(item.tags || [])].sort()) === JSON.stringify([...(v.recommendedTags || [])].sort()) && (item.status === "transfer") === (v.tier === "transfer"); return (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 11, color: TIER_COLORS[v.tier] || "#8899aa", whiteSpace: "pre-wrap" }} title={(v.tags || []).map((t) => `${t.name}: ${t.reason}`).join("\n")}>{v.summary}</div>
                            {v.event && <div style={{ fontSize: 10, color: "#ffd93d" }}>{v.event.note}</div>}
                            {/* 4-C 추천 기술 (기술은 캡처하지 않음 — 기술머신·이벤트로 바꾼다) */}
                            {(v.tags || []).filter((t) => (t.tier === "main" || t.tier === "hold") && t.moves).map((t) => (
                              <div key={"mv" + t.name} style={{ fontSize: 10, color: "#4ecdc4" }}>🎯 {t.name} 추천 기술: {[t.moves.fastKr || t.moves.fast, ...(t.moves.chargedKr?.length ? t.moves.chargedKr : t.moves.charged || [])].filter(Boolean).join("/")}{t.moves.special ? <span style={{ color: "#ffd93d" }}> ⚠ 특수 기술머신</span> : ""}{t.evolveAtEvent ? <span style={{ color: "#ffd93d" }}> · {t.evolveAtEvent}</span> : ""}</div>
                            ))}
                            {/* 4-C 게임 태그 vs 판정 불일치: 게임 태그 우선(박사행 제외 유지), 표시만 */}
                            {(item.raw.game_tags || []).length > 0 && (v.tier === "transfer" || !(item.raw.game_tags || []).some((g) => (v.recommendedTags || []).includes(g))) && (
                              <div style={{ fontSize: 10, color: "#ffd93d" }}>⚠️ 불일치 — 판정: {TIER_LABEL[v.tier] || v.tier}{(v.recommendedTags || []).length ? `(${v.recommendedTags.join(", ")})` : ""} / 게임 태그: {item.raw.game_tags.join(", ")} (게임 태그 우선, 자동 변경 없음)</div>
                            )}
                            {!sameTags && <button onClick={() => applyRecommended(item)} style={{ ...s.chip, fontSize: 10, marginTop: 3, padding: "3px 8px" }}>{v.tier === "transfer" ? "박사행으로 표시" : `추천 태그로 저장 (${(v.recommendedTags || []).join(", ") || "태그 없음"})`}</button>}
                          </div>
                        ); })()}
                      </div>
                      <button style={s.collIconBtn} title="다시 분석" onClick={() => reanalyzeEntry(item)}>🔄</button>
                      <button style={s.collIconBtn} title="수정" onClick={() => setEditing(editing?.id === item.id ? null : { id: item.id, status: item.status, purposes: item.purposes || [], tags: item.tags || [], memo: item.memo || "", cp: item.cp || "", atk: Number.isInteger(item.atkIv) ? item.atkIv : "", def: Number.isInteger(item.defIv) ? item.defIv : "", sta: Number.isInteger(item.staIv) ? item.staIv : "", fast: item.raw.fast_move || "", charged: [item.raw.charged_moves?.[0] || "", item.raw.charged_moves?.[1] || ""] })}>✏️</button>
                      <button style={s.collRemove} onClick={() => removeFromCollection(item.id)}>🗑</button>
                    </div>
                    {editing?.id === item.id && (
                      <div style={{ ...s.saveBox, margin: "10px 0 0", padding: 10 }}>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          {Object.entries(STATUS_LABELS).map(([k, label]) => (
                            <button key={k} onClick={() => setEditing((e) => ({ ...e, status: k }))} style={editing.status === k ? s.chipActive : s.chip}>{label}</button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {Object.entries(PURPOSE_LABELS).map(([k, label]) => (
                            <button key={k} onClick={() => setEditing((e) => ({ ...e, purposes: togglePurpose(e.purposes, k) }))} style={editing.purposes.includes(k) ? s.chipActive : s.chip}>{label}</button>
                          ))}
                        </div>
                        <div style={{ ...s.saveRowLabel, margin: "8px 0 4px" }}>태그</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {[...new Set([...(verdicts[item.id]?.tags || []).map((t) => t.name), ...(editing.tags || [])])].map((t) => (
                            <button key={t} onClick={() => setEditing((e) => ({ ...e, tags: toggleTag(e.tags || [], t) }))} style={(editing.tags || []).includes(t) ? s.chipActive : s.chip}>{t}</button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <input style={{ ...s.input, fontSize: 13, padding: "8px 10px" }} type="number" placeholder="CP" value={editing.cp} onChange={(e) => setEditing((ed) => ({ ...ed, cp: e.target.value }))} />
                          {[["atk", "공격"], ["def", "방어"], ["sta", "HP"]].map(([k, label]) => (
                            <input key={k} style={{ ...s.input, fontSize: 13, padding: "8px 10px" }} type="number" min={0} max={15} placeholder={label} value={editing[k]} onChange={(e) => setEditing((ed) => ({ ...ed, [k]: e.target.value }))} />
                          ))}
                        </div>
                        {(editing.atk === "" && editing.def === "" && editing.sta === "") && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 4 }}>개체값 미입력 — 공격/방어/HP 를 입력하면 저장 시 반영됩니다</div>}
                        {(() => {
                          const sp = speciesOf(item);
                          const anyMove = editing.fast || editing.charged.some(Boolean);
                          return (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ ...s.saveRowLabel, margin: "0 0 4px" }}>기술 {!anyMove && <span style={{ color: "#ffd93d" }}>· 기술 미입력</span>}</div>
                              {sp ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  <select style={{ ...s.select, fontSize: 13, padding: "8px 32px 8px 10px" }} value={editing.fast} onChange={(e) => setEditing((ed) => ({ ...ed, fast: e.target.value }))}>
                                    <option value="">빠른기술 (미입력)</option>{moveOptions(sp, "fast")}
                                  </select>
                                  {[0, 1].map((i) => (
                                    <select key={i} style={{ ...s.select, fontSize: 13, padding: "8px 32px 8px 10px" }} value={editing.charged[i]} onChange={(e) => setEditing((ed) => { const c = [...ed.charged]; c[i] = e.target.value; return { ...ed, charged: c }; })}>
                                      <option value="">{i === 0 ? "차징기술 1 (미입력)" : "차징기술 2 (선택, 없으면 비움)"}</option>{moveOptions(sp, "charged")}
                                    </select>
                                  ))}
                                </div>
                              ) : <div style={{ fontSize: 10, color: "#8899aa" }}>포켓몬 데이터에서 종을 찾지 못해 기술 목록을 표시할 수 없습니다</div>}
                            </div>
                          );
                        })()}
                        <input style={{ ...s.input, marginTop: 8, fontSize: 13 }} placeholder="메모" value={editing.memo} onChange={(e) => setEditing((ed) => ({ ...ed, memo: e.target.value }))} />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={saveEdit} style={{ ...s.keepBtn, flex: 1, padding: 8 }}>저장</button>
                          <button onClick={() => setEditing(null)} style={{ ...s.resetBtn, flex: 1, margin: 0, padding: 8 }}>취소</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 4-B5 정리 도우미 Panel ─── */}
      {showCleanup && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>🧹 정리 도우미</h2>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => loadCleanup()} disabled={cleanupBusy} style={{ ...s.chip, fontSize: 10 }}>🔄</button>
                <button style={s.collClose} onClick={() => setShowCleanup(false)}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.6, marginBottom: 10 }}>
              판정 결과를 포켓몬GO <b>검색어</b>로 만듭니다. 게임을 대신 조작하지 않습니다 — 검색창에 붙여넣고, <b style={{ color: "#ffd93d" }}>결과 수가 "예상 N마리"와 같을 때만</b> 전체 선택 → 박사에게 보내기/태그. 형식 <code>도감번호,…&hp…,…</code>(한국어판 확인: & 절마다 , 는 OR). 박사행 묶음은 다른 개체가 섞일 수 있으면 쪼개거나 만들지 않고, 태그 묶음은 만들되 "다른 개체 최대 n마리 포함 가능"을 표시합니다. 게임 태그가 이미 달린 개체는 박사행에서 제외합니다. 박사행은 되돌릴 수 없습니다.
            </div>
            <div style={{ ...s.sourceNotice, marginBottom: 10 }}>⚠️ {cleanup?.note || "예상 수는 앱이 아는 개체(스캔 기록 + 내 목록) 기준입니다. 앱이 모르는 같은 종·HP 개체가 게임에 있으면 결과가 더 나옵니다 — 게임 결과 수가 예상과 다르면 보내지 마세요."}</div>
            {cleanup?.protectNote && <div style={{ ...s.sourceNotice, marginBottom: 10 }}>🛡 {cleanup.protectNote}</div>}
            {cleanup?.backfill?.ran && <div style={{ fontSize: 10, color: "#4ecdc4", marginBottom: 8 }}>🧹 스캔 기록 정리 1회 실행: 대체된 과거 기록 {cleanup.backfill.superseded}건 · 재스캔 필요 표시 {cleanup.backfill.conflicts ?? 0}건 (규칙 {cleanup.backfill.version})</div>}
            {cleanupError && <div style={s.error}>{cleanupError}</div>}
            {cleanupBusy && !cleanup && <div style={{ fontSize: 12, color: "#8899aa" }}>계산 중…</div>}
            {cleanup && cleanup.categories.length === 0 && <div style={{ fontSize: 12, color: "#576574", padding: "8px 0" }}>정리할 대상이 없습니다 (스캔 기록·내 목록의 판정 기준)</div>}
            {cleanup && cleanup.categories.map((cat) => (
              <div key={cat.category} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cat.category === "transfer" ? "#ff6b6b" : cat.category === "collect" ? "#a890f0" : "#4ecdc4" }}>{cat.label}{cat.fixed ? " — 이로치·배경·XXL 은 게임 검색어로" : ` — 대상 ${cat.count}마리 · 묶음 ${cat.groups.length}${cat.skipped.length ? ` · 제외 ${cat.skipped.length}` : ""}`}{cat.protect ? " · 🛡 보호 조건 포함" : ""}</div>
                {cat.groups.map((g, i) => (
                  <div key={g.query} style={{ ...s.collItem, flexDirection: "column", alignItems: "stretch", marginTop: 6, opacity: cleanupDone[g.query] ? 0.5 : 1 }}>
                    <div style={{ fontSize: 11, color: "#8899aa" }}>{cat.fixed ? <b style={{ color: "#a890f0" }}>{g.label}</b> : <>묶음 {i + 1}/{cat.groups.length} · <b style={{ color: "#ffd93d" }}>{cat.protect ? `게임 결과 ≤ 예상 ${g.expected}마리` : `예상 ${g.expected}마리`}</b></>}{g.withCp ? " · CP 조건 포함" : ""}{g.overlap > 0 ? <span style={{ color: "#ff6b6b" }}> · ⚠️ 다른 개체 최대 {g.overlap}마리 포함 가능</span> : ""}{cat.fixed ? " · 예상 수 없음(앱이 모르는 정보 — 게임 결과를 보고 태그)" : ` · ${g.targetIds.map((id) => cleanup.names[id]).filter(Boolean).slice(0, 8).join(", ")}${g.targetIds.length > 8 ? " …" : ""}`}</div>
                    <code style={{ fontSize: 12, color: "#e0e0e0", wordBreak: "break-all", marginTop: 4, userSelect: "all" }}>{g.query}</code>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={() => copyQuery(g)} style={{ ...s.chip, fontSize: 11, flex: 1 }}>{copied === g.query ? "복사됨 ✓" : "📋 복사"}</button>
                      {!cleanupDone[g.query] && !cat.fixed && <button onClick={() => cleanupGroupDone(cat, g)} disabled={cleanupBusy} style={{ ...s.chip, fontSize: 11, color: cat.category === "transfer" ? "#ff6b6b" : "#4ecdc4" }}>{cat.category === "transfer" ? "보냄 처리 완료" : "완료(정리)"}</button>}
                    </div>
                    {copied === g.query && !cat.fixed && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 4 }}>{cat.protect ? `⚠️ 게임 결과 ≤ 예상 ${g.expected}마리. 적으면 보호 대상(태그·이로치·반짝반짝·XXL·배경)이 빠진 것, 많으면 보내지 마세요.` : `⚠️ 게임 검색 결과가 정확히 ${g.expected}마리일 때만 전체 선택하세요. 다르면 진행하지 마세요.`}</div>}
                  </div>
                ))}
                {cat.skipped.length > 0 && <div style={{ fontSize: 10, color: "#576574", marginTop: 4 }}>제외: {cat.skipped.map((x) => `${cleanup.names[x.id] || x.id}(${x.reason})`).join(", ")}</div>}
              </div>
            ))}
            {cleanup && <div style={{ fontSize: 9, color: "#576574" }}>알려진 개체 {cleanup.population} (스캔 기록 + 내 목록, 게임 태그 있음 {cleanup.gameTagged ?? 0}) 기준으로 교차곱 충돌 검사 · 검색어 길이 상한 {cleanup.maxLen}자 · {fmtStamp(cleanup.at)}</div>}
          </div>
        </div>
      )}

      {/* ─── 4-B 스캔 기록 Panel ─── */}
      {showScans && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>📷 스캔 기록 ({scans.length})</h2>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={loadScans} disabled={scanBusy} style={{ ...s.chip, fontSize: 10 }}>🔄</button>
                <button style={s.collClose} onClick={() => setShowScans(false)}>✕</button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.6, marginBottom: 10 }}>앱의 연속 스캔(평가 화면을 넘기기만)으로 기록된 개체입니다. 자동 저장되지 않으며, 여기서 검토 후 저장합니다. 저장 시 기존 항목(종·개체값·포획일 또는 종·CP·HP 일치)은 갱신됩니다. 14일 후 자동 삭제.</div>
            {scanError && <div style={s.error}>{scanError}</div>}
            {scans.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <button onClick={() => scanAction("save", scans.map((x) => x.id))} disabled={scanBusy} style={{ ...s.keepBtn, width: "auto", padding: "8px 12px" }}>✅ 추천대로 전부 저장 ({scans.length})</button>
                <button onClick={() => scanAction("save", scans.filter((x) => x.verdict?.tier !== "transfer").map((x) => x.id))} disabled={scanBusy} style={{ ...s.chip, fontSize: 11 }}>보관 추천만 저장 ({scans.filter((x) => x.verdict?.tier !== "transfer").length})</button>
                <button onClick={() => { if (window.confirm("스캔 기록을 모두 지웁니다 (내 목록은 그대로). 계속할까요?")) scanAction("clear", []); }} disabled={scanBusy} style={{ ...s.chip, fontSize: 11, color: "#ff6b6b" }}>전부 지우기</button>
              </div>
            )}
            {scanSessions.length > 0 && (
              <details style={{ marginBottom: 10 }}>
                <summary style={{ fontSize: 11, color: "#8899aa", cursor: "pointer" }}>📈 세션 측정값 ({scanSessions.length})</summary>
                {scanSessions.map((ss) => { const m = ss.metrics || {}; const a = m.avgMs || {}; const g = m.gate; const f = m.fail; return (
                  <div key={ss.session_id} style={{ fontSize: 10, color: "#8899aa", padding: "4px 0", borderBottom: "1px solid #1e2a44" }}>
                    <b style={{ color: "#c8d6e5" }}>{ss.session_id}</b> · {m.minutes}분 · 프레임 {m.frames} · 분석 {m.analyses} · 기록 {m.recorded} (중복 {m.duplicates}, CP 미확인 {m.noCp})
                    {g && <> · 게이트 미개방: 불안정 {g.unstable} / 직전과 동일 {g.same} / 평가 화면 아님 {g.notAppraisal} (열림 {g.open})</>}
                    {f && <> · 분석 실패: 평가 아님 {f.notAppraisal} / 종 미확정 {f.noSpecies} / CP 없음 {f.noCp} / 막대-CP 모순 {f.mismatch} / 중복 {f.duplicate}</>}
                    {" "}· 평균 ms 캡처 {a.capture} 서명 {a.fingerprint} OCR {a.ocr} 파싱 {a.parse ?? "-"} 막대 {a.bars} · 전송 {m.queue?.sent}/대기 {m.queue?.pending} · 배터리 {m.battery?.start}%→{m.battery?.end}%{m.debugUploads ? ` · 디버그 업로드 ${m.debugUploads}` : ""}
                  </div>
                ); })}
              </details>
            )}
            {scans.length === 0 && !scanBusy && <div style={{ fontSize: 12, color: "#576574", padding: "8px 0" }}>기록이 없습니다 — 앱에서 "연속 스캔" 을 켜고 평가 화면을 넘기세요</div>}
            {scans.map((it) => (
              <div key={it.id} style={{ ...s.collItem, flexDirection: "column", alignItems: "stretch", marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${it.species_id}.png`} alt="" style={{ width: 36, height: 36, imageRendering: "pixelated" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>{it.is_shadow ? "👤" : ""}{it.name_kr}{it.form && it.form !== "Normal" ? ` (${it.form})` : ""} <span style={{ fontSize: 10, opacity: 0.5 }}>{fmtStamp(it.created_at)} · {it.session_id}</span></div>
                    <div style={{ fontSize: 11, color: "#8899aa" }}>CP{it.cp || "?"} HP{it.hp || "?"} {Number.isInteger(it.atk_iv) ? `${it.atk_iv}/${it.def_iv}/${it.sta_iv} (${Math.round(((it.atk_iv + it.def_iv + it.sta_iv) / 45) * 100)}%)` : "개체값 미확정"}{it.level ? ` L${it.level}` : ""}{it.stars != null ? ` ★${it.stars}` : ""}{it.cp == null ? " · CP 미확인(레벨 범위)" : ""}{it.recheck ? ` · ⚠️ ${it.recheck_reason || "재확인 필요(CP/HP·막대 불일치)"}` : ""}{(it.game_tags || []).length ? ` · 🏷 게임 태그 있음(${it.game_tags.join(", ")})` : ""}</div>
                    {it.verdict ? <div style={{ fontSize: 11, color: TIER_COLORS[it.verdict.tier] || "#8899aa", marginTop: 2 }}>{it.verdict.summary}{it.verdict.event ? ` · ${it.verdict.event}` : ""}</div> : <div style={{ fontSize: 10, color: "#576574", marginTop: 2 }}>판정 계산 중 — 🔄 로 새로고침</div>}
                    {(it.verdict?.tags || []).filter((t) => (t.tier === "main" || t.tier === "hold") && t.moves).map((t) => (
                      <div key={"mv" + t.name} style={{ fontSize: 10, color: "#4ecdc4" }}>🎯 {t.name} 추천 기술: {[t.moves.fastKr || t.moves.fast, ...(t.moves.chargedKr?.length ? t.moves.chargedKr : t.moves.charged || [])].filter(Boolean).join("/")}{t.moves.special ? <span style={{ color: "#ffd93d" }}> ⚠ 특수 기술머신</span> : ""}{t.evolveAtEvent ? <span style={{ color: "#ffd93d" }}> · {t.evolveAtEvent}</span> : ""}</div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={() => scanAction("save", [it.id], { status: "keep" })} disabled={scanBusy} style={{ ...s.chip, fontSize: 11, flex: 1 }}>보관{it.verdict?.recommendedTags?.length ? ` (${it.verdict.recommendedTags.join(", ")})` : ""}</button>
                  <button onClick={() => scanAction("save", [it.id], { status: "transfer" })} disabled={scanBusy} style={{ ...s.chip, fontSize: 11, color: "#ff6b6b" }}>박사행</button>
                  <button onClick={() => scanAction("dismiss", [it.id])} disabled={scanBusy} style={{ ...s.chip, fontSize: 11, color: "#8899aa" }}>숨김</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 3-0 보완: 기기 연결 Panel ─── */}
      {showDevices && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>📱 기기 연결</h2>
              <button style={s.collClose} onClick={() => setShowDevices(false)}>✕</button>
            </div>
            <div style={s.collAnalysis}>
              <div style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.7 }}>
                안드로이드 수집기 앱을 이 계정에 연결합니다. 아래에서 코드를 발급하고 앱의 "연결 코드" 화면에 입력하세요. 코드는 <b style={{ color: "#ffd93d" }}>10분간 1회</b>만 쓸 수 있고, 앱이 저장한 포켓몬은 이 내 목록에 바로 표시됩니다.
              </div>
            </div>
            {devError && <div style={{ ...s.error, marginTop: 12 }}>{devError}</div>}
            {inApp ? (
              <div style={{ ...s.collNote, marginTop: 12, marginBottom: 0 }}>앱 안에서 열린 화면입니다 — 이 기기는 이미 연결되어 있어 코드 발급이 필요 없습니다. 다른 기기(PC 브라우저)는 앱 첫 화면의 "웹 로그인 코드"로 로그인하세요.</div>
            ) : pairCode ? (
              <div style={{ ...s.collAnalysis, marginTop: 12, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#8899aa" }}>연결 코드 (앱에 입력)</div>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: "#4ecdc4", margin: "6px 0", fontVariantNumeric: "tabular-nums" }}>{pairCode.code.slice(0, 4)} {pairCode.code.slice(4)}</div>
                <div style={{ fontSize: 10, color: "#ffd93d" }}>만료 {fmtStamp(pairCode.expiresAt)} · O/0/1/I/L 은 사용하지 않습니다</div>
              </div>
            ) : (
              <button onClick={issuePairCode} disabled={devBusy} style={{ ...s.keepBtn, marginTop: 12 }}>{devBusy ? "발급 중…" : "🔑 연결 코드 발급"}</button>
            )}
            <div style={{ ...s.saveRowLabel, marginTop: 16 }}>연결된 기기 ({devices.filter((d) => !d.revoked_at).length})</div>
            {devices.filter((d) => !d.revoked_at).length === 0 ? (
              <div style={{ fontSize: 12, color: "#576574", padding: "8px 0" }}>연결된 기기가 없습니다</div>
            ) : devices.filter((d) => !d.revoked_at).map((d) => (
              <div key={d.id} style={{ ...s.collItem, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>{d.name}</div>
                  <div style={{ fontSize: 10, color: "#8899aa" }}>연결 {fmtStamp(d.created_at)} · 마지막 사용 {d.last_used_at ? fmtStamp(d.last_used_at) : "없음"}</div>
                </div>
                <button onClick={() => doRevokeDevice(d)} disabled={devBusy} style={{ ...s.collIconBtn, color: "#ff6b6b", fontSize: 11 }}>해제</button>
              </div>
            ))}
            {devices.some((d) => d.revoked_at) && <div style={{ fontSize: 10, color: "#576574", marginTop: 6 }}>해제된 기기 {devices.filter((d) => d.revoked_at).length}대 (숨김)</div>}

            {!inApp && <>
            <div style={{ ...s.saveRowLabel, marginTop: 18 }}>🔑 앱 코드로 로그인 (계정 복구)</div>
            <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.6 }}>이 브라우저의 세션을 잃었을 때(브라우저 종료·시크릿 창 등) 앱 → "웹 로그인 코드" 로 받은 8자리 코드를 입력하면 앱이 연결된 계정으로 돌아옵니다.{account?.appLinked ? " 현재 이 브라우저는 앱 연결 계정입니다." : ""}</div>
            {appLoginInfo && <div style={{ ...s.collNote, marginTop: 8 }}>{appLoginInfo}</div>}
            {appMerge ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => appMergeDecide(true)} disabled={devBusy} style={{ ...s.keepBtn, flex: 1, padding: 8 }}>합치기</button>
                <button onClick={() => appMergeDecide(false)} disabled={devBusy} style={{ ...s.resetBtn, flex: 1, margin: 0, padding: 8 }}>합치지 않음</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input style={{ ...s.input, fontSize: 15, letterSpacing: 3 }} placeholder="ABCD EFGH" value={appCode} onChange={(e) => setAppCode(e.target.value.toUpperCase())} disabled={devBusy} />
                <button onClick={loginWithApp} disabled={devBusy || appCode.replace(/[\s-]/g, "").length !== 8} style={{ ...s.keepBtn, width: "auto", padding: "8px 14px" }}>로그인</button>
              </div>
            )}
            {collection.length > 0 && !appMerge && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 6 }}>이 브라우저의 목록 {collection.length}건은 로그인 후 합칠지 물어봅니다</div>}
            </>}

            <div style={{ ...s.saveRowLabel, marginTop: 18 }}>🐞 디버그 캡처</div>
            <div style={{ fontSize: 11, color: "#8899aa" }}>앱 디버그 모드에서 올린 캡처(상태바 가림)·OCR 원문·판독값. 7일 후 자동 삭제.</div>
            <button onClick={openDebug} style={{ ...s.resetBtn, margin: "8px 0 0", padding: 8, width: "100%" }}>디버그 캡처 보기</button>
          </div>
        </div>
      )}

      {/* ─── 3-1c 디버그 캡처 Panel ─── */}
      {showDebug && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>🐞 디버그 캡처 ({debugRows.length})</h2>
              <button style={s.collClose} onClick={() => setShowDebug(false)}>✕</button>
            </div>
            {debugError && <div style={s.error}>{debugError}</div>}
            {debugRows.length === 0 && !debugError && <div style={{ fontSize: 12, color: "#576574", padding: "8px 0" }}>기록이 없습니다 — 앱 설정에서 디버그 모드를 켜고 캡처하세요</div>}
            {debugRows.map((r) => (
              <div key={r.id} style={{ ...s.collItem, flexDirection: "column", alignItems: "stretch", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#e0e0e0" }}>{r.kind} · {fmtStamp(r.created_at)}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => exportDebug(r)} style={{ ...s.collIconBtn, fontSize: 11 }}>JSON</button>
                    <button onClick={() => removeDebug(r)} style={{ ...s.collIconBtn, color: "#ff6b6b", fontSize: 11 }}>삭제</button>
                  </span>
                </div>
                {r.result && <div style={{ fontSize: 11, color: "#4ecdc4", marginTop: 4, whiteSpace: "pre-wrap" }}>{r.result}</div>}
                {debugUrls[r.id] && <a href={debugUrls[r.id]} target="_blank" rel="noopener noreferrer"><img src={debugUrls[r.id]} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "contain", marginTop: 6, borderRadius: 8, background: "#000" }} /></a>}
                {r.image_path && !debugUrls[r.id] && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 4 }}>이미지 URL 생성 실패 (storage 정책 확인)</div>}
                {Array.isArray(r.ocr) && r.ocr.length > 0 && <div style={{ fontSize: 10, color: "#8899aa", marginTop: 4 }}>OCR: {r.ocr.join(" | ")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 3-0 계정 연결 Panel (NEXT_PUBLIC_ENABLE_EMAIL_LINK=true 일 때만) ─── */}
      {showAccount && EMAIL_LINK_ENABLED && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>{account && !account.anonymous ? "👤 계정" : "🔗 계정 연결"}</h2>
              <button style={s.collClose} onClick={() => { if (acct.step === "merge") return; setShowAccount(false); }}>✕</button>
            </div>
            <div style={s.collAnalysis}>
              <div style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.7 }}>
                {account && !account.anonymous
                  ? <>현재 계정: <b style={{ color: "#4ecdc4" }}>{account.email}</b><br />다른 기기(안드로이드 앱·다른 브라우저)에서 같은 이메일로 로그인하면 같은 목록을 봅니다.</>
                  : <>현재 <b style={{ color: "#ffd93d" }}>익명 계정</b>입니다 (이 기기에만 저장). 이메일을 연결하면 다른 기기에서도 같은 목록을 쓸 수 있고, 브라우저 데이터를 지워도 복구됩니다. 연결하지 않아도 계속 쓸 수 있습니다.</>}
              </div>
            </div>
            {acct.info && <div style={{ ...s.collNote, marginTop: 12 }}>{acct.info}</div>}
            {acct.error && <div style={{ ...s.error, marginTop: 12 }}>{acct.error}</div>}

            {acct.step === "merge" ? (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => acctMerge(true)} disabled={acct.busy} style={{ ...s.keepBtn, flex: 1 }}>{acct.busy ? "병합 중…" : "합치기"}</button>
                <button onClick={() => acctMerge(false)} disabled={acct.busy} style={{ ...s.resetBtn, flex: 1, margin: 0 }}>합치지 않음</button>
              </div>
            ) : acct.step === "done" ? (
              <button onClick={() => setShowAccount(false)} style={{ ...s.keepBtn, marginTop: 12 }}>닫기</button>
            ) : !acct.mode ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                {account?.anonymous && <button onClick={() => acctSet({ mode: "link", error: null, info: null })} style={s.keepBtn}>📧 이 계정에 이메일 연결 (목록·사용 횟수 유지)</button>}
                <button onClick={() => acctSet({ mode: "signin", error: null, info: null })} style={{ ...s.keepBtn, borderColor: "#a890f0", color: "#a890f0", background: "rgba(168,144,240,0.08)" }}>🔑 다른 기기 계정으로 로그인 (같은 이메일)</button>
                {account && !account.anonymous && <button onClick={acctSignOut} disabled={acct.busy} style={{ ...s.resetBtn, margin: 0 }}>로그아웃</button>}
              </div>
            ) : (
              <div style={{ ...s.saveBox, margin: "12px 0 0" }}>
                <div style={s.saveRowLabel}>{acct.mode === "link" ? "연결할 이메일" : "로그인할 이메일"}</div>
                <input style={s.input} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={acct.email} disabled={acct.step === "code" || acct.busy} onChange={(e) => acctSet({ email: e.target.value })} />
                {acct.step === "email" ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={acctRequestCode} disabled={acct.busy} style={{ ...s.keepBtn, flex: 1 }}>{acct.busy ? "전송 중…" : "인증 코드 보내기"}</button>
                    <button onClick={() => acctSet({ mode: null, error: null, info: null })} disabled={acct.busy} style={{ ...s.resetBtn, flex: 1, margin: 0 }}>뒤로</button>
                  </div>
                ) : (
                  <>
                    <div style={s.saveRowLabel}>메일로 받은 6자리 코드</div>
                    <input style={{ ...s.input, letterSpacing: 4, fontSize: 18 }} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={acct.code} disabled={acct.busy} onChange={(e) => acctSet({ code: e.target.value })} />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={acctVerifyCode} disabled={acct.busy} style={{ ...s.keepBtn, flex: 1 }}>{acct.busy ? "확인 중…" : acct.mode === "link" ? "연결하기" : "로그인"}</button>
                      <button onClick={() => acctSet({ step: "email", code: "", error: null, info: null })} disabled={acct.busy} style={{ ...s.resetBtn, flex: 1, margin: 0 }}>다시 보내기</button>
                    </div>
                  </>
                )}
                {acct.mode === "signin" && account?.anonymous && collection.length > 0 && acct.step === "email" && (
                  <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 8 }}>이 기기의 익명 목록 {collection.length}건은 로그인 후 합칠지 물어봅니다</div>
                )}
              </div>
            )}
            <div style={{ fontSize: 10, color: "#576574", marginTop: 16, lineHeight: 1.6 }}>
              비밀번호 없이 이메일 코드로만 인증합니다. 이메일은 로그인 용도로만 쓰이며 목록 데이터와 함께 Supabase 에 저장됩니다.
            </div>
          </div>
        </div>
      )}

      {/* ─── Compare Panel ─── */}
      {showCompare && selectedPokemon && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>⚖️ 개체 비교</h2>
              <button style={s.collClose} onClick={() => { setShowCompare(false); setCompareResult(null); setCompareTarget(null); }}>✕</button>
            </div>
            {!compareResult ? (
              <div>
                <div style={{ fontSize: 13, color: "#8899aa", marginBottom: 16 }}>현재 분석 중인 {selectedPokemon.nameKr}와 비교할 보유 개체를 선택하세요:</div>
                <div style={{ ...s.compareCard, borderColor: "rgba(0,212,170,0.3)" }}>
                  <div style={{ fontSize: 11, color: "#4ecdc4", fontWeight: 600, marginBottom: 6 }}>현재 분석 중</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${selectedPokemon.id}.png`} alt="" style={{ width: 48, height: 48, imageRendering: "pixelated" }} />
                    <div>
                      <div style={{ fontWeight: 700, color: "#e0e0e0" }}>{isShiny ? "✨" : ""}{isShadow ? "👤" : ""}{selectedPokemon.nameKr}</div>
                      <div style={{ fontSize: 12, color: "#8899aa" }}>CP{cp || "?"} | IV{ivPercent}% | {fastMove ? krMove(fastMove) : "-"}/{chargedMove ? krMove(chargedMove) : "-"}</div>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "center", padding: "8px 0", color: "#576574", fontSize: 20 }}>⚖️</div>
                {collection.filter((c) => c.pokemonId === selectedPokemon.id && (!c.form || c.form === selectedPokemon.form)).map((item) => (
                  <div key={item.id} style={s.compareCard} onClick={() => runCompare(item)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.pokemonId}.png`} alt="" style={{ width: 48, height: 48, imageRendering: "pixelated" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, color: "#e0e0e0" }}>{item.isShiny ? "✨" : ""}{item.isShadow ? "👤" : ""}{item.name}</div>
                        <div style={{ fontSize: 12, color: "#8899aa" }}>CP{item.cp || "?"} | {item.ivPercent !== null ? `IV${item.ivPercent}%` : "개체값 미입력"} | {item.fastMove ? krMove(item.fastMove) : "-"}/{item.chargedMove ? krMove(item.chargedMove) : "-"}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#ffd93d" }}>{STATUS_LABELS[item.status] || ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <div style={{ ...s.compareMini, borderColor: "rgba(0,212,170,0.3)" }}>
                    <div style={{ fontSize: 10, color: "#4ecdc4", fontWeight: 600 }}>A (현재)</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#e0e0e0" }}>{selectedPokemon.nameKr}</div>
                    <div style={{ fontSize: 11, color: "#8899aa" }}>CP{cp || "?"} IV{ivPercent}%</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", color: "#576574" }}>vs</div>
                  <div style={{ ...s.compareMini, borderColor: "rgba(255,217,61,0.3)" }}>
                    <div style={{ fontSize: 10, color: "#ffd93d", fontWeight: 600 }}>B (보유)</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#e0e0e0" }}>{compareTarget?.name}</div>
                    <div style={{ fontSize: 11, color: "#8899aa" }}>CP{compareTarget?.cp || "?"} {compareTarget?.ivPercent !== null && compareTarget?.ivPercent !== undefined ? `IV${compareTarget.ivPercent}%` : "개체값 미입력"}</div>
                  </div>
                </div>
                <div style={{ ...s.collAnalysis, lineHeight: 1.7, fontSize: 14 }}>
                  {streaming && thinking && <div style={s.thinking}>🧠 박사가 생각 중…</div>}
                  {formatResult(compareResult)}
                  {streaming && <span style={s.cursor}>▌</span>}
                </div>
                {compareModel && !streaming && <div style={{ padding: "4px 0 0", fontSize: 10, color: "#576574", textAlign: "right" }}>{modelLine(compareModel)}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  container: { minHeight: "100vh", background: "linear-gradient(180deg,#0a1628 0%,#0f2035 50%,#0a1628 100%)", display: "flex", justifyContent: "center", padding: "20px 12px", WebkitTapHighlightColor: "transparent", touchAction: "manipulation" },
  inner: { maxWidth: 520, width: "100%" },
  header: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", marginBottom: 24, padding: "16px 0" },
  logoIcon: { fontSize: 36, filter: "drop-shadow(0 0 12px rgba(0,212,170,0.6))" },
  title: { fontSize: 28, fontWeight: 800, margin: 0, background: "linear-gradient(135deg,#00d4aa,#4ecdc4,#00d4aa)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 3s linear infinite" },
  subtitle: { fontSize: 13, margin: "2px 0 0 0", opacity: 0.5, color: "#c8d6e5" },
  card: { background: "linear-gradient(135deg,#1a2744,#162038)", borderRadius: 16, padding: "24px 20px", border: "1px solid rgba(0,212,170,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", animation: "fadeIn 0.4s ease-out" },
  group: { marginBottom: 20 },
  label: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#8899aa", textTransform: "uppercase", letterSpacing: "0.5px" },
  input: { width: "100%", padding: "12px 16px", background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: 10, color: "#e0e0e0", fontSize: 15, fontFamily: "'Outfit',sans-serif", outline: "none", boxSizing: "border-box" },
  select: { width: "100%", padding: "12px 16px", background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: 10, color: "#e0e0e0", fontSize: 14, fontFamily: "'Outfit',sans-serif", outline: "none", boxSizing: "border-box", cursor: "pointer", WebkitAppearance: "none", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238899aa' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 32 },
  miniInfo: { display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: "#8899aa" },
  suggBox: { position: "absolute", top: "100%", left: 0, right: 0, background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: "0 0 10px 10px", maxHeight: 200, overflowY: "auto", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" },
  suggItem: { padding: "10px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1a2744", fontSize: 14, color: "#c8d6e5" },
  ivBadge: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: "#0a1628", marginLeft: "auto" },
  ivBox: { display: "flex", flexDirection: "column", gap: 16, background: "#0d1a2e", borderRadius: 12, padding: 16, border: "1px solid #2a3a5c" },
  ivItem: { display: "flex", flexDirection: "column", gap: 6 },
  ivLabelRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  ivStatLabel: { fontSize: 13, fontWeight: 600, color: "#8899aa" },
  ivStatVal: { fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  ivStepBtn: { width: 32, height: 32, background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 8, color: "#e0e0e0", fontSize: 18, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit',sans-serif", WebkitTapHighlightColor: "transparent" },
  ivQuickRow: { display: "flex", gap: 4, marginTop: 4 },
  ivQuickBtn: { flex: 1, padding: "4px 0", background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 6, color: "#576574", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit',sans-serif", textAlign: "center", WebkitTapHighlightColor: "transparent" },
  ivQuickBtnActive: { flex: 1, padding: "4px 0", background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.3)", borderRadius: 6, color: "#4ecdc4", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit',sans-serif", textAlign: "center", WebkitTapHighlightColor: "transparent" },
  gaugeOuter: { display: "flex", gap: 3, width: "100%" },
  gaugeSeg: { position: "relative", flex: 1, height: 12, background: "#1a2744", borderRadius: 3, overflow: "hidden", border: "1px solid #2a3a5c" },
  moveRow: { display: "flex", gap: 8 },
  moveLabel: { fontSize: 11, color: "#576574", marginBottom: 4, fontWeight: 500 },
  toggleRow: { display: "flex", gap: 10, marginBottom: 20 },
  toggle: { flex: 1, padding: "12px 16px", background: "#0d1a2e", border: "2px solid #2a3a5c", borderRadius: 10, color: "#8899aa", fontSize: 14, fontWeight: 600, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  error: { background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#ff6b6b", marginBottom: 16 },
  analyzeBtn: { width: "100%", padding: 16, background: "linear-gradient(135deg,#00d4aa,#00b894)", border: "none", borderRadius: 12, color: "#0a1628", fontSize: 16, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "pointer", boxShadow: "0 4px 16px rgba(0,212,170,0.3)" },
  resultCard: { background: "linear-gradient(135deg,#1a2744,#162038)", borderRadius: 16, padding: "0 0 24px", border: "1px solid rgba(0,212,170,0.15)", boxShadow: "0 8px 32px rgba(0,0,0,0.3)", overflow: "hidden", animation: "fadeIn 0.5s ease-out" },
  imgContainer: { position: "relative", display: "flex", justifyContent: "center", padding: "24px 20px 12px", background: "radial-gradient(ellipse at center,rgba(0,212,170,0.08) 0%,transparent 70%)" },
  pokemonImg: { width: 140, height: 140, objectFit: "contain", filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.4))" },
  shinyBadge: { position: "absolute", top: 16, right: 16, background: "linear-gradient(135deg,#ffd93d,#f0a500)", color: "#0a1628", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  shadowBadge: { position: "absolute", top: 16, left: 16, background: "linear-gradient(135deg,#705898,#4a3370)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 },
  ivSummary: { display: "flex", margin: "0 20px 16px", background: "#0d1a2e", borderRadius: 10, overflow: "hidden", border: "1px solid #2a3a5c" },
  ivSumItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 2, borderRight: "1px solid #2a3a5c", fontSize: 15, color: "#e0e0e0" },
  resultContent: { padding: "0 20px", lineHeight: 1.7, fontSize: 14 },
  resultTitle: { fontSize: 17, fontWeight: 700, color: "#fff", padding: "8px 0", borderBottom: "1px solid rgba(0,212,170,0.15)", marginBottom: 12 },
  verdictLine: { background: "rgba(0,212,170,0.06)", borderLeft: "3px solid #4ecdc4", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10, fontSize: 14, fontWeight: 500 },
  warningLine: { background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 8, padding: "10px 14px", margin: "8px 0", fontSize: 13 },
  counterLine: { background: "rgba(168,144,240,0.08)", border: "1px solid rgba(168,144,240,0.2)", borderRadius: 8, padding: "10px 14px", margin: "8px 0", fontSize: 13 },
  bulletLine: { padding: "6px 0", fontSize: 13, lineHeight: 1.8 },
  resetBtn: { display: "block", width: "calc(100% - 40px)", margin: "20px 20px 0", padding: 14, background: "transparent", border: "2px solid #2a3a5c", borderRadius: 12, color: "#8899aa", fontSize: 14, fontWeight: 600, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  footer: { textAlign: "center", padding: "24px 0 8px", fontSize: 11, opacity: 0.3, color: "#c8d6e5" },
  keepBtn: { width: "100%", padding: 12, background: "rgba(0,212,170,0.1)", border: "2px solid #00d4aa", borderRadius: 10, color: "#00d4aa", fontSize: 14, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  keepBtnKept: { width: "100%", padding: 12, background: "#00d4aa", border: "2px solid #00d4aa", borderRadius: 10, color: "#0a1628", fontSize: 14, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "default" },
  fab: { position: "fixed", bottom: 20, right: 20, width: 56, height: 56, background: "linear-gradient(135deg,#00d4aa,#00b894)", border: "none", borderRadius: "50%", fontSize: 24, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,212,170,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
  fabBadge: { position: "absolute", top: -4, right: -4, background: "#ff6b6b", color: "#fff", fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" },
  collOverlay: { position: "fixed", inset: 0, background: "rgba(10,22,40,0.95)", zIndex: 200, display: "flex", justifyContent: "center", overflowY: "auto" },
  collPanel: { width: "100%", maxWidth: 520, padding: 20, paddingBottom: 40 },
  collHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, position: "sticky", top: 0, background: "rgba(10,22,40,0.98)", padding: "12px 0", zIndex: 10 },
  collClose: { width: 36, height: 36, background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: "50%", color: "#c8d6e5", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  collEmpty: { textAlign: "center", padding: "60px 20px", color: "#8899aa" },
  collList: { display: "flex", flexDirection: "column", gap: 8 },
  collItem: { display: "flex", alignItems: "center", gap: 10, background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 12, padding: "10px 12px" },
  statusBar: { display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 10, color: "#8899aa", margin: "-12px 0 14px", padding: "0 4px" },
  thinking: { fontSize: 13, color: "#8899aa", padding: "10px 0", animation: "blink 1.6s ease-in-out infinite" },
  saveBox: { margin: "12px 20px 0", padding: 12, background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: 10 },
  saveRowLabel: { fontSize: 11, color: "#8899aa", margin: "6px 0 4px", fontWeight: 600 },
  chip: { padding: "6px 10px", background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 8, color: "#8899aa", fontSize: 12, cursor: "pointer", fontFamily: "'Outfit',sans-serif" },
  chipActive: { padding: "6px 10px", background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.4)", borderRadius: 8, color: "#4ecdc4", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit',sans-serif" },
  tagBadge: { fontSize: 9, padding: "1px 6px", borderRadius: 6, background: "rgba(255,255,255,0.05)", fontWeight: 600 },
  collIconBtn: { background: "none", border: "1px solid #2a3a5c", borderRadius: 8, fontSize: 14, cursor: "pointer", padding: "4px 6px" },
  collRemove: { background: "none", border: "none", fontSize: 16, cursor: "pointer", padding: 4, opacity: 0.5, filter: "grayscale(0.5)" },
  pvpTag: { marginTop: 10, padding: "8px 12px", background: "rgba(168,144,240,0.06)", border: "1px solid rgba(168,144,240,0.15)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 2 },
  pvpHint: { fontSize: 10, color: "#576574" },
  collBackBtn: { background: "none", border: "none", color: "#4ecdc4", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0", marginBottom: 8, fontFamily: "'Outfit',sans-serif" },
  collItemClickable: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" },
  collAnalysis: { background: "#0d1a2e", borderRadius: 10, padding: 16, border: "1px solid #2a3a5c" },
  cursor: { display: "inline-block", color: "#4ecdc4", animation: "blink 1s step-end infinite", fontWeight: 700, fontSize: 16 },
  tabRow: { display: "flex", gap: 4, marginBottom: 16, background: "#0d1a2e", borderRadius: 12, padding: 4, border: "1px solid #2a3a5c" },
  tab: { flex: 1, padding: "10px 0", background: "transparent", border: "none", borderRadius: 10, color: "#8899aa", fontSize: 13, fontWeight: 600, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  tabActive: { flex: 1, padding: "10px 0", background: "linear-gradient(135deg,#1a2744,#162038)", border: "1px solid rgba(0,212,170,0.2)", borderRadius: 10, color: "#4ecdc4", fontSize: 13, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" },
  sectionHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 16px", background: "rgba(255,159,67,0.08)", border: "1px solid rgba(255,159,67,0.2)", borderRadius: 12 },
  collNote: { padding: "8px 12px", background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.1)", borderRadius: 8, fontSize: 12, color: "#4ecdc4", marginBottom: 16 },
  sourceNotice: { padding: "8px 12px", background: "rgba(255,217,61,0.08)", border: "1px solid rgba(255,217,61,0.25)", borderRadius: 8, fontSize: 11, color: "#ffd93d", marginBottom: 12, lineHeight: 1.5 },
  compareCard: { padding: "12px 16px", background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 12, marginBottom: 8, cursor: "pointer" },
  compareMini: { flex: 1, padding: "10px 12px", background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: 10, textAlign: "center" },
  collFilterRow: { display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 4 },
  collFilterBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "6px 10px", background: "#0d1a2e", border: "1px solid #2a3a5c", borderRadius: 8, color: "#8899aa", cursor: "pointer", fontFamily: "'Outfit',sans-serif", whiteSpace: "nowrap", minWidth: 48 },
  collFilterActive: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "6px 10px", background: "rgba(0,212,170,0.1)", border: "1px solid rgba(0,212,170,0.3)", borderRadius: 8, color: "#4ecdc4", cursor: "pointer", fontFamily: "'Outfit',sans-serif", whiteSpace: "nowrap", minWidth: 48, fontWeight: 600 },
  raidBossChip: { display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", background: "#0d1a2e", border: "1px solid rgba(255,159,67,0.25)", borderRadius: 10, cursor: "pointer", fontFamily: "'Outfit',sans-serif", transition: "border-color 0.2s" },
  linkBtn: { background: "none", border: "1px solid #2a3a5c", borderRadius: 6, color: "#4ecdc4", fontSize: 10, padding: "2px 6px", cursor: "pointer", fontFamily: "'Outfit',sans-serif" },
  teamPanel: { marginTop: 14, padding: 12, background: "#0d1a2e", border: "1px solid rgba(0,212,170,0.2)", borderRadius: 12 },
  teamRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid rgba(255,255,255,0.05)" },

  // ─── 이벤트 스타일 ───
  eventCardActive: { padding: "14px 16px", background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 },
  eventCardUpcoming: { padding: "14px 16px", background: "rgba(255,217,61,0.04)", border: "1px solid rgba(255,217,61,0.12)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 },
  eventTypeBadge: { fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(0,212,170,0.12)", color: "#4ecdc4", border: "1px solid rgba(0,212,170,0.2)", fontWeight: 600, whiteSpace: "nowrap" },
  eventLink: { fontSize: 12, color: "#4ecdc4", textDecoration: "none", fontWeight: 600, opacity: 0.8 },
};
