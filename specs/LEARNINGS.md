# Learnings

Append-only. Read before building; add an entry when something cost time.

- 2026-10-02: the repo is ~170 MB; a fresh clone takes over two minutes. Set `git config http.version HTTP/1.1` or pushes can stall.
- 2026-10-03: the production build strips every `console.*` call in the renderer (terser `drop_console`), so renderer diagnostics only reach the terminal via IPC to main. Headless renders print renderer console with `CHAMELEON_DEBUG=1`.
- 2026-10-03: Pixi's `Texture.from` caches per source object and `FrameRenderer.renderFrame` destroys the previous texture each call, so passing the same `VideoFrame` object twice fails with "Cannot read properties of null (reading 'alphaMode')". Clone the frame per call.
- 2026-10-03: worktree `node_modules` is a symlink into another worktree, so the dev Electron process path names that worktree, not this one. Kill test instances by pid; a stray instance holds the single-instance lock and silently swallows `--chameleon-open`.
- 2026-10-03: `screencapture -l <windowId>` fails ("could not create image from window") when the terminal lacks Screen Recording permission; verify the editor through its `[chameleon]` stdout lines instead.
