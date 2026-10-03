// Named looks: background + framing + motion blur (+ cursor visuals) applied in one step.

import {
	DEFAULT_EDITOR_APPEARANCE_SETTINGS,
	DEFAULT_EDITOR_LAYOUT_SETTINGS,
	type ProjectCursorSettings,
} from "@/components/video-editor/editorDefaults";
import {
	normalizeProjectCursor,
	type ProjectEditorState,
} from "@/components/video-editor/projectPersistence";
import { backgroundIdOf, resolveBackgroundId } from "./backgrounds";

export interface StylePreset {
	id: string;
	name: string;
	description: string;
	/** Background id from BACKGROUNDS. */
	background: string;
	padding: number;
	borderRadius: number;
	shadowIntensity: number;
	motionBlurAmount: number;
	cursor?: Partial<ProjectCursorSettings>;
}

export const STYLE_PRESETS: readonly StylePreset[] = [
	{
		id: "studio",
		name: "Studio",
		description: "the default look for new projects",
		background: backgroundIdOf(DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper) ?? "dusk",
		padding: DEFAULT_EDITOR_LAYOUT_SETTINGS.padding,
		borderRadius: DEFAULT_EDITOR_APPEARANCE_SETTINGS.borderRadius,
		shadowIntensity: DEFAULT_EDITOR_APPEARANCE_SETTINGS.shadowIntensity,
		motionBlurAmount: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount,
	},
	{
		id: "clean",
		name: "Clean",
		description: "light sky backdrop, soft shadow, generous margin",
		background: "sky",
		padding: 50,
		borderRadius: 14,
		shadowIntensity: 0.5,
		motionBlurAmount: 0.35,
		cursor: { size: 3, smoothing: 0.67, clickBounce: 2.5 },
	},
	{
		id: "bold",
		name: "Bold",
		description: "warm sunset, bigger frame, deep shadow, bigger cursor",
		background: "sunset",
		padding: 36,
		borderRadius: 20,
		shadowIntensity: 0.85,
		motionBlurAmount: 0.5,
		cursor: { size: 4, clickBounce: 3 },
	},
	{
		id: "dark",
		name: "Dark",
		description: "graphite backdrop for dark-mode recordings",
		background: "graphite",
		padding: 45,
		borderRadius: 14,
		shadowIntensity: 0.8,
		motionBlurAmount: 0.35,
		cursor: { size: 3, clickBounce: 2.5 },
	},
	{
		id: "minimal",
		name: "Minimal",
		description: "neutral sand, tight margin, subtle shadow, calm cursor",
		background: "sand",
		padding: 36,
		borderRadius: 10,
		shadowIntensity: 0.35,
		motionBlurAmount: 0.2,
		cursor: { size: 2.5, smoothing: 0.8, clickBounce: 1.5, motionBlur: 0.2 },
	},
];

export function getStylePreset(id: string): StylePreset | undefined {
	const key = id.trim().toLowerCase();
	return STYLE_PRESETS.find((p) => p.id === key);
}

/** Editor fields a preset sets (cursor merged over the project's current cursor). */
export function stylePresetFields(
	preset: StylePreset,
	currentCursor: unknown,
): Pick<
	ProjectEditorState,
	"wallpaper" | "padding" | "borderRadius" | "shadowIntensity" | "motionBlurAmount" | "cursor"
> {
	const wallpaper = resolveBackgroundId(preset.background);
	if (!wallpaper)
		throw new Error(`preset ${preset.id} names unknown background ${preset.background}`);
	return {
		wallpaper,
		padding: preset.padding,
		borderRadius: preset.borderRadius,
		shadowIntensity: preset.shadowIntensity,
		motionBlurAmount: preset.motionBlurAmount,
		cursor: normalizeProjectCursor({ ...normalizeProjectCursor(currentCursor), ...preset.cursor }),
	};
}

export function applyStylePreset<T extends Partial<ProjectEditorState>>(
	editor: T,
	preset: StylePreset,
): T {
	return { ...editor, ...stylePresetFields(preset, editor.cursor) };
}
