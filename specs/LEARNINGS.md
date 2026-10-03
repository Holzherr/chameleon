# Learnings

Append-only. Read before building; add an entry when something cost time.

- 2026-10-02: the repo is ~170 MB; a fresh clone takes over two minutes. Set `git config http.version HTTP/1.1` or pushes can stall.
- 2026-10-03: transformers.js v2 (`@xenova/transformers` 2.17) word timestamps work in Node with `Xenova/whisper-base` / `whisper-base.en` / `whisper-small.en` (`return_timestamps: "word"`); `onnx-community/whisper-base_timestamped` needs v3 and fails to load. CLI uses `Xenova/whisper-base` (multilingual keeps punctuation/casing; same speed as `.en`, ~4 s per 9 s clip incl. model load).
- 2026-10-03: Whisper word ends overrun into the following pause by up to ~0.5 s, and fillers are mis-heard (macOS TTS "Um" → "Arm" on base and small.en). The CLI clips words against ffmpeg `silencedetect` (-35 dB, 150 ms) and lets filler queries match filler-like words.
- 2026-10-03: onnxruntime-node 1.14 prints graph-optimizer warnings to native stderr regardless of `logSeverityLevel`/`env.logLevel`; the CLI runs Whisper in a child process to keep agent output clean.
- 2026-10-03: `normalizeProjectEditor` drops a zoom's `customScale` although the app writes it on every new zoom. The CLI writes it too (parity) and never normalizes the stored file.
- 2026-10-03: the app only auto-approves project media inside the project's folder or its recordings folder (`getApprovedProjectSession`); keep CLI-created projects next to their video.
