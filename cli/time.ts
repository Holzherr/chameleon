import { CliError } from "./errors";

/**
 * Parses a CLI time into milliseconds. Accepts `12.5` / `12.5s` (seconds),
 * `1500ms`, `1:02.25` (m:ss) and `1:02:03.5` (h:mm:ss).
 */
export function parseTime(input: string): number {
	const raw = String(input).trim().toLowerCase();
	if (!raw) throw new CliError("empty time");

	let ms: number;
	if (raw.endsWith("ms")) {
		ms = parseNumber(raw.slice(0, -2), input);
	} else if (raw.includes(":")) {
		const parts = raw.split(":");
		if (parts.length > 3 || parts.some((p) => p === "")) {
			throw new CliError(`invalid time "${input}"`);
		}
		const nums = parts.map((p) => parseNumber(p, input));
		for (let i = 1; i < nums.length; i++) {
			if (nums[i] >= 60) throw new CliError(`invalid time "${input}" (field >= 60)`);
		}
		const seconds = nums.reduce((acc, n) => acc * 60 + n, 0);
		ms = seconds * 1000;
	} else {
		const body = raw.endsWith("s") ? raw.slice(0, -1) : raw;
		ms = parseNumber(body, input) * 1000;
	}
	if (ms < 0) throw new CliError(`negative time "${input}"`);
	return Math.round(ms * 1000) / 1000;
}

function parseNumber(text: string, original: string): number {
	if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text.trim())) {
		throw new CliError(`invalid time "${original}" (use 12.5, 12.5s, 1500ms or 1:02.25)`);
	}
	return Number(text);
}

/** Formats milliseconds as seconds with millisecond precision, e.g. `2.162s`. */
export function formatTime(ms: number): string {
	return `${(ms / 1000).toFixed(3)}s`;
}

export function formatRange(startMs: number, endMs: number): string {
	return `${formatTime(startMs)}–${formatTime(endMs)}`;
}
