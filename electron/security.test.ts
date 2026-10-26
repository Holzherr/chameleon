import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";

const openExternal = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("electron", () => ({ shell: { openExternal } }));

import { hardenWebContents, isSafeExternalUrl, openExternalUrl } from "./security";

const INDEX = "/Applications/Chameleon.app/Contents/Resources/app.asar/dist/index.html";
vi.spyOn(console, "warn").mockImplementation(() => undefined);

describe("isSafeExternalUrl", () => {
	it.each(["https://github.com/x", "mailto:a@b.c"])("accepts %s", (url) => {
		expect(isSafeExternalUrl(url)).toBe(true);
	});

	it.each([
		"file:///etc/passwd",
		"javascript:alert(1)",
		"smb://host/share",
		"not a url",
	])("rejects %s", (url) => expect(isSafeExternalUrl(url)).toBe(false));
});

describe("openExternalUrl", () => {
	it("refuses a rejected URL without calling shell.openExternal", async () => {
		await expect(openExternalUrl("file:///etc/passwd")).resolves.toMatchObject({ success: false });
		expect(openExternal).not.toHaveBeenCalled();
		await expect(openExternalUrl("https://github.com/x")).resolves.toEqual({ success: true });
		expect(openExternal).toHaveBeenCalledWith("https://github.com/x");
	});
});

describe("hardenWebContents", () => {
	const handlers: Record<string, (arg: never) => unknown> = {};
	const win = {
		webContents: {
			setWindowOpenHandler: (fn: never) => (handlers["window-open"] = fn),
			on: (name: string, fn: never) => (handlers[name] = fn),
		},
	} as unknown as BrowserWindow;
	hardenWebContents(win, { indexHtmlPath: INDEX });
	const navigate = (url: string) => {
		const preventDefault = vi.fn();
		handlers["will-navigate"]({ url, preventDefault } as never);
		return preventDefault;
	};

	it("denies window.open", () => {
		const result = handlers["window-open"]({ url: "https://example.com" } as never);
		expect(result).toEqual({ action: "deny" });
	});

	it("blocks navigation away from the app but not within it", () => {
		expect(navigate("https://example.com")).toHaveBeenCalled();
		expect(navigate("file:///etc/passwd")).toHaveBeenCalled();
		expect(navigate(`file://${INDEX}?windowType=editor`)).not.toHaveBeenCalled();
	});
});
