import type { CursorTelemetryPoint, ZoomDepth, ZoomFocus } from "../types";

export const MIN_DWELL_DURATION_MS = 450;
export const MAX_DWELL_DURATION_MS = 2600;
export const DWELL_MOVE_THRESHOLD = 0.02;
/** Minimum spacing between two accepted suggestion centres. */
export const SUGGESTION_SPACING_MS = 1800;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
	};
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	return [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) && Number.isFinite(sample.cx) && Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));
}

export function detectZoomDwellCandidates(samples: CursorTelemetryPoint[]): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < MIN_DWELL_DURATION_MS || runDuration > MAX_DWELL_DURATION_MS) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const avgCx = runSamples.reduce((sum, sample) => sum + sample.cx, 0) / runSamples.length;
		const avgCy = runSamples.reduce((sum, sample) => sum + sample.cy, 0) / runSamples.length;

		dwellCandidates.push({
			centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2),
			focus: { cx: avgCx, cy: avgCy },
			strength: runDuration,
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);

		if (distance > DWELL_MOVE_THRESHOLD) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	return dwellCandidates;
}

// ---------------------------------------------------------------- clicks

/** Clicks closer than this to the previous click (in time) can join its cluster. */
export const CLICK_CLUSTER_GAP_MS = 2500;
/** ...and only if they land within this normalised distance of the cluster centroid. */
export const CLICK_CLUSTER_RADIUS = 0.25;
/** The zoom region starts this long before the first click (the renderer reaches full zoom ~500 ms after region start). */
export const CLICK_LEAD_IN_MS = 600;
/** The zoom region holds this long after the last click before zooming out. */
export const CLICK_HOLD_MS = 1500;
/** Clicks closer than this are one physical click reported twice. */
export const CLICK_DEDUPE_MS = 50;
/** A click zoom squeezed by an existing region below this length is dropped. */
export const MIN_AUTO_ZOOM_MS = 1000;
/** Dwell zooms keep at least this gap from click zooms. */
export const DWELL_CLICK_CLEARANCE_MS = 1000;

export interface ZoomClickEvent {
	timeMs: number;
	cx: number;
	cy: number;
}

type InteractionSample =
	| CursorTelemetryPoint
	| { timeMs: number; cx: number; cy: number; interactionType?: string | null };

function isClickInteraction(type: string | null | undefined): boolean {
	return (
		type === "click" || type === "double-click" || type === "right-click" || type === "middle-click"
	);
}

/** Click events (time + position) from samples carrying `interactionType`, deduped and sorted. */
export function extractClickEvents(samples: readonly InteractionSample[]): ZoomClickEvent[] {
	const clicks = samples
		.filter(
			(s) =>
				isClickInteraction((s as { interactionType?: string | null }).interactionType) &&
				Number.isFinite(s.timeMs) &&
				Number.isFinite(s.cx) &&
				Number.isFinite(s.cy),
		)
		.map((s) => ({ timeMs: s.timeMs, cx: s.cx, cy: s.cy }))
		.sort((a, b) => a.timeMs - b.timeMs);
	const out: ZoomClickEvent[] = [];
	for (const click of clicks) {
		const prev = out[out.length - 1];
		if (prev && click.timeMs - prev.timeMs < CLICK_DEDUPE_MS) continue;
		out.push(click);
	}
	return out;
}

export interface ClickCluster {
	clicks: ZoomClickEvent[];
	firstMs: number;
	lastMs: number;
	centroid: ZoomFocus;
	/** Largest distance of a click from the centroid (normalised units). */
	spread: number;
}

function centroidOf(clicks: ZoomClickEvent[]): ZoomFocus {
	return {
		cx: clicks.reduce((sum, c) => sum + c.cx, 0) / clicks.length,
		cy: clicks.reduce((sum, c) => sum + c.cy, 0) / clicks.length,
	};
}

function toCluster(clicks: ZoomClickEvent[]): ClickCluster {
	const centroid = centroidOf(clicks);
	return {
		clicks,
		firstMs: clicks[0].timeMs,
		lastMs: clicks[clicks.length - 1].timeMs,
		centroid,
		spread: Math.max(...clicks.map((c) => Math.hypot(c.cx - centroid.cx, c.cy - centroid.cy))),
	};
}

/**
 * Groups sorted clicks: a click joins the running cluster when it comes within
 * CLICK_CLUSTER_GAP_MS of the previous click and lands within CLICK_CLUSTER_RADIUS of
 * the cluster's centroid; otherwise it starts a new cluster.
 */
export function clusterClicks(clicks: readonly ZoomClickEvent[]): ClickCluster[] {
	const clusters: ClickCluster[] = [];
	let current: ZoomClickEvent[] = [];
	for (const click of clicks) {
		if (current.length > 0) {
			const prev = current[current.length - 1];
			const centroid = centroidOf(current);
			const near =
				Math.hypot(click.cx - centroid.cx, click.cy - centroid.cy) <= CLICK_CLUSTER_RADIUS;
			if (click.timeMs - prev.timeMs <= CLICK_CLUSTER_GAP_MS && near) {
				current.push(click);
				continue;
			}
			clusters.push(toCluster(current));
		}
		current = [click];
	}
	if (current.length > 0) clusters.push(toCluster(current));
	return clusters;
}

/** Tighter clusters zoom deeper: a single spot gets 2.2x, a wide one 1.5x. */
export function depthForClickSpread(spread: number): ZoomDepth {
	if (spread <= 0.06) return 4;
	if (spread <= 0.15) return 3;
	return 2;
}

// ---------------------------------------------------------------- combined

export type AutoZoomReason =
	| { kind: "clicks"; clickCount: number }
	| { kind: "dwell"; dwellMs: number };

export interface AutoZoomSuggestion {
	span: { start: number; end: number };
	focus: ZoomFocus;
	depth: ZoomDepth;
	/** True when the zoom should follow the cursor (focusMode "auto"). */
	followCursor: boolean;
	reason: AutoZoomReason;
}

export type AutoZoomSources = "all" | "clicks" | "dwell";

interface Span {
	start: number;
	end: number;
}

function overlaps(a: Span, b: Span, gap = 0): boolean {
	return a.end + gap > b.start && a.start < b.end + gap;
}

/**
 * Shrinks `span` to the free gap between reserved spans that contains `anchorMs`.
 * Returns null when the anchor itself is reserved.
 */
function fitAround(span: Span, anchorMs: number, reserved: readonly Span[]): Span | null {
	let start = span.start;
	let end = span.end;
	for (const r of reserved) {
		if (anchorMs >= r.start && anchorMs < r.end) return null;
		if (r.end <= anchorMs) start = Math.max(start, r.end);
		else end = Math.min(end, r.start);
	}
	return end > start ? { start, end } : null;
}

function buildClickSuggestions(
	clicks: readonly ZoomClickEvent[],
	totalMs: number,
	reserved: readonly Span[],
): AutoZoomSuggestion[] {
	const inRange = clicks.filter((c) => c.timeMs >= 0 && c.timeMs <= totalMs);
	const clusters = clusterClicks(inRange);
	const spans: Span[] = clusters.map((c) => ({
		start: Math.max(0, Math.round(c.firstMs - CLICK_LEAD_IN_MS)),
		end: Math.min(totalMs, Math.round(c.lastMs + CLICK_HOLD_MS)),
	}));
	// Neighbouring clusters whose padded spans overlap meet halfway between the last
	// click of one and the first of the next, so the renderer pans between them.
	for (let i = 0; i < spans.length - 1; i += 1) {
		if (spans[i].end > spans[i + 1].start) {
			const boundary = Math.round((clusters[i].lastMs + clusters[i + 1].firstMs) / 2);
			spans[i].end = boundary;
			spans[i + 1].start = boundary;
		}
	}

	const suggestions: AutoZoomSuggestion[] = [];
	clusters.forEach((cluster, i) => {
		// Anchor on whichever click leaves the longest free stretch.
		let fitted: Span | null = null;
		for (const click of cluster.clicks) {
			const candidate = fitAround(spans[i], click.timeMs, reserved);
			if (candidate && (!fitted || candidate.end - candidate.start > fitted.end - fitted.start)) {
				fitted = candidate;
			}
		}
		if (!fitted || fitted.end - fitted.start < MIN_AUTO_ZOOM_MS) return;
		suggestions.push({
			span: fitted,
			focus: cluster.centroid,
			depth: depthForClickSpread(cluster.spread),
			followCursor: true,
			reason: { kind: "clicks", clickCount: cluster.clicks.length },
		});
	});
	return suggestions;
}

function buildDwellSuggestions(
	samples: CursorTelemetryPoint[],
	totalMs: number,
	defaultDuration: number,
	reserved: Span[],
	clickSpans: readonly Span[],
): AutoZoomSuggestion[] {
	const dwellCandidates = detectZoomDwellCandidates(samples);
	const sortedCandidates = [...dwellCandidates].sort((a, b) => b.strength - a.strength);
	const acceptedCenters: number[] = [];
	const suggestions: AutoZoomSuggestion[] = [];

	for (const candidate of sortedCandidates) {
		const tooCloseToAccepted = acceptedCenters.some(
			(center) => Math.abs(center - candidate.centerTimeMs) < SUGGESTION_SPACING_MS,
		);
		if (tooCloseToAccepted) continue;

		const centeredStart = Math.round(candidate.centerTimeMs - defaultDuration / 2);
		const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - defaultDuration));
		const span = { start: candidateStart, end: candidateStart + defaultDuration };
		if (reserved.some((r) => overlaps(span, r))) continue;
		if (clickSpans.some((c) => overlaps(span, c, DWELL_CLICK_CLEARANCE_MS))) continue;

		reserved.push(span);
		acceptedCenters.push(candidate.centerTimeMs);
		suggestions.push({
			span,
			focus: candidate.focus,
			depth: 3,
			followCursor: false,
			reason: { kind: "dwell", dwellMs: Math.round(candidate.strength) },
		});
	}
	return suggestions;
}

/**
 * Builds non-overlapping zoom suggestions, Screen Studio style:
 * - click clusters (see clusterClicks) zoom from CLICK_LEAD_IN_MS before the first click
 *   to CLICK_HOLD_MS after the last, focused on the click centroid and following the
 *   cursor, deeper for tighter clusters;
 * - cursor dwells (detectZoomDwellCandidates) fill the remaining quiet stretches with a
 *   `defaultDurationMs` zoom, ranked by duration, SUGGESTION_SPACING_MS apart and at
 *   least DWELL_CLICK_CLEARANCE_MS away from click zooms.
 * Existing regions are never overlapped: click zooms shrink into the free gap, dwell
 * zooms are dropped. Pure; shared by the editor's wand and the `chameleon autozoom` CLI.
 */
export function buildAutoZoomSuggestions(options: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	existingRegions: { startMs: number; endMs: number }[];
	defaultDurationMs: number;
	/** Click events; defaults to clicks found in `cursorTelemetry` via `interactionType`. */
	clicks?: readonly ZoomClickEvent[];
	sources?: AutoZoomSources;
}): AutoZoomSuggestion[] {
	const { cursorTelemetry, totalMs, existingRegions, defaultDurationMs } = options;
	const sources = options.sources ?? "all";
	if (totalMs <= 0) return [];

	const reserved: Span[] = existingRegions
		.map((region) => ({ start: region.startMs, end: region.endMs }))
		.sort((a, b) => a.start - b.start);

	const clickSuggestions =
		sources === "dwell"
			? []
			: buildClickSuggestions(
					options.clicks ?? extractClickEvents(cursorTelemetry),
					totalMs,
					reserved,
				);
	const clickSpans = clickSuggestions.map((s) => s.span);

	let dwellSuggestions: AutoZoomSuggestion[] = [];
	const defaultDuration = Math.min(defaultDurationMs, totalMs);
	if (sources !== "clicks" && defaultDuration > 0 && cursorTelemetry.length >= 2) {
		const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
		if (normalizedSamples.length >= 2) {
			dwellSuggestions = buildDwellSuggestions(
				normalizedSamples,
				totalMs,
				defaultDuration,
				[...reserved, ...clickSpans],
				clickSpans,
			);
		}
	}

	return [...clickSuggestions, ...dwellSuggestions].sort((a, b) => a.span.start - b.span.start);
}
