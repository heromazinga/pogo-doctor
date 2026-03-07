'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Korean move names: fetched from PokeAPI, cached in memory ───
// PoGO move name → PokeAPI slug: "Fire Punch" → "fire-punch"
function moveToSlug(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/'/g, '')
    .replace(/--+/g, '-');
}

// Global cache: English move name → Korean name
let moveKrCache = {};
let moveKrLoaded = false;

// Fetch Korean move names from PokeAPI (batch, once)
async function loadMoveKrNames(allMoveNames) {
  if (moveKrLoaded) return;

  // Try loading from sessionStorage first
  try {
    const cached = sessionStorage.getItem('pogo-move-kr');
    if (cached) {
      moveKrCache = JSON.parse(cached);
      moveKrLoaded = true;
      return;
    }
  } catch {}

  const unique = [...new Set(allMoveNames.map((m) => m.replace(' ★', '')))];

  // Fetch in parallel batches of 20
  const batchSize = 20;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (engName) => {
        const slug = moveToSlug(engName);
        if (!slug) return;
        try {
          const res = await fetch(`https://pokeapi.co/api/v2/move/${slug}`);
          if (!res.ok) return;
          const data = await res.json();
          const krEntry = data.names?.find((n) => n.language.name === 'ko');
          if (krEntry) {
            moveKrCache[engName] = krEntry.name;
          }
        } catch {}
      })
    );
  }

  // Save to sessionStorage for speed on page refresh
  try {
    sessionStorage.setItem('pogo-move-kr', JSON.stringify(moveKrCache));
  } catch {}

  moveKrLoaded = true;
}

// Helper: translate move name (uses cached data)
function krMove(engName) {
  if (!engName) return '';
  const clean = engName.replace(' ★', '');
  return moveKrCache[clean] || clean;
}

const POGO_API = 'https://pogoapi.net/api/v1';

export default function Home() {
  // ─── State ───
  const [allPokemon, setAllPokemon] = useState([]);
  const [pokemonMoves, setPokemonMoves] = useState([]);
  const [pokemonTypes, setPokemonTypes] = useState([]);
  const [koreanNames, setKoreanNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [moveLoading, setMoveLoading] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedPokemon, setSelectedPokemon] = useState(null);

  const [cp, setCp] = useState('');
  const [iv, setIv] = useState({ attack: 15, defense: 15, hp: 15 });
  const [fastMove, setFastMove] = useState('');
  const [chargedMove, setChargedMove] = useState('');
  const [isShiny, setIsShiny] = useState(false);
  const [isShadow, setIsShadow] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const [collection, setCollection] = useState([]);
  const [showCollection, setShowCollection] = useState(false);
  const [currentKept, setCurrentKept] = useState(false);

  const searchRef = useRef(null);
  const suggestRef = useRef(null);

  // ─── Load data ───
  useEffect(() => {
    async function loadData() {
      try {
        const [statsRes, movesRes, typesRes, krRes] = await Promise.all([
          fetch(`${POGO_API}/pokemon_stats.json`),
          fetch(`${POGO_API}/current_pokemon_moves.json`),
          fetch(`${POGO_API}/pokemon_types.json`),
          // Korean names from PokeAPI
          fetch('https://pokeapi.co/api/v2/pokemon-species?limit=1100'),
        ]);

        const stats = await statsRes.json();
        const moves = await movesRes.json();
        const types = await typesRes.json();

        setAllPokemon(stats);
        setPokemonMoves(moves);
        setPokemonTypes(types);

        // Load Korean move names from PokeAPI (background, non-blocking)
        const allMoveNames = [];
        moves.forEach((m) => {
          if (m.fast_moves) allMoveNames.push(...m.fast_moves);
          if (m.charged_moves) allMoveNames.push(...m.charged_moves);
          if (m.elite_fast_moves) allMoveNames.push(...m.elite_fast_moves);
          if (m.elite_charged_moves) allMoveNames.push(...m.elite_charged_moves);
        });
        // Start loading moves in background (don't block UI)
        setMoveLoading(true);
        loadMoveKrNames(allMoveNames).then(() => {
          setMoveLoading(false);
        });

        // Build Korean name map from PokeAPI
        const speciesList = await krRes.json();
        const krMap = {};

        // Fetch Korean names in batches
        const batchSize = 50;
        const results = speciesList.results;
        for (let i = 0; i < Math.min(results.length, 1010); i += batchSize) {
          const batch = results.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (s) => {
              try {
                const r = await fetch(s.url);
                const d = await r.json();
                const krEntry = d.names?.find((n) => n.language.name === 'ko');
                return { id: d.id, kr: krEntry?.name || d.name, en: d.name };
              } catch {
                return null;
              }
            })
          );
          batchResults.filter(Boolean).forEach((p) => {
            krMap[p.id] = p.kr;
            // Also map English name to Korean for search
            krMap[p.en.toLowerCase()] = p.kr;
          });
        }

        setKoreanNames(krMap);
      } catch (e) {
        console.error('Data loading error:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Load collection from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pogo-collection');
      if (saved) setCollection(JSON.parse(saved));
    } catch {}
  }, []);

  // Save collection
  useEffect(() => {
    try {
      localStorage.setItem('pogo-collection', JSON.stringify(collection));
    } catch {}
  }, [collection]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e) {
      if (
        suggestRef.current &&
        !suggestRef.current.contains(e.target) &&
        !searchRef.current.contains(e.target)
      ) {
        setSuggestions([]);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ─── Get Korean name ───
  const getKrName = useCallback(
    (pokemon) => {
      if (!pokemon) return '';
      return koreanNames[pokemon.pokemon_id] || pokemon.pokemon_name;
    },
    [koreanNames]
  );

  // ─── Search handler ───
  function handleSearch(text) {
    setSearchText(text);
    setActiveIdx(-1);

    if (!text.trim()) {
      setSuggestions([]);
      return;
    }

    const query = text.toLowerCase();
    const seen = new Set();
    const matches = [];

    for (const p of allPokemon) {
      const key = `${p.pokemon_id}-${p.form || 'Normal'}`;
      if (seen.has(key)) continue;

      const krName = getKrName(p);
      const enName = p.pokemon_name.toLowerCase();

      if (krName.includes(query) || enName.includes(query) || String(p.pokemon_id).startsWith(query)) {
        seen.add(key);
        matches.push({ ...p, krName });
        if (matches.length >= 8) break;
      }
    }

    setSuggestions(matches);
  }

  // ─── Select pokemon ───
  function selectPokemon(p) {
    setSelectedPokemon(p);
    setSearchText(p.krName || getKrName(p));
    setSuggestions([]);
    setFastMove('');
    setChargedMove('');
    setResult('');
    setError('');
    setCurrentKept(false);
  }

  // ─── Get available moves ───
  function getMovesForPokemon() {
    if (!selectedPokemon) return { fast: [], charged: [] };

    const found = pokemonMoves.find(
      (m) =>
        m.pokemon_id === selectedPokemon.pokemon_id &&
        (m.form === selectedPokemon.form || (!m.form && selectedPokemon.form === 'Normal'))
    ) || pokemonMoves.find((m) => m.pokemon_id === selectedPokemon.pokemon_id);

    if (!found) return { fast: [], charged: [] };

    const fast = [...(found.fast_moves || [])];
    const charged = [...(found.charged_moves || [])];
    if (found.elite_fast_moves) fast.push(...found.elite_fast_moves.map((m) => m + ' ★'));
    if (found.elite_charged_moves) charged.push(...found.elite_charged_moves.map((m) => m + ' ★'));

    return { fast, charged };
  }

  // ─── Get types ───
  function getTypesForPokemon() {
    if (!selectedPokemon) return [];
    const found = pokemonTypes.find(
      (t) =>
        t.pokemon_id === selectedPokemon.pokemon_id &&
        (t.form === selectedPokemon.form || (!t.form && selectedPokemon.form === 'Normal'))
    ) || pokemonTypes.find((t) => t.pokemon_id === selectedPokemon.pokemon_id);
    return found?.type || [];
  }

  // ─── IV percent ───
  const ivPercent = Math.round(((iv.attack + iv.defense + iv.hp) / 45) * 100);

  function getIvLabel(pct) {
    if (pct >= 98) return '⭐ 완벽!';
    if (pct >= 90) return '거의 완벽!';
    if (pct >= 80) return '꽤 좋음';
    if (pct >= 60) return '보통';
    return '아쉬움';
  }

  // ─── Analyze ───
  async function handleAnalyze() {
    if (!selectedPokemon) return;

    setAnalyzing(true);
    setResult('');
    setError('');
    setCurrentKept(false);

    const types = getTypesForPokemon();

    // Resolve elite marker for API
    const cleanMove = (m) => m?.replace(' ★', '') || '';

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pokemon: {
            id: selectedPokemon.pokemon_id,
            name: `${getKrName(selectedPokemon)}(${selectedPokemon.pokemon_name})`,
            types,
            stats: {
              attack: selectedPokemon.base_attack,
              defense: selectedPokemon.base_defense,
              stamina: selectedPokemon.base_stamina,
            },
            form: selectedPokemon.form || 'Normal',
          },
          cp: parseInt(cp) || 0,
          iv,
          moves: {
            fast: fastMove ? `${krMove(cleanMove(fastMove))}(${cleanMove(fastMove)})` : '',
            charged: chargedMove ? `${krMove(cleanMove(chargedMove))}(${cleanMove(chargedMove)})` : '',
          },
          isShiny,
          isShadow,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.analysis);
      }
    } catch (e) {
      setError('네트워크 오류가 발생했습니다');
    } finally {
      setAnalyzing(false);
    }
  }

  // ─── Keep / Collection ───
  function handleKeep() {
    if (!selectedPokemon || !result) return;

    const entry = {
      id: `${selectedPokemon.pokemon_id}-${Date.now()}`,
      pokemonId: selectedPokemon.pokemon_id,
      name: getKrName(selectedPokemon),
      enName: selectedPokemon.pokemon_name,
      form: selectedPokemon.form || 'Normal',
      cp: parseInt(cp) || 0,
      iv: { ...iv },
      ivPercent,
      fastMove: fastMove ? krMove(fastMove.replace(' ★', '')) : '',
      chargedMove: chargedMove ? krMove(chargedMove.replace(' ★', '')) : '',
      isShiny,
      isShadow,
      verdict: extractVerdict(result),
      date: new Date().toISOString(),
    };

    setCollection((prev) => {
      const updated = [...prev, entry];
      // Sort by dex number
      updated.sort((a, b) => a.pokemonId - b.pokemonId);
      return updated;
    });
    setCurrentKept(true);
  }

  function extractVerdict(text) {
    // Try to extract the verdict keyword
    const match = text.match(/(킵|강화후보|교환용|박사행)/);
    return match ? match[1] : '킵';
  }

  function removeFromCollection(entryId) {
    setCollection((prev) => prev.filter((e) => e.id !== entryId));
  }

  // ─── Keyboard nav for autocomplete ───
  function handleKeyDown(e) {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectPokemon(suggestions[activeIdx]);
    }
  }

  const availableMoves = getMovesForPokemon();
  const spriteUrl = selectedPokemon
    ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${selectedPokemon.pokemon_id}.png`
    : '';

  // ─── Render ───
  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="logo">⚡</div>
        <h1>포고박사</h1>
        <div className="subtitle">킵? 버려? 냅둬? AI가 판정해드립니다</div>
      </div>

      {/* Pokemon Search */}
      <div className="card">
        <div className="card-title">포켓몬 이름</div>
        <div className="search-wrap">
          <input
            ref={searchRef}
            className="search-input"
            type="text"
            placeholder={loading ? '데이터 로딩중...' : '이름 또는 도감번호 검색'}
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          {suggestions.length > 0 && (
            <div className="autocomplete" ref={suggestRef}>
              {suggestions.map((s, i) => (
                <div
                  key={`${s.pokemon_id}-${s.form}`}
                  className={`autocomplete-item ${i === activeIdx ? 'active' : ''}`}
                  onClick={() => selectPokemon(s)}
                >
                  <span>
                    {getKrName(s)}
                    {s.form && s.form !== 'Normal' ? ` (${s.form})` : ''}
                  </span>
                  <span className="num">#{String(s.pokemon_id).padStart(4, '0')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedPokemon && (
          <div className="pokemon-info">
            <img src={spriteUrl} alt={selectedPokemon.pokemon_name} />
            <div className="details">
              <h3>
                {getKrName(selectedPokemon)}
                {selectedPokemon.form && selectedPokemon.form !== 'Normal'
                  ? ` (${selectedPokemon.form})`
                  : ''}
              </h3>
              <div className="types">
                {getTypesForPokemon().map((t) => (
                  <span key={t} className={`type-badge type-${t}`}>
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                공{selectedPokemon.base_attack} / 방{selectedPokemon.base_defense} / 체
                {selectedPokemon.base_stamina}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CP */}
      <div className="card">
        <div className="card-title">CP (전투력)</div>
        <input
          className="cp-input"
          type="number"
          placeholder="0"
          value={cp}
          onChange={(e) => setCp(e.target.value)}
          min="10"
          max="9999"
        />
      </div>

      {/* IV */}
      <div className="card">
        <div className="iv-header">
          <div className="card-title" style={{ margin: 0 }}>
            개체값 (IV)
          </div>
          <div className="iv-percent">
            {ivPercent}% — {getIvLabel(ivPercent)}
          </div>
        </div>
        {['attack', 'defense', 'hp'].map((stat) => (
          <div className="iv-row" key={stat}>
            <span className="iv-label">
              {stat === 'attack' ? '공격' : stat === 'defense' ? '방어' : 'HP'}
            </span>
            <input
              className="iv-slider"
              type="range"
              min="0"
              max="15"
              value={iv[stat]}
              onChange={(e) => setIv((prev) => ({ ...prev, [stat]: parseInt(e.target.value) }))}
            />
            <span className="iv-value">{iv[stat]}</span>
          </div>
        ))}
      </div>

      {/* Moves - now in Korean */}
      <div className="card">
        <div className="card-title">
          현재 기술 {!selectedPokemon && '(포켓몬 선택 시 목록 표시)'}
          {selectedPokemon && moveLoading && (
            <span style={{ color: 'var(--accent)', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
              기술명 한글화 중...
            </span>
          )}
        </div>
        <div className="move-row">
          <div className="move-label">빠른기술</div>
          <select
            className="move-select"
            value={fastMove}
            onChange={(e) => setFastMove(e.target.value)}
            disabled={!selectedPokemon}
          >
            <option value="">선택하세요</option>
            {availableMoves.fast.map((m) => {
              const isElite = m.endsWith(' ★');
              const clean = m.replace(' ★', '');
              return (
                <option key={m} value={m}>
                  {krMove(clean)}{isElite ? ' ★' : ''} ({clean})
                </option>
              );
            })}
          </select>
        </div>
        <div className="move-row">
          <div className="move-label">차징기술</div>
          <select
            className="move-select"
            value={chargedMove}
            onChange={(e) => setChargedMove(e.target.value)}
            disabled={!selectedPokemon}
          >
            <option value="">선택하세요</option>
            {availableMoves.charged.map((m) => {
              const isElite = m.endsWith(' ★');
              const clean = m.replace(' ★', '');
              return (
                <option key={m} value={m}>
                  {krMove(clean)}{isElite ? ' ★' : ''} ({clean})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="card">
        <div className="toggles">
          <button
            className={`toggle-btn ${isShiny ? 'active' : ''}`}
            onClick={() => setIsShiny(!isShiny)}
          >
            ✨ 이로치
          </button>
          <button
            className={`toggle-btn ${isShadow ? 'active' : ''}`}
            onClick={() => setIsShadow(!isShadow)}
          >
            👤 그림자
          </button>
        </div>
      </div>

      {/* Analyze button */}
      <button
        className="analyze-btn"
        onClick={handleAnalyze}
        disabled={!selectedPokemon || analyzing}
      >
        {analyzing ? '분석 중...' : '🔍 포켓몬 분석하기'}
      </button>

      {/* Loading */}
      {analyzing && (
        <div className="loading">
          <div className="spinner" />
          <div>AI가 분석 중입니다...</div>
        </div>
      )}

      {/* Error */}
      {error && <div className="error">⚠️ {error}</div>}

      {/* Result */}
      {result && (
        <>
          <div className="result">{result}</div>
          <div className="keep-bar">
            <button
              className={`keep-btn ${currentKept ? 'kept' : ''}`}
              onClick={handleKeep}
              disabled={currentKept}
            >
              {currentKept ? '✅ 보유목록에 저장됨' : '📦 킵! 보유목록에 저장'}
            </button>
          </div>
        </>
      )}

      {/* Collection FAB */}
      <button className="collection-toggle" onClick={() => setShowCollection(true)}>
        📋
        {collection.length > 0 && <span className="collection-badge">{collection.length}</span>}
      </button>

      {/* Collection Panel */}
      {showCollection && (
        <div className="collection-panel">
          <div className="collection-header">
            <h2>📋 보유목록 ({collection.length})</h2>
            <button className="close-btn" onClick={() => setShowCollection(false)}>
              ✕
            </button>
          </div>

          {collection.length === 0 ? (
            <div className="empty-collection">
              <div className="icon">📦</div>
              <div>아직 저장된 포켓몬이 없습니다</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                분석 후 "킵" 버튼을 눌러 보유목록에 추가하세요
              </div>
            </div>
          ) : (
            collection.map((item) => (
              <div className="collection-item" key={item.id}>
                <img
                  src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.pokemonId}.png`}
                  alt={item.name}
                />
                <div className="col-info">
                  <div className="col-name">
                    {item.isShiny ? '✨' : ''}
                    {item.isShadow ? '👤' : ''}
                    {item.name}
                    <span style={{ color: 'var(--text2)', fontSize: 12, marginLeft: 4 }}>
                      #{String(item.pokemonId).padStart(4, '0')}
                    </span>
                  </div>
                  <div className="col-detail">
                    CP{item.cp} IV{item.ivPercent}% | {item.fastMove}/{item.chargedMove}
                  </div>
                </div>
                <div className="col-verdict">{item.verdict}</div>
                <button className="col-remove" onClick={() => removeFromCollection(item.id)}>
                  🗑
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer */}
      <div className="footer">
        <div>포고박사 v0.4 — Gemini 3.1 Flash Lite</div>
        <div>Pokémon GO는 Niantic, Inc.의 상표입니다</div>
      </div>
    </div>
  );
}
