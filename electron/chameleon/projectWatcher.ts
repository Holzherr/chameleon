import fs from "node:fs";
import path from "node:path";

export interface ProjectWatcherDeps {
	watch: (dir: string, listener: (filename: string | null) => void) => { close: () => void };
	readFile: (filePath: string) => Promise<string>;
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
}

const defaultDeps: ProjectWatcherDeps = {
	watch: (dir, listener) => {
		const watcher = fs.watch(dir, { persistent: false }, (_event, filename) =>
			listener(filename ? filename.toString() : null),
		);
		watcher.on("error", () => {
			// The directory vanished or became unreadable; stay quiet until re-armed.
		});
		return watcher;
	},
	readFile: (filePath) => fs.promises.readFile(filePath, "utf-8"),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export const PROJECT_WATCH_DEBOUNCE_MS = 150;

/**
 * Watches one project file for changes made by other programs.
 *
 * Watches the parent directory rather than the file: editors and CLIs that write
 * atomically (temp file + rename) replace the inode, which silently kills a
 * file-level fs.watch on macOS. A directory watch keeps firing across renames.
 *
 * Changes are debounced, then the file is read and compared with the last content
 * the app itself read or wrote, so the app's own saves never count as external.
 * Unparseable content (a half-written file) is skipped; the next event retries.
 */
export class ProjectFileWatcher {
	private filePath: string | null = null;
	private lastKnownContent: string | null = null;
	private handle: { close: () => void } | null = null;
	private timer: unknown = null;
	private generation = 0;

	constructor(
		private readonly onExternalChange: (filePath: string, content: string) => void,
		private readonly deps: ProjectWatcherDeps = defaultDeps,
		private readonly debounceMs = PROJECT_WATCH_DEBOUNCE_MS,
	) {}

	get watchedPath() {
		return this.filePath;
	}

	/** Start watching `filePath` (or stop when null). `content` is what the app last saw. */
	setFile(filePath: string | null, content?: string) {
		const resolved = filePath ? path.resolve(filePath) : null;
		if (resolved !== this.filePath) {
			this.stop();
			this.filePath = resolved;
			this.lastKnownContent = null;
			if (resolved) this.arm(resolved);
		}
		if (content !== undefined) this.lastKnownContent = content;
	}

	/** Record content the app read or is about to write, so it isn't reported back. */
	noteContent(filePath: string, content: string) {
		if (this.filePath && path.resolve(filePath) === this.filePath) {
			this.lastKnownContent = content;
		}
	}

	stop() {
		this.generation++;
		if (this.timer !== null) {
			this.deps.clearTimeout(this.timer);
			this.timer = null;
		}
		this.handle?.close();
		this.handle = null;
		this.filePath = null;
	}

	private arm(filePath: string) {
		const dir = path.dirname(filePath);
		const base = path.basename(filePath);
		try {
			this.handle = this.deps.watch(dir, (filename) => {
				if (filename !== null && filename !== base) return;
				this.schedule();
			});
		} catch (error) {
			console.warn("[chameleon] could not watch project file:", filePath, error);
			this.handle = null;
		}
	}

	private schedule() {
		if (this.timer !== null) this.deps.clearTimeout(this.timer);
		this.timer = this.deps.setTimeout(() => {
			this.timer = null;
			void this.check();
		}, this.debounceMs);
	}

	private async check() {
		const filePath = this.filePath;
		if (!filePath) return;
		const generation = this.generation;
		let content: string;
		try {
			content = await this.deps.readFile(filePath);
		} catch {
			// Mid-rename the path can briefly not exist; the rename's own event retries.
			return;
		}
		if (generation !== this.generation || filePath !== this.filePath) return;
		if (content === this.lastKnownContent) return;
		try {
			JSON.parse(content);
		} catch {
			return;
		}
		this.lastKnownContent = content;
		this.onExternalChange(filePath, content);
	}
}
