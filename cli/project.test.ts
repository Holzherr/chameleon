import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CURSOR } from "@/components/video-editor/editorDefaults";
import { normalizeProjectEditor } from "@/components/video-editor/projectPersistence";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import { getBackground } from "@/lib/backgrounds";
import { resolveWallpaperArg } from "./commands";
import { parseSilenceDetect } from "./media";
import { createNewProjectData, SETTABLE_KEYS } from "./project";

describe("createNewProjectData", () => {
	it("equals what the app saves for a fresh recording", () => {
		const data = createNewProjectData({ screenVideoPath: "/v/a.mp4" });
		// The editor saves its cursor settings next to the undoable state.
		expect(data.editor).toEqual(
			normalizeProjectEditor({ ...INITIAL_EDITOR_STATE, cursor: DEFAULT_PROJECT_CURSOR }),
		);
		expect(data.version).toBe(2);
		expect(data.media).toEqual({ screenVideoPath: "/v/a.mp4" });
	});

	it("survives a normalize round trip unchanged", () => {
		const data = createNewProjectData({ screenVideoPath: "/v/a.mp4" });
		expect(normalizeProjectEditor(data.editor)).toEqual(data.editor);
	});

	it("does not expose region arrays as settings", () => {
		expect(SETTABLE_KEYS).toContain("padding");
		expect(SETTABLE_KEYS).not.toContain("trimRegions");
		expect(SETTABLE_KEYS).toContain("cursor");
	});
});

describe("resolveWallpaperArg", () => {
	it("maps background ids to their stored value", () => {
		expect(resolveWallpaperArg("ocean")).toBe(getBackground("ocean")?.value);
		expect(resolveWallpaperArg("wallpaper3")).toBe("/wallpapers/wallpaper3.jpg");
	});

	it("passes raw colours, drawable gradients and image paths through", () => {
		expect(resolveWallpaperArg("#112233")).toBe("#112233");
		expect(resolveWallpaperArg("rgb(1,2,3)")).toBe("rgb(1,2,3)");
		expect(resolveWallpaperArg("linear-gradient(90deg, #000, #fff)")).toBe(
			"linear-gradient(90deg, #000, #fff)",
		);
		expect(resolveWallpaperArg("/wallpapers/wallpaper1.jpg")).toBe("/wallpapers/wallpaper1.jpg");
	});

	it("rejects unknown ids and gradients the exporter cannot draw", () => {
		expect(() => resolveWallpaperArg("nope")).toThrow(/unknown background/);
		expect(() => resolveWallpaperArg("conic-gradient(red, blue)")).toThrow(/cannot draw/);
		expect(() => resolveWallpaperArg(5)).toThrow();
	});
});

describe("parseSilenceDetect", () => {
	it("parses ffmpeg output and closes a trailing silence at the duration", () => {
		const stderr = [
			"[silencedetect @ 0x1] silence_start: 2.011927",
			"[silencedetect @ 0x1] silence_end: 2.478277 | silence_duration: 0.466349",
			"[silencedetect @ 0x1] silence_start: 8.5",
		].join("\n");
		expect(parseSilenceDetect(stderr, 8861)).toEqual([
			{ startMs: 2012, endMs: 2478 },
			{ startMs: 8500, endMs: 8861 },
		]);
	});
});
