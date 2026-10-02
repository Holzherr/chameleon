Status: draft

# Claude control

Goal: G-01. Claude Code opens a project, reads it, edits precise portions, previews, and exports.

## Facts it builds on

- The `.openscreen` project file is JSON holding every edit (trim, speed, zoom, annotation regions in ms). Editing that file is editing the video.
- Captions already produce timestamped Whisper segments, so a transcript with times is available.
- Export only runs inside the Electron renderer today.

## Open questions for Nick

- Surface: MCP server, CLI, or both?
- Should the running app live-reload when Claude changes the project file, or does Claude work on closed projects only?
- Whisper tiny is the current model; is its timing accurate enough for word-level cuts, or upgrade the model?
