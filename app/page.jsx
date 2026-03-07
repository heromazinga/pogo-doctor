"use client";
import { useState, useEffect, useCallback } from "react";

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

  // ─── Collection (킵 보유목록) ───
  const [collection, setCollection] = useState([]);
  const [showCollection, setShowCollection] = useState(false);
  const [currentKept, setCurrentKept] = useState(false);
  const [usedModel, setUsedModel] = useState("");
  const [viewingEntry, setViewingEntry] = useState(null);

  const ivPercent = Math.round(((atkIv + defIv + staIv) / 45) * 100);
  const getIvColor = () => ivPercent >= 93 ? "#4ecdc4" : ivPercent >= 82 ? "#ffd93d" : "#ff6b6b";
  const getIvLabel = () => ivPercent >= 98 ? "거의 완벽!" : ivPercent >= 93 ? "매우 우수" : ivPercent >= 82 ? "괜찮음" : ivPercent >= 67 ? "보통" : "별로";

  // PvP IV evaluation: low attack + high def/hp = better for GL/UL
  const getPvpTag = () => {
    if (atkIv <= 3 && defIv >= 13 && staIv >= 13) return { text: "🏆 PvP 최적 (그레이트/울트라)", color: "#a890f0" };
    if (atkIv <= 7 && defIv >= 11 && staIv >= 11) return { text: "👍 PvP 적합", color: "#7c8db5" };
    if (atkIv >= 14 && defIv >= 14 && staIv >= 14) return { text: "⚔️ 레이드/마스터리그 최적", color: "#ff9f43" };
    if (atkIv >= 13) return { text: "⚔️ PvE 우선", color: "#8899aa" };
    return null;
  };

  // Move name helper: English → Korean (fallback to English)
  const krMove = (engName) => moveNamesKr[engName] || engName;

  useEffect(() => {
    fetch("/api/pokemon-data")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllPokemon(data);
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  // Load collection from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pogo-collection");
      if (saved) setCollection(JSON.parse(saved));
    } catch {}
  }, []);

  // Save collection to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("pogo-collection", JSON.stringify(collection));
    } catch {}
  }, [collection]);

  const handleNameChange = (val) => {
    setPokemonName(val);
    setSelectedPokemon(null);
    setFastMove("");
    setChargedMove("");
    if (val.length >= 1) {
      const q = val.toLowerCase();
      const matches = allPokemon
        .filter((p) => {
          if (p.form !== "Normal") return false;
          return p.nameKr.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
        })
        .slice(0, 8);
      setSuggestions(matches);
      setShowSugg(matches.length > 0);
    } else {
      setSuggestions([]);
      setShowSugg(false);
    }
  };

  const selectPokemon = (poke) => {
    setPokemonName(poke.nameKr);
    setSelectedPokemon(poke);
    setSuggestions([]);
    setShowSugg(false);

    // Fetch Korean names for this pokemon's moves only (4-8 calls, fast)
    const allMoves = [...(poke.fast || []), ...(poke.charged || []), ...(poke.eliteFast || []), ...(poke.eliteCharged || [])];
    const toFetch = allMoves.filter((m) => !moveNamesKr[m]);
    if (toFetch.length > 0) {
      Promise.allSettled(
        toFetch.map(async (engName) => {
          const slug = engName.toLowerCase().replace(/[()'']/g, "").replace(/\s+/g, "-").replace(/--+/g, "-");
          try {
            const r = await fetch(`https://pokeapi.co/api/v2/move/${slug}`);
            if (!r.ok) return;
            const d = await r.json();
            const kr = d.names?.find((n) => n.language.name === "ko");
            if (kr) return { eng: engName, kr: kr.name };
          } catch {}
        })
      ).then((results) => {
        const newNames = {};
        results.forEach((r) => { if (r.status === "fulfilled" && r.value) newNames[r.value.eng] = r.value.kr; });
        if (Object.keys(newNames).length > 0) {
          setMoveNamesKr((prev) => ({ ...prev, ...newNames }));
        }
      });
    }
  };

  const analyze = useCallback(async () => {
    if (!pokemonName.trim()) { setError("포켓몬 이름을 입력해주세요!"); return; }
    setLoading(true); setError(null); setResult(null); setCurrentKept(false); setUsedModel("");

    const pokemonData = selectedPokemon
      ? {
          name: selectedPokemon.name,
          nameKr: selectedPokemon.nameKr,
          id: selectedPokemon.id,
          baseAttack: selectedPokemon.baseAttack,
          baseDefense: selectedPokemon.baseDefense,
          baseStamina: selectedPokemon.baseStamina,
          fast: selectedPokemon.fast,
          charged: selectedPokemon.charged,
          eliteFast: selectedPokemon.eliteFast,
          eliteCharged: selectedPokemon.eliteCharged,
        }
      : { name: pokemonName, note: "API에서 매칭 안됨" };

    // Send Korean move names for context
    const fastMoveDisplay = fastMove ? `${krMove(fastMove)} (${fastMove})` : "";
    const chargedMoveDisplay = chargedMove ? `${krMove(chargedMove)} (${chargedMove})` : "";

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pokemonData,
          userInput: {
            name: selectedPokemon ? selectedPokemon.nameKr : pokemonName,
            cp, atkIv, defIv, staIv, ivPercent,
            fastMove: fastMoveDisplay || fastMove,
            chargedMove: chargedMoveDisplay || chargedMove,
            isShiny, isShadow,
          },
          collection: collection.map((c) => ({
            name: c.name, pokemonId: c.pokemonId, cp: c.cp,
            ivPercent: c.ivPercent, verdict: c.verdict,
            isShiny: c.isShiny, isShadow: c.isShadow,
          })),
        }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); }
      else { setResult(data.result); setUsedModel(data.model || ""); }
    } catch (e) { setError("네트워크 오류입니다. 다시 시도해주세요."); }
    setLoading(false);
  }, [pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove, chargedMove, isShiny, isShadow, selectedPokemon, moveNamesKr, collection]);

  const reset = () => {
    setPokemonName(""); setCp(""); setAtkIv(15); setDefIv(15); setStaIv(15);
    setFastMove(""); setChargedMove(""); setIsShiny(false); setIsShadow(false);
    setResult(null); setSelectedPokemon(null); setError(null); setCurrentKept(false); setUsedModel("");
  };

  // ─── Keep / Collection ───
  const handleKeep = () => {
    if (!selectedPokemon || !result || currentKept) return;
    const verdict = result.match(/(영구 보존|킵|보류|사탕행|PvP용 킵)/)?.[0] || "킵";
    const entry = {
      id: `${selectedPokemon.id}-${Date.now()}`,
      pokemonId: selectedPokemon.id,
      name: selectedPokemon.nameKr,
      enName: selectedPokemon.name,
      cp: parseInt(cp) || 0,
      ivPercent,
      fastMove: fastMove ? krMove(fastMove) : "",
      chargedMove: chargedMove ? krMove(chargedMove) : "",
      isShiny, isShadow, verdict,
      analysisResult: result,
      date: new Date().toISOString(),
    };
    setCollection((prev) => {
      const updated = [...prev, entry];
      updated.sort((a, b) => a.pokemonId - b.pokemonId);
      return updated;
    });
    setCurrentKept(true);
  };

  const removeFromCollection = (entryId) => {
    setCollection((prev) => prev.filter((e) => e.id !== entryId));
  };

  const renderBold = (text) => {
    return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={i} style={{ color: "#e0e0e0" }}>{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>
    );
  };

  const formatResult = (text) => text.split("\n").map((line, i) => {
    if (line.startsWith("**") && line.includes("👉")) return <div key={i} style={s.resultTitle}>{line.replace(/\*\*/g, "")}</div>;
    if (line.includes("**판정:**") || line.includes("**판정:")) {
      const color = line.includes("영구 보존") || line.includes("킵") ? "#4ecdc4" : line.includes("보류") ? "#ffd93d" : line.includes("사탕행") ? "#ff6b6b" : "#a890f0";
      return <div key={i} style={{ ...s.verdictLine, borderLeftColor: color }}>{renderBold(line)}</div>;
    }
    if (line.includes("🚨")) return <div key={i} style={s.warningLine}>{renderBold(line)}</div>;
    if (line.includes("🛡️")) return <div key={i} style={s.counterLine}>{renderBold(line)}</div>;
    if (line.trim().startsWith("*")) return <div key={i} style={s.bulletLine}>{renderBold(line.replace(/^\*\s*/, ""))}</div>;
    if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
    return <div key={i} style={{ padding: "2px 0", fontSize: 13 }}>{renderBold(line)}</div>;
  });

  const hasFast = selectedPokemon && selectedPokemon.fast && selectedPokemon.fast.length > 0;
  const hasCharged = selectedPokemon && selectedPokemon.charged && selectedPokemon.charged.length > 0;
  const displayName = selectedPokemon ? selectedPokemon.nameKr : pokemonName;

  return (
    <div style={s.container}>
      <div style={s.inner}>
        <div style={s.header}>
          <span style={s.logoIcon}>⚡</span>
          <div>
            <h1 style={s.title}>포고박사</h1>
            <p style={s.subtitle}>킵? 버려? 냅둬? AI가 판정해드립니다</p>
          </div>
        </div>

        {!result ? (
          <div style={s.card}>
            <div style={s.group}>
              <label style={s.label}>포켓몬 이름 {dataLoading && <span style={{ fontSize: 10, color: "#ffd93d" }}>데이터 로딩중...</span>}</label>
              <div style={{ position: "relative" }}>
                <input style={s.input} value={pokemonName} onChange={(e) => handleNameChange(e.target.value)} onFocus={() => suggestions.length > 0 && setShowSugg(true)} onBlur={() => setTimeout(() => setShowSugg(false), 200)} />
                {selectedPokemon && (
                  <div style={s.miniInfo}>
                    <span style={{ color: "#4ecdc4" }}>✓ #{selectedPokemon.id} {selectedPokemon.nameKr}</span>
                    <span style={{ opacity: 0.5 }}>공{selectedPokemon.baseAttack} / 방{selectedPokemon.baseDefense} / 체{selectedPokemon.baseStamina}</span>
                  </div>
                )}
                {showSugg && (
                  <div style={s.suggBox}>
                    {suggestions.map((p, i) => (
                      <div key={`${p.id}-${p.form}-${i}`} style={s.suggItem} onMouseDown={() => selectPokemon(p)}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{p.nameKr}</span>
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
                {[{ label: "공격", value: atkIv, set: setAtkIv }, { label: "방어", value: defIv, set: setDefIv }, { label: "HP", value: staIv, set: setStaIv }].map(({ label, value, set }) => (
                  <div key={label} style={s.ivItem}>
                    <div style={s.ivLabelRow}>
                      <span style={s.ivStatLabel}>{label}</span>
                      <span style={{ ...s.ivStatVal, color: value >= 14 ? "#ff6348" : value >= 10 ? "#ffa502" : "#8899aa" }}>{value}</span>
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
                    <input type="range" className="iv-slider" min="0" max="15" value={value} onChange={(e) => set(parseInt(e.target.value))} />
                  </div>
                ))}
              </div>
              {getPvpTag() && (
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
                      {selectedPokemon.eliteFast && selectedPokemon.eliteFast.length > 0 && (
                        <optgroup label="── 한정기술 ──">
                          {selectedPokemon.eliteFast.map((m) => <option key={m} value={m}>⭐ {krMove(m)} ({m})</option>)}
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
                      {selectedPokemon.eliteCharged && selectedPokemon.eliteCharged.length > 0 && (
                        <optgroup label="── 한정기술 ──">
                          {selectedPokemon.eliteCharged.map((m) => <option key={m} value={m}>⭐ {krMove(m)} ({m})</option>)}
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
        ) : (
          <div style={s.resultCard}>
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

            <div style={s.resultContent}>{formatResult(result)}</div>

            {/* Model info */}
            {usedModel && (
              <div style={{ padding: "4px 20px 0", fontSize: 10, color: "#576574", textAlign: "right" }}>
                ⚡ {usedModel.replace("gemini-", "").replace("-preview", "")}
              </div>
            )}

            {/* ─── Keep button ─── */}
            {selectedPokemon && (
              <div style={{ padding: "12px 20px 0" }}>
                <button onClick={handleKeep} disabled={currentKept} style={currentKept ? s.keepBtnKept : s.keepBtn}>
                  {currentKept ? "✅ 보유목록에 저장됨" : "📦 킵! 보유목록에 저장"}
                </button>
              </div>
            )}

            <button onClick={reset} style={s.resetBtn}>🔄 다른 포켓몬 분석하기</button>
          </div>
        )}

        <div style={s.footer}>
          <p>포고박사 v0.5</p>
          <p style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>Pokémon GO는 Niantic, Inc.의 상표입니다</p>
        </div>
      </div>

      {/* ─── Collection FAB ─── */}
      <button style={s.fab} onClick={() => setShowCollection(true)}>
        📋
        {collection.length > 0 && <span style={s.fabBadge}>{collection.length}</span>}
      </button>

      {/* ─── Collection Panel ─── */}
      {showCollection && (
        <div style={s.collOverlay}>
          <div style={s.collPanel}>
            <div style={s.collHeader}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#e0e0e0" }}>📋 보유목록 ({collection.length})</h2>
              <button style={s.collClose} onClick={() => { setShowCollection(false); setViewingEntry(null); }}>✕</button>
            </div>

            {collection.length === 0 ? (
              <div style={s.collEmpty}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                <div>아직 저장된 포켓몬이 없습니다</div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.5 }}>분석 후 "킵" 버튼을 눌러 추가하세요</div>
              </div>
            ) : viewingEntry ? (
              /* ─── Detail view: saved analysis ─── */
              <div>
                <button onClick={() => setViewingEntry(null)} style={s.collBackBtn}>← 목록으로</button>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <img
                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${viewingEntry.pokemonId}.png`}
                    alt={viewingEntry.name} style={{ width: 48, height: 48, imageRendering: "pixelated" }}
                  />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#e0e0e0" }}>
                      {viewingEntry.isShiny ? "✨" : ""}{viewingEntry.isShadow ? "👤" : ""}{viewingEntry.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#8899aa" }}>
                      CP{viewingEntry.cp} IV{viewingEntry.ivPercent}% | {viewingEntry.verdict}
                    </div>
                  </div>
                </div>
                {viewingEntry.analysisResult ? (
                  <div style={{ ...s.collAnalysis, lineHeight: 1.7, fontSize: 14 }}>
                    {formatResult(viewingEntry.analysisResult)}
                  </div>
                ) : (
                  <div style={{ color: "#8899aa", textAlign: "center", padding: 20 }}>
                    저장된 분석 결과가 없습니다 (이전 버전에서 저장됨)
                  </div>
                )}
              </div>
            ) : (
              <div style={s.collList}>
                {collection.map((item) => (
                  <div key={item.id} style={s.collItem}>
                    <div style={s.collItemClickable} onClick={() => item.analysisResult ? setViewingEntry(item) : null}>
                      <img
                        src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.pokemonId}.png`}
                        alt={item.name} style={{ width: 40, height: 40, imageRendering: "pixelated" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e0e0e0" }}>
                          {item.isShiny ? "✨" : ""}{item.isShadow ? "👤" : ""}{item.name}
                          <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 4 }}>#{item.pokemonId}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#8899aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          CP{item.cp} IV{item.ivPercent}% | {item.fastMove}/{item.chargedMove}
                          {item.analysisResult && <span style={{ marginLeft: 4, opacity: 0.5 }}>📄</span>}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#ffd93d", whiteSpace: "nowrap" }}>{item.verdict}</span>
                    </div>
                    <button style={s.collRemove} onClick={() => removeFromCollection(item.id)}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  // ─── Existing styles (unchanged) ───
  container: { minHeight: "100vh", background: "linear-gradient(180deg,#0a1628 0%,#0f2035 50%,#0a1628 100%)", display: "flex", justifyContent: "center", padding: "20px 12px" },
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

  // ─── New styles: Keep button ───
  keepBtn: { width: "100%", padding: 12, background: "rgba(0,212,170,0.1)", border: "2px solid #00d4aa", borderRadius: 10, color: "#00d4aa", fontSize: 14, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  keepBtnKept: { width: "100%", padding: 12, background: "#00d4aa", border: "2px solid #00d4aa", borderRadius: 10, color: "#0a1628", fontSize: 14, fontWeight: 700, fontFamily: "'Outfit',sans-serif", cursor: "default" },

  // ─── New styles: Collection FAB ───
  fab: { position: "fixed", bottom: 20, right: 20, width: 56, height: 56, background: "linear-gradient(135deg,#00d4aa,#00b894)", border: "none", borderRadius: "50%", fontSize: 24, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,212,170,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" },
  fabBadge: { position: "absolute", top: -4, right: -4, background: "#ff6b6b", color: "#fff", fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" },

  // ─── New styles: Collection Panel ───
  collOverlay: { position: "fixed", inset: 0, background: "rgba(10,22,40,0.95)", zIndex: 200, display: "flex", justifyContent: "center", overflowY: "auto" },
  collPanel: { width: "100%", maxWidth: 520, padding: 20, paddingBottom: 40 },
  collHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, position: "sticky", top: 0, background: "rgba(10,22,40,0.98)", padding: "12px 0", zIndex: 10 },
  collClose: { width: 36, height: 36, background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: "50%", color: "#c8d6e5", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  collEmpty: { textAlign: "center", padding: "60px 20px", color: "#8899aa" },
  collList: { display: "flex", flexDirection: "column", gap: 8 },
  collItem: { display: "flex", alignItems: "center", gap: 10, background: "#1a2744", border: "1px solid #2a3a5c", borderRadius: 12, padding: "10px 12px" },
  collRemove: { background: "none", border: "none", fontSize: 16, cursor: "pointer", padding: 4, opacity: 0.5, filter: "grayscale(0.5)" },

  // ─── PvP IV tag ───
  pvpTag: { marginTop: 10, padding: "8px 12px", background: "rgba(168,144,240,0.06)", border: "1px solid rgba(168,144,240,0.15)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 2 },
  pvpHint: { fontSize: 10, color: "#576574" },

  // ─── Collection detail view ───
  collBackBtn: { background: "none", border: "none", color: "#4ecdc4", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0", marginBottom: 8, fontFamily: "'Outfit',sans-serif" },
  collItemClickable: { display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" },
  collAnalysis: { background: "#0d1a2e", borderRadius: 10, padding: 16, border: "1px solid #2a3a5c" },
};
