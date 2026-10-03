<p align="center">
  <img src="icons/icons/png/256x256.png" alt="Chameleon" width="64" />
</p>

# <p align="center">Chameleon</p>

<p align="center"><strong>Screen recorder and video editor that Claude can drive.</strong></p>

Chameleon is a fork of [OpenScreen](https://github.com/siddharthvaddem/openscreen) by Siddharth Vaddem (MIT). It adds a `chameleon` CLI ([cli/README.md](cli/README.md)) so Claude Code can open, edit and export projects from a terminal. Project files use the `.chameleon` extension; OpenScreen `.openscreen` projects open too.

## Core Features
- Record a specific window, or your whole screen.
- Record microphone and system audio.
- Webcam overlay with picture-in-picture, drag-to-position, mirroring, and shape options.
- Auto or manual zooms with adjustable depth, duration, easing, and pixel-precise position; auto-zoom follows your cursor as you work.
- Custom cursor size, smoothing, and click effects, with cursor themes and post-recording path smoothing.
- Automatic captions for voiceovers, generated on-device with no upload (works offline).
- Wallpapers, solid colors, gradients, or your own background image.
- Motion blur.
- Crop, trim, and per-segment speed control on the timeline.
- Text, arrow, and image annotations, with text animation presets.
- Timeline snapping guides and an audio waveform to make trimming easier.
- Customizable keyboard shortcuts.
- Export to MP4 or GIF in multiple aspect ratios and resolutions.
- Languages supported: Arabic, English, Spanish, French, Italian, Japanese, Korean, Portuguese (Brazil), Russian, Turkish, Vietnamese, Simplified Chinese, and Traditional Chinese.

## Building (macOS)

Needs full Xcode for the ScreenCaptureKit helper.

```bash
npm install
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run build:native:mac
npx tsc && npx vite build && npx electron-builder --mac dir --arm64
ditto release/<version>/mac-arm64/Chameleon.app /Applications/Chameleon.app
```

On first record, macOS asks for Screen Recording (and Accessibility for the editable cursor) for **Chameleon**. If a stale "OpenScreen"/"openscreen" entry is left under System Settings > Privacy & Security, remove it.

## Platform differences

Everything in the editor and export is the same on macOS, Windows, and Linux: zooms, backgrounds, motion blur, crop/trim/speed, blur regions, annotations, auto-captions, projects, export, and all languages. The differences are in **capture**, where macOS and Windows use a native pipeline that Linux doesn't have:

- **Native recording**: macOS (ScreenCaptureKit) and Windows (Windows Graphics Capture) record through a native pipeline for higher quality and clean window-level capture. Linux records through the browser pipeline instead.
- **Custom cursors**: on macOS and Windows the real cursor is captured (shape, type, and clicks), which powers the cursor themes, click effects, and editable cursor overlay. On Linux only the cursor position is captured (used for auto-zoom), so those cursor options aren't available.
- **Webcam**: captured natively on macOS and Windows; on Linux it's recorded through the browser, but still works as a picture-in-picture overlay.
- **System audio** support varies by OS:
  - **macOS**: requires macOS 13+. On macOS 14.2+ you'll be prompted to grant audio capture permission. macOS 12 and below can't capture system audio (mic still works).
  - **Windows**: works out of the box.
  - **Linux**: needs PipeWire (default on Ubuntu 22.04+, Fedora 34+). Older PulseAudio-only setups may not capture system audio (mic should still work).

## Credits and license

Built on [OpenScreen](https://github.com/siddharthvaddem/openscreen), copyright (c) 2025 Siddharth Vaddem, released under the [MIT License](./LICENSE). Chameleon keeps that license and notice. By using this software, you agree that the authors are not liable for any issues, damages, or claims arising from its use.
