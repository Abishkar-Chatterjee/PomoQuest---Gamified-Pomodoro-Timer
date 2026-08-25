# PomoQuest

A gamified Pomodoro timer built with React and Tailwind CSS. Focus in timed quests, earn XP, level up, and clear a daily board of tasks before the day resets.

Built as a learning project — a companion [code walkthrough](WALKTHROUGH.md) explains the codebase concept-by-concept for anyone new to React.

## Features

- **Pomodoro timer** with independently configurable Focus, Short Break, and Long Break durations, and automatic cycling between them (long break every *N* sessions, also configurable).
- **Drift-proof countdown** — the clock is driven by a stored end time rather than a naive per-second decrement, so it stays accurate even when the browser tab is backgrounded or throttled.
- **Quest log** — add tasks with a difficulty (Easy / Normal / Boss), each worth different XP; check them off to earn XP immediately.
- **XP and levelling** — a single stored XP value drives your level, progress bar, and unlocks, using a non-linear cost curve so early levels come quickly and later ones take more focus.
- **Daily quest board** — set a daily goal, watch a live counter of quests remaining, and claim a bonus XP reward once the day is cleared. Includes streak tracking across days.
- **Trophy case** — six achievements that unlock automatically as you use the app.
- **Accounts** — create a name and password to save progress locally, or skip in as a guest.
- **Responsive, animated UI** — a hexagonal "quest crystal" timer, floating XP toasts, a level-up celebration, and a settings panel, all built with a small custom design system on top of Tailwind.
- **Sound** — short chimes generated with the Web Audio API, no audio files required.

## Tech stack

- [React](https://react.dev/) — UI and state
- [Tailwind CSS v4](https://tailwindcss.com/) — layout and utility styling
- [Vite](https://vite.dev/) — dev server and build tool
- Web Audio API — chime sounds, no external assets
- Browser key-value storage for accounts and save data (see [Limitations](#limitations) below)

No other dependencies. No backend.

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org) 18+ and npm.

```bash
# clone the repo
git clone https://github.com/YOUR-USERNAME/pomoquest.git
cd pomoquest

# install dependencies
npm install

# start the dev server
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`).

### Build for production

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally to sanity-check it
```

## Project structure

```
pomoquest/
├── src/
│   ├── PomoQuest.jsx    # the entire app: components, state, game logic
│   ├── main.jsx         # React entry point
│   └── index.css        # Tailwind import
├── vite.config.js       # Vite + Tailwind plugin config
├── WALKTHROUGH.md        # line-by-line explanation of PomoQuest.jsx, for beginners
└── package.json
```

`PomoQuest.jsx` is intentionally kept as one file with numbered section banners (`/* === 1. THEME TOKENS === */`, etc.) — each section maps to a natural future file (`theme.js`, `constants.js`, `components/QuestLog.jsx`, and so on) if you want to split it up as the project grows. See the walkthrough for a suggested folder layout.

## Customization

Most tuning lives in a small number of places in `PomoQuest.jsx`:

| Want to change | Edit |
|---|---|
| Colors and fonts | the `T` object (Section 1) |
| Default timer lengths / daily goal | `newSaveFile()`'s `settings` object (Section 4) |
| Settings panel min/max ranges | the `rows` array in `SettingsSheet` (Section 9) |
| XP awarded per quest difficulty | `DIFFICULTY` (Section 2) |
| XP curve / leveling pace | `xpForLevel()` (Section 3) |
| Achievements | `ACHIEVEMENTS` (Section 2) |

## Limitations

This is a learning project, not a production app — a few things to know before relying on it:

- **Authentication is not secure.** Passwords are hashed client-side with a fast, reversible hash and checked in the browser. This is enough to keep two people from casually overwriting each other's save on the same device, but it is not real security. See the walkthrough's [section on swapping in real auth](WALKTHROUGH.md#swap-in-real-auth) (e.g. Supabase) if you want to deploy this for real.
- **Saves are local to one browser.** There's no server, so progress doesn't sync across devices unless you replace the storage layer.
- **Guest mode saves nothing.** It's there for trying the app without creating an account.

## Documentation

[`WALKTHROUGH.md`](WALKTHROUGH.md) is a full companion guide to the codebase, written for someone new to React — it explains every section of `PomoQuest.jsx`, core React concepts (state, props, effects, refs), common beginner pitfalls, and a set of graded exercises for extending the app.

## License

MIT — do whatever you'd like with it.