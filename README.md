# brat lyrics

A *brat*-style typography generator (white background mode) designed to create lyric visuals that can be synchronized in video editing (TikTok, Reels, etc.).

**Open source project** — [GitHub repository](https://github.com/GARNAUD-CORP/alt-lyrics-gen)

## Getting Started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Features

### Phase 1 — Brat Display
Square preview area (what gets exported) + text input. Text is lowercase, justified (including last line), slightly blurred, and automatically sizes to fill the frame. The layout recomposes with each letter/word — just like bratgenerator.com. Words are never broken: the font shrinks so the longest word fits within the width.

### Phase 2 — Sequence Export
**Export Sequence** tab. Automatically generates a sequence of images (`.zip`, numbered `frame_001…`) ready to import into editing software:
- **Cumulative** : +1 word (or +1 letter) per image → karaoke/build-up effect.
- **Word by word** : one image per isolated word.
- **Line by line** : cumulative line-by-line (lines detected from actual render).
- Formats : 1080×1920 (TikTok/Reels), 1080×1080, 1920×1080.
- Transparent background option (PNG with alpha channel).

### Phase 3 — Customization
**Style** tab: font, blur, weight, letter spacing, line height, block width, auto/fixed size, lowercase, last-line justification, text and background color. Settings are persisted (localStorage).

## Tech Stack
Vite + TypeScript, `html-to-image` (DOM render → PNG, CSS filters included),
`jszip` (sequence archive). Everything runs client-side, no network dependencies.
