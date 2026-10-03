import type {
	CursorRecordingData,
	CursorRecordingSample,
	NativeCursorAsset,
	NativePlatform,
} from "./contracts";

/**
 * Parsing for `<video>.cursor.json`, the cursor telemetry the recorder writes next to
 * each video. Shared by the Electron main process and the `chameleon` CLI so both read
 * the file identically.
 */
export const CURSOR_TELEMETRY_VERSION = 2;

export function emptyCursorRecordingData(): CursorRecordingData {
	return { version: CURSOR_TELEMETRY_VERSION, provider: "none", samples: [], assets: [] };
}

function normalizeCursorSample(sample: unknown): CursorRecordingSample | null {
	if (!sample || typeof sample !== "object") {
		return null;
	}

	const point = sample as Partial<CursorRecordingSample>;
	const interactionType =
		point.interactionType === "click" ||
		point.interactionType === "mouseup" ||
		point.interactionType === "move"
			? point.interactionType
			: "move";
	return {
		timeMs:
			typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
				? Math.max(0, point.timeMs)
				: 0,
		cx: typeof point.cx === "number" && Number.isFinite(point.cx) ? point.cx : 0.5,
		cy: typeof point.cy === "number" && Number.isFinite(point.cy) ? point.cy : 0.5,
		assetId: typeof point.assetId === "string" ? point.assetId : null,
		visible: typeof point.visible === "boolean" ? point.visible : true,
		cursorType: typeof point.cursorType === "string" ? point.cursorType : null,
		interactionType,
	};
}

function normalizeCursorAsset(asset: unknown, hostPlatform: string): NativeCursorAsset | null {
	if (!asset || typeof asset !== "object") {
		return null;
	}

	const candidate = asset as Partial<NativeCursorAsset>;
	if (typeof candidate.id !== "string" || typeof candidate.imageDataUrl !== "string") {
		return null;
	}

	const platform: NativePlatform =
		candidate.platform === "win32" ? "win32" : hostPlatform === "darwin" ? "darwin" : "linux";
	return {
		id: candidate.id,
		platform,
		imageDataUrl: candidate.imageDataUrl,
		width:
			typeof candidate.width === "number" && Number.isFinite(candidate.width)
				? Math.max(1, Math.round(candidate.width))
				: 1,
		height:
			typeof candidate.height === "number" && Number.isFinite(candidate.height)
				? Math.max(1, Math.round(candidate.height))
				: 1,
		hotspotX:
			typeof candidate.hotspotX === "number" && Number.isFinite(candidate.hotspotX)
				? Math.max(0, Math.round(candidate.hotspotX))
				: 0,
		hotspotY:
			typeof candidate.hotspotY === "number" && Number.isFinite(candidate.hotspotY)
				? Math.max(0, Math.round(candidate.hotspotY))
				: 0,
		scaleFactor:
			typeof candidate.scaleFactor === "number" && Number.isFinite(candidate.scaleFactor)
				? Math.max(0.1, candidate.scaleFactor)
				: undefined,
		cursorType: typeof candidate.cursorType === "string" ? candidate.cursorType : null,
	};
}

/**
 * Parses the file content (a bare sample array or `{version, provider, samples, assets}`).
 * Throws on invalid JSON. `hostPlatform` stands in for assets without a platform tag.
 */
export function parseCursorRecordingFile(
	content: string,
	hostPlatform: string,
): CursorRecordingData {
	const parsed = JSON.parse(content);
	const rawSamples = Array.isArray(parsed)
		? parsed
		: Array.isArray(parsed?.samples)
			? parsed.samples
			: [];
	const rawAssets = Array.isArray(parsed?.assets) ? parsed.assets : [];

	const samples = rawSamples
		.map((sample: unknown) => normalizeCursorSample(sample))
		.filter((sample: CursorRecordingSample | null): sample is CursorRecordingSample =>
			Boolean(sample),
		)
		.sort((a: CursorRecordingSample, b: CursorRecordingSample) => a.timeMs - b.timeMs);

	const assets = rawAssets
		.map((asset: unknown) => normalizeCursorAsset(asset, hostPlatform))
		.filter((asset: NativeCursorAsset | null): asset is NativeCursorAsset => Boolean(asset));

	return {
		version:
			typeof parsed?.version === "number" && Number.isFinite(parsed.version) ? parsed.version : 1,
		provider: parsed?.provider === "native" ? "native" : "none",
		samples,
		assets,
	};
}
