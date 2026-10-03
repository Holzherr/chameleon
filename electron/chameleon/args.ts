// Command-line contract between the `chameleon` CLI and the app. Pure (no electron
// imports) so the CLI bundle can share it.

export const OPEN_FLAG = "--chameleon-open";
export const RENDER_FLAG = "--chameleon-render";
export const OUT_FLAG = "--chameleon-out";
export const FRAME_MS_FLAG = "--chameleon-frame-ms";
export const RESULT_PREFIX = "CHAMELEON_RESULT ";

/** Extension new projects are saved with. */
export const PROJECT_EXTENSION = ".chameleon";
/** Extensions the app opens: our own plus legacy OpenScreen projects (same format). */
export const OPENABLE_PROJECT_EXTENSIONS: readonly string[] = [PROJECT_EXTENSION, ".openscreen"];

export function isProjectFilePath(value: string): boolean {
	return OPENABLE_PROJECT_EXTENSIONS.includes(extensionOf(value));
}

export interface RenderJob {
	projectPath: string;
	outPath: string;
	/**
	 * When set, write a single PNG of the fully rendered frame at this time in ms. Time is
	 * source-video time: the editor timeline/playhead and every region in the project file
	 * use it. It is not the position in the exported (trimmed/sped-up) video.
	 */
	frameMs?: number;
}

export interface ChameleonArgs {
	openPath?: string;
	render?: RenderJob;
	/** Set when render flags are present but invalid. */
	renderError?: string;
}

export interface RenderResult {
	ok: boolean;
	path?: string;
	/** Duration of the written media in ms (0 for a PNG frame). */
	durationMs?: number;
	/** Wall-clock time the render took. */
	elapsedMs?: number;
	error?: string;
	/** `--chameleon-open` only: the path went to an already-running instance. */
	forwarded?: boolean;
}

function readFlag(argv: readonly string[], flag: string): string | undefined {
	const prefix = `${flag}=`;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith(prefix)) return arg.slice(prefix.length);
		if (arg === flag && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
			return argv[i + 1];
		}
	}
	return undefined;
}

function isAbsolutePath(value: string) {
	return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function extensionOf(value: string) {
	const base = value.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function parseChameleonArgs(argv: readonly string[]): ChameleonArgs {
	const result: ChameleonArgs = {};

	const openPath = readFlag(argv, OPEN_FLAG);
	if (openPath) result.openPath = openPath;

	const projectPath = readFlag(argv, RENDER_FLAG);
	if (projectPath === undefined) return result;

	const outPath = readFlag(argv, OUT_FLAG);
	const frameRaw = readFlag(argv, FRAME_MS_FLAG);
	const error = validateRenderArgs(projectPath, outPath, frameRaw);
	if (error) {
		result.renderError = error;
		return result;
	}

	result.render = {
		projectPath,
		outPath: outPath as string,
		...(frameRaw !== undefined ? { frameMs: Number(frameRaw) } : {}),
	};
	return result;
}

function validateRenderArgs(
	projectPath: string,
	outPath: string | undefined,
	frameRaw: string | undefined,
): string | null {
	if (!projectPath || !isAbsolutePath(projectPath)) {
		return `${RENDER_FLAG} needs an absolute ${PROJECT_EXTENSION} path`;
	}
	if (!isProjectFilePath(projectPath)) {
		return `${RENDER_FLAG} must point to a ${OPENABLE_PROJECT_EXTENSIONS.join(" or ")} project`;
	}
	if (!outPath || !isAbsolutePath(outPath)) {
		return `${OUT_FLAG} needs an absolute output path`;
	}
	const ext = extensionOf(outPath);
	if (frameRaw !== undefined) {
		const frameMs = Number(frameRaw);
		if (frameRaw.trim() === "" || !Number.isFinite(frameMs) || frameMs < 0) {
			return `${FRAME_MS_FLAG} must be a non-negative number of milliseconds`;
		}
		if (ext !== ".png") return `${OUT_FLAG} must end in .png when ${FRAME_MS_FLAG} is set`;
		return null;
	}
	if (ext !== ".mp4" && ext !== ".gif") {
		return `${OUT_FLAG} must end in .mp4 or .gif`;
	}
	return null;
}

export function formatResultLine(result: RenderResult): string {
	return `${RESULT_PREFIX}${JSON.stringify(result)}`;
}

/** Returns the last well-formed result line in the output, if any. */
export function parseResultLine(output: string): RenderResult | undefined {
	const lines = output.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line.startsWith(RESULT_PREFIX)) continue;
		try {
			const parsed = JSON.parse(line.slice(RESULT_PREFIX.length));
			if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") {
				return parsed as RenderResult;
			}
		} catch {
			// Keep scanning: a truncated line shouldn't hide an earlier good one.
		}
	}
	return undefined;
}
