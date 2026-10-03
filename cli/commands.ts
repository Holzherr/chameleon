import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_CURSOR } from "@/components/video-editor/editorDefaults";
import {
	deriveNextId,
	normalizeProjectCursor,
	normalizeProjectEditor,
	type ProjectEditorState,
} from "@/components/video-editor/projectPersistence";
import {
	type AutoZoomSources,
	type AutoZoomSuggestion,
	buildAutoZoomSuggestions,
	extractClickEvents,
} from "@/components/video-editor/timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AnnotationTextStyle,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_ZOOM_DEPTH,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomRegion,
} from "@/components/video-editor/types";
import { normalizeTextAnimation } from "@/lib/annotationTextAnimation";
import {
	BACKGROUNDS,
	backgroundIdOf,
	IMAGE_BACKGROUNDS,
	resolveBackgroundId,
} from "@/lib/backgrounds";
import { captionSegmentsToAnnotationRegions } from "@/lib/captioning/annotationsFromCaptions";
import { parseCssBackgroundLayers } from "@/lib/exporter/gradientParser";
import { getStylePreset, STYLE_PRESETS, stylePresetFields } from "@/lib/stylePresets";
import { classifyWallpaper } from "@/lib/wallpaper";
import { parseCursorRecordingFile } from "@/native/cursorRecordingFile";
import { launchApp } from "./app";
import { flagBool, flagNumber, flagString, type ParsedArgs } from "./args";
import { CliError } from "./errors";
import {
	assertFile,
	DEFAULT_SILENCE_PARAMS,
	loadOrCreateTranscript,
	probeDurationMs,
	type SilenceParams,
	type TranscriptFile,
	writeFileAtomic,
} from "./media";
import {
	createNewProjectData,
	defaultProjectPath,
	type LoadedProject,
	loadProject,
	PROJECT_EXTENSION,
	REGION_KEYS,
	regionsOf,
	SETTABLE_KEYS,
	saveProject,
	transcriptCachePath,
} from "./project";
import { formatRange, formatTime, parseTime } from "./time";
import {
	addTrimRegion,
	applySpeedRegion,
	assertRange,
	computePlaybackSegments,
	editedDurationMs,
	nextRegionId,
	type PlaybackSegment,
	sourceToTimeline,
	timelineToSource,
} from "./timeline";
import { findPhrase, selectMatches, snapRange } from "./transcript";

export interface CommandOutput {
	json: Record<string, unknown>;
	human: string;
}

const log = (msg: string) => process.stderr.write(`${msg}\n`);

function need(args: ParsedArgs, index: number, what: string): string {
	const v = args.positionals[index];
	if (v === undefined) throw new CliError(`missing <${what}>`);
	return v;
}

interface ProjectContext {
	project: LoadedProject;
	sourceDurationMs: number;
	segments: PlaybackSegment[];
}

async function openProject(projectPath: string): Promise<ProjectContext> {
	const project = await loadProject(projectPath);
	const sourceDurationMs = await probeDurationMs(project.media.screenVideoPath);
	const { trimRegions, speedRegions } = regionsOf(project);
	return {
		project,
		sourceDurationMs,
		segments: computePlaybackSegments(sourceDurationMs, trimRegions, speedRegions),
	};
}

function refreshSegments(ctx: ProjectContext): void {
	const { trimRegions, speedRegions } = regionsOf(ctx.project);
	ctx.segments = computePlaybackSegments(ctx.sourceDurationMs, trimRegions, speedRegions);
}

/** Reads <start> <end> as source time, or edited-timeline time with --timeline. */
function readRange(
	ctx: ProjectContext,
	args: ParsedArgs,
	i: number,
): { startMs: number; endMs: number } {
	const a = parseTime(need(args, i, "start"));
	const b = parseTime(need(args, i + 1, "end"));
	let startMs = a;
	let endMs = b;
	if (flagBool(args, "timeline")) {
		assertRange(a, b);
		startMs = timelineToSource(ctx.segments, a, "start");
		endMs = timelineToSource(ctx.segments, b, "end");
	}
	assertRange(startMs, endMs);
	if (startMs >= ctx.sourceDurationMs) {
		throw new CliError(
			`start ${formatTime(startMs)} is past the source duration ${formatTime(ctx.sourceDurationMs)}`,
		);
	}
	return { startMs: Math.round(startMs), endMs: Math.round(Math.min(endMs, ctx.sourceDurationMs)) };
}

function timelineSpan(ctx: ProjectContext, startMs: number, endMs: number) {
	const s = sourceToTimeline(ctx.segments, startMs);
	const e = sourceToTimeline(ctx.segments, endMs);
	return { timelineStartMs: Math.round(s.timelineMs), timelineEndMs: Math.round(e.timelineMs) };
}

function durations(ctx: ProjectContext) {
	return {
		sourceDurationMs: ctx.sourceDurationMs,
		editedDurationMs: Math.round(editedDurationMs(ctx.segments)),
	};
}

function durationLine(ctx: ProjectContext): string {
	return `edited duration ${formatTime(editedDurationMs(ctx.segments))} (source ${formatTime(ctx.sourceDurationMs)})`;
}

function silenceParams(args: ParsedArgs): SilenceParams {
	const noise = flagNumber(args, "noise");
	const min = flagString(args, "min-silence");
	return {
		noiseDb: noise ?? DEFAULT_SILENCE_PARAMS.noiseDb,
		minSilenceMs: min !== undefined ? parseTime(min) : DEFAULT_SILENCE_PARAMS.minSilenceMs,
	};
}

async function projectTranscript(
	project: LoadedProject,
	args: ParsedArgs,
): Promise<TranscriptFile> {
	const { transcript } = await loadOrCreateTranscript(
		project.media.screenVideoPath,
		transcriptCachePath(project.path),
		{ silence: silenceParams(args), refresh: flagBool(args, "refresh"), log },
	);
	return transcript;
}

// ---------------------------------------------------------------- new

export async function cmdNew(args: ParsedArgs): Promise<CommandOutput> {
	const video = path.resolve(need(args, 0, "video"));
	const sourceDurationMs = await probeDurationMs(video);
	const webcamArg = flagString(args, "webcam");
	const webcam = webcamArg ? path.resolve(webcamArg) : undefined;
	if (webcam) await assertFile(webcam, "webcam video");
	const out = path.resolve(flagString(args, "out") ?? defaultProjectPath(video));
	if (!out.endsWith(PROJECT_EXTENSION))
		throw new CliError(`project path must end in ${PROJECT_EXTENSION}`);
	if (existsSync(out) && !flagBool(args, "force")) {
		throw new CliError(`project already exists: ${out} (pass --force to overwrite)`);
	}
	const media = { screenVideoPath: video, ...(webcam ? { webcamVideoPath: webcam } : {}) };
	const data = createNewProjectData(media);
	await writeFileAtomic(out, JSON.stringify(data, null, 2));

	const warnings: string[] = [];
	const projectDir = path.dirname(out);
	for (const p of [video, webcam].filter(Boolean) as string[]) {
		if (path.relative(projectDir, p).startsWith("..")) {
			warnings.push(
				`${p} is outside the project folder; the app only auto-approves media next to the project (or in its recordings folder)`,
			);
		}
	}
	return {
		json: { ok: true, project: out, media, sourceDurationMs, warnings },
		human: [
			`created ${out}`,
			`video ${video} (${formatTime(sourceDurationMs)})`,
			...warnings.map((w) => `warning: ${w}`),
		].join("\n"),
	};
}

// ---------------------------------------------------------------- show / list

type RegionKind = "trim" | "speed" | "zoom" | "annotation";

function describeRegions(ctx: ProjectContext) {
	const r = regionsOf(ctx.project);
	const span = (s: number, e: number) => timelineSpan(ctx, s, e);
	return {
		trims: r.trimRegions.map((t) => ({
			id: t.id,
			startMs: t.startMs,
			endMs: t.endMs,
			removedMs: t.endMs - t.startMs,
			cutAtTimelineMs: span(t.startMs, t.endMs).timelineStartMs,
		})),
		speeds: r.speedRegions.map((s) => ({
			id: s.id,
			startMs: s.startMs,
			endMs: s.endMs,
			speed: s.speed,
			...span(s.startMs, s.endMs),
		})),
		zooms: r.zoomRegions.map((z) => ({
			id: z.id,
			startMs: z.startMs,
			endMs: z.endMs,
			depth: z.depth,
			focus: z.focus,
			focusMode: z.focusMode ?? "manual",
			source: z.source ?? "manual",
			...span(z.startMs, z.endMs),
		})),
		annotations: r.annotationRegions.map((a) => ({
			id: a.id,
			startMs: a.startMs,
			endMs: a.endMs,
			type: a.type,
			text: a.type === "text" ? (a.textContent ?? a.content) : undefined,
			caption: a.annotationSource === "auto-caption" || undefined,
			position: a.position,
			size: a.size,
			...span(a.startMs, a.endMs),
		})),
	};
}

function humanRegionLines(
	regions: ReturnType<typeof describeRegions>,
	only?: RegionKind,
): string[] {
	const lines: string[] = [];
	const want = (k: RegionKind) => !only || only === k;
	if (want("trim"))
		for (const t of regions.trims)
			lines.push(`${t.id.padEnd(14)} cut   ${formatRange(t.startMs, t.endMs)}`);
	if (want("speed"))
		for (const s of regions.speeds)
			lines.push(`${s.id.padEnd(14)} speed ${formatRange(s.startMs, s.endMs)}  ${s.speed}x`);
	if (want("zoom"))
		for (const z of regions.zooms)
			lines.push(
				`${z.id.padEnd(14)} zoom  ${formatRange(z.startMs, z.endMs)}  depth ${z.depth} focus ${z.focusMode === "auto" ? "auto" : `${z.focus.cx},${z.focus.cy}`}`,
			);
	if (want("annotation"))
		for (const a of regions.annotations)
			lines.push(
				`${a.id.padEnd(14)} ${(a.caption ? "capt" : a.type).padEnd(5)} ${formatRange(a.startMs, a.endMs)}${a.text !== undefined ? `  "${a.text}"` : ""}`,
			);
	return lines;
}

function settingsOf(editor: ProjectEditorState): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(editor)) {
		if (!(REGION_KEYS as readonly string[]).includes(k)) out[k] = v;
	}
	return out;
}

export async function cmdShow(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const regions = describeRegions(ctx);
	const settings = settingsOf(ctx.project.data.editor);
	const backgroundId = backgroundIdOf(ctx.project.data.editor.wallpaper);
	const human = [
		ctx.project.path,
		`video ${ctx.project.media.screenVideoPath}${ctx.project.media.webcamVideoPath ? `\nwebcam ${ctx.project.media.webcamVideoPath}` : ""}`,
		durationLine(ctx),
		`regions: ${regions.trims.length} cut, ${regions.speeds.length} speed, ${regions.zooms.length} zoom, ${regions.annotations.length} annotation (times are source time)`,
		...humanRegionLines(regions).map((l) => `  ${l}`),
		`settings: ${Object.entries(settings)
			.map(([k, v]) => {
				if (k === "wallpaper" && backgroundId) return `wallpaper=${backgroundId}`;
				return `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`;
			})
			.join(" ")}`,
	].join("\n");
	return {
		json: {
			ok: true,
			project: ctx.project.path,
			media: ctx.project.media,
			...durations(ctx),
			timeDomain: "source",
			regions,
			settings,
			backgroundId,
			data: ctx.project.data,
		},
		human,
	};
}

const KIND_ALIASES: Record<string, RegionKind> = {
	trim: "trim",
	trims: "trim",
	cut: "trim",
	cuts: "trim",
	speed: "speed",
	speeds: "speed",
	zoom: "zoom",
	zooms: "zoom",
	annotation: "annotation",
	annotations: "annotation",
	text: "annotation",
	caption: "annotation",
	captions: "annotation",
};

export async function cmdList(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const typeArg = args.positionals[1];
	const kind = typeArg ? KIND_ALIASES[typeArg.toLowerCase()] : undefined;
	if (typeArg && !kind) {
		throw new CliError(
			`unknown region type "${typeArg}" (trim, speed, zoom, annotation, text, caption)`,
		);
	}
	const all = describeRegions(ctx);
	let annotations = all.annotations;
	if (typeArg === "caption" || typeArg === "captions")
		annotations = annotations.filter((a) => a.caption);
	if (typeArg === "text") annotations = annotations.filter((a) => a.type === "text" && !a.caption);
	const regions = { ...all, annotations };
	const picked =
		kind === undefined
			? regions
			: {
					trim: { trims: regions.trims },
					speed: { speeds: regions.speeds },
					zoom: { zooms: regions.zooms },
					annotation: { annotations },
				}[kind];
	const lines = humanRegionLines(regions, kind);
	return {
		json: { ok: true, project: ctx.project.path, timeDomain: "source", ...picked },
		human: lines.length ? lines.join("\n") : "no regions",
	};
}

// ---------------------------------------------------------------- transcript

export async function cmdTranscript(args: ParsedArgs): Promise<CommandOutput> {
	const target = path.resolve(need(args, 0, "project|video"));
	let video = target;
	let cache = transcriptCachePath(target);
	if (target.endsWith(PROJECT_EXTENSION)) {
		const project = await loadProject(target);
		video = project.media.screenVideoPath;
		cache = transcriptCachePath(project.path);
	}
	const { transcript, cached } = await loadOrCreateTranscript(video, cache, {
		silence: silenceParams(args),
		refresh: flagBool(args, "refresh"),
		log,
	});
	const human = [
		transcript.text,
		"",
		"words (source time):",
		...transcript.words.map(
			(w) => `  ${formatTime(w.startMs).padStart(9)} ${formatTime(w.endMs).padStart(9)}  ${w.text}`,
		),
		"silences:",
		...transcript.silences.map((s) => `  ${formatRange(s.startMs, s.endMs)}`),
	].join("\n");
	return {
		json: {
			ok: true,
			video,
			cachePath: cache,
			cached,
			model: transcript.model,
			timeDomain: "source",
			durationMs: transcript.durationMs,
			text: transcript.text,
			words: transcript.words,
			silences: transcript.silences,
			silenceParams: transcript.silenceParams,
		},
		human,
	};
}

// ---------------------------------------------------------------- cut

export async function cmdCut(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const phrase = flagString(args, "text");
	const snap = flagBool(args, "snap");
	const ranges: Array<{
		startMs: number;
		endMs: number;
		match?: { text: string; fuzzy: boolean };
	}> = [];
	let transcript: TranscriptFile | null = null;

	if (phrase !== undefined) {
		if (args.positionals.length > 1)
			throw new CliError("use either <start> <end> or --text, not both");
		transcript = await projectTranscript(ctx.project, args);
		const nth = flagNumber(args, "nth");
		const matches = selectMatches(findPhrase(transcript.words, phrase), phrase, {
			all: flagBool(args, "all"),
			nth,
		});
		for (const m of matches) {
			ranges.push({ startMs: m.startMs, endMs: m.endMs, match: { text: m.text, fuzzy: m.fuzzy } });
		}
	} else {
		ranges.push(readRange(ctx, args, 1));
		if (snap) transcript = await projectTranscript(ctx.project, args);
	}

	const cuts: Record<string, unknown>[] = [];
	const humanLines: string[] = [];
	for (const range of ranges) {
		let { startMs, endMs } = range;
		let snapped: { start: string | null; end: string | null } | undefined;
		if (snap && transcript) {
			const r = snapRange(startMs, endMs, transcript.silences, transcript.words);
			startMs = r.start.ms;
			endMs = r.end.ms;
			snapped = { start: r.start.snappedTo, end: r.end.snappedTo };
		}
		const before = regionsOf(ctx.project).trimRegions;
		const { trimRegions, region, mergedIds } = addTrimRegion(before, startMs, endMs);
		ctx.project.data.editor.trimRegions = trimRegions;
		cuts.push({
			id: region.id,
			startMs: region.startMs,
			endMs: region.endMs,
			requested: { startMs: range.startMs, endMs: range.endMs },
			...(snapped ? { snapped } : {}),
			...(range.match ? { match: range.match } : {}),
			mergedIds,
		});
		humanLines.push(
			`cut ${region.id} ${formatRange(region.startMs, region.endMs)}` +
				(range.match ? ` "${range.match.text}"${range.match.fuzzy ? " (filler match)" : ""}` : "") +
				(snapped ? ` snapped start→${snapped.start ?? "none"} end→${snapped.end ?? "none"}` : "") +
				(mergedIds.length ? ` (merged ${mergedIds.join(", ")})` : ""),
		);
	}
	await saveProject(ctx.project);
	refreshSegments(ctx);
	humanLines.push(durationLine(ctx));
	return {
		json: { ok: true, project: ctx.project.path, cuts, ...durations(ctx) },
		human: humanLines.join("\n"),
	};
}

// ---------------------------------------------------------------- speed

export async function cmdSpeed(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const { startMs, endMs } = readRange(ctx, args, 1);
	const factorText = need(args, 3, "factor").replace(/x$/i, "");
	const factor = Number(factorText);
	const { speedRegions, region, changedIds } = applySpeedRegion(
		regionsOf(ctx.project).speedRegions,
		startMs,
		endMs,
		factor,
	);
	ctx.project.data.editor.speedRegions = speedRegions;
	await saveProject(ctx.project);
	refreshSegments(ctx);
	return {
		json: { ok: true, project: ctx.project.path, region, changedIds, ...durations(ctx) },
		human: [
			`speed ${region.id} ${formatRange(region.startMs, region.endMs)} ${region.speed}x${changedIds.length ? ` (clipped ${changedIds.join(", ")})` : ""}`,
			durationLine(ctx),
		].join("\n"),
	};
}

// ---------------------------------------------------------------- zoom

function parseFocus(text: string): { cx: number; cy: number } {
	const parts = text.split(",").map((p) => Number(p.trim()));
	if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
		throw new CliError(`--focus must be x,y with each in 0–1 (or "auto"), got "${text}"`);
	}
	return { cx: parts[0], cy: parts[1] };
}

export async function cmdZoom(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const { startMs, endMs } = readRange(ctx, args, 1);
	const depthArg = flagNumber(args, "depth");
	const depth = (depthArg ?? DEFAULT_ZOOM_DEPTH) as ZoomDepth;
	if (![1, 2, 3, 4, 5, 6].includes(depth)) throw new CliError("--depth must be an integer 1–6");
	const focusArg = flagString(args, "focus");
	const autoFocus =
		focusArg === "auto" ||
		(focusArg === undefined && ctx.project.data.editor.autoFocusAll === true);
	const focus = focusArg && focusArg !== "auto" ? parseFocus(focusArg) : { cx: 0.5, cy: 0.5 };

	const zooms = regionsOf(ctx.project).zoomRegions;
	const overlapping = zooms.filter((z) => z.startMs < endMs && z.endMs > startMs);
	if (overlapping.length && !flagBool(args, "replace")) {
		throw new CliError(
			`zoom overlaps ${overlapping.map((z) => `${z.id} ${formatRange(z.startMs, z.endMs)}`).join(", ")}; zooms cannot overlap (pass --replace to remove them)`,
		);
	}
	// Same shape as VideoEditor.handleZoomAdded.
	const region: ZoomRegion = {
		id: nextRegionId(
			"zoom",
			zooms.map((z) => z.id),
		),
		startMs,
		endMs,
		depth,
		customScale: ZOOM_DEPTH_SCALES[depth],
		focus,
		focusMode: autoFocus ? "auto" : undefined,
		source: "manual",
	};
	ctx.project.data.editor.zoomRegions = [
		...zooms.filter((z) => !overlapping.includes(z)),
		region,
	].sort((a, b) => a.startMs - b.startMs);
	await saveProject(ctx.project);
	return {
		json: {
			ok: true,
			project: ctx.project.path,
			region: JSON.parse(JSON.stringify(region)),
			removedIds: overlapping.map((z) => z.id),
			...timelineSpan(ctx, startMs, endMs),
		},
		human: `zoom ${region.id} ${formatRange(startMs, endMs)} depth ${depth} (${ZOOM_DEPTH_SCALES[depth]}x) focus ${autoFocus ? "auto" : `${focus.cx},${focus.cy}`}${overlapping.length ? ` (replaced ${overlapping.map((z) => z.id).join(", ")})` : ""}`,
	};
}

// ---------------------------------------------------------------- autozoom

/** Reads `<video>.cursor.json` the way the app's get-cursor-recording-data handler does. */
async function loadCursorRecording(videoPath: string) {
	const file = `${videoPath}.cursor.json`;
	let content: string;
	try {
		content = await fs.readFile(file, "utf-8");
	} catch {
		throw new CliError(
			`no cursor telemetry for this video (expected ${file}, written by the recorder)`,
		);
	}
	let data: ReturnType<typeof parseCursorRecordingFile>;
	try {
		data = parseCursorRecordingFile(content, process.platform);
	} catch {
		throw new CliError(`cursor telemetry is not valid JSON: ${file}`);
	}
	if (data.samples.length < 2) throw new CliError(`cursor telemetry has no samples: ${file}`);
	return { file, data };
}

function describeReason(s: AutoZoomSuggestion): string {
	return s.reason.kind === "clicks"
		? `click cluster, ${s.reason.clickCount} click${s.reason.clickCount === 1 ? "" : "s"}`
		: `cursor dwell ${formatTime(s.reason.dwellMs)}`;
}

export async function cmdAutozoom(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const clicksOnly = flagBool(args, "clicks-only");
	const dwellOnly = flagBool(args, "dwell-only");
	if (clicksOnly && dwellOnly)
		throw new CliError("pass at most one of --clicks-only, --dwell-only");
	const sources: AutoZoomSources = clicksOnly ? "clicks" : dwellOnly ? "dwell" : "all";

	const { file, data } = await loadCursorRecording(ctx.project.media.screenVideoPath);
	const telemetry = data.samples.map((s) => ({ timeMs: s.timeMs, cx: s.cx, cy: s.cy }));
	const clicks = extractClickEvents(data.samples);

	const zooms = regionsOf(ctx.project).zoomRegions;
	const replace = flagBool(args, "replace");
	// --replace is the wand's OFF→ON: drop untouched auto zooms, regenerate around the rest.
	const kept = replace ? zooms.filter((z) => z.source !== "auto") : zooms;
	const removedIds = zooms.filter((z) => !kept.includes(z)).map((z) => z.id);

	const totalMs = ctx.sourceDurationMs;
	const suggestions = buildAutoZoomSuggestions({
		cursorTelemetry: telemetry,
		clicks,
		totalMs,
		existingRegions: kept,
		// Same default as VideoEditor.buildAutoZoomRegions.
		defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
		sources,
	});

	const autoFocusAll = ctx.project.data.editor.autoFocusAll === true;
	const ids = zooms.map((z) => z.id);
	const added = suggestions.map((s) => {
		const id = nextRegionId("zoom", ids);
		ids.push(id);
		// Same shape as VideoEditor.buildAutoZoomRegions.
		const region: ZoomRegion = {
			id,
			startMs: Math.round(s.span.start),
			endMs: Math.round(s.span.end),
			depth: s.depth,
			customScale: ZOOM_DEPTH_SCALES[s.depth],
			focus: clampFocusToDepth(s.focus, s.depth),
			focusMode: autoFocusAll || s.followCursor ? "auto" : undefined,
			source: "auto",
		};
		return { region, suggestion: s };
	});

	ctx.project.data.editor.zoomRegions = [...kept, ...added.map((a) => a.region)].sort(
		(a, b) => a.startMs - b.startMs,
	);
	ctx.project.data.editor.autoZoomEnabled = true;
	await saveProject(ctx.project);

	const round3 = (n: number) => Math.round(n * 1000) / 1000;
	return {
		json: {
			ok: true,
			project: ctx.project.path,
			telemetry: file,
			clickCount: clicks.length,
			sources,
			added: added.map(({ region, suggestion }) => ({
				id: region.id,
				startMs: region.startMs,
				endMs: region.endMs,
				...timelineSpan(ctx, region.startMs, region.endMs),
				depth: region.depth,
				scale: ZOOM_DEPTH_SCALES[region.depth],
				focus: { cx: round3(region.focus.cx), cy: round3(region.focus.cy) },
				focusMode: region.focusMode ?? "manual",
				reason: suggestion.reason,
			})),
			removedIds,
		},
		human: [
			`added ${added.length} auto zoom(s) from ${clicks.length} click(s) + cursor dwell${removedIds.length ? `, removed ${removedIds.length} old auto zoom(s)` : ""}`,
			...added.map(
				({ region, suggestion }) =>
					`  ${region.id.padEnd(10)} ${formatRange(region.startMs, region.endMs)}  ${ZOOM_DEPTH_SCALES[region.depth]}x at ${round3(region.focus.cx)},${round3(region.focus.cy)}${region.focusMode === "auto" ? " (follows cursor)" : ""}  ${describeReason(suggestion)}`,
			),
		].join("\n"),
	};
}

// ---------------------------------------------------------------- text / caption

function nextAnnotationIds(annotations: AnnotationRegion[]) {
	return {
		numericId: deriveNextId(
			"annotation",
			annotations.map((a) => a.id),
		),
		zIndex: annotations.reduce((max, a) => Math.max(max, a.zIndex ?? 0), 0) + 1,
	};
}

function pct(args: ParsedArgs, name: string, fallback: number, min: number, max: number): number {
	const v = flagNumber(args, name);
	if (v === undefined) return fallback;
	if (v < min || v > max) throw new CliError(`--${name} must be between ${min} and ${max}`);
	return v;
}

function oneOf<T extends string>(
	args: ParsedArgs,
	name: string,
	allowed: readonly T[],
	fallback: T,
): T {
	const v = flagString(args, name);
	if (v === undefined) return fallback;
	if (!allowed.includes(v as T))
		throw new CliError(`--${name} must be one of ${allowed.join(", ")}`);
	return v as T;
}

export async function cmdText(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const { startMs, endMs } = readRange(ctx, args, 1);
	const text = need(args, 3, "text");
	const annotations = regionsOf(ctx.project).annotationRegions;
	const { numericId, zIndex } = nextAnnotationIds(annotations);

	const animationArg = flagString(args, "animation");
	if (animationArg !== undefined && normalizeTextAnimation(animationArg) !== animationArg) {
		throw new CliError(
			"--animation must be one of none, fade, rise, pop, slide-left, typewriter, pulse",
		);
	}
	const fontSize = flagNumber(args, "size");
	if (fontSize !== undefined && !(fontSize > 0)) throw new CliError("--size must be > 0");
	const style: AnnotationTextStyle = {
		...DEFAULT_ANNOTATION_STYLE,
		...(fontSize !== undefined ? { fontSize } : {}),
		...(flagString(args, "color") ? { color: flagString(args, "color") as string } : {}),
		...(flagString(args, "bg") ? { backgroundColor: flagString(args, "bg") as string } : {}),
		...(flagString(args, "font") ? { fontFamily: flagString(args, "font") as string } : {}),
		fontWeight: oneOf(
			args,
			"weight",
			["normal", "bold"] as const,
			DEFAULT_ANNOTATION_STYLE.fontWeight,
		),
		textAlign: oneOf(
			args,
			"align",
			["left", "center", "right"] as const,
			DEFAULT_ANNOTATION_STYLE.textAlign,
		),
		...(animationArg !== undefined ? { textAnimation: normalizeTextAnimation(animationArg) } : {}),
	};
	// Same shape as VideoEditor.handleAnnotationAdded after the text is typed in.
	const region: AnnotationRegion = {
		id: `annotation-${numericId}`,
		startMs,
		endMs,
		type: "text",
		content: text,
		textContent: text,
		position: {
			x: pct(args, "x", DEFAULT_ANNOTATION_POSITION.x, 0, 100),
			y: pct(args, "y", DEFAULT_ANNOTATION_POSITION.y, 0, 100),
		},
		size: {
			width: pct(args, "width", DEFAULT_ANNOTATION_SIZE.width, 1, 200),
			height: pct(args, "height", DEFAULT_ANNOTATION_SIZE.height, 1, 200),
		},
		style,
		zIndex,
	};
	ctx.project.data.editor.annotationRegions = [...annotations, region];
	await saveProject(ctx.project);
	return {
		json: { ok: true, project: ctx.project.path, region, ...timelineSpan(ctx, startMs, endMs) },
		human: `text ${region.id} ${formatRange(startMs, endMs)} "${text}" at ${region.position.x},${region.position.y}%`,
	};
}

export async function cmdCaption(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const transcript = await projectTranscript(ctx.project, args);
	const minWords = flagNumber(args, "min-words") ?? 2;
	const maxWords = flagNumber(args, "max-words") ?? 7;
	if (!(minWords >= 1 && maxWords >= minWords))
		throw new CliError("need 1 <= --min-words <= --max-words");

	const { trimRegions, annotationRegions } = regionsOf(ctx.project);
	// Same rule as the app's transcription: words inside a cut get no caption.
	const segments = transcript.words
		.filter((w) => !trimRegions.some((t) => w.startMs < t.endMs && w.endMs > t.startMs))
		.map((w) => ({ startSec: w.startMs / 1000, endSec: w.endMs / 1000, text: w.text }));
	// Ids come from the full list first so a replaced caption's id is never reused.
	const { numericId, zIndex } = nextAnnotationIds(annotationRegions);
	const replace = flagBool(args, "replace");
	const kept = replace
		? annotationRegions.filter((a) => a.annotationSource !== "auto-caption")
		: annotationRegions;
	const removedIds = annotationRegions.filter((a) => !kept.includes(a)).map((a) => a.id);
	const { regions } = captionSegmentsToAnnotationRegions(segments, numericId, zIndex, {
		minWordsPerCaption: minWords,
		maxWordsPerCaption: maxWords,
		timestampGranularity: "word",
	});
	ctx.project.data.editor.annotationRegions = [...kept, ...regions];
	await saveProject(ctx.project);
	return {
		json: {
			ok: true,
			project: ctx.project.path,
			added: regions.map((r) => ({
				id: r.id,
				startMs: r.startMs,
				endMs: r.endMs,
				text: r.content,
			})),
			removedIds,
		},
		human: [
			`added ${regions.length} caption(s)${removedIds.length ? `, removed ${removedIds.length} old` : ""}`,
			...regions.map(
				(r) => `  ${r.id.padEnd(14)} ${formatRange(r.startMs, r.endMs)}  "${r.content}"`,
			),
		].join("\n"),
	};
}

// ---------------------------------------------------------------- remove / set

export async function cmdRemove(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const ids = args.positionals.slice(1);
	if (ids.length === 0) throw new CliError("missing <id>");
	const editor = ctx.project.data.editor as unknown as Record<string, Array<{ id: string }>>;
	const removed: string[] = [];
	for (const id of ids) {
		const key = REGION_KEYS.find(
			(k) => Array.isArray(editor[k]) && editor[k].some((r) => r.id === id),
		);
		if (!key) throw new CliError(`no region with id "${id}" (see: chameleon list <project>)`);
		editor[key] = editor[key].filter((r) => r.id !== id);
		removed.push(id);
	}
	await saveProject(ctx.project);
	refreshSegments(ctx);
	return {
		json: { ok: true, project: ctx.project.path, removed, ...durations(ctx) },
		human: `removed ${removed.join(", ")}\n${durationLine(ctx)}`,
	};
}

function parseValue(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

const COLOR_VALUE_RE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;

/** `wallpaper=` takes a background id, a CSS colour/gradient the exporter can draw, or an image path. */
export function resolveWallpaperArg(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new CliError("wallpaper must be a background id, colour, gradient or image path");
	}
	const fromId = resolveBackgroundId(value);
	if (fromId) return fromId;
	const classified = classifyWallpaper(value);
	if (classified.kind === "gradient") {
		if (!parseCssBackgroundLayers(classified.value)) {
			throw new CliError(
				`the exporter cannot draw this gradient (supported: linear-/radial-gradient layers): ${value}`,
			);
		}
		return value.trim();
	}
	if (classified.kind === "color" && !COLOR_VALUE_RE.test(classified.value)) {
		throw new CliError(
			`unknown background "${value}" (ids: ${BACKGROUNDS.map((b) => b.id).join(", ")}, wallpaper1-${IMAGE_BACKGROUNDS.length}; or #hex / rgb() / a gradient)`,
		);
	}
	return value.trim();
}

export async function cmdSet(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const pairs = args.positionals.slice(1);
	if (pairs.length === 0) {
		throw new CliError(`missing key=value (keys: ${SETTABLE_KEYS.join(", ")})`);
	}
	const editor = { ...ctx.project.data.editor } as unknown as Record<string, unknown>;
	const touched: string[] = [];
	for (const pair of pairs) {
		const eq = pair.indexOf("=");
		if (eq <= 0) throw new CliError(`expected key=value, got "${pair}"`);
		const keyPath = pair.slice(0, eq);
		const value = parseValue(pair.slice(eq + 1));
		const [key, sub, ...rest] = keyPath.split(".");
		if (rest.length) throw new CliError(`key path too deep: ${keyPath}`);
		if (!(SETTABLE_KEYS as string[]).includes(key)) {
			throw new CliError(`unknown setting "${key}" (keys: ${SETTABLE_KEYS.join(", ")})`);
		}
		if (key === "wallpaper") {
			editor[key] = resolveWallpaperArg(value);
			touched.push(key);
			continue;
		}
		if (key === "cursor" && sub === undefined && value && typeof value === "object") {
			editor.cursor = { ...normalizeProjectCursor(editor.cursor), ...(value as object) };
			touched.push(key);
			continue;
		}
		if (key === "cursor" && sub !== undefined) {
			if (!(sub in DEFAULT_PROJECT_CURSOR)) {
				throw new CliError(
					`cursor has no field ${sub} (fields: ${Object.keys(DEFAULT_PROJECT_CURSOR).join(", ")})`,
				);
			}
			editor.cursor = { ...normalizeProjectCursor(editor.cursor), [sub]: value };
			touched.push(key);
			continue;
		}
		if (sub !== undefined) {
			const current = editor[key];
			if (!current || typeof current !== "object") throw new CliError(`${key} has no field ${sub}`);
			if (!(sub in (current as object))) throw new CliError(`${key} has no field ${sub}`);
			editor[key] = { ...(current as object), [sub]: value };
		} else {
			editor[key] = value;
		}
		touched.push(key);
	}
	const normalized = normalizeProjectEditor(
		editor as Partial<ProjectEditorState>,
	) as unknown as Record<string, unknown>;
	for (const key of touched) {
		if (JSON.stringify(normalized[key]) !== JSON.stringify(editor[key])) {
			throw new CliError(
				`invalid value for ${key}: ${JSON.stringify(editor[key])} (the app would load it as ${JSON.stringify(normalized[key])})`,
			);
		}
	}
	ctx.project.data.editor = editor as unknown as ProjectEditorState;
	await saveProject(ctx.project);
	const changed = Object.fromEntries(touched.map((k) => [k, editor[k]]));
	return {
		json: { ok: true, project: ctx.project.path, changed },
		human: Object.entries(changed)
			.map(([k, v]) => {
				const id = k === "wallpaper" && typeof v === "string" ? backgroundIdOf(v) : null;
				return `${k} = ${id ?? JSON.stringify(v)}`;
			})
			.join("\n"),
	};
}

// ---------------------------------------------------------------- looks

export async function cmdBackgrounds(_args: ParsedArgs): Promise<CommandOutput> {
	const curated = BACKGROUNDS.map((b) => ({
		id: b.id,
		name: b.name,
		kind: "gradient" as const,
		tone: b.tone,
		value: b.value,
	}));
	const images = IMAGE_BACKGROUNDS.map((b) => ({
		id: b.id,
		name: b.name,
		kind: "image" as const,
		value: b.value,
	}));
	return {
		json: { ok: true, backgrounds: [...curated, ...images] },
		human: [
			...curated.map((b) => `${b.id.padEnd(12)} ${b.name} (${b.tone})`),
			`wallpaper1…wallpaper${images.length}  bundled images`,
			"",
			"use: chameleon set <project> wallpaper=<id>",
		].join("\n"),
	};
}

export async function cmdStyles(_args: ParsedArgs): Promise<CommandOutput> {
	return {
		json: { ok: true, presets: STYLE_PRESETS },
		human: [
			...STYLE_PRESETS.map(
				(p) =>
					`${p.id.padEnd(8)} ${p.description} (background ${p.background}, padding ${p.padding}, radius ${p.borderRadius}, shadow ${p.shadowIntensity}, motion blur ${p.motionBlurAmount})`,
			),
			"",
			"use: chameleon style <project> <preset>",
		].join("\n"),
	};
}

export async function cmdStyle(args: ParsedArgs): Promise<CommandOutput> {
	const project = await loadProject(need(args, 0, "project"));
	const id = need(args, 1, "preset");
	const preset = getStylePreset(id);
	if (!preset) {
		throw new CliError(
			`unknown style "${id}" (presets: ${STYLE_PRESETS.map((p) => p.id).join(", ")})`,
		);
	}
	const fields = stylePresetFields(preset, project.data.editor.cursor);
	project.data.editor = { ...project.data.editor, ...fields };
	await saveProject(project);
	return {
		json: { ok: true, project: project.path, preset: preset.id, changed: fields },
		human: `applied ${preset.id}: background ${preset.background}, padding ${fields.padding}, radius ${fields.borderRadius}, shadow ${fields.shadowIntensity}, motion blur ${fields.motionBlurAmount}, cursor size ${fields.cursor?.size}`,
	};
}

// ---------------------------------------------------------------- app commands

function appResultOutput(
	action: string,
	res: { code: number; stdout: string; result?: unknown },
	extra: Record<string, unknown>,
): CommandOutput {
	if (res.code !== 0) {
		throw new CliError(
			`app exited with code ${res.code}${res.result ? `: ${JSON.stringify(res.result)}` : ""}`,
		);
	}
	return {
		json: { ok: true, action, ...extra, result: res.result ?? null },
		human: `${action} done${Object.values(extra).length ? `: ${Object.values(extra).join(" ")}` : ""}`,
	};
}

export async function cmdOpen(args: ParsedArgs): Promise<CommandOutput> {
	const project = await loadProject(need(args, 0, "project"));
	await launchApp([`--chameleon-open=${project.path}`], { wait: false });
	return {
		json: { ok: true, action: "open", project: project.path },
		human: `opened ${project.path}`,
	};
}

export async function cmdExport(args: ParsedArgs): Promise<CommandOutput> {
	const project = await loadProject(need(args, 0, "project"));
	const outArg = flagString(args, "out");
	if (!outArg) throw new CliError("missing -o <out.mp4|out.gif>");
	const out = path.resolve(outArg);
	if (!/\.(mp4|gif)$/i.test(out)) throw new CliError("output must end in .mp4 or .gif");
	const res = await launchApp([`--chameleon-render=${project.path}`, `--chameleon-out=${out}`], {
		wait: true,
	});
	return appResultOutput("export", res, { out });
}

export async function cmdFrame(args: ParsedArgs): Promise<CommandOutput> {
	const ctx = await openProject(need(args, 0, "project"));
	const t = parseTime(need(args, 1, "time"));
	const outArg = flagString(args, "out");
	if (!outArg) throw new CliError("missing -o <out.png>");
	const out = path.resolve(outArg);
	if (!/\.png$/i.test(out)) throw new CliError("output must end in .png");
	// The app renders frames at source-video time (the editor playhead's units).
	let sourceMs: number;
	if (flagBool(args, "timeline")) {
		const total = editedDurationMs(ctx.segments);
		if (t > total) throw new CliError(`time is past the edited duration ${formatTime(total)}`);
		sourceMs = timelineToSource(ctx.segments, t, "start");
	} else {
		if (sourceToTimeline(ctx.segments, t).trimmed)
			throw new CliError(
				`source time ${formatTime(t)} is inside a cut; it never appears in the output`,
			);
		sourceMs = t;
	}
	sourceMs = Math.round(sourceMs);
	const res = await launchApp(
		[
			`--chameleon-render=${ctx.project.path}`,
			`--chameleon-out=${out}`,
			`--chameleon-frame-ms=${sourceMs}`,
		],
		{ wait: true },
	);
	return appResultOutput("frame", res, { out, sourceMs });
}
