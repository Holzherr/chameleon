import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, type BrowserWindow, ipcMain } from "electron";
import { createRenderWindow } from "../windows";
import { formatResultLine, type RenderJob, type RenderResult } from "./args";

const RENDER_TIMEOUT_MS = Number(process.env.CHAMELEON_RENDER_TIMEOUT_MS) || 30 * 60 * 1000;

let renderSessionDir: string | null = null;

/**
 * Runs before app ready. Headless renders must not disturb a running Chameleon: no
 * single-instance lock, no dock icon, and a throwaway Chromium profile so we neither
 * fight over the profile's LevelDB locks nor write the user's preferences. Local Storage
 * is copied in so custom fonts the user added still resolve.
 */
export function prepareRenderMode() {
	if (process.platform === "darwin") {
		app.dock?.hide();
	}
	try {
		renderSessionDir = mkdtempSync(path.join(os.tmpdir(), "chameleon-render-"));
		const userLocalStorage = path.join(app.getPath("userData"), "Local Storage");
		if (existsSync(userLocalStorage)) {
			cpSync(userLocalStorage, path.join(renderSessionDir, "Local Storage"), {
				recursive: true,
				filter: (source) => path.basename(source) !== "LOCK",
			});
		}
		app.setPath("sessionData", renderSessionDir);
	} catch (error) {
		console.error("[chameleon] could not prepare render session dir:", error);
	}
}

function finish(result: RenderResult) {
	process.stdout.write(`${formatResultLine(result)}\n`);
	if (renderSessionDir) {
		try {
			rmSync(renderSessionDir, { recursive: true, force: true });
		} catch {
			// Temp dir; the OS cleans it eventually.
		}
	}
	app.exit(result.ok ? 0 : 1);
}

/** Runs after app ready, with IPC handlers registered. Exits the process when done. */
export async function runRenderMode(
	job: RenderJob | undefined,
	jobError: string | undefined,
	setWindow: (window: BrowserWindow | null) => void,
) {
	const startedAt = Date.now();
	if (!job) {
		finish({ ok: false, error: jobError ?? "Invalid render arguments" });
		return;
	}

	try {
		const stats = await fs.stat(job.projectPath);
		if (!stats.isFile()) throw new Error("not a file");
	} catch {
		finish({ ok: false, error: `Project not found: ${job.projectPath}` });
		return;
	}

	let settled = false;
	const settle = (result: RenderResult) => {
		if (settled) return;
		settled = true;
		finish({ ...result, elapsedMs: Date.now() - startedAt });
	};

	ipcMain.handle("chameleon-get-render-job", () => job);
	ipcMain.handle(
		"chameleon-render-done",
		async (
			_event,
			result: { ok: boolean; data?: ArrayBuffer; durationMs?: number; error?: string },
		) => {
			if (!result?.ok || !result.data) {
				settle({ ok: false, error: result?.error || "Render produced no output" });
				return;
			}
			try {
				const outPath = path.normalize(job.outPath);
				await fs.mkdir(path.dirname(outPath), { recursive: true });
				await fs.writeFile(outPath, Buffer.from(result.data));
				settle({ ok: true, path: outPath, durationMs: result.durationMs ?? 0 });
			} catch (error) {
				settle({ ok: false, error: `Failed to write output: ${String(error)}` });
			}
		},
	);

	setTimeout(() => {
		settle({ ok: false, error: `Render timed out after ${RENDER_TIMEOUT_MS} ms` });
	}, RENDER_TIMEOUT_MS).unref();

	const window = createRenderWindow();
	setWindow(window);
	window.webContents.on("render-process-gone", (_event, details) => {
		settle({ ok: false, error: `Renderer process gone: ${details.reason}` });
	});
	window.webContents.on("did-fail-load", (_event, code, description) => {
		settle({ ok: false, error: `Render window failed to load (${code}): ${description}` });
	});
	if (process.env.CHAMELEON_DEBUG) {
		window.webContents.on("console-message", (event) => {
			process.stderr.write(`[render] ${event.message}\n`);
		});
	}
}
