import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "@/components/video-editor/projectPersistence";
import { INITIAL_EDITOR_STATE } from "@/hooks/useEditorHistory";
import { parseSilenceDetect } from "./media";
import { createNewProjectData, SETTABLE_KEYS } from "./project";

describe("createNewProjectData", () => {
	it("equals what the app saves for a fresh recording", () => {
		const data = createNewProjectData({ screenVideoPath: "/v/a.mp4" });
		expect(data.editor).toEqual(normalizeProjectEditor(INITIAL_EDITOR_STATE));
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
