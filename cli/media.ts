import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors";
import { refineWordsWithSilences, type Silence, type TranscriptWord } from "./transcript";

function findBinary(name: string): string {
	const envOverride = process.env[`CHAMELEON_${name.toUpperCase()}`];
	if (envOverride) return envOverride;
	for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
		const candidate = path.join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return name; // fall back to PATH
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(bin, args, { maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					reject(new CliError(`${bin} not found (install ffmpeg, e.g. brew install ffmpeg)`));
					return;
				}
				reject(
					new CliError(
						`${path.basename(bin)} failed: ${stderr.trim().split("\n").slice(-3).join(" ")}`,
					),
				);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

export async function assertFile(p: string, what = "file"): Promise<void> {
	try {
		const st = await fs.stat(p);
		if (!st.isFile()) throw new Error();
	} catch {
		throw new CliError(`${what} not found: ${p}`);
	}
}

/** Media duration in ms via ffprobe (container duration). */
export async function probeDurationMs(videoPath: string): Promise<number> {
	await assertFile(videoPath, "video");
	const { stdout } = await run(findBinary("ffprobe"), [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		videoPath,
	]);
	const seconds = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(seconds)) throw new CliError(`could not read duration of ${videoPath}`);
	return Math.round(seconds * 1000);
}

export interface SilenceParams {
	noiseDb: number;
	minSilenceMs: number;
}

export const DEFAULT_SILENCE_PARAMS: SilenceParams = { noiseDb: -35, minSilenceMs: 150 };

export async function detectSilences(
	videoPath: string,
	params: SilenceParams,
	durationMs: number,
): Promise<Silence[]> {
	const { stderr } = await run(findBinary("ffmpeg"), [
		"-hide_banner",
		"-nostats",
		"-i",
		videoPath,
		"-vn",
		"-af",
		`silencedetect=noise=${params.noiseDb}dB:d=${params.minSilenceMs / 1000}`,
		"-f",
		"null",
		"-",
	]);
	return parseSilenceDetect(stderr, durationMs);
}

export function parseSilenceDetect(stderr: string, durationMs: number): Silence[] {
	const out: Silence[] = [];
	let open: number | null = null;
	for (const line of stderr.split("\n")) {
		const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
		if (start) {
			open = Math.max(0, Number.parseFloat(start[1]) * 1000);
			continue;
		}
		const end = /silence_end:\s*([\d.]+)/.exec(line);
		if (end && open !== null) {
			out.push({ startMs: Math.round(open), endMs: Math.round(Number.parseFloat(end[1]) * 1000) });
			open = null;
		}
	}
	if (open !== null && open < durationMs) {
		out.push({ startMs: Math.round(open), endMs: durationMs });
	}
	return out;
}

/** Decodes the first audio stream to mono 16 kHz float32 PCM (what Whisper expects). */
export async function extractMono16k(videoPath: string, outPath: string): Promise<void> {
	await run(findBinary("ffmpeg"), [
		"-v",
		"error",
		"-y",
		"-i",
		videoPath,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"16000",
		"-f",
		"f32le",
		outPath,
	]);
}

export const DEFAULT_WHISPER_MODEL = "Xenova/whisper-base";

export function whisperModel(): string {
	return process.env.CHAMELEON_WHISPER_MODEL || DEFAULT_WHISPER_MODEL;
}

export function modelCacheDir(): string {
	return (
		process.env.CHAMELEON_MODEL_DIR || path.join(os.homedir(), ".cache", "chameleon", "models")
	);
}

export interface RawWord {
	text: string;
	startMs: number;
	endMs: number;
}

/**
 * Runs inside the `__whisper` child process (see `transcribeWords`). Uses the
 * same Transformers.js v2 ASR pipeline as the app's caption worker, but with
 * whisper-base and `return_timestamps: "word"` on onnxruntime-node.
 */
export async function whisperWordsInProcess(f32Path: string, model: string): Promise<RawWord[]> {
	const buf = await fs.readFile(f32Path);
	const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
	const { pipeline, env } = await import("@xenova/transformers");
	env.cacheDir = modelCacheDir();
	env.allowLocalModels = false;
	const transcriber = (await pipeline("automatic-speech-recognition", model, {
		quantized: true,
	})) as unknown as (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>;
	const durationSec = samples.length / 16_000;
	const chunking = durationSec > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {};
	const result = (await transcriber(samples, { return_timestamps: "word", ...chunking })) as {
		chunks?: Array<{ text: string; timestamp: [number | null, number | null] }>;
	};
	const chunks = result.chunks ?? [];
	const words: RawWord[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const c = chunks[i];
		const text = String(c.text ?? "").trim();
		if (!text) continue;
		const start = c.timestamp[0] ?? (words.length ? words[words.length - 1].endMs / 1000 : 0);
		const end = c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? durationSec;
		words.push({
			text,
			startMs: Math.round(start * 1000),
			endMs: Math.round(Math.max(start, end) * 1000),
		});
	}
	return words;
}

/** Path of the bundled CLI, used to re-run itself as the whisper child. */
function selfPath(): string {
	return fileURLToPath(import.meta.url);
}

/**
 * Whisper runs in a child process: onnxruntime-node prints graph-optimizer
 * warnings straight to the native stderr, which would pollute agent output.
 */
async function transcribeWords(f32Path: string, model: string): Promise<RawWord[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [selfPath(), "__whisper", f32Path, model], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				const lines = stderr
					.split("\n")
					.filter((l) => l.trim() && !l.includes("[W:onnxruntime"))
					.slice(-5)
					.join("\n");
				reject(new CliError(`transcription failed (exit ${code}):\n${lines}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as RawWord[]);
			} catch {
				reject(new CliError("transcription produced unreadable output"));
			}
		});
	});
}

export interface TranscriptFile {
	version: 1;
	video: string;
	videoSize: number;
	videoMtimeMs: number;
	model: string;
	silenceParams: SilenceParams;
	durationMs: number;
	text: string;
	words: TranscriptWord[];
	/** Whisper's own word times before clipping against silences. */
	rawWords: RawWord[];
	silences: Silence[];
}

export async function loadOrCreateTranscript(
	videoPath: string,
	cachePath: string,
	opts: { silence?: SilenceParams; refresh?: boolean; log?: (msg: string) => void } = {},
): Promise<{ transcript: TranscriptFile; cached: boolean }> {
	await assertFile(videoPath, "video");
	const st = await fs.stat(videoPath);
	const model = whisperModel();
	const silenceParams = opts.silence ?? DEFAULT_SILENCE_PARAMS;

	let previous: TranscriptFile | null = null;
	if (!opts.refresh) {
		try {
			previous = JSON.parse(await fs.readFile(cachePath, "utf-8")) as TranscriptFile;
		} catch {
			previous = null;
		}
	}
	const sameMedia =
		previous &&
		previous.version === 1 &&
		previous.video === videoPath &&
		previous.videoSize === st.size &&
		previous.videoMtimeMs === Math.round(st.mtimeMs) &&
		previous.model === model;
	const sameSilence =
		sameMedia &&
		previous?.silenceParams.noiseDb === silenceParams.noiseDb &&
		previous?.silenceParams.minSilenceMs === silenceParams.minSilenceMs;
	if (previous && sameMedia && sameSilence) return { transcript: previous, cached: true };

	const durationMs = await probeDurationMs(videoPath);
	const silences = await detectSilences(videoPath, silenceParams, durationMs);
	let rawWords: RawWord[];
	if (previous && sameMedia) {
		rawWords = previous.rawWords;
	} else {
		opts.log?.(`transcribing ${path.basename(videoPath)} with ${model}…`);
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chameleon-"));
		const f32 = path.join(tmpDir, "audio.f32");
		try {
			await extractMono16k(videoPath, f32);
			rawWords = await transcribeWords(f32, model);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	}
	const words = refineWordsWithSilences(rawWords, silences, durationMs);
	const transcript: TranscriptFile = {
		version: 1,
		video: videoPath,
		videoSize: st.size,
		videoMtimeMs: Math.round(st.mtimeMs),
		model,
		silenceParams,
		durationMs,
		text: words.map((w) => w.text).join(" "),
		words,
		rawWords,
		silences,
	};
	await writeFileAtomic(cachePath, JSON.stringify(transcript, null, 2));
	return { transcript, cached: false };
}

export async function writeFileAtomic(target: string, content: string): Promise<void> {
	const tmp = path.join(
		path.dirname(target),
		`.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
	);
	await fs.writeFile(tmp, content, "utf-8");
	try {
		await fs.rename(tmp, target);
	} catch (error) {
		await fs.rm(tmp, { force: true });
		throw error;
	}
}
