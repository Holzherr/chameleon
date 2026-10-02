Status: agreed

# Generated voice and animations

Goal: G-02. Claude generates voice and animations and places them on the timeline over real footage.

## Facts it builds on

- OpenScreen has no extra audio track and no video overlay track. Annotations support static images only (data URL in `imageContent`).
- Both tracks have to be added to the project model, playback, and the exporter (`src/lib/exporter/`) before generated media can land.

## Decisions (see DECISIONS.md)

- Voice is bring-your-own: no bundled provider. The user's provider produces an audio file; Claude places it.
- Claude generates animations under the user's own tool licences. Chameleon only needs to give Claude full control of placement.

## What Chameleon must support

- Audio track: add/move/trim audio files, with volume.
- Overlay track: video files with alpha (and images) placed by time, position, size and layer, composited in preview and export.
- All of the above editable through the CLI (claude-control.md).
