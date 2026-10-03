import { deriveNextId } from "@/components/video-editor/projectPersistence";
import {
	clampPlaybackSpeed,
	MAX_PLAYBACK_SPEED,
	MIN_PLAYBACK_SPEED,
	type SpeedRegion,
	type TrimRegion,
} from "@/components/video-editor/types";
import { CliError } from "./errors";

/**
 * All region times in a project are SOURCE video ms: the exporter decodes the
 * source, drops trimmed spans and renders each frame at its source timestamp
 * (`streamingDecoder.decodeAll` → `frameRenderer.renderFrame(frame, sourceTimestampUs)`).
 * The edited output timeline is the kept source spans played back-to-back, each
 * at its speed. These helpers mirror `StreamingVideoDecoder.computeSegments`
 * and `splitBySpeed` so CLI durations match the exporter.
 */
export interface PlaybackSegment {
	srcStartMs: number;
	srcEndMs: number;
	speed: number;
	tlStartMs: number;
	tlEndMs: number;
}

export function computePlaybackSegments(
	durationMs: number,
	trimRegions: TrimRegion[] = [],
	speedRegions: SpeedRegion[] = [],
): PlaybackSegment[] {
	const kept: Array<{ startMs: number; endMs: number }> = [];
	const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
	let cursor = 0;
	for (const trim of sortedTrims) {
		if (cursor < trim.startMs)
			kept.push({ startMs: cursor, endMs: Math.min(trim.startMs, durationMs) });
		cursor = Math.max(cursor, trim.endMs);
	}
	if (cursor < durationMs) kept.push({ startMs: cursor, endMs: durationMs });

	const split: Array<{ startMs: number; endMs: number; speed: number }> = [];
	for (const seg of kept) {
		const overlapping = speedRegions
			.filter((sr) => sr.startMs < seg.endMs && sr.endMs > seg.startMs)
			.sort((a, b) => a.startMs - b.startMs);
		let c = seg.startMs;
		for (const sr of overlapping) {
			const s = Math.max(sr.startMs, seg.startMs, c);
			const e = Math.min(sr.endMs, seg.endMs);
			if (e <= s) continue;
			if (c < s) split.push({ startMs: c, endMs: s, speed: 1 });
			split.push({ startMs: s, endMs: e, speed: sr.speed });
			c = e;
		}
		if (c < seg.endMs) split.push({ startMs: c, endMs: seg.endMs, speed: 1 });
	}

	let tl = 0;
	return split
		.filter((s) => s.endMs - s.startMs > 0.1)
		.map((s) => {
			const len = (s.endMs - s.startMs) / s.speed;
			const out = {
				srcStartMs: s.startMs,
				srcEndMs: s.endMs,
				speed: s.speed,
				tlStartMs: tl,
				tlEndMs: tl + len,
			};
			tl += len;
			return out;
		});
}

export function editedDurationMs(segments: PlaybackSegment[]): number {
	return segments.length ? segments[segments.length - 1].tlEndMs : 0;
}

/**
 * Maps a source time to the edited timeline. A time inside a trimmed span maps
 * to the cut point and reports `trimmed: true`.
 */
export function sourceToTimeline(
	segments: PlaybackSegment[],
	sourceMs: number,
): { timelineMs: number; trimmed: boolean } {
	for (const seg of segments) {
		if (sourceMs < seg.srcStartMs) return { timelineMs: seg.tlStartMs, trimmed: true };
		if (sourceMs <= seg.srcEndMs) {
			return {
				timelineMs: seg.tlStartMs + (sourceMs - seg.srcStartMs) / seg.speed,
				trimmed: false,
			};
		}
	}
	return { timelineMs: editedDurationMs(segments), trimmed: true };
}

/**
 * Maps an edited-timeline time back to source time. At a cut, `bias: "start"`
 * returns the source time after the cut and `"end"` the time before it, so a
 * range given on the timeline never silently swallows a trimmed span at its edges.
 */
export function timelineToSource(
	segments: PlaybackSegment[],
	timelineMs: number,
	bias: "start" | "end" = "start",
): number {
	if (segments.length === 0) throw new CliError("the edited timeline is empty");
	const total = editedDurationMs(segments);
	if (timelineMs > total + 0.5) {
		throw new CliError(
			`timeline time ${(timelineMs / 1000).toFixed(3)}s is past the edited duration ${(total / 1000).toFixed(3)}s`,
		);
	}
	const t = Math.min(timelineMs, total);
	const ordered = bias === "start" ? segments : [...segments].reverse();
	for (const seg of ordered) {
		if (t >= seg.tlStartMs && t <= seg.tlEndMs) {
			if (bias === "start" && t === seg.tlEndMs && seg !== segments[segments.length - 1]) continue;
			if (bias === "end" && t === seg.tlStartMs && seg !== segments[0]) continue;
			return seg.srcStartMs + (t - seg.tlStartMs) * seg.speed;
		}
	}
	return segments[segments.length - 1].srcEndMs;
}

export function nextRegionId(prefix: string, ids: string[]): string {
	return `${prefix}-${deriveNextId(prefix, ids)}`;
}

/**
 * Adds a trim and merges it with any trims it overlaps or touches (the app's
 * timeline forbids overlapping trims and the exporter assumes none). The merged
 * region keeps the earliest existing id.
 */
export function addTrimRegion(
	trims: TrimRegion[],
	startMs: number,
	endMs: number,
): { trimRegions: TrimRegion[]; region: TrimRegion; mergedIds: string[] } {
	assertRange(startMs, endMs);
	const touching = trims.filter((t) => t.startMs <= endMs && t.endMs >= startMs);
	const rest = trims.filter((t) => !touching.includes(t));
	const start = Math.min(startMs, ...touching.map((t) => t.startMs));
	const end = Math.max(endMs, ...touching.map((t) => t.endMs));
	const earliest = [...touching].sort((a, b) => a.startMs - b.startMs)[0];
	const region: TrimRegion = {
		...(earliest ?? {}),
		id:
			earliest?.id ??
			nextRegionId(
				"trim",
				trims.map((t) => t.id),
			),
		startMs: Math.round(start),
		endMs: Math.round(end),
	};
	const trimRegions = [...rest, region].sort((a, b) => a.startMs - b.startMs);
	return { trimRegions, region, mergedIds: touching.map((t) => t.id) };
}

/**
 * Sets the speed of a span. Existing speed regions are clipped (or split) so
 * regions never overlap, matching the app's timeline rule.
 */
export function applySpeedRegion(
	speeds: SpeedRegion[],
	startMs: number,
	endMs: number,
	factor: number,
): { speedRegions: SpeedRegion[]; region: SpeedRegion; changedIds: string[] } {
	assertRange(startMs, endMs);
	if (!Number.isFinite(factor) || factor < MIN_PLAYBACK_SPEED || factor > MAX_PLAYBACK_SPEED) {
		throw new CliError(`speed must be between ${MIN_PLAYBACK_SPEED} and ${MAX_PLAYBACK_SPEED}`);
	}
	const s = Math.round(startMs);
	const e = Math.round(endMs);
	const ids = speeds.map((r) => r.id);
	const out: SpeedRegion[] = [];
	const changedIds: string[] = [];
	for (const r of speeds) {
		if (r.endMs <= s || r.startMs >= e) {
			out.push(r);
			continue;
		}
		changedIds.push(r.id);
		if (r.startMs < s) out.push({ ...r, endMs: s });
		if (r.endMs > e) {
			const id = r.startMs < s ? nextRegionId("speed", ids) : r.id;
			ids.push(id);
			out.push({ ...r, id, startMs: e });
		}
	}
	const region: SpeedRegion = {
		id: nextRegionId("speed", ids),
		startMs: s,
		endMs: e,
		speed: clampPlaybackSpeed(factor),
	};
	out.push(region);
	out.sort((a, b) => a.startMs - b.startMs);
	return { speedRegions: out, region, changedIds };
}

export function assertRange(startMs: number, endMs: number): void {
	if (!(endMs > startMs)) {
		throw new CliError(
			`end (${(endMs / 1000).toFixed(3)}s) must be after start (${(startMs / 1000).toFixed(3)}s)`,
		);
	}
}
