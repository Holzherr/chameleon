// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Drives the real CLI bundle against fake ffmpeg/ffprobe that log their argv, to check a
// `-`-prefixed file name never reaches them where they would parse it as an option.
let dir: string;
let cli: string;
let log: string;

beforeAll(async () => {
	// realpath: macOS tmpdir is a /var symlink, and the CLI sees the /private/var cwd.
	dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "chameleon-argv-")));
	cli = path.join(dir, "chameleon.mjs");
	log = path.join(dir, "argv.log");
	await build({
		entryPoints: [path.join(__dirname, "main.ts")],
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		outfile: cli,
		external: ["@xenova/transformers", "onnxruntime-node"],
		alias: { "@": path.join(__dirname, "..", "src") },
		logLevel: "silent",
	});
	const fake = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify([path.basename(process.argv[1]), ...process.argv.slice(2)]) + "\\n");
if (path.basename(process.argv[1]) === "ffprobe") process.stdout.write("2.5\\n");
`;
	for (const name of ["ffprobe", "ffmpeg"]) {
		await fs.writeFile(path.join(dir, name), fake, { mode: 0o755 });
	}
	await fs.writeFile(path.join(dir, "-y.mp4"), "");
}, 60_000);

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

async function runCli(...args: string[]): Promise<string[][]> {
	await fs.rm(log, { force: true });
	spawnSync(process.execPath, [cli, ...args], {
		cwd: dir,
		env: {
			...process.env,
			CHAMELEON_FFPROBE: path.join(dir, "ffprobe"),
			CHAMELEON_FFMPEG: path.join(dir, "ffmpeg"),
		},
		encoding: "utf-8",
	});
	const text = await fs.readFile(log, "utf-8").catch(() => "");
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as string[]);
}

/** The input file each call reads: the value after `-i`, else ffprobe's last positional. */
function inputsOf(calls: string[][]): string[] {
	return calls.map((argv) => {
		const i = argv.indexOf("-i");
		return i >= 0 ? argv[i + 1] : argv[argv.length - 1];
	});
}

describe("ffmpeg/ffprobe argv for a '-'-prefixed file name", () => {
	it("`new -y.mp4` and `transcript` pass an absolute input", async () => {
		const created = await runCli("new", "-y.mp4");
		expect(created).toHaveLength(1);
		expect(inputsOf(created)).toEqual([path.join(dir, "-y.mp4")]);

		const transcribed = await runCli("transcript", "-y.chameleon", "--refresh");
		expect(transcribed.map((argv) => argv[0])).toEqual(["ffprobe", "ffmpeg", "ffmpeg"]);
		for (const input of inputsOf(transcribed)) expect(input).toBe(path.join(dir, "-y.mp4"));
	});

	it("a project storing a relative '-' media path never hands ffprobe a bare option", async () => {
		const project = path.join(dir, "relative.chameleon");
		const data = JSON.parse(await fs.readFile(path.join(dir, "-y.chameleon"), "utf-8"));
		data.media.screenVideoPath = "-y.mp4";
		await fs.writeFile(project, JSON.stringify(data));

		const calls = await runCli("show", project);
		expect(calls).toHaveLength(1);
		const argv = calls[0];
		// Either made absolute or read as the value of `-i`, never a standalone argument.
		const i = argv.indexOf("-y.mp4");
		expect(i === -1 || argv[i - 1] === "-i").toBe(true);
	});
});
