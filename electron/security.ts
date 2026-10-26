import { pathToFileURL } from "node:url";
import { type BrowserWindow, shell } from "electron";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/** Only web and mail links may leave the app; `file:`, `smb:`, app schemes etc. are refused. */
export function isSafeExternalUrl(url: unknown): url is string {
	return (
		typeof url === "string" &&
		URL.canParse(url) &&
		SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
	);
}

export async function openExternalUrl(url: unknown): Promise<{ success: boolean; error?: string }> {
	if (!isSafeExternalUrl(url)) {
		console.warn("Blocked external URL:", url);
		return { success: false, error: "URL scheme not allowed" };
	}
	try {
		await shell.openExternal(url);
		return { success: true };
	} catch (error) {
		console.error("Failed to open URL:", error);
		return { success: false, error: String(error) };
	}
}

export interface AppEntry {
	devServerUrl?: string;
	indexHtmlPath: string;
}

function isAppUrl(url: string, entry: AppEntry): boolean {
	if (!URL.canParse(url)) return false;
	const target = new URL(url);
	if (entry.devServerUrl) return target.origin === new URL(entry.devServerUrl).origin;
	return (
		target.protocol === "file:" && target.pathname === pathToFileURL(entry.indexHtmlPath).pathname
	);
}

/**
 * Windows carry the preload API, so they must never show other content: `window.open` is
 * denied (safe links go to the system browser) and navigation away from the app is blocked.
 */
export function hardenWebContents(win: BrowserWindow, entry: AppEntry): void {
	win.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event) => {
		if (isAppUrl(event.url, entry)) return;
		console.warn("Blocked navigation:", event.url);
		event.preventDefault();
	});
}
