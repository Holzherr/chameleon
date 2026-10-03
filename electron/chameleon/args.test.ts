import { describe, expect, it } from "vitest";
import { formatResultLine, parseChameleonArgs, parseResultLine } from "./args";

describe("parseChameleonArgs", () => {
	it("reads the open path", () => {
		expect(parseChameleonArgs(["electron", ".", "--chameleon-open=/tmp/a.openscreen"])).toEqual({
			openPath: "/tmp/a.openscreen",
		});
	});

	it("accepts space-separated values", () => {
		expect(parseChameleonArgs(["--chameleon-open", "/tmp/a b.openscreen"]).openPath).toBe(
			"/tmp/a b.openscreen",
		);
	});

	it("returns nothing for a plain launch", () => {
		expect(parseChameleonArgs(["electron", "."])).toEqual({});
	});

	it("builds an MP4 render job", () => {
		expect(
			parseChameleonArgs(["--chameleon-render=/p/x.openscreen", "--chameleon-out=/o/out.mp4"])
				.render,
		).toEqual({ projectPath: "/p/x.openscreen", outPath: "/o/out.mp4" });
	});

	it("builds a frame job", () => {
		expect(
			parseChameleonArgs([
				"--chameleon-render=/p/x.openscreen",
				"--chameleon-out=/o/f.png",
				"--chameleon-frame-ms=1500",
			]).render,
		).toEqual({ projectPath: "/p/x.openscreen", outPath: "/o/f.png", frameMs: 1500 });
	});

	it.each([
		[["--chameleon-render=rel.openscreen", "--chameleon-out=/o.mp4"], "absolute"],
		[["--chameleon-render=/p/x.json", "--chameleon-out=/o.mp4"], ".openscreen"],
		[["--chameleon-render=/p/x.openscreen"], "absolute output"],
		[["--chameleon-render=/p/x.openscreen", "--chameleon-out=/o.mov"], ".mp4 or .gif"],
		[
			["--chameleon-render=/p/x.openscreen", "--chameleon-out=/o.mp4", "--chameleon-frame-ms=5"],
			".png",
		],
		[
			["--chameleon-render=/p/x.openscreen", "--chameleon-out=/o.png", "--chameleon-frame-ms=-1"],
			"non-negative",
		],
		[
			["--chameleon-render=/p/x.openscreen", "--chameleon-out=/o.png", "--chameleon-frame-ms=abc"],
			"non-negative",
		],
	])("rejects bad render args %j", (argv, message) => {
		const parsed = parseChameleonArgs(argv);
		expect(parsed.render).toBeUndefined();
		expect(parsed.renderError).toContain(message);
	});
});

describe("result line", () => {
	it("round-trips through noisy stdout", () => {
		const stdout = [
			"RECORDINGS_DIR: /x",
			formatResultLine({ ok: true, path: "/o.mp4", durationMs: 7900 }),
			"",
		].join("\n");
		expect(parseResultLine(stdout)).toEqual({ ok: true, path: "/o.mp4", durationMs: 7900 });
	});

	it("takes the last valid line and skips malformed ones", () => {
		const stdout = [
			formatResultLine({ ok: false, error: "first" }),
			"CHAMELEON_RESULT {not json",
			'CHAMELEON_RESULT {"no":"ok field"}',
		].join("\r\n");
		expect(parseResultLine(stdout)).toEqual({ ok: false, error: "first" });
	});

	it("returns undefined without a result line", () => {
		expect(parseResultLine("hello\nworld")).toBeUndefined();
	});
});
