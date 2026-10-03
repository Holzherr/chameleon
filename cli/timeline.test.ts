import { describe, expect, it } from "vitest";
import {
	addTrimRegion,
	applySpeedRegion,
	computePlaybackSegments,
	editedDurationMs,
	sourceToTimeline,
	timelineToSource,
} from "./timeline";

describe("computePlaybackSegments", () => {
	it("matches the exporter: trims removed, speed divides duration", () => {
		const segs = computePlaybackSegments(
			10_000,
			[{ id: "trim-1", startMs: 2000, endMs: 3000 }],
			[{ id: "speed-1", startMs: 6000, endMs: 8000, speed: 2 }],
		);
		expect(segs.map((s) => [s.srcStartMs, s.srcEndMs, s.speed])).toEqual([
			[0, 2000, 1],
			[3000, 6000, 1],
			[6000, 8000, 2],
			[8000, 10000, 1],
		]);
		expect(editedDurationMs(segs)).toBe(2000 + 3000 + 1000 + 2000);
	});

	it("tolerates overlapping trims", () => {
		const segs = computePlaybackSegments(10_000, [
			{ id: "trim-1", startMs: 1000, endMs: 5000 },
			{ id: "trim-2", startMs: 2000, endMs: 3000 },
		]);
		expect(editedDurationMs(segs)).toBe(6000);
	});
});

describe("source ↔ timeline mapping", () => {
	const segs = computePlaybackSegments(
		10_000,
		[{ id: "trim-1", startMs: 2000, endMs: 3000 }],
		[{ id: "speed-1", startMs: 6000, endMs: 8000, speed: 2 }],
	);

	it("maps source to timeline", () => {
		expect(sourceToTimeline(segs, 1000)).toEqual({ timelineMs: 1000, trimmed: false });
		expect(sourceToTimeline(segs, 2500)).toEqual({ timelineMs: 2000, trimmed: true });
		expect(sourceToTimeline(segs, 4000).timelineMs).toBe(3000);
		expect(sourceToTimeline(segs, 7000).timelineMs).toBe(5500);
		expect(sourceToTimeline(segs, 10_000).timelineMs).toBe(8000);
	});

	it("maps timeline back to source and round-trips", () => {
		for (const src of [0, 1500, 3500, 6500, 7900, 9000]) {
			const tl = sourceToTimeline(segs, src).timelineMs;
			expect(timelineToSource(segs, tl)).toBeCloseTo(src, 6);
		}
	});

	it("resolves the cut point by bias", () => {
		expect(timelineToSource(segs, 2000, "start")).toBe(3000);
		expect(timelineToSource(segs, 2000, "end")).toBe(2000);
	});

	it("rejects times past the edited end", () => {
		expect(() => timelineToSource(segs, 9000)).toThrow(/past the edited duration/);
	});
});

describe("addTrimRegion", () => {
	it("creates trim ids in the app's format", () => {
		const { region } = addTrimRegion([{ id: "trim-4", startMs: 0, endMs: 100 }], 500, 900);
		expect(region.id).toBe("trim-5");
	});

	it("merges overlapping and touching trims, keeping the earliest id", () => {
		const trims = [
			{ id: "trim-1", startMs: 1000, endMs: 2000 },
			{ id: "trim-2", startMs: 3000, endMs: 4000 },
			{ id: "trim-3", startMs: 8000, endMs: 9000 },
		];
		const r = addTrimRegion(trims, 1500, 3000);
		expect(r.region).toEqual({ id: "trim-1", startMs: 1000, endMs: 4000 });
		expect(r.mergedIds).toEqual(["trim-1", "trim-2"]);
		expect(r.trimRegions.map((t) => t.id)).toEqual(["trim-1", "trim-3"]);
	});

	it("rejects empty ranges", () => {
		expect(() => addTrimRegion([], 500, 500)).toThrow();
	});
});

describe("applySpeedRegion", () => {
	it("clips and splits existing regions so none overlap", () => {
		const r = applySpeedRegion(
			[{ id: "speed-1", startMs: 0, endMs: 10_000, speed: 1.5 }],
			4000,
			6000,
			3,
		);
		expect(r.speedRegions).toEqual([
			{ id: "speed-1", startMs: 0, endMs: 4000, speed: 1.5 },
			{ id: "speed-3", startMs: 4000, endMs: 6000, speed: 3 },
			{ id: "speed-2", startMs: 6000, endMs: 10_000, speed: 1.5 },
		]);
	});

	it("rejects speeds outside the app range", () => {
		expect(() => applySpeedRegion([], 0, 1000, 20)).toThrow();
		expect(() => applySpeedRegion([], 0, 1000, 0)).toThrow();
	});
});
