import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ==========================================================================
   PomoQuest — a gamified Pomodoro timer
   --------------------------------------------------------------------------
   SECTION MAP (the walkthrough doc follows these same numbers)
     1. Theme tokens & global CSS
     2. Constants: modes, difficulties, achievements
     3. Pure helpers: time, dates, XP maths
     4. Storage layer (fake auth + save files)
     5. UI atoms: Panel, Btn, Meter, Chip
     6. AuthScreen
     7. TopBar (level + XP meter)
     8. TimerShrine (the hexagon crystal)
     9. SettingsSheet
    10. DailyQuestBar
    11. QuestLog + QuestRow
    12. TrophyCase
    13. App (the brain: state, effects, wiring)
   ========================================================================== */

/* ==========================================================================
   1. THEME TOKENS
   Artifacts can't compile custom Tailwind colours (no build step), so every
   colour lives here as a plain string and gets applied with `style={{...}}`.
   Tailwind still does all the layout work: flex, grid, gap, padding, md:*.
   ========================================================================== */
const T = {
  ink: "#14102A",
  panel: "#1E1840",
  panel2: "#2A2158",
  line: "#3B3178",
  gold: "#FFC145",
  mint: "#4FE0B0",
  sky: "#6BA8FF",
  rose: "#FF6B8B",
  text: "#EDE9FF",
  muted: "#968DC4",
  display: '"Chakra Petch", "Trebuchet MS", system-ui, sans-serif',
  body: '"Outfit", "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "Courier New", monospace',
};

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;700&display=swap');

.pq-scroll::-webkit-scrollbar { width: 8px; }
.pq-scroll::-webkit-scrollbar-track { background: transparent; }
.pq-scroll::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 99px; }

.pq-rise { animation: pqRise .45s cubic-bezier(.2,.8,.2,1) both; }
@keyframes pqRise { from { opacity:0; transform: translateY(10px) } to { opacity:1; transform:none } }

.pq-float { animation: pqFloat 1.5s ease-out forwards; }
@keyframes pqFloat { 0%{opacity:0;transform:translateY(6px) scale(.9)} 15%{opacity:1;transform:none} 100%{opacity:0;transform:translateY(-34px)} }

.pq-burst { animation: pqBurst 1.1s ease-out forwards; }
@keyframes pqBurst { 0%{opacity:0;transform:scale(.7)} 20%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.12)} }

.pq-pulse { animation: pqPulse 2.4s ease-in-out infinite; }
@keyframes pqPulse { 0%,100%{opacity:.35} 50%{opacity:.75} }

.pq-focusable:focus-visible { outline: 2px solid ${T.gold}; outline-offset: 3px; }

@media (prefers-reduced-motion: reduce) {
  .pq-rise, .pq-float, .pq-burst, .pq-pulse { animation: none !important; }
  * { transition-duration: .01ms !important; }
}
`;

/* ==========================================================================
   2. CONSTANTS
   Config lives in objects, not scattered through JSX. Want a 4th timer mode?
   Add one entry here and the mode buttons render it automatically.
   ========================================================================== */
const MODES = {
  focus: { id: "focus", label: "Focus", color: T.gold, blurb: "One quest. Nothing else.", settingKey: "focusMin" },
  short: { id: "short", label: "Short rest", color: T.mint, blurb: "Stand up. Look out a window.", settingKey: "shortMin" },
  long: { id: "long", label: "Long rest", color: T.sky, blurb: "Step away properly. You earned it.", settingKey: "longMin" },
};
const MODE_ORDER = ["focus", "short", "long"];

const DIFFICULTY = {
  easy: { id: "easy", label: "Easy", xp: 15, color: T.mint },
  normal: { id: "normal", label: "Normal", xp: 30, color: T.gold },
  boss: { id: "boss", label: "Boss", xp: 60, color: T.rose },
};
const DIFFICULTY_ORDER = ["easy", "normal", "boss"];

const XP_PER_FOCUS_SESSION = 25;
const DAY_GOAL_BONUS = 120;

/* Each achievement is data + a test function. Adding one is a one-line job. */
const ACHIEVEMENTS = [
  { id: "spark", name: "First Spark", hint: "Finish 1 focus session", test: (s) => s.totalSessions >= 1 },
  { id: "quester", name: "Quest Taker", hint: "Complete 1 quest", test: (s) => s.totalQuests >= 1 },
  { id: "diver", name: "Deep Diver", hint: "Finish 10 focus sessions", test: (s) => s.totalSessions >= 10 },
  { id: "century", name: "Century", hint: "Focus for 100 minutes", test: (s) => s.totalFocusMin >= 100 },
  { id: "regular", name: "Guild Regular", hint: "Complete 25 quests", test: (s) => s.totalQuests >= 25 },
  { id: "threesuns", name: "Three Suns", hint: "Hit your goal 3 days running", test: (s) => s.bestStreak >= 3 },
];

/* ==========================================================================
   3. PURE HELPERS
   No React in here. Same input -> same output, every time. Easy to reason
   about, easy to test, and safe to call from anywhere.
   ========================================================================== */
function pad(n) {
  return String(n).padStart(2, "0");
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** "2026-08-14" — a stable key for "which day is it", in the user's own timezone. */
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

/** XP needed to get from `level` to the next one. Curve gets steeper as you climb. */
function xpForLevel(level) {
  return 100 + (level - 1) * 75;
}

/** Turn one number (total XP) into everything the UI needs to draw the meter. */
function levelFromXP(totalXP) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXP));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  const need = xpForLevel(level);
  return { level, into: remaining, need, pct: need === 0 ? 0 : remaining / need };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** A short chime built from scratch with the Web Audio API — no audio files needed. */
function playChime(kind = "done") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = kind === "levelup" ? [523, 659, 784, 1047] : kind === "rest" ? [659, 523] : [784, 988, 1319];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    setTimeout(() => ctx.close(), 1600);
  } catch {
    /* audio is a nice-to-have, never a crash */
  }
}

/* ==========================================================================
   4. STORAGE LAYER
   window.storage is the artifact's key/value store. It's async (returns
   Promises) and it throws when a key is missing, so everything is wrapped.
   In your own project you'd swap these two functions for a real backend.
   ========================================================================== */
const memoryStore = new Map(); // fallback so the app still runs anywhere

async function loadJSON(key) {
  try {
    if (window.storage) {
      const res = await window.storage.get(key, false);
      return res ? JSON.parse(res.value) : null;
    }
  } catch {
    /* missing key throws — treat as "nothing saved yet" */
  }
  return memoryStore.has(key) ? JSON.parse(memoryStore.get(key)) : null;
}

async function saveJSON(key, value) {
  const raw = JSON.stringify(value);
  memoryStore.set(key, raw);
  try {
    if (window.storage) await window.storage.set(key, raw, false);
  } catch (err) {
    console.error("Could not save:", err);
  }
}

const K = {
  users: "pomoquest:users",
  session: "pomoquest:session",
  save: (name) => `pomoquest:save:${name}`,
};

/** NOT security. A scrambler so plain passwords aren't sitting in storage. */
function scramble(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function newSaveFile() {
  return {
    xp: 0,
    quests: [],
    settings: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: true, sound: true, dailyGoal: 5 },
    stats: { totalSessions: 0, totalFocusMin: 0, totalQuests: 0, streak: 0, bestStreak: 0 },
    day: { date: todayKey(), quests: 0, sessions: 0, claimed: false },
    trophies: [],
  };
}

/** Old saves may be missing newer fields — fill the gaps instead of crashing. */
function hydrate(raw) {
  const base = newSaveFile();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    stats: { ...base.stats, ...(raw.stats || {}) },
    day: { ...base.day, ...(raw.day || {}) },
    quests: Array.isArray(raw.quests) ? raw.quests : [],
    trophies: Array.isArray(raw.trophies) ? raw.trophies : [],
  };
}

/* ==========================================================================
   5. UI ATOMS
   Tiny presentational components. They hold no state — they just take props
   and return JSX. Build these once, reuse them fifty times.
   ========================================================================== */
function Panel({ children, className = "", glow = null, style = {} }) {
  return (
    <section
      className={`rounded-2xl border p-5 ${className}`}
      style={{
        background: T.panel,
        borderColor: T.line,
        boxShadow: glow ? `0 0 0 1px ${glow}22, 0 18px 40px -28px ${glow}` : "0 18px 40px -32px #000",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function Eyebrow({ children, color = T.muted }) {
  return (
    <p
      className="mb-3 text-xs uppercase"
      style={{ color, fontFamily: T.display, letterSpacing: "0.18em", fontWeight: 600 }}
    >
      {children}
    </p>
  );
}

function Btn({ children, onClick, tone = "ghost", color = T.gold, size = "md", disabled, className = "", title }) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "px-7 py-3 text-base" : "px-4 py-2 text-sm";
  const solid = tone === "solid";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`pq-focusable rounded-xl border transition-all duration-150 active:translate-y-px ${pad} ${
        disabled ? "opacity-40" : "hover:-translate-y-0.5"
      } ${className}`}
      style={{
        fontFamily: T.display,
        fontWeight: 600,
        letterSpacing: "0.04em",
        cursor: disabled ? "not-allowed" : "pointer",
        background: solid ? color : "transparent",
        color: solid ? T.ink : color,
        borderColor: solid ? color : `${color}66`,
        boxShadow: solid && !disabled ? `0 8px 22px -12px ${color}` : "none",
      }}
    >
      {children}
    </button>
  );
}

/** A generic progress bar. Used by the XP meter, the day goal, and quest cards. */
function Meter({ pct, color = T.gold, height = 10, showShine = true }) {
  const width = `${clamp(pct * 100, 0, 100)}%`;
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: T.ink, boxShadow: `inset 0 1px 3px #0008` }}
      role="progressbar"
      aria-valuenow={Math.round(clamp(pct * 100, 0, 100))}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width,
          background: showShine ? `linear-gradient(90deg, ${color}99, ${color})` : color,
          boxShadow: `0 0 14px -2px ${color}`,
        }}
      />
    </div>
  );
}

function Chip({ children, color = T.muted, active = false, onClick, title }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={`pq-focusable rounded-full border px-2.5 py-1 text-xs transition-colors ${onClick ? "cursor-pointer" : ""}`}
      style={{
        fontFamily: T.display,
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: active ? T.ink : color,
        background: active ? color : `${color}14`,
        borderColor: active ? color : `${color}44`,
      }}
    >
      {children}
    </Tag>
  );
}

function Stat({ label, value, color = T.text }) {
  return (
    <div>
      <p className="text-xs" style={{ color: T.muted, fontFamily: T.body }}>
        {label}
      </p>
      <p className="text-lg" style={{ color, fontFamily: T.mono, fontWeight: 700 }}>
        {value}
      </p>
    </div>
  );
}

/* ==========================================================================
   6. AUTH SCREEN
   A "controlled form": every input's value comes from state, and every
   keystroke writes back to state. React is the single source of truth.
   Note: no <form> tag — a button with onClick + Enter key handling instead.
   ========================================================================== */
function AuthScreen({ onAuth, onGuest }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit() {
    const user = name.trim().toLowerCase();
    setError("");

    if (user.length < 3) return setError("Names need at least 3 characters.");
    if (pass.length < 4) return setError("Passwords need at least 4 characters.");

    setBusy(true);
    const users = (await loadJSON(K.users)) || {};

    if (isSignup) {
      if (users[user]) {
        setBusy(false);
        return setError("That name is taken. Try logging in.");
      }
      users[user] = { pass: scramble(pass), joined: todayKey() };
      await saveJSON(K.users, users);
      await saveJSON(K.save(user), newSaveFile());
    } else {
      if (!users[user]) {
        setBusy(false);
        return setError("No adventurer by that name. Create one?");
      }
      if (users[user].pass !== scramble(pass)) {
        setBusy(false);
        return setError("Wrong password.");
      }
    }

    await saveJSON(K.session, { user });
    setBusy(false);
    onAuth(user);
  }

  const inputStyle = {
    background: T.ink,
    borderColor: T.line,
    color: T.text,
    fontFamily: T.body,
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: T.ink }}>
      <div className="pq-rise w-full max-w-md">
        <div className="mb-8 text-center">
          <HexMark size={64} color={T.gold} />
          <h1
            className="mt-4 text-4xl"
            style={{ fontFamily: T.display, color: T.text, fontWeight: 700, letterSpacing: "0.02em" }}
          >
            Pomo<span style={{ color: T.gold }}>Quest</span>
          </h1>
          <p className="mt-2 text-sm" style={{ color: T.muted, fontFamily: T.body }}>
            Focus in 25-minute quests. Earn XP. Keep the streak alive.
          </p>
        </div>

        <Panel glow={T.gold}>
          <div className="mb-5 flex gap-2">
            <Btn tone={!isSignup ? "solid" : "ghost"} onClick={() => setMode("login")} className="flex-1">
              Log in
            </Btn>
            <Btn tone={isSignup ? "solid" : "ghost"} onClick={() => setMode("signup")} className="flex-1">
              New adventurer
            </Btn>
          </div>

          <label className="mb-1 block text-xs" style={{ color: T.muted, fontFamily: T.body }}>
            Adventurer name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="wanderer"
            autoComplete="off"
            className="pq-focusable mb-4 w-full rounded-xl border px-3 py-2.5 text-sm"
            style={inputStyle}
          />

          <label className="mb-1 block text-xs" style={{ color: T.muted, fontFamily: T.body }}>
            Password
          </label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••"
            className="pq-focusable w-full rounded-xl border px-3 py-2.5 text-sm"
            style={inputStyle}
          />

          {error && (
            <p className="mt-3 text-xs" style={{ color: T.rose, fontFamily: T.body }}>
              {error}
            </p>
          )}

          <div className="mt-5">
            <Btn tone="solid" size="lg" onClick={submit} disabled={busy} className="w-full">
              {busy ? "Opening the gate…" : isSignup ? "Start the journey" : "Enter"}
            </Btn>
          </div>

          <button
            type="button"
            onClick={onGuest}
            className="pq-focusable mt-4 w-full text-center text-xs underline"
            style={{ color: T.muted, fontFamily: T.body }}
          >
            Skip — play as guest (progress won't be saved)
          </button>
        </Panel>

        <p className="mt-5 text-center text-xs leading-relaxed" style={{ color: T.muted, fontFamily: T.body }}>
          Accounts are stored on this device only. This is a learning project, not real security —
          the walkthrough explains how to swap in a proper auth service.
        </p>
      </div>
    </div>
  );
}

/** The little hexagon logo mark, reused in a few places. */
function HexMark({ size = 40, color = T.gold }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="mx-auto" aria-hidden="true">
      <polygon
        points="50,6 88,28 88,72 50,94 12,72 12,28"
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <polygon points="50,28 70,39 70,61 50,72 30,61 30,39" fill={color} opacity="0.85" />
    </svg>
  );
}

/* ==========================================================================
   7. TOP BAR
   Receives everything it needs through props. It computes nothing about the
   game — it only draws what it's handed. That's a "presentational" component.
   ========================================================================== */
function TopBar({ user, level, into, need, pct, streak, onLogout, onOpenSettings }) {
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center">
      <div className="flex items-center gap-4">
        <div
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border"
          style={{ background: T.panel2, borderColor: `${T.gold}55` }}
        >
          <span style={{ fontFamily: T.display, color: T.gold, fontWeight: 700, fontSize: 22 }}>{level}</span>
          <span
            className="absolute -bottom-2 rounded-full px-1.5 uppercase"
            style={{ background: T.gold, color: T.ink, fontFamily: T.display, letterSpacing: "0.12em", fontWeight: 700, fontSize: 9 }}
          >
            lvl
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="truncate text-xl" style={{ fontFamily: T.display, color: T.text, fontWeight: 600 }}>
              {user}
            </h2>
            {streak > 0 && <Chip color={T.rose}>{streak} day streak</Chip>}
          </div>
          <p className="text-xs" style={{ color: T.muted, fontFamily: T.mono }}>
            {into} / {need} XP to level {level + 1}
          </p>
        </div>
      </div>

      <div className="flex-1 md:px-6">
        <Meter pct={pct} color={T.gold} height={12} />
      </div>

      <div className="flex gap-2">
        <Btn size="sm" color={T.muted} onClick={onOpenSettings}>
          Settings
        </Btn>
        <Btn size="sm" color={T.rose} onClick={onLogout}>
          Log out
        </Btn>
      </div>
    </header>
  );
}

/* ==========================================================================
   8. TIMER SHRINE — the signature element
   The hexagon uses SVG `pathLength="100"`, which tells the browser "pretend
   this shape is exactly 100 units long". Then strokeDashoffset is just
   `100 - percentDone`, no trigonometry required.
   ========================================================================== */
function TimerShrine({ mode, secondsLeft, totalSeconds, running, cycle, longEvery, onStart, onPause, onReset, onSkip, onPickMode }) {
  const conf = MODES[mode];
  const done = totalSeconds === 0 ? 0 : 1 - secondsLeft / totalSeconds;
  const size = 300;

  return (
    <Panel glow={conf.color} className="flex flex-col items-center">
      <div className="mb-5 flex w-full flex-wrap justify-center gap-2">
        {MODE_ORDER.map((id) => (
          <Chip key={id} color={MODES[id].color} active={mode === id} onClick={() => onPickMode(id)}>
            {MODES[id].label}
          </Chip>
        ))}
      </div>

      <div className="relative" style={{ width: "100%", maxWidth: size }}>
        <svg viewBox="0 0 240 240" className="w-full" role="img" aria-label={`${conf.label} timer`}>
          <defs>
            <filter id="pqGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* the empty crystal */}
          <polygon
            points="120,20 206.6,70 206.6,170 120,220 33.4,170 33.4,70"
            fill={T.ink}
            stroke={T.line}
            strokeWidth="10"
            strokeLinejoin="round"
          />
          {/* the filling stroke */}
          <polygon
            points="120,20 206.6,70 206.6,170 120,220 33.4,170 33.4,70"
            fill="none"
            stroke={conf.color}
            strokeWidth="10"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - clamp(done * 100, 0, 100)}
            filter="url(#pqGlow)"
            style={{ transition: "stroke-dashoffset .35s linear, stroke .3s ease" }}
          />
          {/* inner facet */}
          <polygon
            points="120,52 179,86 179,154 120,188 61,154 61,86"
            fill={`${conf.color}0F`}
            stroke={`${conf.color}33`}
            strokeWidth="1.5"
            className={running ? "pq-pulse" : ""}
          />

          <text
            x="120"
            y="118"
            textAnchor="middle"
            style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 42, fill: T.text, letterSpacing: "-1px" }}
          >
            {formatClock(secondsLeft)}
          </text>
          <text
            x="120"
            y="142"
            textAnchor="middle"
            style={{ fontFamily: T.display, fontSize: 11, fill: conf.color, letterSpacing: "0.22em", fontWeight: 600 }}
          >
            {conf.label.toUpperCase()}
          </text>
          <text
            x="120"
            y="164"
            textAnchor="middle"
            style={{ fontFamily: T.mono, fontSize: 10, fill: T.muted, letterSpacing: "0.1em" }}
          >
            {mode === "focus" ? `SESSION ${(cycle % longEvery) + 1} / ${longEvery}` : "RECOVERING"}
          </text>
        </svg>
      </div>

      <p className="mt-4 text-center text-sm" style={{ color: T.muted, fontFamily: T.body }}>
        {conf.blurb}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {running ? (
          <Btn tone="solid" size="lg" color={conf.color} onClick={onPause}>
            Pause
          </Btn>
        ) : (
          <Btn tone="solid" size="lg" color={conf.color} onClick={onStart}>
            {secondsLeft === totalSeconds ? "Begin" : "Resume"}
          </Btn>
        )}
        <Btn color={T.muted} onClick={onReset}>
          Reset
        </Btn>
        <Btn color={T.muted} onClick={onSkip} title="Jump to the next stage without earning XP">
          Skip
        </Btn>
      </div>
    </Panel>
  );
}

/* ==========================================================================
   9. SETTINGS SHEET
   A modal. `if (!open) return null` is the whole show/hide mechanism —
   returning null from a component renders nothing at all.
   ========================================================================== */
function SettingsSheet({ open, settings, onChange, onClose }) {
  if (!open) return null;

  const rows = [
    { key: "focusMin", label: "Focus length", suffix: "min", min: 1, max: 90, color: T.gold },
    { key: "shortMin", label: "Short rest", suffix: "min", min: 1, max: 30, color: T.mint },
    { key: "longMin", label: "Long rest", suffix: "min", min: 5, max: 60, color: T.sky },
    { key: "longEvery", label: "Long rest after", suffix: "sessions", min: 2, max: 8, color: T.sky },
    { key: "dailyGoal", label: "Daily quest goal", suffix: "quests", min: 1, max: 20, color: T.rose },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-6"
      style={{ background: "#0A0718CC" }}
      onClick={onClose}
    >
      <div
        className="pq-scroll pq-rise w-full max-w-lg overflow-y-auto rounded-t-3xl border p-6 md:rounded-3xl"
        style={{ background: T.panel, borderColor: T.line, maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-2xl" style={{ fontFamily: T.display, color: T.text, fontWeight: 700 }}>
            Settings
          </h3>
          <Btn size="sm" color={T.muted} onClick={onClose}>
            Close
          </Btn>
        </div>

        {rows.map((r) => (
          <div key={r.key} className="mb-5">
            <div className="mb-2 flex items-baseline justify-between">
              <label className="text-sm" style={{ color: T.text, fontFamily: T.body }}>
                {r.label}
              </label>
              <span style={{ color: r.color, fontFamily: T.mono, fontWeight: 700 }}>
                {settings[r.key]} <span style={{ color: T.muted, fontSize: 11 }}>{r.suffix}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Btn size="sm" color={r.color} onClick={() => onChange(r.key, clamp(settings[r.key] - 1, r.min, r.max))}>
                −
              </Btn>
              <input
                type="range"
                min={r.min}
                max={r.max}
                value={settings[r.key]}
                onChange={(e) => onChange(r.key, Number(e.target.value))}
                className="pq-focusable h-1.5 flex-1 cursor-pointer appearance-none rounded-full"
                style={{ accentColor: r.color, background: T.ink }}
              />
              <Btn size="sm" color={r.color} onClick={() => onChange(r.key, clamp(settings[r.key] + 1, r.min, r.max))}>
                +
              </Btn>
            </div>
          </div>
        ))}

        <div className="mt-6 space-y-3 border-t pt-5" style={{ borderColor: T.line }}>
          <Toggle
            label="Start the next stage automatically"
            checked={settings.autoStart}
            color={T.mint}
            onChange={(v) => onChange("autoStart", v)}
          />
          <Toggle
            label="Play a chime when a stage ends"
            checked={settings.sound}
            color={T.gold}
            onChange={(v) => onChange("sound", v)}
          />
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, color = T.gold }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="pq-focusable flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left"
      style={{ background: T.ink, borderColor: T.line }}
    >
      <span className="text-sm" style={{ color: T.text, fontFamily: T.body }}>
        {label}
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? color : T.line }}
      >
        <span
          className="absolute top-1 h-4 w-4 rounded-full transition-all duration-200"
          style={{ background: checked ? T.ink : T.muted, left: checked ? 26 : 4 }}
        />
      </span>
    </button>
  );
}

/* ==========================================================================
   10. DAILY QUEST BAR
   The "how much of today is left" gauge. It reads today's counters and shows
   what's still owed, plus the end-of-day reward button.
   ========================================================================== */
function DailyQuestBar({ day, goal, sessions, onClaim, projectedXP }) {
  const doneToday = day.quests;
  const left = Math.max(0, goal - doneToday);
  const pct = goal === 0 ? 1 : doneToday / goal;
  const goalMet = doneToday >= goal;
  const canClaim = !day.claimed && doneToday > 0;

  return (
    <Panel glow={goalMet ? T.mint : T.rose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow color={goalMet ? T.mint : T.rose}>Today's board</Eyebrow>
          <p className="text-2xl" style={{ fontFamily: T.display, color: T.text, fontWeight: 700 }}>
            {doneToday} of {goal} cleared
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: T.muted, fontFamily: T.body }}>
            {day.claimed ? "Reward taken" : "Reward waiting"}
          </p>
          <p style={{ color: T.gold, fontFamily: T.mono, fontWeight: 700 }}>+{projectedXP} XP</p>
        </div>
      </div>

      <div className="my-4">
        <Meter pct={pct} color={goalMet ? T.mint : T.rose} height={14} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: T.muted, fontFamily: T.body }}>
          {goalMet ? (
            <span style={{ color: T.mint }}>Board cleared. Anything else is bonus.</span>
          ) : (
            <>
              <span style={{ color: T.text, fontFamily: T.mono, fontWeight: 700 }}>{left}</span> quest{left === 1 ? "" : "s"} left
              before the day counts · {sessions} focus session{sessions === 1 ? "" : "s"} logged
            </>
          )}
        </p>
        <Btn
          tone={canClaim ? "solid" : "ghost"}
          color={goalMet ? T.mint : T.gold}
          onClick={onClaim}
          disabled={!canClaim}
          title={day.claimed ? "Already claimed today" : "Bank today's XP"}
        >
          {day.claimed ? "Claimed" : "Claim day's reward"}
        </Btn>
      </div>
    </Panel>
  );
}

/* ==========================================================================
   11. QUEST LOG
   Rendering a list: `.map()` over the array and give every item a stable
   `key`. The key is how React knows which row is which between renders.
   ========================================================================== */
function QuestLog({ quests, activeId, onAdd, onToggle, onDelete, onSetActive, onClearDone }) {
  const [text, setText] = useState("");
  const [diff, setDiff] = useState("normal");
  const [filter, setFilter] = useState("open");

  const visible = useMemo(() => {
    if (filter === "open") return quests.filter((q) => !q.done);
    if (filter === "done") return quests.filter((q) => q.done);
    return quests;
  }, [quests, filter]);

  const openCount = quests.filter((q) => !q.done).length;
  const doneCount = quests.length - openCount;

  function add() {
    const title = text.trim();
    if (!title) return;
    onAdd(title, diff);
    setText("");
  }

  return (
    <Panel className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <Eyebrow>Quest log</Eyebrow>
        <div className="flex gap-1.5">
          {[
            ["open", `Open ${openCount}`],
            ["done", `Done ${doneCount}`],
            ["all", "All"],
          ].map(([id, label]) => (
            <Chip key={id} color={T.muted} active={filter === id} onClick={() => setFilter(id)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="What are you taking on?"
          className="pq-focusable min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm"
          style={{ background: T.ink, borderColor: T.line, color: T.text, fontFamily: T.body }}
        />
        <Btn tone="solid" onClick={add} disabled={!text.trim()}>
          Add
        </Btn>
      </div>

      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs" style={{ color: T.muted, fontFamily: T.body }}>
          Difficulty
        </span>
        {DIFFICULTY_ORDER.map((id) => (
          <Chip key={id} color={DIFFICULTY[id].color} active={diff === id} onClick={() => setDiff(id)}>
            {DIFFICULTY[id].label} +{DIFFICULTY[id].xp}
          </Chip>
        ))}
      </div>

      <div className="pq-scroll -mr-2 flex-1 space-y-2 overflow-y-auto pr-2" style={{ minHeight: 140, maxHeight: 380 }}>
        {visible.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center"
            style={{ borderColor: T.line }}
          >
            <p className="text-sm" style={{ color: T.text, fontFamily: T.display, fontWeight: 600 }}>
              {filter === "done" ? "Nothing cleared yet." : "The board is empty."}
            </p>
            <p className="mt-1 text-xs" style={{ color: T.muted, fontFamily: T.body }}>
              Add a quest above to start earning XP.
            </p>
          </div>
        ) : (
          visible.map((q) => (
            <QuestRow
              key={q.id}
              quest={q}
              isActive={q.id === activeId}
              onToggle={() => onToggle(q.id)}
              onDelete={() => onDelete(q.id)}
              onSetActive={() => onSetActive(q.id)}
            />
          ))
        )}
      </div>

      {doneCount > 0 && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: T.line }}>
          <Btn size="sm" color={T.muted} onClick={onClearDone}>
            Clear {doneCount} finished quest{doneCount === 1 ? "" : "s"}
          </Btn>
        </div>
      )}
    </Panel>
  );
}

function QuestRow({ quest, isActive, onToggle, onDelete, onSetActive }) {
  const d = DIFFICULTY[quest.difficulty] || DIFFICULTY.normal;
  return (
    <div
      className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
      style={{
        background: isActive ? `${d.color}12` : T.ink,
        borderColor: isActive ? `${d.color}77` : T.line,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={quest.done ? "Mark as not done" : "Mark as done"}
        className="pq-focusable flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors"
        style={{
          borderColor: quest.done ? T.mint : d.color,
          background: quest.done ? T.mint : "transparent",
        }}
      >
        {quest.done && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="4" strokeLinecap="round">
            <path d="M4 13l6 6L20 5" />
          </svg>
        )}
      </button>

      <button type="button" onClick={onSetActive} className="pq-focusable min-w-0 flex-1 text-left">
        <p
          className="truncate text-sm"
          style={{
            color: quest.done ? T.muted : T.text,
            fontFamily: T.body,
            textDecoration: quest.done ? "line-through" : "none",
          }}
        >
          {quest.title}
        </p>
        <p className="text-xs" style={{ color: T.muted, fontFamily: T.mono }}>
          {d.label} · +{d.xp} XP · {quest.sessions} session{quest.sessions === 1 ? "" : "s"}
          {isActive && <span style={{ color: d.color }}> · tracking now</span>}
        </p>
      </button>

      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete quest"
        className="pq-focusable rounded-md px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        style={{ color: T.rose, fontFamily: T.mono }}
      >
        ✕
      </button>
    </div>
  );
}

/* ==========================================================================
   12. TROPHY CASE
   Derived UI: nothing is stored except a list of earned ids. Everything else
   is worked out from the ACHIEVEMENTS constant at render time.
   ========================================================================== */
function TrophyCase({ earned, stats }) {
  return (
    <Panel>
      <Eyebrow>Trophies</Eyebrow>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ACHIEVEMENTS.map((a) => {
          const has = earned.includes(a.id);
          return (
            <div
              key={a.id}
              title={a.hint}
              className="rounded-xl border px-3 py-2.5 transition-colors"
              style={{
                background: has ? `${T.gold}12` : T.ink,
                borderColor: has ? `${T.gold}66` : T.line,
                opacity: has ? 1 : 0.55,
              }}
            >
              <p className="text-sm" style={{ color: has ? T.gold : T.muted, fontFamily: T.display, fontWeight: 600 }}>
                {has ? "★" : "☆"} {a.name}
              </p>
              <p className="mt-0.5 text-xs leading-snug" style={{ color: T.muted, fontFamily: T.body }}>
                {a.hint}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4" style={{ borderColor: T.line }}>
        <Stat label="Sessions" value={stats.totalSessions} color={T.gold} />
        <Stat label="Focus min" value={stats.totalFocusMin} color={T.mint} />
        <Stat label="Quests" value={stats.totalQuests} color={T.sky} />
        <Stat label="Best streak" value={stats.bestStreak} color={T.rose} />
      </div>
    </Panel>
  );
}

/* ==========================================================================
   13. APP — the brain
   Every piece of shared state lives here and flows *down* through props.
   Child components send messages back *up* by calling functions in props.
   That one-way loop is the whole mental model of React.
   ========================================================================== */
export default function App() {
  /* ---- who's playing ---- */
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState(null);
  const [isGuest, setIsGuest] = useState(false);

  /* ---- the save file (one object holds the entire game) ---- */
  const [save, setSave] = useState(newSaveFile);

  /* ---- timer state ---- */
  const [mode, setMode] = useState("focus");
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(0);

  /* ---- UI-only state (never saved) ---- */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeQuestId, setActiveQuestId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [levelUp, setLevelUp] = useState(null);

  const deadlineRef = useRef(0); // when the current stage ends, in ms since epoch
  const prevLevelRef = useRef(1);

  const { settings, stats, day, quests, trophies } = save;
  const totalSeconds = settings[MODES[mode].settingKey] * 60;
  const level = useMemo(() => levelFromXP(save.xp), [save.xp]);

  /* -----------------------------------------------------------------
     A tiny updater. Pass a function that receives the old save and
     returns the new one. Never mutate — always build a new object, or
     React won't notice anything changed.
     ----------------------------------------------------------------- */
  const update = useCallback((fn) => setSave((prev) => fn(prev)), []);

  const pushToast = useCallback((text, color = T.gold) => {
    const id = uid();
    setToasts((t) => [...t, { id, text, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1500);
  }, []);

  /* ================= EFFECT: boot up ================= */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadJSON(K.session);
      if (session?.user) {
        const file = hydrate(await loadJSON(K.save(session.user)));
        if (!cancelled) {
          setUser(session.user);
          setSave(rollOverIfNewDay(file));
          setSecondsLeft(file.settings.focusMin * 60);
          // remember the loaded level, or the "level up!" overlay fires on boot
          prevLevelRef.current = levelFromXP(file.xp).level;
        }
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true; // don't touch state if the component went away mid-load
    };
  }, []);

  /* ================= EFFECT: save on every change ================= */
  useEffect(() => {
    if (!user || isGuest) return;
    const id = setTimeout(() => saveJSON(K.save(user), save), 400); // debounce
    return () => clearTimeout(id);
  }, [save, user, isGuest]);

  /* ================= EFFECT: keep the clock honest =================
     setInterval drifts and browsers throttle background tabs, so we never
     count down by subtracting 1. We store the finish time and ask
     "how long until then?" four times a second. Accurate either way.
     ================================================================= */
  const finishRef = useRef(() => {});
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = (deadlineRef.current - Date.now()) / 1000;
      if (left <= 0) {
        finishRef.current();
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return () => clearInterval(id); // cleanup runs before the next effect and on unmount
  }, [running]);

  /* ================= EFFECT: reflect the timer in the tab title ================= */
  useEffect(() => {
    document.title = running ? `${formatClock(secondsLeft)} · ${MODES[mode].label} — PomoQuest` : "PomoQuest";
  }, [running, secondsLeft, mode]);

  /* ================= EFFECT: follow duration changes when idle =================
     Careful here: if `running` were in the dependency list, this would also fire
     the moment you hit Pause and would wipe out your remaining time. We only
     ever want it to react to the *duration* changing, so `running` is read
     through a ref instead of being a dependency.
     ============================================================================ */
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (!runningRef.current) setSecondsLeft(totalSeconds);
  }, [totalSeconds]);

  /* ================= EFFECT: hand out trophies ================= */
  useEffect(() => {
    const newly = ACHIEVEMENTS.filter((a) => !trophies.includes(a.id) && a.test(stats));
    if (newly.length === 0) return;
    update((s) => ({ ...s, trophies: [...s.trophies, ...newly.map((a) => a.id)] }));
    newly.forEach((a) => pushToast(`Trophy: ${a.name}`, T.gold));
  }, [stats, trophies, update, pushToast]);

  /* ================= EFFECT: celebrate a level up ================= */
  useEffect(() => {
    if (level.level > prevLevelRef.current) {
      setLevelUp(level.level);
      if (settings.sound) playChime("levelup");
      const id = setTimeout(() => setLevelUp(null), 1800);
      prevLevelRef.current = level.level;
      return () => clearTimeout(id);
    }
    prevLevelRef.current = level.level;
  }, [level.level, settings.sound]);

  /* ================= EFFECT: notice midnight ================= */
  useEffect(() => {
    const id = setInterval(() => update(rollOverIfNewDay), 60000);
    return () => clearInterval(id);
  }, [update]);

  /* -----------------------------------------------------------------
     Actions — the verbs of the app
     ----------------------------------------------------------------- */
  function start() {
    deadlineRef.current = Date.now() + secondsLeft * 1000;
    setRunning(true);
  }
  function pause() {
    setRunning(false);
  }
  function reset() {
    setRunning(false);
    setSecondsLeft(totalSeconds);
  }
  function pickMode(id) {
    setRunning(false);
    setMode(id);
    setSecondsLeft(settings[MODES[id].settingKey] * 60);
  }
  function skip() {
    setRunning(false);
    goToNextStage(false);
  }

  /** Move to whatever comes next in the pomodoro cycle. */
  function goToNextStage(earned) {
    let next;
    let nextCycle = cycle;
    if (mode === "focus") {
      nextCycle = cycle + 1;
      next = nextCycle % settings.longEvery === 0 ? "long" : "short";
      setCycle(nextCycle);
    } else {
      next = "focus";
    }
    setMode(next);
    const nextSeconds = settings[MODES[next].settingKey] * 60;
    setSecondsLeft(nextSeconds);

    if (earned && settings.autoStart) {
      deadlineRef.current = Date.now() + nextSeconds * 1000;
      setRunning(true);
    } else {
      setRunning(false);
    }
  }

  /** Called the instant a stage hits zero. Kept in a ref so the interval
      above never needs to restart when this function is re-created. */
  finishRef.current = () => {
    setRunning(false);
    if (settings.sound) playChime(mode === "focus" ? "done" : "rest");

    if (mode === "focus") {
      update((s) => ({
        ...s,
        xp: s.xp + XP_PER_FOCUS_SESSION,
        stats: {
          ...s.stats,
          totalSessions: s.stats.totalSessions + 1,
          totalFocusMin: s.stats.totalFocusMin + s.settings.focusMin,
        },
        day: { ...s.day, sessions: s.day.sessions + 1 },
        quests: s.quests.map((q) => (q.id === activeQuestId ? { ...q, sessions: q.sessions + 1 } : q)),
      }));
      pushToast(`+${XP_PER_FOCUS_SESSION} XP · session complete`, T.gold);
    } else {
      pushToast("Rest over — back in", T.mint);
    }
    goToNextStage(true);
  };

  function addQuest(title, difficulty) {
    const quest = { id: uid(), title, difficulty, done: false, sessions: 0, created: todayKey() };
    update((s) => ({ ...s, quests: [quest, ...s.quests] }));
    setActiveQuestId((cur) => cur ?? quest.id);
  }

  function toggleQuest(id) {
    update((s) => {
      const q = s.quests.find((x) => x.id === id);
      if (!q) return s;
      const d = DIFFICULTY[q.difficulty] || DIFFICULTY.normal;
      const becomingDone = !q.done;
      const delta = becomingDone ? d.xp : -d.xp; // un-checking takes the XP back
      return {
        ...s,
        xp: Math.max(0, s.xp + delta),
        quests: s.quests.map((x) => (x.id === id ? { ...x, done: becomingDone } : x)),
        stats: { ...s.stats, totalQuests: Math.max(0, s.stats.totalQuests + (becomingDone ? 1 : -1)) },
        day: { ...s.day, quests: Math.max(0, s.day.quests + (becomingDone ? 1 : -1)) },
      };
    });
    const q = quests.find((x) => x.id === id);
    if (q && !q.done) {
      const d = DIFFICULTY[q.difficulty] || DIFFICULTY.normal;
      pushToast(`+${d.xp} XP · ${q.title}`, d.color);
      if (settings.sound) playChime("rest");
    }
  }

  function deleteQuest(id) {
    update((s) => ({ ...s, quests: s.quests.filter((q) => q.id !== id) }));
    setActiveQuestId((cur) => (cur === id ? null : cur));
  }

  function clearDone() {
    update((s) => ({ ...s, quests: s.quests.filter((q) => !q.done) }));
  }

  const projectedXP = day.quests * 10 + day.sessions * 5 + (day.quests >= settings.dailyGoal ? DAY_GOAL_BONUS : 0);

  function claimDay() {
    if (day.claimed || day.quests === 0) return;
    const met = day.quests >= settings.dailyGoal;
    update((s) => {
      const streak = met ? s.stats.streak + 1 : s.stats.streak;
      return {
        ...s,
        xp: s.xp + projectedXP,
        day: { ...s.day, claimed: true },
        stats: { ...s.stats, streak, bestStreak: Math.max(s.stats.bestStreak, streak) },
      };
    });
    pushToast(`+${projectedXP} XP · day banked`, met ? T.mint : T.gold);
    if (settings.sound) playChime("levelup");
  }

  function changeSetting(key, value) {
    update((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
  }

  async function handleAuth(name) {
    const file = hydrate(await loadJSON(K.save(name)));
    setUser(name);
    setIsGuest(false);
    setSave(rollOverIfNewDay(file));
    setMode("focus");
    setSecondsLeft(file.settings.focusMin * 60);
    prevLevelRef.current = levelFromXP(file.xp).level;
  }

  function playAsGuest() {
    setUser("guest");
    setIsGuest(true);
    setSave(newSaveFile());
    setSecondsLeft(25 * 60);
  }

  async function logout() {
    setRunning(false);
    if (!isGuest && user) await saveJSON(K.save(user), save);
    await saveJSON(K.session, {});
    setUser(null);
    setIsGuest(false);
    setSave(newSaveFile());
  }

  /* ---------------- render ---------------- */
  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: T.ink }}>
        <style>{GLOBAL_CSS}</style>
        <div className="pq-pulse text-center">
          <HexMark size={54} color={T.gold} />
          <p className="mt-3 text-sm" style={{ color: T.muted, fontFamily: T.display, letterSpacing: "0.2em" }}>
            LOADING SAVE
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <style>{GLOBAL_CSS}</style>
        <AuthScreen onAuth={handleAuth} onGuest={playAsGuest} />
      </>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 md:py-8" style={{ background: T.ink, fontFamily: T.body }}>
      <style>{GLOBAL_CSS}</style>

      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <TopBar
          user={isGuest ? "guest" : user}
          level={level.level}
          into={level.into}
          need={level.need}
          pct={level.pct}
          streak={stats.streak}
          onLogout={logout}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {isGuest && (
          <p
            className="mb-4 rounded-xl border px-4 py-2 text-xs"
            style={{ borderColor: `${T.rose}55`, background: `${T.rose}12`, color: T.rose, fontFamily: T.body }}
          >
            Guest run — nothing is being saved. Log out and create a name to keep your XP.
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-3">
            <TimerShrine
              mode={mode}
              secondsLeft={secondsLeft}
              totalSeconds={totalSeconds}
              running={running}
              cycle={cycle}
              longEvery={settings.longEvery}
              onStart={start}
              onPause={pause}
              onReset={reset}
              onSkip={skip}
              onPickMode={pickMode}
            />
            <DailyQuestBar
              day={day}
              goal={settings.dailyGoal}
              sessions={day.sessions}
              projectedXP={projectedXP}
              onClaim={claimDay}
            />
          </div>

          <div className="space-y-5 lg:col-span-2">
            <QuestLog
              quests={quests}
              activeId={activeQuestId}
              onAdd={addQuest}
              onToggle={toggleQuest}
              onDelete={deleteQuest}
              onSetActive={setActiveQuestId}
              onClearDone={clearDone}
            />
            <TrophyCase earned={trophies} stats={stats} />
          </div>
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: T.muted, fontFamily: T.mono }}>
          {formatClock(secondsLeft)} · {MODES[mode].label} · level {level.level} · {save.xp} XP total
        </p>
      </div>

      <SettingsSheet
        open={settingsOpen}
        settings={settings}
        onChange={changeSetting}
        onClose={() => setSettingsOpen(false)}
      />

      {/* floating XP toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex flex-col items-center gap-1">
        {toasts.map((t) => (
          <span
            key={t.id}
            className="pq-float rounded-full border px-4 py-1.5 text-sm"
            style={{
              color: t.color,
              borderColor: `${t.color}66`,
              background: T.panel,
              fontFamily: T.display,
              fontWeight: 600,
            }}
          >
            {t.text}
          </span>
        ))}
      </div>

      {/* level-up overlay */}
      {levelUp && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <div className="pq-burst text-center">
            <HexMark size={96} color={T.gold} />
            <p className="mt-3 text-4xl" style={{ fontFamily: T.display, color: T.gold, fontWeight: 700 }}>
              LEVEL {levelUp}
            </p>
            <p className="text-sm" style={{ color: T.text, fontFamily: T.body }}>
              The crystal grows brighter.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* A plain function, not a component: given a save file, return the correct
   save file for *today*. Called on boot and once a minute. */
function rollOverIfNewDay(s) {
  const today = todayKey();
  if (s.day.date === today) return s;

  const metGoal = s.day.quests >= s.settings.dailyGoal;
  const wasYesterday = s.day.date === yesterdayKey();
  // Missed the goal -> streak dies. Met it yesterday -> the run continues.
  // Met it after a gap of more than one day -> this is day 1 of a new run.
  const streak = !metGoal ? 0 : wasYesterday ? Math.max(1, s.stats.streak) : 1;

  return {
    ...s,
    day: { date: today, quests: 0, sessions: 0, claimed: false },
    stats: { ...s.stats, streak, bestStreak: Math.max(s.stats.bestStreak, streak) },
  };
}
