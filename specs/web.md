Status: draft (idea only, not scheduled; Nick 2026-10-05: "write the specs / idea - but don't want to build for now")

# Web Chameleon

Nick's ask (2026-10-05): make Chameleon web-based like Loom, with the same backgrounds and zooming features.

## Facts (as of main `173e064`)

- The editor, preview and exporter already run in a Chromium renderer: React UI, Pixi rendering, WebCodecs decode/encode (`src/lib/exporter/`). Backgrounds, padding, radius, shadow, manual zooms, captions (Transformers.js Whisper), trims and speed have no native dependency.
- The renderer reaches the desktop shell through 57 distinct `window.electronAPI.*` calls in 21 files, plus `nativeBridgeClient` (`src/native/`) in 7. Each needs a web implementation or removal: file pick/save, recordings storage, project load/save, cursor telemetry, export write, prefs.
- Browsers record screen/window/tab with `getDisplayMedia` and webcam/mic with `getUserMedia`. Chrome/Edge support tab and system audio; Safari and Firefox are uneven on system audio and WebCodecs encoding.
- A browser can't observe the cursor or clicks outside its own tab. Cursor telemetry (`<video>.cursor.json`, used by click auto-zoom, cursor smoothing/hiding and click bounce) comes from the native macOS/Windows helpers, so web recordings of other apps have the cursor burned into the pixels.

## What works on the web without change

Backgrounds, style presets, padding/radius/shadow, manual zooms, trims, speed, text, captions, MP4/GIF export.

## What degrades

Click-driven auto-zoom and cursor effects. Options:
1. **Tab recording**: a page or extension can capture clicks inside the recorded tab only.
2. **Cursor detection from frames**: approximate cursor/click positions by computer vision on the recording. Works for any source; accuracy unknown.
3. **Desktop app as the high-quality recorder**: the web app edits and shares; recordings with full cursor data come from the desktop app.

## New pieces a web version needs

- Web implementations of the shell calls above (OPFS/IndexedDB or uploads instead of local files).
- Loom layer: upload, storage (e.g. Cloudflare R2), share links, a player page, accounts. Ongoing storage/bandwidth cost.
- Claude control: the CLI's headless render could target headless Chrome running the same renderer instead of Electron.

## Claude's recommendation (not agreed)

One shared editor codebase, two shells: desktop for recording with full cursor data, web for quick recordings, editing and Loom-style share links. If built, start with the web recorder plus share links.

## Open questions for Nick

- Web-only, or desktop + web sharing one editor?
- Which cursor option (1, 2, 3) for web recordings?
- Sharing: public links only, or accounts/teams?
- Hosting/storage budget.
