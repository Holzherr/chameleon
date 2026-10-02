Status: draft

# Generated voice and animations

Goal: G-02. Claude generates voice and animations and places them on the timeline over real footage.

## Facts it builds on

- OpenScreen has no extra audio track and no video overlay track. Annotations support static images only (data URL in `imageContent`).
- Both tracks have to be added to the project model, playback, and the exporter (`src/lib/exporter/`) before generated media can land.

## Open questions for Nick

- Voice provider (paid per use, e.g. ElevenLabs): which one, and is spend pre-approved?
- Animations: rendered to video with alpha and placed on an overlay track, drawn live in the render pipeline, or both?
