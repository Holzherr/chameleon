Status: built

# Claude control

Goal: G-01. Claude Code opens a project, reads it, edits precise portions, previews, and exports.

## Facts it builds on

- The `.openscreen` project file is JSON holding every edit (trim, speed, zoom, annotation regions in ms). Editing that file is editing the video.
- Captions already produce timestamped Whisper segments (whisper-tiny, chunk-level).
- Export only runs inside the Electron renderer today.

## Decisions (see DECISIONS.md)

- Surface: CLI now, MCP later.
- The open app live-reloads external changes to the project file, one undo step per change; banner instead of overwrite when the editor has unsaved edits.
- Word-level transcript (Whisper base timestamped); cuts snap to silence.

## What the CLI must let Claude do

- Open a recording or project, and read its full state as JSON.
- Get a word-level transcript with timestamps.
- Edit precise portions: trim/cut, speed, zoom, annotations/captions, by time range.
- Add audio files (voice) and overlay media (animations) at a time and position. See generated-media.md.
- Grab a still frame at any time so Claude can check its work.
- Export MP4/GIF without a person clicking through the app.
