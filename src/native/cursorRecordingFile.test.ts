import { describe, expect, it } from "vitest";
import { parseCursorRecordingFile } from "./cursorRecordingFile";

describe("parseCursorRecordingFile", () => {
	it("normalises samples and sorts them by time", () => {
		const data = parseCursorRecordingFile(
			JSON.stringify({
				version: 2,
				provider: "native",
				samples: [
					{ timeMs: 200, cx: 0.4, cy: 0.6, interactionType: "click", cursorType: "pointer" },
					{ timeMs: 100, cx: 0.1, cy: 0.2 },
					{ timeMs: 300, cx: "x", cy: 0.2, interactionType: "keydown" },
				],
				assets: [],
			}),
			"darwin",
		);
		expect(data.provider).toBe("native");
		expect(data.samples.map((s) => [s.timeMs, s.interactionType])).toEqual([
			[100, "move"],
			[200, "click"],
			[300, "move"],
		]);
		expect(data.samples[2].cx).toBe(0.5);
	});

	it("accepts a bare sample array (old format)", () => {
		const data = parseCursorRecordingFile(JSON.stringify([{ timeMs: 0, cx: 0, cy: 0 }]), "darwin");
		expect(data.version).toBe(1);
		expect(data.provider).toBe("none");
		expect(data.samples).toHaveLength(1);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseCursorRecordingFile("{", "darwin")).toThrow();
	});
});
