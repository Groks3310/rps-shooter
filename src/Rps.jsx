import React, { useState, useEffect, useRef, useCallback } from "react";
import "./Rps.css";

const TYPES = ["rock", "paper", "scissors"];
const EMOJI = { rock: "🪨", paper: "📄", scissors: "✂️" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

const MODES = {
  amateur:      { label: "Amateur",      spawnMs: 1000, maxBalls: 12, speedMult: 0.8 },
  advanced:     { label: "Advanced",     spawnMs: 700,  maxBalls: 18, speedMult: 1.2 },
  professional: { label: "Professional", spawnMs: 450,  maxBalls: 25, speedMult: 1.8 },
};

const RULES = [
  { icon: "⚠️", text: "5 Mismatches = Lose 1 Life" },
  { icon: "🛡️", text: "Bosses have 3HP & change type" },
  { icon: "👹", text: "Bosses spawn every 7 seconds" },
  { icon: "⚡", text: "Massive speed jump at 30 pts" },
  { icon: "🔥", text: "5x Combo recovers 1 Life!" },
];

// ── Helpers ──
function createBall(arenaW, arenaH, isBoss = false, speedMult = 1, currentScore = 0) {
  const type = TYPES[Math.floor(Math.random() * 3)];
  let scale = 1 + (Math.floor(currentScore / 10) * 0.1);
  if (currentScore >= 30) scale *= 1.5; 

  const speed = (2 + Math.random() * 2) * speedMult * scale * (isBoss ? 0.6 : 1);
  const angle = Math.random() * Math.PI * 2;
  
  return {
    id: Date.now() + Math.random(),
    type, isBoss,
    hp: isBoss ? 3 : 1,
    x: arenaW * 0.1 + Math.random() * arenaW * 0.8,
    y: -30,
    vx: Math.cos(angle) * speed * 0.7,
    vy: Math.abs(Math.sin(angle) * speed) + 0.8,
  };
}

function beats(a, b) { return BEATS[a] === b; }
function getMultiplier(combo) {
  if (combo >= 5) return 3;
  if (combo >= 3) return 2;
  return 1;
}

function getHighScores() {
  try { return JSON.parse(localStorage.getItem("rps_hs_v2") || "{}"); } catch { return {}; }
}
function saveHighScore(mode, score) {
  const hs = getHighScores();
  if ((hs[mode] || 0) < score) { 
    hs[mode] = score; 
    localStorage.setItem("rps_hs_v2", JSON.stringify(hs)); 
  }
  return hs;
}

// ── Audio Engine ──
function getAudioCtx(ref) {
  if (!ref.current) ref.current = new (window.AudioContext || window.webkitAudioContext)();
  if (ref.current.state === "suspended") ref.current.resume();
  return ref.current;
}

function playTone(ctx, freq, type, duration, gainVal = 0.18, when = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + duration);
  osc.start(ctx.currentTime + when);
  osc.stop(ctx.currentTime + when + duration);
}

class MusicEngine {
  constructor(ctx, filePath) {
    this.ctx = ctx;
    this.audio = new Audio(filePath);
    this.audio.loop = true;
    this.audio.crossOrigin = "anonymous";
    this.source = ctx.createMediaElementSource(this.audio);
    this.masterGain = ctx.createGain();
    this.source.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }
  start() { this.audio.play().catch(() => {}); }
  pause() { this.audio.pause(); }
  stop() { this.audio.pause(); this.audio.currentTime = 0; }
  setVolume(v) { this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
}

export default function Rps() {
  const [phase, setPhase] = useState("idle");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [mismatch, setMismatch] = useState(0); // Tracking mismatches
  const [highScores, setHighScores] = useState(getHighScores);
  const [popups, setPopups] = useState([]);
  const [flashColor, setFlashColor] = useState(null);
  const [waveBanner, setWaveBanner] = useState(null);
  const [balls, setBalls] = useState([]);
  const [finalScore, setFinalScore] = useState(0);
  const [missedCount, setMissedCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState("amateur");
  const [musicVol, setMusicVol] = useState(0.4);
  const [openSection, setOpenSection] = useState(null);
  const [isQuitting, setIsQuitting] = useState(false);

  const arenaRef    = useRef(null);
  const playingRef  = useRef(false);
  const scoreRef    = useRef(0);
  const comboRef    = useRef(0);
  const livesRef    = useRef(3);
  const mismatchRef = useRef(0); // Ref for sync logic
  const missedRef   = useRef(0);
  const spawnRef    = useRef(null);
  const moveRef     = useRef(null);
  const bossRef     = useRef(null);
  const popupIdRef  = useRef(0);
  const ballsRef    = useRef([]);
  const audioCtxRef = useRef(null);
  const musicRef    = useRef(null);
  const modeRef     = useRef("amateur");

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const toggleSection = (name) => setOpenSection(openSection === name ? null : name);

  const stopAll = useCallback(() => {
    [spawnRef, moveRef, bossRef].forEach(r => { clearInterval(r.current); r.current = null; });
  }, []);

  const getSfxCtx = useCallback(() => {
    try { return getAudioCtx(audioCtxRef); } catch { return null; }
  }, []);

  const stopMusic = useCallback(() => { musicRef.current?.stop(); }, []);

  const triggerFlash = useCallback((color) => {
    setFlashColor(color);
    setTimeout(() => setFlashColor(null), 140);
  }, []);

  const addPopup = useCallback((x, y, text, color) => {
    const id = popupIdRef.current++;
    setPopups(p => [...p, { id, x, y, text, color }]);
    setTimeout(() => setPopups(p => p.filter(pp => pp.id !== id)), 900);
  }, []);

  const showWaveBanner = useCallback((text) => {
    setWaveBanner(text);
    setTimeout(() => setWaveBanner(null), 1500);
  }, []);

  const endGame = useCallback(() => {
    playingRef.current = false;
    stopAll();
    stopMusic();
    const fs = scoreRef.current;
    setFinalScore(fs);
    setBalls([]); ballsRef.current = [];
    setHighScores(saveHighScore(modeRef.current, fs));
    const ctx = getSfxCtx();
    if (ctx) [400, 320, 240, 160].forEach((f, i) => setTimeout(() => playTone(ctx, f, "sawtooth", 0.35, 0.22), i * 180));
    setPhase("gameover");
    setIsQuitting(false);
  }, [stopAll, stopMusic, getSfxCtx]);

  const startRound = useCallback(() => {
    const cfg = MODES[modeRef.current];
    playingRef.current = true;
    setPhase("playing");
    setIsQuitting(false);
    
    try {
      const ctx = getAudioCtx(audioCtxRef);
      if (!musicRef.current) musicRef.current = new MusicEngine(ctx, "./sounds/background.mp3");
      musicRef.current.setVolume(musicVol * 0.18);
      musicRef.current.start();
    } catch {}

    spawnRef.current = setInterval(() => {
      if (!playingRef.current) return;
      if (ballsRef.current.length < cfg.maxBalls) {
        const r = arenaRef.current?.getBoundingClientRect();
        ballsRef.current = [...ballsRef.current, createBall(r.width, r.height, false, cfg.speedMult, scoreRef.current)];
        setBalls([...ballsRef.current]);
      }
    }, cfg.spawnMs);

    moveRef.current = setInterval(() => {
      if (!playingRef.current) return;
      const r = arenaRef.current?.getBoundingClientRect();
      let escaped = 0;
      ballsRef.current = ballsRef.current.map(b => {
        let { x, y, vx, vy } = b;
        vy += 0.04; x += vx; y += vy;
        if (x < 12) { x = 12; vx = Math.abs(vx); }
        if (x > r.width - 12) { x = r.width - 12; vx = -Math.abs(vx); }
        if (y > r.height + 40) { escaped++; y = -500; }
        return { ...b, x, y, vx, vy };
      });
      if (escaped > 0) {
        livesRef.current = Math.max(0, livesRef.current - escaped);
        missedRef.current += escaped;
        setLives(livesRef.current);
        setMissedCount(missedRef.current);
        comboRef.current = 0; setCombo(0);
        triggerFlash("#ff4c5e");
        const ctx = getSfxCtx(); if (ctx) playTone(ctx, 160, "sawtooth", 0.2, 0.25);
        if (livesRef.current <= 0) endGame();
      }
      setBalls([...ballsRef.current.filter(b => b.y > -100)]);
    }, 50);

    bossRef.current = setInterval(() => {
        if (!playingRef.current) return;
        const r = arenaRef.current?.getBoundingClientRect();
        ballsRef.current = [...ballsRef.current, createBall(r.width, r.height, true, cfg.speedMult, scoreRef.current)];
        setBalls([...ballsRef.current]);
        showWaveBanner("👹 BOSS ALERT!");
        const ctx = getSfxCtx(); if (ctx) playTone(ctx, 80, "sawtooth", 0.5, 0.35);
    }, 7000); 
  }, [endGame, showWaveBanner, triggerFlash, getSfxCtx, musicVol, stopMusic]);

  const shoot = useCallback((choice) => {
    if (!playingRef.current || isQuitting) return;
    const ctx = getSfxCtx();
    const hits = ballsRef.current.filter(b => beats(choice, b.type));

    if (hits.length > 0) {
      let earned = 0;
      const mult = getMultiplier(comboRef.current + 1);

      ballsRef.current = ballsRef.current.map(b => {
        if (beats(choice, b.type)) {
          if (b.isBoss && b.hp > 1) {
            addPopup(b.x, b.y, "SHIELD HIT", "#f5c400");
            return { ...b, hp: b.hp - 1, type: TYPES[Math.floor(Math.random() * 3)] };
          } else {
            earned += (b.isBoss ? 5 : 1) * mult;
            addPopup(b.x, b.y, `+${b.isBoss ? 5 : 1}${mult > 1 ? `x${mult}` : ""}`, "#00e676");
            return null;
          }
        }
        return b;
      }).filter(Boolean);

      if (earned > 0) {
        const oldScore = scoreRef.current;
        scoreRef.current += earned;
        setScore(scoreRef.current);
        if (oldScore < 30 && scoreRef.current >= 30) showWaveBanner("⚡ SPEED UP! ⚡");

        comboRef.current = Math.min(comboRef.current + 1, 5);
        setCombo(comboRef.current);
        if (comboRef.current === 5 && livesRef.current < 3) {
          livesRef.current++; setLives(livesRef.current);
        }
        triggerFlash("#00e676");
        if (ctx) playTone(ctx, 520, "square", 0.08, 0.2);
      }
      setBalls([...ballsRef.current]);
    } else {
      // MISMATCH LOGIC
      mismatchRef.current += 1;
      setMismatch(mismatchRef.current);
      comboRef.current = 0; 
      setCombo(0);
      
      if (mismatchRef.current >= 5) {
        mismatchRef.current = 0;
        setMismatch(0);
        livesRef.current = Math.max(0, livesRef.current - 1);
        setLives(livesRef.current);
        addPopup(arenaRef.current?.offsetWidth/2, 100, "💔 MISMATCH PENALTY", "#ff4c5e");
        triggerFlash("#ff4c5e");
        const ctx = getSfxCtx(); if (ctx) playTone(ctx, 120, "sawtooth", 0.3, 0.3);
        if (livesRef.current <= 0) endGame();
      } else {
        triggerFlash("#ffa500"); // Orange flash for small mismatch
        const ctx = getSfxCtx(); if (ctx) playTone(ctx, 200, "sine", 0.1, 0.2);
      }
    }
  }, [addPopup, triggerFlash, getSfxCtx, isQuitting, showWaveBanner, endGame]);

  const startGame = useCallback(() => {
    stopAll(); stopMusic();
    setSidebarOpen(false); setIsQuitting(false);
    scoreRef.current = 0; comboRef.current = 0; missedRef.current = 0; livesRef.current = 3; mismatchRef.current = 0;
    setScore(0); setLives(3); setCombo(0); setMissedCount(0); setMismatch(0);
    setBalls([]); ballsRef.current = [];
    setPhase("countdown"); setCountdown(3);
    let n = 3;
    const cd = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(cd); startRound(); }
      else setCountdown(n);
    }, 800);
  }, [startRound, stopAll, stopMusic]);

  useEffect(() => {
    if (musicRef.current) musicRef.current.setVolume(musicVol * 0.18);
  }, [musicVol]);

  useEffect(() => {
    if (sidebarOpen || isQuitting) {
      playingRef.current = false;
      stopAll();
      musicRef.current?.pause();
    }
  }, [sidebarOpen, isQuitting, stopAll]);

  const confirmQuit = () => {
    stopAll(); stopMusic();
    setPhase("idle");
    setIsQuitting(false);
    setSidebarOpen(false);
  };

  return (
    <div className="rps-root">
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <span className="sidebar-logo">RPS<span className="dot">.</span></span>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection('diff')} style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between'}}>
            GAME MODE <span>{openSection === 'diff' ? '−' : '+'}</span>
          </div>
          {openSection === 'diff' && (
            <div style={{marginTop: '10px'}}>
              {Object.entries(MODES).map(([key, cfg]) => (
                <button key={key} className={`level-btn ${mode === key ? "active" : ""} lvl-${key}`} onClick={() => setMode(key)} disabled={phase === "playing"}>
                  <span className="level-name">{cfg.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection('audio')} style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between'}}>
            Audio Settings <span>{openSection === 'audio' ? '−' : '+'}</span>
          </div>
          {openSection === 'audio' && (
            <div className="sound-toggle-row" style={{marginTop: '10px'}}>
              <span className="sound-label">Music Vol</span>
              <input type="range" min="0" max="1" step="0.1" value={musicVol} onChange={e => setMusicVol(parseFloat(e.target.value))} />
            </div>
          )}
        </div>

        <div className="sidebar-section">
            <div className="sidebar-section-title" onClick={() => toggleSection('rules')} style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between'}}>
              Game Rules <span>{openSection === 'rules' ? '−' : '+'}</span>
            </div>
            {openSection === 'rules' && (
              <div style={{marginTop: '10px'}}>
                {RULES.map((r, i) => (
                    <div key={i} style={{fontSize: '11px', marginBottom: '6px', color: '#ccc'}}>
                        {r.icon} {r.text}
                    </div>
                ))}
              </div>
            )}
        </div>

        <div className="sidebar-footer">
          {phase === "playing" ? (
            <button className="resume-btn" onClick={() => { setSidebarOpen(false); startRound(); }}>Resume</button>
          ) : (
            <button className="newgame-btn" onClick={startGame}>New Game</button>
          )}
        </div>
      </aside>

      <div className="game-wrap">
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)}><span /><span /><span /></button>
          <div className="topbar-title">RPS<span className="dot">.</span></div>
          <div className="topbar-level">{MODES[mode].label}</div>
        </div>

        <div className="rps-hud">
          <div className="hud-box"><div className="hud-label">Score</div><div className="hud-val yellow">{score}</div></div>
          <div className="hud-box"><div className="hud-label">Lives</div><div className="hud-val red">{"❤️".repeat(lives)}</div></div>
          {/* NEW MISMATCH HUD */}
          <div className="hud-box"><div className="hud-label">Mismatch</div><div className="hud-val orange">{mismatch} / 5</div></div>
          <div className="hud-box"><div className="hud-label">Best</div><div className="hud-val white">{highScores[mode] ?? 0}</div></div>
        </div>

        <div className="combo-row">
          <span className="combo-label">COMBO</span>
          <div className="combo-track"><div className="combo-fill" style={{ width: `${(combo/5)*100}%` }} /></div>
          <span className="combo-mult">{combo > 0 ? `${getMultiplier(combo)}×` : "—"}</span>
        </div>

        <div className="rps-arena" ref={arenaRef}>
          {flashColor && <div className="arena-flash" style={{ background: flashColor }} />}
          {balls.map(b => (
            <div key={b.id} className={`ball${b.isBoss ? " boss" : ""}`} style={{ left: b.x, top: b.y }}>
              {EMOJI[b.type]}
              {b.isBoss && <div className="boss-hp">{"●".repeat(b.hp)}</div>}
            </div>
          ))}
          {popups.map(p => <div key={p.id} className="popup" style={{ left: p.x, top: p.y, color: p.color }}>{p.text}</div>)}
          {waveBanner && <div className="wave-banner">{waveBanner}</div>}

          {(phase !== "playing" || isQuitting) && (
            <div className="overlay">
              {isQuitting ? (
                <div style={{textAlign: 'center'}}>
                  <div className="overlay-title" style={{fontSize: '24px', color: '#ff4c5e'}}>Quit Game?</div>
                  <div style={{display: 'flex', gap: '15px', marginTop: '20px'}}>
                    <button className="overlay-btn" style={{background: '#ff4c5e'}} onClick={confirmQuit}>Quit</button>
                    <button className="overlay-btn" style={{background: '#444'}} onClick={() => { setIsQuitting(false); startRound(); }}>Stay</button>
                  </div>
                </div>
              ) : phase === "idle" ? (
                <>
                  <div className="overlay-badge">Survival Mode</div>
                  <div className="overlay-title">RPS Shooter</div>
                  <button className="overlay-btn" onClick={startGame}>Start</button>
                </>
              ) : phase === "countdown" ? (
                <div className="countdown-num">{countdown}</div>
              ) : (
                <>
                  <div className="overlay-title">Game Over</div>
                  <div className="stat-val yellow">Score: {finalScore}</div>
                  <button className="overlay-btn" onClick={startGame}>Retry</button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="controls">
          {TYPES.map(t => (
            <button key={t} className={`shoot-btn ${t}`} onClick={() => shoot(t)} disabled={phase !== "playing" || isQuitting}>
              <span className="shoot-icon">{EMOJI[t]}</span>
              <span className="shoot-label">{t}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}