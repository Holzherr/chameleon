import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import {
	buildAutoZoomSuggestions,
	CLICK_CLUSTER_GAP_MS,
	CLICK_HOLD_MS,
	CLICK_LEAD_IN_MS,
	clusterClicks,
	DWELL_CLICK_CLEARANCE_MS,
	depthForClickSpread,
	extractClickEvents,
	SUGGESTION_SPACING_MS,
	type ZoomClickEvent,
} from "./zoomSuggestionUtils";

const click = (timeMs: number, cx: number, cy: number): ZoomClickEvent => ({ timeMs, cx, cy });

/** Cursor moving steadily (never dwelling) from `fromMs` to `toMs`, 30 Hz. */
function moving(fromMs: number, toMs: number): CursorTelemetryPoint[] {
	const out: CursorTelemetryPoint[] = [];
	for (let t = fromMs; t < toMs; t += 33) {
		const phase = (t / 1000) * Math.PI;
		out.push({ timeMs: t, cx: 0.5 + 0.4 * Math.sin(phase), cy: 0.5 + 0.4 * Math.cos(phase) });
	}
	return out;
}

/** Cursor resting at (cx, cy) from `fromMs` to `toMs`, 30 Hz. */
function resting(fromMs: number, toMs: number, cx: number, cy: number): CursorTelemetryPoint[] {
	const out: CursorTelemetryPoint[] = [];
	for (let t = fromMs; t <= toMs; t += 33) out.push({ timeMs: t, cx, cy });
	return out;
}

const base = { totalMs: 30_000, existingRegions: [], defaultDurationMs: 1500 };

describe("extractClickEvents", () => {
	it("keeps click-like interactions, sorted, and drops duplicate reports", () => {
		const events = extractClickEvents([
			{ timeMs: 500, cx: 0.2, cy: 0.2, interactionType: "click" },
			{ timeMs: 100, cx: 0.1, cy: 0.1, interactionType: "move" },
			{ timeMs: 520, cx: 0.2, cy: 0.2, interactionType: "click" },
			{ timeMs: 900, cx: 0.3, cy: 0.3, interactionType: "mouseup" },
			{ timeMs: 1200, cx: 0.4, cy: 0.4, interactionType: "double-click" },
			{ timeMs: 50, cx: 0.5, cy: 0.5, interactionType: "right-click" },
		]);
		expect(events).toEqual([click(50, 0.5, 0.5), click(500, 0.2, 0.2), click(1200, 0.4, 0.4)]);
	});

	it("returns nothing for telemetry without interaction types", () => {
		expect(extractClickEvents(moving(0, 1000))).toEqual([]);
	});
});

describe("clusterClicks", () => {
	it("merges clicks close in time and space", () => {
		const clusters = clusterClicks([
			click(1000, 0.3, 0.3),
			click(2000, 0.32, 0.31),
			click(3500, 0.29, 0.3),
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].firstMs).toBe(1000);
		expect(clusters[0].lastMs).toBe(3500);
		expect(clusters[0].centroid.cx).toBeCloseTo(0.3033, 3);
	});

	it("splits on a time gap", () => {
		const clusters = clusterClicks([
			click(1000, 0.3, 0.3),
			click(1000 + CLICK_CLUSTER_GAP_MS + 1, 0.3, 0.3),
		]);
		expect(clusters).toHaveLength(2);
	});

	it("splits on a jump across the screen even when close in time", () => {
		const clusters = clusterClicks([click(1000, 0.1, 0.1), click(1500, 0.9, 0.9)]);
		expect(clusters.map((c) => c.clicks.length)).toEqual([1, 1]);
	});

	it("measures spread from the centroid", () => {
		const [cluster] = clusterClicks([click(0, 0.4, 0.5), click(500, 0.6, 0.5)]);
		expect(cluster.spread).toBeCloseTo(0.1, 6);
	});
});

describe("depthForClickSpread", () => {
	it("zooms deeper for tighter clusters", () => {
		expect(depthForClickSpread(0)).toBe(4);
		expect(depthForClickSpread(0.1)).toBe(3);
		expect(depthForClickSpread(0.24)).toBe(2);
	});
});

describe("buildAutoZoomSuggestions: clicks", () => {
	it("zooms from a lead-in before the first click to a hold after the last", () => {
		const clicks = [click(5000, 0.7, 0.2), click(6000, 0.71, 0.21), click(7200, 0.7, 0.2)];
		const [s, ...rest] = buildAutoZoomSuggestions({ ...base, cursorTelemetry: [], clicks });
		expect(rest).toEqual([]);
		expect(s.span).toEqual({ start: 5000 - CLICK_LEAD_IN_MS, end: 7200 + CLICK_HOLD_MS });
		expect(s.focus.cx).toBeCloseTo(0.7033, 3);
		expect(s.followCursor).toBe(true);
		expect(s.depth).toBe(4);
		expect(s.reason).toEqual({ kind: "clicks", clickCount: 3 });
	});

	it("reads clicks from telemetry interaction types when none are passed", () => {
		const telemetry: CursorTelemetryPoint[] = [
			...moving(0, 4000),
			{ timeMs: 4000, cx: 0.5, cy: 0.5, interactionType: "click" },
			...moving(4033, 9000),
		];
		const suggestions = buildAutoZoomSuggestions({ ...base, cursorTelemetry: telemetry });
		expect(suggestions.map((s) => s.reason.kind)).toEqual(["clicks"]);
	});

	it("clamps spans to the video", () => {
		const [s] = buildAutoZoomSuggestions({
			...base,
			totalMs: 3000,
			cursorTelemetry: [],
			clicks: [click(200, 0.5, 0.5), click(2000, 0.5, 0.5)],
		});
		expect(s.span).toEqual({ start: 0, end: 3000 });
	});

	it("ignores clicks past the end of the video", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			totalMs: 3000,
			cursorTelemetry: [],
			clicks: [click(4000, 0.5, 0.5)],
		});
		expect(out).toEqual([]);
	});

	it("makes neighbouring clusters in different places meet halfway instead of overlapping", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: [],
			clicks: [click(4000, 0.1, 0.1), click(5000, 0.9, 0.9)],
		});
		expect(out.map((s) => s.span)).toEqual([
			{ start: 4000 - CLICK_LEAD_IN_MS, end: 4500 },
			{ start: 4500, end: 5000 + CLICK_HOLD_MS },
		]);
	});

	it("shrinks a click zoom to fit around an existing region", () => {
		const [s] = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: [],
			existingRegions: [{ startMs: 3000, endMs: 4800 }],
			clicks: [click(5000, 0.5, 0.5), click(6000, 0.5, 0.5)],
		});
		expect(s.span).toEqual({ start: 4800, end: 6000 + CLICK_HOLD_MS });
	});

	it("drops a click zoom whose clicks all sit inside an existing region", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: [],
			existingRegions: [{ startMs: 4000, endMs: 9000 }],
			clicks: [click(5000, 0.5, 0.5)],
		});
		expect(out).toEqual([]);
	});

	it("drops a click zoom squeezed below the minimum length", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: [],
			existingRegions: [
				{ startMs: 0, endMs: 4900 },
				{ startMs: 5300, endMs: 9000 },
			],
			clicks: [click(5000, 0.5, 0.5)],
		});
		expect(out).toEqual([]);
	});
});

describe("buildAutoZoomSuggestions: dwell and combination", () => {
	const dwellTelemetry = [
		...moving(0, 10_000),
		...resting(10_000, 11_500, 0.2, 0.8),
		...moving(11_533, 20_000),
	];

	it("keeps dwell zooms as before (centred, default depth, focus mode left to the editor)", () => {
		const [s] = buildAutoZoomSuggestions({ ...base, cursorTelemetry: dwellTelemetry });
		expect(s.reason.kind).toBe("dwell");
		expect(s.span.end - s.span.start).toBe(1500);
		expect(Math.abs((s.span.start + s.span.end) / 2 - 10_750)).toBeLessThan(40);
		expect(s.focus.cx).toBeCloseTo(0.2, 9);
		expect(s.focus.cy).toBeCloseTo(0.8, 9);
		expect(s.depth).toBe(3);
		expect(s.followCursor).toBe(false);
	});

	it("combines click and dwell zooms, sorted by time", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: dwellTelemetry,
			clicks: [click(3000, 0.4, 0.4)],
		});
		expect(out.map((s) => s.reason.kind)).toEqual(["clicks", "dwell"]);
	});

	it("drops a dwell that overlaps or crowds a click zoom", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: dwellTelemetry,
			clicks: [click(8000, 0.4, 0.4)],
		});
		// The click zoom ends at 9500; the dwell zoom would start ~10000, inside DWELL_CLICK_CLEARANCE_MS.
		expect(out.map((s) => s.reason.kind)).toEqual(["clicks"]);
	});

	it("keeps dwell zooms SUGGESTION_SPACING_MS apart", () => {
		const telemetry = [
			...moving(0, 5000),
			...resting(5000, 5600, 0.2, 0.2),
			...moving(5633, 6000),
			...resting(6000, 7000, 0.8, 0.8),
			...moving(7033, 12_000),
		];
		const out = buildAutoZoomSuggestions({
			...base,
			defaultDurationMs: 500,
			cursorTelemetry: telemetry,
		});
		expect(out).toHaveLength(1);
		// The longer dwell wins.
		expect(out[0].focus.cx).toBeCloseTo(0.8, 9);
	});

	it("honours sources filters", () => {
		const opts = { ...base, cursorTelemetry: dwellTelemetry, clicks: [click(3000, 0.4, 0.4)] };
		expect(
			buildAutoZoomSuggestions({ ...opts, sources: "clicks" }).map((s) => s.reason.kind),
		).toEqual(["clicks"]);
		expect(
			buildAutoZoomSuggestions({ ...opts, sources: "dwell" }).map((s) => s.reason.kind),
		).toEqual(["dwell"]);
	});

	it("never overlaps existing regions or other suggestions", () => {
		const out = buildAutoZoomSuggestions({
			...base,
			cursorTelemetry: dwellTelemetry,
			existingRegions: [{ startMs: 1000, endMs: 2000 }],
			clicks: [
				click(2500, 0.1, 0.1),
				click(3000, 0.9, 0.1),
				click(3400, 0.9, 0.12),
				click(15_000, 0.5, 0.5),
			],
		});
		const spans = [{ start: 1000, end: 2000 }, ...out.map((s) => s.span)].sort(
			(a, b) => a.start - b.start,
		);
		for (let i = 1; i < spans.length; i += 1)
			expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
	});

	it("returns nothing for an empty video", () => {
		expect(
			buildAutoZoomSuggestions({ ...base, totalMs: 0, cursorTelemetry: dwellTelemetry }),
		).toEqual([]);
	});
});
