import { describe, expect, it } from "vitest";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import {
	buildExportSettings,
	buildGifExporterConfig,
	buildMp4ExporterConfig,
	deriveCursorClickTimestamps,
	type ExportCursorState,
	type ExportMedia,
	getHeadlessPreviewSize,
} from "./exportPlan";
import { computeEffectiveDurationSec } from "./streamingDecoder";

const media: ExportMedia = {
	videoUrl: "file:///v.mp4",
	sourceWidth: 1920,
	sourceHeight: 1080,
	previewWidth: 960,
	previewHeight: 540,
};

const cursor: ExportCursorState = {
	recordingData: null,
	scale: 0,
	smoothing: 0.5,
	motionBlur: 0,
	clickBounce: 1,
	clipToBounds: true,
	theme: "default",
	telemetry: [],
	clickTimestamps: [],
};

describe("export plan", () => {
	it("builds MP4 config at the project's quality with the editor's frame rate and codec", () => {
		const config = buildMp4ExporterConfig(
			"good",
			media,
			{ ...INITIAL_EDITOR_STATE, padding: 20 },
			cursor,
		);
		expect(config).toMatchObject({
			videoUrl: "file:///v.mp4",
			width: 1920,
			height: 1080,
			frameRate: 60,
			codec: "avc1.640033",
			padding: 20,
			previewWidth: 960,
		});
		expect(config).not.toHaveProperty("videoPadding");
	});

	it("builds GIF settings and config from the saved GIF options", () => {
		const settings = buildExportSettings({
			format: "gif",
			quality: "good",
			gifFrameRate: 15,
			gifLoop: false,
			gifSizePreset: "medium",
			sourceWidth: 1920,
			sourceHeight: 1080,
			cropRegion: INITIAL_EDITOR_STATE.cropRegion,
			aspectRatio: "16:9",
		});
		expect(settings.gifConfig).toEqual({
			frameRate: 15,
			loop: false,
			sizePreset: "medium",
			width: 1280,
			height: 720,
		});
		if (!settings.gifConfig) throw new Error("expected gif config");
		const config = buildGifExporterConfig(settings.gifConfig, media, INITIAL_EDITOR_STATE, cursor);
		expect(config).toMatchObject({ width: 1280, height: 720, frameRate: 15, loop: false });
		expect(config.videoPadding).toBe(INITIAL_EDITOR_STATE.padding);
	});

	it("leaves MP4 settings as format + quality", () => {
		expect(
			buildExportSettings({
				format: "mp4",
				quality: "medium",
				gifFrameRate: 15,
				gifLoop: true,
				gifSizePreset: "medium",
				sourceWidth: 1920,
				sourceHeight: 1080,
				cropRegion: INITIAL_EDITOR_STATE.cropRegion,
				aspectRatio: "16:9",
			}),
		).toEqual({ format: "mp4", quality: "medium" });
	});

	it("fits the headless preview inside 960x540 at the output aspect", () => {
		expect(getHeadlessPreviewSize(1920, 1080)).toEqual({ width: 960, height: 540 });
		expect(getHeadlessPreviewSize(1080, 1920)).toEqual({ width: 304, height: 540 });
	});

	it("prefers native click samples over telemetry", () => {
		const telemetry = [
			{ timeMs: 10, cx: 0, cy: 0, interactionType: "click" as const },
			{ timeMs: 20, cx: 0, cy: 0 },
		];
		expect(deriveCursorClickTimestamps(null, telemetry)).toEqual([10]);
	});
});

describe("computeEffectiveDurationSec", () => {
	it("subtracts trims and stretches speed regions", () => {
		expect(computeEffectiveDurationSec(10, [{ id: "t", startMs: 2000, endMs: 3000 }])).toBe(9);
		expect(
			computeEffectiveDurationSec(
				10,
				[{ id: "t", startMs: 0, endMs: 1000 }],
				[{ id: "s", startMs: 4000, endMs: 8000, speed: 2 }],
			),
		).toBe(7);
	});
});
