# Learn English Through TV

A single-page React application that helps you learn English by watching
American TV shows, built around the workflow:

> 定位 → 盲听 2 遍 → 逐句听写 → 对照订正 → 跟读 2 遍 → 收词

## Features

- **Video sources**: pick a local video file or paste a remote URL.
- **Subtitle loading**: parse `.srt` or `.vtt` files, click a cue to jump to
  that timestamp.
- **A-B loop**: set marker A, marker B, then enable the loop to keep
  rehearsing a single line.
- **Vocabulary collection**: click any English word inside a subtitle to add
  it (with sentence / video / timestamp) to your personal dictionary.
- **Anki export**: one click downloads a tab-separated `.txt` file ready for
  Anki import (front / back / extra fields).
- **localStorage persistence**: your vocabulary survives page refreshes.
- **Learning steps indicator**: 8-step progress strip at the top.

## Tech stack

- Vite + React 18 + TypeScript
- Material-UI (`@mui/material`, `@mui/icons-material`)
- Tailwind CSS (preflight disabled to coexist with MUI)

## Getting started

### Quick start (Windows, one click)

Double-click **`start.bat`** in the project root. It automatically

1. checks for Node.js,
2. installs dependencies on the first run,
3. builds the app if `dist/` is missing,
4. starts the local server and opens your browser.

Keep the console window open while you use the app — closing it stops the
server.

### Manual

```bash
npm install
npm run dev      # dev server        → http://localhost:5173
npm run build    # type-check + production bundle into dist/
npm run start    # serve the build   → http://localhost:5180
npm run clean    # remove stray build artifacts and the Vite cache
```

> Dictionary lookups (dictionaryapi.dev / Youdao / Datamuse) are routed
> through Vite's server-side proxy (`/dict/*`, see `vite.config.ts`) while
> the app is served from `localhost` — the browser cannot call those APIs
> directly because of CORS. Anywhere else it falls back to calling them
> directly.

Open the app and:

1. Pick a video file or paste a video URL.
2. Load a matching `.srt` or `.vtt` subtitle file.
3. Use **A-B 循环** to drill a sentence.
4. Click any word inside a subtitle to collect it.
5. Click **词库** in the top bar → **导出 Anki** to get your deck.

## Project layout

```
src/
  main.tsx                  App bootstrap (MUI theme + CssBaseline)
  App.tsx                   Top-level state & layout
  types.ts                  Shared TypeScript types
  index.css                 Tailwind + subtitle-word styles
  utils/
    subtitleParser.ts       SRT/VTT parser, formatTime, findCueAtTime
    ankiExport.ts           buildAnkiText + downloadAnkiExport
    abLoop.ts               Pure helpers for A-B marker state machine
  hooks/
    useVideoPlayer.ts       <video> ref, currentTime, seek, togglePlay
    useVocabulary.ts        localStorage-backed word list
  components/
    VideoSelector.tsx       File / URL / subtitle pickers
    VideoPlayer.tsx         <video> + overlay + visibility toggle
    SubtitleList.tsx        Scrollable cue list with clickable words
    ABLoopControls.tsx      A / B / loop / clear
    VocabularyPanel.tsx     Right-side Drawer with export
    LearningSteps.tsx       Top progress strip
```

## Known limitations

- Translations in the Anki export are intentionally left blank — the user
  fills them in once inside Anki so they engage in active recall.
- The subtitle parser handles standard SRT/VTT and strips inline styling
  tags (`<i>`, `<b>`, `<font>`, ASS `{\...}` overrides). Styled ASS/SSA
  files are not supported.
- Anki import requires the user to manually map columns (Front / Back /
  Extra) the first time.