# Decisions

Append-only.

- 2026-10-02 Nick: name is Chameleon, logo direction = curled-tail chameleon silhouette (stock ref Adobe Stock 604570962, placeholder only, not licensed).
- 2026-10-02 Nick: fork OpenScreen (MIT) rather than Recordly (AGPL-3.0) or a from-scratch build. Reason: AGPL concern.
- 2026-10-02 Claude (sourced): Recordly's README says OpenScreen's zoom animations were "directly ported from early versions of Recordly". If any of that code was AGPL at the time, it's a provenance risk in the zoom files (`videoPlayback/zoom*.ts`). Unverified; check git history before relying on those files commercially.
- 2026-10-02 Nick: Claude control surface is a CLI first; MCP later, eventually both.
- 2026-10-02 Nick (delegated to Claude): the running app live-reloads when the open project file changes on disk. Each external change lands as one undo step. If the editor has unsaved edits, show a banner offering reload instead of overwriting.
- 2026-10-02 Nick (delegated to Claude): transcripts for editing use word-level timestamps from a Whisper base-size timestamped model (e.g. `onnx-community/whisper-base_timestamped` via Transformers.js), not whisper-tiny chunk timing. Cut points snap to the nearest silence. Verify accuracy on real recordings while building; upgrade the model if cuts land mid-word.
- 2026-10-02 Nick: voice is bring-your-own. Chameleon bundles no voice provider; the user generates audio with their own provider/key and Claude places the file.
- 2026-10-02 Nick: Claude generates animations itself, under the user's own tool licences. Chameleon's job is to give Claude full control to place them on the timeline.
- 2026-10-05 Nick: web/Loom-style Chameleon is spec-only for now (specs/web.md); don't build.
