"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { ensureAnonymousSession, authHeader, supabaseConfigured } from "./lib/supabaseClient";
import { listMyPokemon, insertMyPokemon, updateMyPokemon, deleteMyPokemon, migrateLocalCollection, getTodayUsage, STATUS_LABELS, PURPOSE_LABELS } from "./lib/myPokemon";
import { usageDate } from "./lib/aiUsage";

// my_pokemon 행 → 화면/AI 용 항목 (판정은 저장하지 않으므로 없음)
function toEntry(r) {
  const ivs = [r.atk_iv, r.def_iv, r.sta_iv];
  const raw = { id: r.id, species_id: r.species_id, form: r.form, name_kr: r.name_kr, cp: r.cp, atk_iv: r.atk_iv, def_iv: r.def_iv, sta_iv: r.sta_iv, level: r.level, fast_move: r.fast_move, charged_moves: r.charged_moves || [], is_shadow: !!r.is_shadow, is_purified: !!r.is_purified, is_shiny: !!r.is_shiny, is_lucky: !!r.is_lucky, status: r.status, purposes: r.purposes || [], source: r.source, memo: r.memo, created_at: r.created_at, updated_at: r.updated_at };
  const hasIv = ivs.every((v) => Number.isInteger(v));
  return {
    id: r.id, pokemonId: r.species_id, form: r.form || "Normal",
    name: (r.name_kr || `#${r.species_id}`) + (r.form && r.form !== "Normal" ? ` (${r.form})` : ""),
    nameKr: r.name_kr, cp: r.cp || 0,
    atkIv: r.atk_iv, defIv: r.def_iv, staIv: r.sta_iv,
    ivPercent: hasIv ? Math.round(((r.atk_iv + r.def_iv + r.sta_iv) / 45) * 100) : null,
    fastMove: r.fast_move || "", chargedMove: (r.charged_moves || [])[0] || "",
    isShiny: !!r.is_shiny, isShadow: !!r.is_shadow, isPurified: !!r.is_purified, isLucky: !!r.is_lucky,
    status: r.status || "keep", purposes: r.purposes || [], memo: r.memo || "", source: r.source || "web",
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
  const [usageCount, setUsageCount] = useState(null);
  const [saveOpts, setSaveOpts] = useState({ open: false, status: "keep", purposes: [], memo: "" });
  const [saving, setSaving] = useState(false);
  const [collError, setCollError] = useState(null);
  const [collStatusFilter, setCollStatusFilter] = useState("all");
  const [collPurposeFilter, setCollPurposeFilter] = useState("all");
  const [editing, setEditing] = useState(null); // { id, status, purposes, memo }
  const [thinking, setThinking] = useState(false); // 첫 텍스트 도착 전(모델 thinking 구간)
  const [pendingReanalyze, setPendingReanalyze] = useState(false);
  const [ivMissing, setIvMissing] = useState(false); // 이전된 항목 등 개체값이 없는 경우: 입력 전 분석 금지
  const [fallbackNotice, setFallbackNotice] = useState(null); // 폴백 모델로 답한 경우 안내

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
      (collPurposeFilter === "all" || (item.purposes || []).includes(collPurposeFilter))
    )
    .sort((a, b) => (a.ivPercent === null ? 0 : 1) - (b.ivPercent === null ? 0 : 1) || a.pokemonId - b.pokemonId);
  const ivMissingCount = collection.filter((i) => i.ivPercent === null).length;

  // AI 에 넘기는 내 포켓몬 목록 (verdict 없음, status·purposes 전달)
  const collectionForAI = () => collection.map((c) => ({ name: c.name, pokemonId: c.pokemonId, cp: c.cp, ivPercent: c.ivPercent, status: c.status, purposes: c.purposes, isShiny: c.isShiny, isShadow: c.isShadow }));

  const reloadCollection = async () => {
    const { rows, error } = await listMyPokemon();
    if (error && error !== "미설정") setCollError(`목록 불러오기 실패: ${error}`);
    else { setCollError(null); setCollection(rows.map(toEntry)); }
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
      const s = await ensureAnonymousSession();
      if (!s) { setSessionNotice("서버 저장 연결 실패 · 목록 기능 비활성화"); return; }
      setSession(s);
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
            const [reason, primary, used] = line.replace("__FALLBACK__:", "").split("|");
            const short = (m) => (m || "").replace("gemini-", "").replace("-preview", "");
            setFallbackNotice(
              reason === "quota_minute" ? `고급 모델(${short(primary)}) 분당 한도 초과 → 기본 모델(${short(used)})로 분석 중 · 잠시 후 고급 모델로 자동 복귀`
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
  }, [pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove, chargedMove, isShiny, isShadow, selectedPokemon, moveNamesKr, collection, ivMissing]);

  useEffect(() => {
    if (pendingReanalyze && selectedPokemon) { setPendingReanalyze(false); analyze(); }
  }, [pendingReanalyze, selectedPokemon, analyze]);

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setPokemonName(""); setCp(""); setAtkIv(15); setDefIv(15); setStaIv(15);
    setIvMissing(false); setFallbackNotice(null);
    setFastMove(""); setChargedMove(""); setIsShiny(false); setIsShadow(false);
    setResult(null); setSelectedPokemon(null); setError(null); setCurrentKept(false); setUsedModel("");
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
    const { row, error } = await insertMyPokemon({
      species_id: selectedPokemon.id,
      form: selectedPokemon.form || "Normal",
      name_kr: selectedPokemon.nameKr,
      cp: parseInt(cp) || null,
      atk_iv: atkIv, def_iv: defIv, sta_iv: staIv,
      fast_move: fastMove || null,
      charged_moves: chargedMove ? [chargedMove] : [],
      is_shadow: isShadow, is_shiny: isShiny,
      status: saveOpts.status, purposes: saveOpts.purposes, memo: saveOpts.memo.trim() || null,
      source: "web",
    });
    setSaving(false);
    if (error) { setCollError(`저장 실패: ${error}`); return; }
    setCollection((prev) => [...prev, toEntry(row)].sort((a, b) => a.pokemonId - b.pokemonId));
    setCurrentKept(true);
    setSaveOpts({ open: false, status: "keep", purposes: [], memo: "" });
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
      status: editing.status, purposes: editing.purposes, memo: editing.memo.trim() || null,
      cp: cpVal, atk_iv: anyIv ? ivs[0] : null, def_iv: anyIv ? ivs[1] : null, sta_iv: anyIv ? ivs[2] : null,
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
          <span style={{ opacity: 0.7 }}>{sessionNotice || (session ? "이 기기에 저장됨 · 브라우저 데이터를 지우면 목록이 사라질 수 있음" : "")}</span>
        </div>

        {/* ─── Tab Switcher (결과 표시 중에는 숨김) ─── */}
        {!result && !raidResult && (
          <div style={s.tabRow}>
            <button onClick={() => { setActiveTab("analyze"); setError(null); }} style={activeTab === "analyze" ? s.tabActive : s.tab}>🔍 분석</button>
            <button onClick={() => { setActiveTab("raid"); setError(null); }} style={activeTab === "raid" ? s.tabActive : s.tab}>⚔️ 레이드</button>
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
            {selectedPokemon && !streaming && saveOpts.open && !currentKept && (
              <div style={s.saveBox}>
                <div style={s.saveRowLabel}>상태</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {Object.entries(STATUS_LABELS).map(([k, label]) => (
                    <button key={k} onClick={() => setSaveOpts((o) => ({ ...o, status: k }))} style={saveOpts.status === k ? s.chipActive : s.chip}>{label}</button>
                  ))}
                </div>
                <div style={s.saveRowLabel}>용도 (복수 선택)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(PURPOSE_LABELS).map(([k, label]) => (
                    <button key={k} onClick={() => setSaveOpts((o) => ({ ...o, purposes: togglePurpose(o.purposes, k) }))} style={saveOpts.purposes.includes(k) ? s.chipActive : s.chip}>{label}</button>
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
                {collection.length > 0 && (
                  <button onClick={exportCollection} style={{ background: "none", border: "1px solid #2a3a5c", borderRadius: 8, color: "#8899aa", fontSize: 11, padding: "4px 8px", cursor: "pointer", fontFamily: "'Outfit',sans-serif" }}>📤 내보내기</button>
                )}
                <button style={s.collClose} onClick={() => { setShowCollection(false); setEditing(null); setCollStatusFilter("all"); setCollPurposeFilter("all"); }}>✕</button>
              </div>
            </div>
            {sessionNotice && <div style={s.sourceNotice}>{sessionNotice}</div>}
            {collError && <div style={s.error}>{collError}</div>}

            {ivMissingCount > 0 && <div style={s.sourceNotice}>개체값 미입력 {ivMissingCount}건이 목록 위쪽에 있습니다 — ✏️ 로 개체값·CP 를 입력하세요</div>}
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
                          CP{item.cp || "?"} {item.ivPercent !== null ? `IV${item.ivPercent}% (${item.atkIv}/${item.defIv}/${item.staIv})` : "개체값 미입력"} | {item.fastMove ? krMove(item.fastMove) : "-"}/{item.chargedMove ? krMove(item.chargedMove) : "-"}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                          <span style={{ ...s.tagBadge, color: item.status === "transfer" ? "#ff6b6b" : "#4ecdc4" }}>{STATUS_LABELS[item.status] || item.status}</span>
                          {(item.purposes || []).map((p) => <span key={p} style={{ ...s.tagBadge, color: "#a890f0" }}>{PURPOSE_LABELS[p] || p}</span>)}
                          {item.source === "import" && <span style={{ ...s.tagBadge, color: "#8899aa" }}>가져옴</span>}
                          {item.memo && <span style={{ ...s.tagBadge, color: "#ffd93d" }}>📝 {item.memo}</span>}
                        </div>
                      </div>
                      <button style={s.collIconBtn} title="다시 분석" onClick={() => reanalyzeEntry(item)}>🔄</button>
                      <button style={s.collIconBtn} title="수정" onClick={() => setEditing(editing?.id === item.id ? null : { id: item.id, status: item.status, purposes: item.purposes || [], memo: item.memo || "", cp: item.cp || "", atk: Number.isInteger(item.atkIv) ? item.atkIv : "", def: Number.isInteger(item.defIv) ? item.defIv : "", sta: Number.isInteger(item.staIv) ? item.staIv : "" })}>✏️</button>
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
                        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                          <input style={{ ...s.input, fontSize: 13, padding: "8px 10px" }} type="number" placeholder="CP" value={editing.cp} onChange={(e) => setEditing((ed) => ({ ...ed, cp: e.target.value }))} />
                          {[["atk", "공격"], ["def", "방어"], ["sta", "HP"]].map(([k, label]) => (
                            <input key={k} style={{ ...s.input, fontSize: 13, padding: "8px 10px" }} type="number" min={0} max={15} placeholder={label} value={editing[k]} onChange={(e) => setEditing((ed) => ({ ...ed, [k]: e.target.value }))} />
                          ))}
                        </div>
                        {(editing.atk === "" && editing.def === "" && editing.sta === "") && <div style={{ fontSize: 10, color: "#ffd93d", marginTop: 4 }}>개체값 미입력 — 공격/방어/HP 를 입력하면 저장 시 반영됩니다</div>}
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

  // ─── 이벤트 스타일 ───
  eventCardActive: { padding: "14px 16px", background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.2)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 },
  eventCardUpcoming: { padding: "14px 16px", background: "rgba(255,217,61,0.04)", border: "1px solid rgba(255,217,61,0.12)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 },
  eventTypeBadge: { fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(0,212,170,0.12)", color: "#4ecdc4", border: "1px solid rgba(0,212,170,0.2)", fontWeight: 600, whiteSpace: "nowrap" },
  eventLink: { fontSize: 12, color: "#4ecdc4", textDecoration: "none", fontWeight: 600, opacity: 0.8 },
};
