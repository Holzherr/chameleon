import { describe, expect, it } from "vitest";
import {
	DEFAULT_EDITOR_APPEARANCE_SETTINGS,
	DEFAULT_PROJECT_CURSOR,
} from "@/components/video-editor/editorDefaults";
import { normalizeProjectEditor } from "@/components/video-editor/projectPersistence";
import { resolveBackgroundId } from "./backgrounds";
import { applyStylePreset, getStylePreset, STYLE_PRESETS } from "./stylePresets";

describe("style presets", () => {
	it("includes the named looks with unique ids", () => {
		const ids = STYLE_PRESETS.map((p) => p.id);
		expect(ids).toEqual(expect.arrayContaining(["studio", "clean", "bold", "dark", "minimal"]));
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("only uses known backgrounds and values the app keeps on load", () => {
		const base = normalizeProjectEditor({});
		for (const preset of STYLE_PRESETS) {
			expect(resolveBackgroundId(preset.background), preset.id).toBeDefined();
			const applied = applyStylePreset(base, preset);
			expect(normalizeProjectEditor(applied), preset.id).toEqual(applied);
		}
	});

	it("studio equals the new-project defaults", () => {
		const studio = getStylePreset("studio");
		expect(studio).toBeDefined();
		const applied = applyStylePreset(normalizeProjectEditor({}), studio!);
		expect(applied).toMatchObject({
			wallpaper: normalizeProjectEditor({}).wallpaper,
			shadowIntensity: DEFAULT_EDITOR_APPEARANCE_SETTINGS.shadowIntensity,
			borderRadius: DEFAULT_EDITOR_APPEARANCE_SETTINGS.borderRadius,
			motionBlurAmount: DEFAULT_EDITOR_APPEARANCE_SETTINGS.motionBlurAmount,
			cursor: DEFAULT_PROJECT_CURSOR,
		});
	});

	it("sets the look, keeps everything else, merges cursor fields", () => {
		const editor = normalizeProjectEditor({
			aspectRatio: "9:16",
			trimRegions: [{ id: "trim-1", startMs: 0, endMs: 500 }],
			cursor: { ...DEFAULT_PROJECT_CURSOR, show: false, smoothing: 0.1 },
		});
		const bold = getStylePreset("BOLD");
		expect(bold).toBeDefined();
		const applied = applyStylePreset(editor, bold!);
		expect(applied.wallpaper).toBe(resolveBackgroundId("sunset"));
		expect(applied.padding).toBe(bold!.padding);
		expect(applied.shadowIntensity).toBe(bold?.shadowIntensity);
		expect(applied.aspectRatio).toBe("9:16");
		expect(applied.trimRegions).toEqual(editor.trimRegions);
		expect(applied.cursor).toEqual({
			...DEFAULT_PROJECT_CURSOR,
			show: false,
			smoothing: 0.1,
			size: 4,
			clickBounce: 3,
		});
	});

	it("returns undefined for unknown presets", () => {
		expect(getStylePreset("nope")).toBeUndefined();
	});
});
