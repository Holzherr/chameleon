import { describe, expect, it, vi } from "vitest";
import { ProjectFileWatcher, type ProjectWatcherDeps } from "./projectWatcher";

function setup(initialDisk: string) {
	let disk: string | null = initialDisk;
	let listener: ((filename: string | null) => void) | null = null;
	const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
	const watched: string[] = [];
	const closed: string[] = [];
	const deps: ProjectWatcherDeps = {
		watch: (dir, l) => {
			watched.push(dir);
			listener = l;
			return { close: () => closed.push(dir) };
		},
		readFile: async () => {
			if (disk === null) throw new Error("ENOENT");
			return disk;
		},
		setTimeout: (fn) => {
			const timer = { fn, cancelled: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (handle) => {
			(handle as { cancelled: boolean }).cancelled = true;
		},
	};
	const onChange = vi.fn();
	const watcher = new ProjectFileWatcher(onChange, deps, 150);
	return {
		watcher,
		onChange,
		watched,
		closed,
		setDisk: (value: string | null) => {
			disk = value;
		},
		emit: (filename: string | null) => listener?.(filename),
		/** Runs pending debounce timers and lets the async read settle. */
		flush: async () => {
			for (const timer of timers.splice(0)) {
				if (!timer.cancelled) timer.fn();
			}
			await new Promise((resolve) => setTimeout(resolve, 0));
		},
	};
}

const A = JSON.stringify({ version: 2, editor: { zoomRegions: [] } });
const B = JSON.stringify({ version: 2, editor: { zoomRegions: [{ id: "zoom-1" }] } });

describe("ProjectFileWatcher", () => {
	it("watches the parent directory so atomic renames keep firing", () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		expect(t.watched).toEqual(["/p"]);
	});

	it("reports an external change once, debounced across a burst of events", async () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		t.setDisk(B);
		t.emit(".demo.openscreen.tmp");
		t.emit("demo.openscreen");
		t.emit("demo.openscreen");
		await t.flush();
		expect(t.onChange).toHaveBeenCalledTimes(1);
		expect(t.onChange).toHaveBeenCalledWith("/p/demo.openscreen", B);

		// Same content again (e.g. a trailing rename event) is not re-reported.
		t.emit("demo.openscreen");
		await t.flush();
		expect(t.onChange).toHaveBeenCalledTimes(1);
	});

	it("ignores events for other files in the folder", async () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		t.setDisk(B);
		t.emit("other.openscreen");
		await t.flush();
		expect(t.onChange).not.toHaveBeenCalled();
	});

	it("ignores the app's own saves", async () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		t.watcher.noteContent("/p/demo.openscreen", B);
		t.setDisk(B);
		t.emit("demo.openscreen");
		await t.flush();
		expect(t.onChange).not.toHaveBeenCalled();
	});

	it("skips half-written JSON and missing files, then reports the finished write", async () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		t.setDisk('{"version": 2, "edi');
		t.emit("demo.openscreen");
		await t.flush();
		t.setDisk(null);
		t.emit("demo.openscreen");
		await t.flush();
		expect(t.onChange).not.toHaveBeenCalled();

		t.setDisk(B);
		t.emit(null);
		await t.flush();
		expect(t.onChange).toHaveBeenCalledWith("/p/demo.openscreen", B);
	});

	it("re-arms on a new path and stops on null", async () => {
		const t = setup(A);
		t.watcher.setFile("/p/demo.openscreen", A);
		t.watcher.setFile("/q/next.openscreen", A);
		expect(t.closed).toEqual(["/p"]);
		expect(t.watched).toEqual(["/p", "/q"]);

		t.setDisk(B);
		t.emit("next.openscreen");
		t.watcher.setFile(null);
		await t.flush();
		expect(t.onChange).not.toHaveBeenCalled();
		expect(t.watcher.watchedPath).toBeNull();
	});
});
