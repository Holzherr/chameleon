# Chameleon

Screen recorder and video editor that Claude can drive. Fork of [OpenScreen](https://github.com/siddharthvaddem/openscreen) (MIT), upstream remote `upstream`.

- Goals: [GOALS.md](GOALS.md)
- Decisions: [DECISIONS.md](DECISIONS.md)
- Gotchas: [LEARNINGS.md](LEARNINGS.md)
- Feature specs:
  - [claude-control.md](claude-control.md): Claude Code opens and edits projects
  - [generated-media.md](generated-media.md): generated voice and animations on the timeline

## What OpenScreen gives us (as forked, upstream `f57e36e`)

- Electron + React. macOS capture via a ScreenCaptureKit Swift helper (`electron/native/screencapturekit/`), Windows via WGC.
- Project file: JSON, extension `.openscreen` (`electron/ipc/handlers.ts:47`), `PROJECT_VERSION = 2`. Editor state holds `trimRegions`, `speedRegions`, `zoomRegions` (auto/manual), `annotationRegions` (text, image, figure, blur), crop, wallpaper, padding, radius, shadow, webcam layout, export settings (`src/components/video-editor/projectPersistence.ts`).
- Cursor telemetry recorded alongside video; auto-zoom suggestions from it (`timeline/zoomSuggestionUtils.ts`, `videoPlayback/zoomSpring.ts`).
- Captions: Whisper tiny via Transformers.js in a worker (`src/lib/captioning/transcribe.worker.ts`), turned into annotation regions.
- Export runs in the renderer (WebCodecs decode/encode, `src/lib/exporter/`), MP4 and GIF.
- Not present: extra audio tracks, video overlay tracks, any CLI or MCP surface.
