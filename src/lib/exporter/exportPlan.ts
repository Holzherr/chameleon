// Builds exporter configs from editor state. Shared by the editor's Export button and the
// headless `--chameleon-render` path so both produce the same output.

import type {
	AnnotationRegion,
	CropRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	WebcamLayoutPreset,
	WebcamMaskShape,
	WebcamPosition,
	WebcamSizePreset,
	ZoomRegion,
} from "@/components/video-editor/types";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import type { CursorRecordingData } from "@/native/contracts";
import {
	type AspectRatio,
	getAspectRatioValue,
	getNativeAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { calculateOutputDimensions, type GifExporterConfig } from "./gifExporter";
import {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
} from "./mp4ExportSettings";
import type {
	ExportFormat,
	ExportQuality,
	ExportSettings,
	GifExportConfig,
	GifFrameRate,
	GifSizePreset,
} from "./types";
import { GIF_SIZE_PRESETS } from "./types";
import type { VideoExporterConfig } from "./videoExporter";

export const MP4_EXPORT_FRAME_RATE = 60;
export const MP4_EXPORT_CODEC = "avc1.640033";

export interface ExportEditorState {
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	shadowIntensity: number;
	showBlur: boolean;
	motionBlurAmount: number;
	borderRadius: number;
	padding: number;
	cropRegion: CropRegion;
	aspectRatio: AspectRatio;
	webcamLayoutPreset: WebcamLayoutPreset;
	webcamMaskShape: WebcamMaskShape;
	webcamMirrored: boolean;
	webcamReactiveZoom: boolean;
	webcamSizePreset: WebcamSizePreset;
	webcamPosition: WebcamPosition | null;
}

export interface ExportCursorState {
	recordingData: CursorRecordingData | null;
	/** 0 hides the editable cursor overlay. */
	scale: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clipToBounds: boolean;
	theme: string;
	telemetry: CursorTelemetryPoint[];
	clickTimestamps: number[];
}

export interface ExportMedia {
	videoUrl: string;
	webcamVideoUrl?: string;
	sourceWidth: number;
	sourceHeight: number;
	/** Size of the preview stage the edits were made against (scales text/radius). */
	previewWidth: number;
	previewHeight: number;
}

export function getExportAspectRatioValue(
	aspectRatio: AspectRatio,
	sourceWidth: number,
	sourceHeight: number,
	cropRegion: CropRegion,
) {
	return aspectRatio === "native"
		? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
		: getAspectRatioValue(aspectRatio);
}

/** The settings the Export button uses for the project's saved format/quality. */
export function buildExportSettings(input: {
	format: ExportFormat;
	quality: ExportQuality;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	sourceWidth: number;
	sourceHeight: number;
	cropRegion: CropRegion;
	aspectRatio: AspectRatio;
}): ExportSettings {
	if (input.format !== "gif") {
		return { format: input.format, quality: input.quality };
	}
	const effective = calculateEffectiveSourceDimensions(
		input.sourceWidth,
		input.sourceHeight,
		input.cropRegion,
	);
	const gifDimensions = calculateOutputDimensions(
		effective.width,
		effective.height,
		input.gifSizePreset,
		GIF_SIZE_PRESETS,
		getExportAspectRatioValue(
			input.aspectRatio,
			input.sourceWidth,
			input.sourceHeight,
			input.cropRegion,
		),
	);
	return {
		format: "gif",
		gifConfig: {
			frameRate: input.gifFrameRate,
			loop: input.gifLoop,
			sizePreset: input.gifSizePreset,
			width: gifDimensions.width,
			height: gifDimensions.height,
		},
	};
}

function buildSharedConfig(
	media: ExportMedia,
	editor: ExportEditorState,
	cursor: ExportCursorState,
) {
	return {
		videoUrl: media.videoUrl,
		webcamVideoUrl: media.webcamVideoUrl || undefined,
		wallpaper: editor.wallpaper,
		zoomRegions: editor.zoomRegions,
		trimRegions: editor.trimRegions,
		speedRegions: editor.speedRegions,
		showShadow: editor.shadowIntensity > 0,
		shadowIntensity: editor.shadowIntensity,
		showBlur: editor.showBlur,
		motionBlurAmount: editor.motionBlurAmount,
		borderRadius: editor.borderRadius,
		padding: editor.padding,
		cropRegion: editor.cropRegion,
		cursorRecordingData: cursor.recordingData,
		cursorScale: cursor.scale,
		cursorSmoothing: cursor.smoothing,
		cursorMotionBlur: cursor.motionBlur,
		cursorClickBounce: cursor.clickBounce,
		cursorClipToBounds: cursor.clipToBounds,
		cursorTheme: cursor.theme,
		annotationRegions: editor.annotationRegions,
		webcamLayoutPreset: editor.webcamLayoutPreset,
		webcamMaskShape: editor.webcamMaskShape,
		webcamMirrored: editor.webcamMirrored,
		webcamReactiveZoom: editor.webcamReactiveZoom,
		webcamSizePreset: editor.webcamSizePreset,
		webcamPosition: editor.webcamPosition,
		previewWidth: media.previewWidth,
		previewHeight: media.previewHeight,
		cursorTelemetry: cursor.telemetry,
		cursorClickTimestamps: cursor.clickTimestamps,
	};
}

export function buildMp4ExporterConfig(
	quality: ExportQuality,
	media: ExportMedia,
	editor: ExportEditorState,
	cursor: ExportCursorState,
): VideoExporterConfig {
	const effective = calculateEffectiveSourceDimensions(
		media.sourceWidth,
		media.sourceHeight,
		editor.cropRegion,
	);
	const { width, height, bitrate } = calculateMp4ExportSettings({
		quality,
		sourceWidth: effective.width,
		sourceHeight: effective.height,
		aspectRatioValue: getExportAspectRatioValue(
			editor.aspectRatio,
			media.sourceWidth,
			media.sourceHeight,
			editor.cropRegion,
		),
	});
	return {
		...buildSharedConfig(media, editor, cursor),
		width,
		height,
		frameRate: MP4_EXPORT_FRAME_RATE,
		bitrate,
		codec: MP4_EXPORT_CODEC,
	};
}

export function buildGifExporterConfig(
	gifConfig: GifExportConfig,
	media: ExportMedia,
	editor: ExportEditorState,
	cursor: ExportCursorState,
): GifExporterConfig {
	return {
		...buildSharedConfig(media, editor, cursor),
		width: gifConfig.width,
		height: gifConfig.height,
		frameRate: gifConfig.frameRate,
		loop: gifConfig.loop,
		sizePreset: gifConfig.sizePreset,
		videoPadding: editor.padding,
	};
}

/**
 * Preview stage size for renders with no editor on screen. The editor passes its real
 * preview size; headless renders use this reference box (the output aspect fitted in
 * 960x540, about what a maximised editor shows on a laptop) so text and corner radius
 * scale the same way on every run.
 */
export function getHeadlessPreviewSize(outputWidth: number, outputHeight: number) {
	const maxWidth = 960;
	const maxHeight = 540;
	const scale = Math.min(maxWidth / outputWidth, maxHeight / outputHeight);
	return {
		width: Math.round(outputWidth * scale),
		height: Math.round(outputHeight * scale),
	};
}

function isClickInteractionType(interactionType: string | null | undefined) {
	return (
		interactionType === "click" ||
		interactionType === "double-click" ||
		interactionType === "right-click" ||
		interactionType === "middle-click"
	);
}

/** Click times for click-bounce, preferring native recording samples over telemetry. */
export function deriveCursorClickTimestamps(
	recordingData: CursorRecordingData | null,
	telemetry: CursorTelemetryPoint[],
): number[] {
	const recordingClicks =
		recordingData?.samples
			.filter((sample) => isClickInteractionType(sample.interactionType))
			.map((sample) => sample.timeMs) ?? [];
	if (recordingClicks.length > 0) {
		return recordingClicks;
	}
	return telemetry
		.filter((sample) => isClickInteractionType(sample.interactionType))
		.map((sample) => sample.timeMs);
}

/**
 * Whether the recording has an editable cursor overlay. Windows recordings include
 * captured cursor assets; macOS hides the system cursor in ScreenCaptureKit and renders
 * telemetry samples with the default arrow asset.
 */
export function hasEditableCursorOverlay(
	captureMode: string | null | undefined,
	platform: string | null | undefined,
	recordingData: CursorRecordingData | null,
): boolean {
	return (
		captureMode === "editable-overlay" &&
		(platform === "win32" || platform === "darwin") &&
		hasNativeCursorRecordingData(recordingData)
	);
}
