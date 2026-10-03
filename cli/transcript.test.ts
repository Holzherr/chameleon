import { describe, expect, it } from "vitest";
import {
	findPhrase,
	refineWordsWithSilences,
	selectMatches,
	snapBoundary,
	snapRange,
	type TranscriptWord,
} from "./transcript";

// Whisper-base output for the fixture (macOS TTS), source ms.
const raw = [
	["Chameleon.", 1480, 2460],
	["Arm,", 2500, 3080],
	["first", 3080, 3360],
	["we", 3360, 3560],
	["open", 3560, 3760],
	["the", 3760, 3920],
	["settings", 3920, 4200],
	["page.", 4200, 4980],
	["Then", 5300, 5360],
	["we", 5360, 5520],
	["click", 5520, 5740],
	["the", 5740, 5980],
] as const;
const silences = [
	{ startMs: 2012, endMs: 2478 },
	{ startMs: 2869, endMs: 3145 },
	{ startMs: 4785, endMs: 5227 },
];
const words: TranscriptWord[] = refineWordsWithSilences(
	raw.map(([text, startMs, endMs]) => ({ text, startMs, endMs })),
	silences,
	8861,
);

describe("refineWordsWithSilences", () => {
	it("clips word ends that run into a silence and starts that begin inside one", () => {
		expect(words[0]).toMatchObject({ text: "Chameleon.", startMs: 1480, endMs: 2012 });
		expect(words[1]).toMatchObject({ text: "Arm,", startMs: 2500, endMs: 2869 });
		expect(words[2]).toMatchObject({ text: "first", startMs: 3145, endMs: 3360 });
		expect(words[7]).toMatchObject({ text: "page.", endMs: 4785 });
	});

	it("clamps to the media duration", () => {
		const [w] = refineWordsWithSilences(
			[{ text: "watching.", startMs: 8380, endMs: 10320 }],
			[],
			8861,
		);
		expect(w.endMs).toBe(8861);
	});
});

describe("findPhrase", () => {
	it("matches case- and punctuation-insensitively across words", () => {
		const m = findPhrase(words, "open the Settings");
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({
			startMs: 3560,
			endMs: 4200,
			text: "open the settings",
			fuzzy: false,
		});
	});

	it("lets a filler match whisper's mis-hearing and flags it", () => {
		const m = findPhrase(words, "Um,");
		expect(m).toHaveLength(1);
		expect(m[0]).toMatchObject({ text: "Arm,", fuzzy: true });
		expect(findPhrase(words, "arm")[0].fuzzy).toBe(false);
	});

	it("errors when ambiguous unless --all/--nth", () => {
		const m = findPhrase(words, "the");
		expect(m).toHaveLength(2);
		expect(() => selectMatches(m, "the", {})).toThrow(/ambiguous/);
		expect(selectMatches(m, "the", { nth: 2 })[0].startMs).toBe(5740);
		expect(selectMatches(m, "the", { all: true })).toHaveLength(2);
		expect(() => selectMatches(m, "the", { nth: 3 })).toThrow();
		expect(() => selectMatches([], "nope", {})).toThrow(/not found/);
	});
});

describe("snapping", () => {
	it("moves cut edges into the surrounding silences, keeping a short pause", () => {
		const { start, end } = snapRange(2500, 2869, silences, words);
		expect(start).toEqual({ ms: 2162, snappedTo: "silence" });
		expect(end).toEqual({ ms: 3007, snappedTo: "silence" });
	});

	it("caps the kept pause at half of a short silence", () => {
		expect(snapBoundary(2869, "end", [{ startMs: 2869, endMs: 2969 }], [])).toEqual({
			ms: 2919,
			snappedTo: "silence",
		});
	});

	it("falls back to the nearest word gap", () => {
		const r = snapBoundary(5350, "start", [], words);
		expect(r.snappedTo).toBe("word-gap");
		expect(r.ms).toBe(5360);
	});

	it("leaves a boundary alone when nothing is near", () => {
		expect(snapBoundary(100, "start", silences, [], { maxDistanceMs: 50 })).toEqual({
			ms: 100,
			snappedTo: null,
		});
	});

	it("never inverts a range", () => {
		const { start, end } = snapRange(3760, 3920, silences, words);
		expect(end.ms).toBeGreaterThan(start.ms);
	});
});
