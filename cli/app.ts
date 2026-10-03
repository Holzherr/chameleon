// Launches the Chameleon app for the CLI. Owned by the app side: the argv contract and
// the result line live in electron/chameleon/args.ts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResultLine, type RenderResult } from "../electron/chameleon/args";

export interface LaunchResult {
	code: number;
	stdout: string;
	result?: RenderResult;
}

interface AppCommand {
	command: string;
	args: string[];
}

/** Walks up from this file to the repo root (the dir whose package.json has main = dist-electron). */
export function findRepoRoot(startDir: string): string | null {
	let dir = startDir;
	for (;;) {
		if (
			existsSync(path.join(dir, "package.json")) &&
			existsSync(path.join(dir, "node_modules", "electron"))
		) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function resolveAppCommand(
	extraArgs: string[],
	env: NodeJS.ProcessEnv = process.env,
	moduleDir = path.dirname(fileURLToPath(import.meta.url)),
): AppCommand {
	const packaged = env.CHAMELEON_APP;
	if (packaged) {
		if (!existsSync(packaged)) {
			throw new Error(`CHAMELEON_APP points to a missing file: ${packaged}`);
		}
		return { command: packaged, args: extraArgs };
	}

	const root = findRepoRoot(moduleDir);
	if (!root) {
		throw new Error(
			"Could not find the Chameleon app. Set CHAMELEON_APP to the app binary " +
				"(e.g. /Applications/Chameleon.app/Contents/MacOS/Chameleon).",
		);
	}
	if (
		!existsSync(path.join(root, "dist-electron", "main.js")) ||
		!existsSync(path.join(root, "dist", "index.html"))
	) {
		throw new Error(`The app isn't built. Run \`npx vite build\` in ${root} first.`);
	}
	// node_modules/electron's entry exports the path of the Electron binary.
	const electronBinary = createRequire(path.join(root, "package.json"))("electron") as unknown;
	if (typeof electronBinary !== "string" || !existsSync(electronBinary)) {
		throw new Error("Electron binary not found in node_modules/electron");
	}
	return { command: electronBinary, args: [root, ...extraArgs] };
}

function childEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	// Set by some Node-based hosts; it would make Electron run as plain Node.
	delete env.ELECTRON_RUN_AS_NODE;
	return env;
}

/**
 * Spawns the app with extra argv (e.g. `--chameleon-render=...`). With `wait`, resolves
 * when the app exits, with its stdout and the parsed `CHAMELEON_RESULT` line. Without,
 * the app is detached and keeps running after the CLI exits.
 */
export async function launchApp(
	args: string[],
	opts: { wait: boolean },
): Promise<{ code: number; stdout: string; result?: RenderResult }> {
	const { command, args: fullArgs } = resolveAppCommand(args);

	if (!opts.wait) {
		const child = spawn(command, fullArgs, {
			detached: true,
			stdio: "ignore",
			env: childEnv(),
		});
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", () => resolve());
			child.once("error", reject);
		});
		child.unref();
		return { code: 0, stdout: "" };
	}

	return await new Promise<LaunchResult>((resolve, reject) => {
		const child = spawn(command, fullArgs, {
			stdio: ["ignore", "pipe", "pipe"],
			env: childEnv(),
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
			if (process.env.CHAMELEON_DEBUG) process.stderr.write(chunk);
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			let result = parseResultLine(stdout);
			const exitCode = code ?? (signal ? 1 : 0);
			if (!result && exitCode !== 0) {
				const tail = stderr.trim().split(/\r?\n/).slice(-5).join("\n");
				result = {
					ok: false,
					error: `App exited with ${signal ?? `code ${exitCode}`}${tail ? `: ${tail}` : ""}`,
				};
			}
			resolve({ code: exitCode, stdout, ...(result ? { result } : {}) });
		});
	});
}
