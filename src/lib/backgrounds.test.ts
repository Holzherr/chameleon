import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_LAYOUT_SETTINGS } from "@/components/video-editor/editorDefaults";
import {
	BACKGROUNDS,
	backgroundIdOf,
	DEFAULT_BACKGROUND_ID,
	IMAGE_BACKGROUNDS,
	resolveBackgroundId,
} from "./backgrounds";
import { parseCssBackgroundLayers } from "./exporter/gradientParser";
import { classifyWallpaper } from "./wallpaper";

describe("curated backgrounds", () => {
	it("has unique lowercase ids", () => {
		const ids = [...BACKGROUNDS, ...IMAGE_BACKGROUNDS].map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
		expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(12);
	});

	it("are gradients the exporter can draw", () => {
		for (const b of BACKGROUNDS) {
			expect(classifyWallpaper(b.value).kind).toBe("gradient");
			const layers = parseCssBackgroundLayers(b.value);
			expect(layers, b.id).not.toBeNull();
			// Mesh look: radial blobs over a linear base (the last, bottom layer).
			expect(layers?.at(-1)?.type).toBe("linear");
			expect(layers?.slice(0, -1).every((l) => l.type === "radial")).toBe(true);
		}
	});

	it("resolves ids to values and back", () => {
		for (const b of BACKGROUNDS) {
			expect(resolveBackgroundId(b.id)).toBe(b.value);
			expect(resolveBackgroundId(` ${b.id.toUpperCase()} `)).toBe(b.value);
			expect(backgroundIdOf(b.value)).toBe(b.id);
		}
		expect(resolveBackgroundId("wallpaper18")).toBe("/wallpapers/wallpaper18.jpg");
		expect(backgroundIdOf("/wallpapers/wallpaper2.jpg")).toBe("wallpaper2");
		expect(resolveBackgroundId("missing")).toBeUndefined();
		expect(backgroundIdOf("#123456")).toBeNull();
	});

	it("new projects start on the default background", () => {
		expect(backgroundIdOf(DEFAULT_EDITOR_LAYOUT_SETTINGS.wallpaper)).toBe(DEFAULT_BACKGROUND_ID);
	});
});
