import { DEFAULT_BACKGROUND_VALUE } from "@/lib/backgrounds";
import { DEFAULT_CURSOR_THEME_ID } from "@/lib/cursor/cursorThemes";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import {
	type CursorVisualSettings,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLIP_TO_BOUNDS,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_WEBCAM_LAYOUT_PRESET,
	DEFAULT_WEBCAM_MASK_SHAPE,
	DEFAULT_WEBCAM_POSITION,
	DEFAULT_WEBCAM_SIZE_PRESET,
	DEFAULT_ZOOM_MOTION_BLUR,
	type WebcamLayoutPreset,
	type WebcamMaskShape,
	type WebcamPosition,
	type WebcamSizePreset,
} from "./types";

export const DEFAULT_SOURCE_DIMENSIONS = {
	width: 1920,
	height: 1080,
} as const;

export const DEFAULT_GIF_OUTPUT_DIMENSIONS = {
	width: 1280,
	height: 720,
} as const;

export const DEFAULT_EDITOR_APPEARANCE_SETTINGS: {
	shadowIntensity: number;
	showBlur: boolean;
	motionBlurAmount: number;
	borderRadius: number;
	showTrimWaveform: boolean;
} = {
	// Polished out of the box: soft shadow, rounded corners, zoom motion blur on.
	shadowIntensity: 0.6,
	showBlur: false,
	motionBlurAmount: DEFAULT_ZOOM_MOTION_BLUR,
	// Preview-stage px (scaled to the export size), about 14px at 960 wide.
	borderRadius: 14,
	showTrimWaveform: true,
};

export const DEFAULT_EDITOR_LAYOUT_SETTINGS: {
	padding: number;
	aspectRatio: AspectRatio;
	cropRegion: typeof DEFAULT_CROP_REGION;
	wallpaper: string;
} = {
	padding: 50,
	aspectRatio: "16:9",
	cropRegion: DEFAULT_CROP_REGION,
	wallpaper: DEFAULT_BACKGROUND_VALUE,
};

export const DEFAULT_WEBCAM_SETTINGS = {
	layoutPreset: DEFAULT_WEBCAM_LAYOUT_PRESET,
	maskShape: DEFAULT_WEBCAM_MASK_SHAPE,
	sizePreset: DEFAULT_WEBCAM_SIZE_PRESET,
	position: DEFAULT_WEBCAM_POSITION,
} as const satisfies {
	layoutPreset: WebcamLayoutPreset;
	maskShape: WebcamMaskShape;
	sizePreset: WebcamSizePreset;
	position: WebcamPosition | null;
};

export const DEFAULT_CURSOR_SETTINGS: CursorVisualSettings & { show: boolean; theme: string } = {
	show: true,
	size: DEFAULT_CURSOR_SIZE,
	smoothing: DEFAULT_CURSOR_SMOOTHING,
	motionBlur: DEFAULT_CURSOR_MOTION_BLUR,
	clickBounce: DEFAULT_CURSOR_CLICK_BOUNCE,
	clipToBounds: DEFAULT_CURSOR_CLIP_TO_BOUNDS,
	theme: DEFAULT_CURSOR_THEME_ID,
};

/** Cursor visuals as stored in the project file (`editor.cursor`); the theme is `cursorTheme`. */
export type ProjectCursorSettings = CursorVisualSettings & { show: boolean };

export const DEFAULT_PROJECT_CURSOR: ProjectCursorSettings = {
	show: DEFAULT_CURSOR_SETTINGS.show,
	size: DEFAULT_CURSOR_SETTINGS.size,
	smoothing: DEFAULT_CURSOR_SETTINGS.smoothing,
	motionBlur: DEFAULT_CURSOR_SETTINGS.motionBlur,
	clickBounce: DEFAULT_CURSOR_SETTINGS.clickBounce,
	clipToBounds: DEFAULT_CURSOR_SETTINGS.clipToBounds,
};

/** Slider ranges in the cursor panel; the project normalizer clamps to these. */
export const PROJECT_CURSOR_RANGES = {
	size: { min: 0.5, max: 10 },
	smoothing: { min: 0, max: 1 },
	motionBlur: { min: 0, max: 1 },
	clickBounce: { min: 0, max: 5 },
} as const;

export const DEFAULT_EXPORT_SETTINGS: {
	quality: ExportQuality;
	format: ExportFormat;
} = {
	quality: "good",
	format: "mp4",
};

export const DEFAULT_GIF_SETTINGS: {
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	outputDimensions: typeof DEFAULT_GIF_OUTPUT_DIMENSIONS;
} = {
	frameRate: 15,
	loop: true,
	sizePreset: "medium",
	outputDimensions: DEFAULT_GIF_OUTPUT_DIMENSIONS,
};
