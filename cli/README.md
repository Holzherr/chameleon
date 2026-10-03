# chameleon CLI

Edits `.openscreen` project files so Claude Code can drive the editor from a terminal.

```
npm run build:cli          # bundles cli/ to dist-cli/chameleon.mjs
bin/chameleon --help
```

Needs Node 22+, ffmpeg/ffprobe (`/opt/homebrew/bin` or PATH). Every command takes `--json`; errors exit 1 (with `{"ok":false,"error":…}` on stdout under `--json`).

| Command | What it does |
| --- | --- |
| `new <video> [-o p.openscreen] [--webcam v]` | project identical to what the app saves for a fresh recording |
| `show <project>` | full project + source/edited duration + regions with ids |
| `transcript <project\|video>` | word timestamps (Whisper base) + ffmpeg silences, cached in `<file>.transcript.json` |
| `cut <p> <start> <end> [--snap]` / `cut <p> --text "phrase" [--snap] [--all\|--nth N]` | trim region; overlapping cuts merge |
| `speed <p> <start> <end> <factor>` | 0.1–16x; overlapped speed regions are clipped |
| `zoom <p> <start> <end> [--depth 1-6] [--focus x,y\|auto] [--replace]` | zooms may not overlap |
| `text <p> <start> <end> "text" [--x --y --width --height --size --color --bg --font --weight --align --animation]` | text annotation; x/y = top-left in % |
| `caption <p> [--min-words 2 --max-words 7] [--replace]` | caption annotations, same grouping as the app's auto-captions |
| `list <p> [type]`, `remove <p> <id>...`, `set <p> key=value...` | `set` validates through `normalizeProjectEditor` |
| `open <p>`, `export <p> -o out.mp4\|.gif`, `frame <p> <time> -o out.png` | launch the Electron app (`cli/app.ts`) |
| `backgrounds` | background ids: 12 curated mesh gradients (`dusk` default, `dawn`, `sky`, `mint`, `lavender`, `rose`, `sand`, `ocean`, `sunset`, `aurora`, `graphite`, `midnight`) and `wallpaper1`–`wallpaper18` |
| `styles`, `style <p> <preset>` | presets `studio` (new-project default), `clean`, `bold`, `dark`, `minimal`: background + padding + radius + shadow + motion blur + cursor; other settings kept |

## Looks

- `set p wallpaper=ocean` stores the background's CSS value (`show` prints the id back). Raw `#hex`/`rgb()`, `linear-`/`radial-gradient` layers and `/wallpapers/…` paths also work; gradients the exporter cannot draw (e.g. `conic-`) are rejected.
- Cursor visuals live in `editor.cursor` (`show`, `size` 0.5–10, `smoothing` 0–1, `motionBlur` 0–1, `clickBounce` 0–5, `clipToBounds`): `set p cursor.size=4 cursor.show=false`. Projects without it use the app defaults; the app writes it on save. Headless `export`/`frame` honour it.
- Data: `src/lib/backgrounds.ts`, `src/lib/stylePresets.ts`; new-project defaults in `src/components/video-editor/editorDefaults.ts`.

## Time semantics

- Times: `12.5`, `12.5s`, `1500ms`, `1:02.25` (seconds by default).
- Every region in the project file is in **source video time**: the exporter decodes the source, drops trimmed spans, and renders each frame at its source timestamp. The transcript is in source time too, so its numbers can be passed straight to `cut`/`zoom`/`text`.
- `--timeline` reads `<start> <end>` as times on the edited output (after cuts and speed) and converts them to source time. At a cut point, a start maps to just after the cut and an end to just before it.
- `frame <time>` takes source time by default (error if that moment is cut) or timeline time with `--timeline`; the app receives source ms (the editor playhead's units).

## Snapping

`--snap` moves each cut edge into the nearest silence within 400 ms, leaving up to 150 ms of pause on the kept side; failing that, to the midpoint of the nearest gap between words. Word times are Whisper's, clipped against ffmpeg silences (Whisper word ends run into the following pause).

Filler words in `--text` (`um`, `uh`, `erm`, …) also match Whisper's mis-hearings of them (`arm`, `mhm`, `eh`); such matches are reported with `fuzzy: true`.

Env: `CHAMELEON_WHISPER_MODEL` (default `Xenova/whisper-base`), `CHAMELEON_MODEL_DIR` (default `~/.cache/chameleon/models`), `CHAMELEON_FFMPEG` / `CHAMELEON_FFPROBE`.
