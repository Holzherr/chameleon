import { CliError } from "./errors";

export interface TranscriptWord {
	index: number;
	text: string;
	startMs: number;
	endMs: number;
}

export interface Silence {
	startMs: number;
	endMs: number;
}

/**
 * Whisper word ends run into the following pause and onsets sometimes start
 * inside the preceding one. Clip each word against ffmpeg-detected silences
 * (which are sample-accurate) and the media duration.
 */
export function refineWordsWithSilences(
	words: Array<{ text: string; startMs: number; endMs: number }>,
	silences: Silence[],
	durationMs: number,
): TranscriptWord[] {
	return words.map((w, index) => {
		let start = Math.max(0, Math.min(w.startMs, durationMs));
		let end = Math.max(start, Math.min(w.endMs, durationMs));
		for (const s of silences) {
			if (s.endMs <= start || s.startMs >= end) continue;
			const coversStart = s.startMs <= start && s.endMs < end;
			const coversEnd = s.startMs > start && s.endMs >= end;
			if (coversStart) start = s.endMs;
			else if (coversEnd) end = s.startMs;
		}
		return {
			index,
			text: w.text.trim(),
			startMs: Math.round(start),
			endMs: Math.round(Math.max(start, end)),
		};
	});
}

const FILLERS = new Set([
	"um",
	"umm",
	"uhm",
	"uh",
	"uhh",
	"er",
	"erm",
	"ah",
	"ahh",
	"hm",
	"hmm",
	"mm",
]);
/** Whisper often mis-hears a spoken filler; "arm" is what whisper-base writes for macOS TTS "Um". */
const FILLER_ALIASES = new Set([...FILLERS, "arm", "mhm", "eh"]);

export function normalizeToken(text: string): string {
	return text
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[^\p{L}\p{N}']+/gu, "")
		.replace(/^'+|'+$/g, "");
}

function tokensMatch(query: string, word: string): { ok: boolean; fuzzy: boolean } {
	if (query === word) return { ok: true, fuzzy: false };
	if (FILLERS.has(query) && FILLER_ALIASES.has(word)) return { ok: true, fuzzy: true };
	return { ok: false, fuzzy: false };
}

export interface PhraseMatch {
	startIndex: number;
	endIndex: number;
	startMs: number;
	endMs: number;
	text: string;
	/** True when a filler in the query matched a different filler-like word ("Um" → "Arm"). */
	fuzzy: boolean;
}

/** Finds every occurrence of `phrase` as a consecutive word sequence (case/punctuation-insensitive). */
export function findPhrase(words: TranscriptWord[], phrase: string): PhraseMatch[] {
	const query = phrase.split(/\s+/).map(normalizeToken).filter(Boolean);
	if (query.length === 0) throw new CliError(`phrase "${phrase}" has no words`);
	const tokens = words.map((w) => normalizeToken(w.text));
	const matches: PhraseMatch[] = [];
	for (let i = 0; i + query.length <= tokens.length; i++) {
		let fuzzy = false;
		let ok = true;
		for (let k = 0; k < query.length; k++) {
			const m = tokensMatch(query[k], tokens[i + k]);
			if (!m.ok) {
				ok = false;
				break;
			}
			fuzzy ||= m.fuzzy;
		}
		if (!ok) continue;
		const slice = words.slice(i, i + query.length);
		matches.push({
			startIndex: i,
			endIndex: i + query.length - 1,
			startMs: slice[0].startMs,
			endMs: slice[slice.length - 1].endMs,
			text: slice.map((w) => w.text).join(" "),
			fuzzy,
		});
	}
	return matches;
}

export function selectMatches(
	matches: PhraseMatch[],
	phrase: string,
	opts: { all?: boolean; nth?: number },
): PhraseMatch[] {
	if (matches.length === 0) throw new CliError(`phrase "${phrase}" not found in transcript`);
	if (opts.nth !== undefined) {
		const m = matches[opts.nth - 1];
		if (!m)
			throw new CliError(`--nth ${opts.nth} but "${phrase}" occurs ${matches.length} time(s)`);
		return [m];
	}
	if (matches.length > 1 && !opts.all) {
		const where = matches
			.map((m, i) => `  ${i + 1}: ${(m.startMs / 1000).toFixed(3)}s "${m.text}"`)
			.join("\n");
		throw new CliError(
			`phrase "${phrase}" is ambiguous (${matches.length} matches); pass --nth N or --all\n${where}`,
		);
	}
	return matches;
}

export interface SnapOptions {
	/** Only snap to a silence/word gap within this distance of the boundary. */
	maxDistanceMs?: number;
	/** Pause left on the kept side of a silence (capped at half the silence). */
	keepMs?: number;
	/** The snapped value must stay below (start) / above (end) this, so a range never inverts. */
	bound?: number;
}

export interface SnapResult {
	ms: number;
	snappedTo: "silence" | "word-gap" | null;
}

function distanceToInterval(t: number, a: number, b: number): number {
	if (t < a) return a - t;
	if (t > b) return t - b;
	return 0;
}

/**
 * Moves a cut boundary into the nearest silence (ffmpeg silencedetect), else the
 * nearest gap between two words. A start boundary sits `keepMs` into the silence
 * so the kept audio before it keeps a short natural pause; an end boundary sits
 * `keepMs` before the silence ends, for the same reason.
 */
export function snapBoundary(
	t: number,
	kind: "start" | "end",
	silences: Silence[],
	words: TranscriptWord[],
	opts: SnapOptions = {},
): SnapResult {
	const maxDist = opts.maxDistanceMs ?? 400;
	const keep = opts.keepMs ?? 150;
	const withinBound = (ms: number) =>
		opts.bound === undefined || (kind === "start" ? ms < opts.bound : ms > opts.bound);

	let best: number | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const s of silences) {
		const d = distanceToInterval(t, s.startMs, s.endMs);
		const pad = Math.min(keep, (s.endMs - s.startMs) / 2);
		const ms = kind === "start" ? s.startMs + pad : s.endMs - pad;
		if (d <= maxDist && d < bestDist && withinBound(ms)) {
			best = ms;
			bestDist = d;
		}
	}
	if (best !== null) return { ms: Math.round(best), snappedTo: "silence" };

	let gapMs: number | null = null;
	let gapDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i + 1 < words.length; i++) {
		const a = words[i].endMs;
		const b = Math.max(a, words[i + 1].startMs);
		const d = distanceToInterval(t, a, b);
		const mid = (a + b) / 2;
		if (d <= maxDist && d < gapDist && withinBound(mid)) {
			gapDist = d;
			gapMs = mid;
		}
	}
	if (gapMs !== null) return { ms: Math.round(gapMs), snappedTo: "word-gap" };
	return { ms: Math.round(t), snappedTo: null };
}

/** Snaps both ends of a cut; the end is constrained to stay after the snapped start. */
export function snapRange(
	startMs: number,
	endMs: number,
	silences: Silence[],
	words: TranscriptWord[],
	opts: Omit<SnapOptions, "bound"> = {},
): { start: SnapResult; end: SnapResult } {
	const start = snapBoundary(startMs, "start", silences, words, { ...opts, bound: endMs });
	const end = snapBoundary(endMs, "end", silences, words, { ...opts, bound: start.ms });
	return { start, end };
}
