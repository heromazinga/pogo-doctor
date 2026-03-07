"use client";
import { useState, useEffect, useCallback } from "react";

export default function Home() {
  const [allPokemon, setAllPokemon] = useState([]);
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

  const ivPercent = Math.round(((atkIv + defIv + staIv) / 45) * 100);
  const getIvColor = () => ivPercent >= 93 ? "#4ecdc4" : ivPercent >= 82 ? "#ffd93d" : "#ff6b6b";
  const getIvLabel = () => ivPercent >= 98 ? "거의 완벽!" : ivPercent >= 93 ? "매우 우수" : ivPercent >= 82 ? "괜찮음" : ivPercent >= 67 ? "보통" : "별로";

  // Load Pokemon data
  useEffect(() => {
    fetch("/api/pokemon-data")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllPokemon(data);
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, []);

  const handleNameChange = (val) => {
    setPokemonName(val);
    setSelectedPokemon(null);
    setFastMove("");
    setChargedMove("");
    if (val.length >= 2) {
      const q = val.toLowerCase();
      const matches = allPokemon
        .filter((p) => p.name.toLowerCase().includes(q) && p.form === "Normal")
        .slice(0, 8);
      setSuggestions(matches);
      setShowSugg(matches.length > 0);
    } else {
      setSuggestions([]);
      setShowSugg(false);
    }
  };

  const selectPokemon = (poke) => {
    setPokemonName(poke.name);
    setSelectedPokemon(poke);
    setSuggestions([]);
    setShowSugg(false);
  };

  const getMoves = () => {
    if (!selectedPokemon?.moves?.length) return { fast: [], charged: [], eliteFast: [], eliteCharged: [] };
    const m = selectedPokemon.moves.find((mv) => mv.form === selectedPokemon.form) || selectedPokemon.moves[0];
    return m || { fast: [], charged: [], eliteFast: [], eliteCharged: [] };
  };

  const analyze = useCallback(async () => {
    if (!pokemonName.trim()) { setError("포켓몬 이름을 입력해주세요!"); return; }
    setLoading(true); setError(null); setResult(null);

    const pokemonData = selectedPokemon
      ? { name: selectedPokemon.name, id: selectedPokemon.id, baseAttack: selectedPokemon.baseAttack, baseDefense: selectedPokemon.baseDefense, baseStamina: selectedPokemon.baseStamina, moves: getMoves() }
      : { name: pokemonName, note: "API에서 매칭 안됨 - AI가 직접 판단" };

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pokemonData,
          userInput: { name: pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove, chargedMove, isShiny, isShadow },
        }),
      });
      const data = await res.json();
      if (data.error) { setError("분석 오류: " + data.error); }
      else { setResult(data.result); }
    } catch (e) { setError("네트워크 오류입니다. 다시 시도해주세요."); }
    setLoading(false);
  }, [pokemonName, cp, atkIv, defIv, staIv, ivPercent, fastMove, chargedMove, isShiny, isShadow, selectedPokemon]);

  const reset = () => {
    setPokemonName(""); setCp(""); setAtkIv(15); setDefIv(15); setStaIv(15);
    setFastMove(""); setChargedMove(""); setIsShiny(false); setIsShadow(false);
    setResult(null); setSelectedPokemon(null); setError(null);
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
    if (line.trim().startsWith("*")) return <div key={i} style={s.bulletLine}>{renderBold(line.replace(/^\*\s*/, ""))}</div>;
    if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
    return <div key={i} style={{ padding: "2px 0", fontSize: 13 }}>{renderBold(line)}</div>;
  });

  const moves = getMoves();

  return (
    <div style={s.container}>
      <div style={s.inner}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.logoIcon}>⚡</span>
          <div>
            <h1 style={s.title}>포고박사</h1>
            <p style={s.subtitle}>킵? 버려? 냅둬? AI가 판정해드립니다</p>
          </div>
        </div>

        {!result ? (
          <div style={s.card}>
            {/* Name */}
            <div style={s.group}>
              <label style={s.label}>포켓몬 이름 {dataLoading && <span style={{ fontSize: 10, color: "#ffd93d" }}>데이터 로딩중...</span>}</label>
              <div style={{ position: "relative" }}>
                <input style={s.input} value={pokemonName} onChange={(e) => handleNameChange(e.target.value)} onFocus={() => suggestions.length > 0 && setShowSugg(true)} onBlur={() => setTimeout(() => setShowSugg(false), 200)} />
                {selectedPokemon && (
                  <div style={s.miniInfo}>
                    <span style={{ color: "#4ecdc4" }}>✓ #{selectedPokemon.id}</span>
                    <span style={{ opacity: 0.5 }}>공{selectedPokemon.baseAttack}/방{selectedPokemon.baseDefense}/체{selectedPokemon.baseStamina}</span>
                  </div>
                )}
                {showSugg && (
                  <div style={s.suggBox}>
                    {suggestions.map((p) => (
                      <div key={p.id + p.form} style={s.suggItem} onMouseDown={() => selectPokemon(p)}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 11, opacity: 0.5 }}>#{p.id} 공{p.baseAttack}/방{p.baseDefense}/체{p.baseStamina}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CP */}
            <div style={s.group}>
              <label style={s.label}>CP (전투력)</label>
              <input style={s.input} type="number" value={cp} onChange={(e) => setCp(e.target.value)} />
            </div>

            {/* IV */}
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
            </div>

            {/* Moves */}
            <div style={s.group}>
              <label style={s.label}>현재 기술 {!selectedPokemon && <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.5 }}>(포켓몬 선택 시 목록 표시)</span>}</label>
              <div style={s.moveRow}>
                <div style={{ flex: 1 }}>
                  <div style={s.moveLabel}>빠른기술</div>
                  {selectedPokemon && moves.fast.length > 0 ? (
                    <select style={s.select} value={fastMove} onChange={(e) => setFastMove(e.target.value)}>
                      <option value="">선택</option>
                      {moves.fast.map((m) => <option key={m} value={m}>{m}</option>)}
                      {moves.eliteFast?.length > 0 && <optgroup label="── 한정기술 ──">{moves.eliteFast.map((m) => <option key={m} value={`⭐${m}`}>⭐ {m}</option>)}</optgroup>}
                    </select>
                  ) : <input style={s.input} value={fastMove} onChange={(e) => setFastMove(e.target.value)} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={s.moveLabel}>차징기술</div>
                  {selectedPokemon && moves.charged.length > 0 ? (
                    <select style={s.select} value={chargedMove} onChange={(e) => setChargedMove(e.target.value)}>
                      <option value="">선택</option>
                      {moves.charged.map((m) => <option key={m} value={m}>{m}</option>)}
                      {moves.eliteCharged?.length > 0 && <optgroup label="── 한정기술 ──">{moves.eliteCharged.map((m) => <option key={m} value={`⭐${m}`}>⭐ {m}</option>)}</optgroup>}
                    </select>
                  ) : <input style={s.input} value={chargedMove} onChange={(e) => setChargedMove(e.target.value)} />}
                </div>
              </div>
            </div>

            {/* Toggles */}
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
            {/* Pokemon Image */}
            {selectedPokemon && (
              <div style={s.imgContainer}>
                <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${selectedPokemon.id}.png`} alt={pokemonName} style={s.pokemonImg} onError={(e) => { e.target.style.display = "none"; }} />
                {isShiny && <span style={s.shinyBadge}>✨ 이로치</span>}
                {isShadow && <span style={s.shadowBadge}>👤 그림자</span>}
              </div>
            )}

            {/* IV Summary */}
            <div style={s.ivSummary}>
              {[["공격", atkIv], ["방어", defIv], ["HP", staIv]].map(([l, v]) => (
                <div key={l} style={s.ivSumItem}><span style={{ fontSize: 11, opacity: 0.6 }}>{l}</span><span style={{ fontWeight: 700 }}>{v}</span></div>
              ))}
              <div style={{ ...s.ivSumItem, borderRight: "none" }}><span style={{ fontSize: 11, opacity: 0.6 }}>IV</span><span style={{ fontWeight: 700, color: getIvColor() }}>{ivPercent}%</span></div>
            </div>

            <div style={s.resultContent}>{formatResult(result)}</div>
            <button onClick={reset} style={s.resetBtn}>🔄 다른 포켓몬 분석하기</button>
          </div>
        )}

        <div style={s.footer}>
          <p>포고박사 v0.2 — AI 기반 포켓몬GO 어드바이저</p>
          <p style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>Pokémon GO는 Niantic, Inc.의 상표입니다</p>
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { minHeight: "100vh", background: "linear-gradient(180deg,#0a1628 0%,#0f2035 50%,#0a1628 100%)", display: "flex", justifyContent: "center", padding: "20px 12px" },
  inner: { maxWidth: 520, width: "100%" },
  header: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", marginBottom: 24, padding: "16px 0" },
  logoIcon: { fontSize: 36, filter: "drop-shadow(0 0 12px rgba(0,212,170,0.6))" },
  title: { fontSize: 28, fontWeight: 800, margin: 0, background: "linear-gradient(135deg,#00d4aa,#4ecdc4,#00d4aa)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "shimmer 3s linear infinite" },
  subtitle: { fontSize: 13, margin: "2px 0 0 0", opacity: 0.5 },
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
  bulletLine: { padding: "6px 0", fontSize: 13, lineHeight: 1.8 },
  resetBtn: { display: "block", width: "calc(100% - 40px)", margin: "20px 20px 0", padding: 14, background: "transparent", border: "2px solid #2a3a5c", borderRadius: 12, color: "#8899aa", fontSize: 14, fontWeight: 600, fontFamily: "'Outfit',sans-serif", cursor: "pointer" },
  footer: { textAlign: "center", padding: "24px 0 8px", fontSize: 11, opacity: 0.3, color: "#c8d6e5" },
};

