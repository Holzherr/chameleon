// Headless `--chameleon-render` job, run inside a hidden window. Loads the project the
// same way the editor does and exports through the editor's own exporter configs.

import { DEFAULT_PROJECT_CURSOR } from "@/components/video-editor/editorDefaults";
import {
	normalizeProjectEditor,
	type ProjectEditorState,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "@/components/video-editor/projectPersistence";
import { loadAllCustomFonts } from "@/lib/customFonts";
import { FrameRenderer, GifExporter, VideoExporter } from "@/lib/exporter";
import {
	buildExportSettings,
	buildGifExporterConfig,
	buildMp4ExporterConfig,
	deriveCursorClickTimestamps,
	type ExportCursorState,
	type ExportMedia,
	getHeadlessPreviewSize,
	hasEditableCursorOverlay,
} from "@/lib/exporter/exportPlan";
import { computeEffectiveDurationSec } from "@/lib/exporter/streamingDecoder";
import { buildFrameRenderConfig } from "@/lib/exporter/videoExporter";
import { nativeBridgeClient } from "@/native";

interface RenderJob {
	projectPath: string;
	outPath: string;
	frameMs?: number;
}

interface RenderOutput {
	data: ArrayBuffer;
	durationMs: number;
}

/** Zoom/cursor smoothing is stateful, so a single frame is rendered after this much run-up. */
const FRAME_WARMUP_MS = 1500;
const FRAME_WARMUP_STEP_MS = 1000 / 60;
const MEDIA_LOAD_TIMEOUT_MS = 30_000;

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function waitForEvent(target: HTMLVideoElement, event: string): Promise<void> {
	return withTimeout(
		new Promise<void>((resolve, reject) => {
			const onEvent = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error(target.error?.message || `Failed to load ${target.src}`));
			};
			const cleanup = () => {
				target.removeEventListener(event, onEvent);
				target.removeEventListener("error", onError);
			};
			target.addEventListener(event, onEvent);
			target.addEventListener("error", onError);
		}),
		MEDIA_LOAD_TIMEOUT_MS,
		`Timed out waiting for video ${event}`,
	);
}

async function loadVideo(url: string): Promise<HTMLVideoElement> {
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.playsInline = true;
	const loaded = waitForEvent(video, "loadeddata");
	video.src = url;
	await loaded;
	return video;
}

async function seekVideo(video: HTMLVideoElement, timeSec: number) {
	const target = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.001)));
	if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return;
	const seeked = waitForEvent(video, "seeked");
	video.currentTime = target;
	await seeked;
}

function toExportEditor(editor: ProjectEditorState) {
	return {
		wallpaper: editor.wallpaper,
		zoomRegions: editor.zoomRegions,
		trimRegions: editor.trimRegions,
		speedRegions: editor.speedRegions,
		annotationRegions: editor.annotationRegions,
		shadowIntensity: editor.shadowIntensity,
		showBlur: editor.showBlur,
		motionBlurAmount: editor.motionBlurAmount,
		borderRadius: editor.borderRadius,
		padding: editor.padding,
		cropRegion: editor.cropRegion,
		aspectRatio: editor.aspectRatio,
		webcamLayoutPreset: editor.webcamLayoutPreset,
		webcamMaskShape: editor.webcamMaskShape,
		webcamMirrored: editor.webcamMirrored,
		webcamReactiveZoom: editor.webcamReactiveZoom,
		webcamSizePreset: editor.webcamSizePreset,
		webcamPosition: editor.webcamPosition,
	};
}

function extensionOf(filePath: string) {
	const base = filePath.split(/[\\/]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

async function renderJob(job: RenderJob): Promise<RenderOutput> {
	const loaded = await window.electronAPI.loadProjectFileFromPath(job.projectPath);
	if (!loaded.success) {
		throw new Error(loaded.message || loaded.error || "Failed to load project");
	}
	if (!validateProjectData(loaded.project)) {
		throw new Error("Invalid project file");
	}
	const projectMedia = resolveProjectMedia(loaded.project);
	if (!projectMedia) {
		throw new Error("Project has no screen video");
	}
	// Main approves media inside the project's folder or the recordings folder only.
	const session = await window.electronAPI.getCurrentRecordingSession();
	if (!session.success || !session.session) {
		throw new Error(
			`Project video is missing or outside the trusted folders: ${projectMedia.screenVideoPath}`,
		);
	}

	const editor = normalizeProjectEditor(loaded.project.editor);
	const screenPath = projectMedia.screenVideoPath;
	const webcamPath = projectMedia.webcamVideoPath ?? null;

	await loadAllCustomFonts();
	await document.fonts.ready;

	const [platform, recordingData, telemetry] = await Promise.all([
		nativeBridgeClient.system.getPlatform().catch(() => null),
		nativeBridgeClient.cursor.getRecordingData(screenPath).catch(() => null),
		nativeBridgeClient.cursor.getTelemetry(screenPath).catch(() => []),
	]);

	const cursorSettings = editor.cursor ?? DEFAULT_PROJECT_CURSOR;
	const cursor: ExportCursorState = {
		recordingData,
		scale:
			cursorSettings.show &&
			hasEditableCursorOverlay(projectMedia.cursorCaptureMode, platform, recordingData)
				? cursorSettings.size
				: 0,
		smoothing: cursorSettings.smoothing,
		motionBlur: cursorSettings.motionBlur,
		clickBounce: cursorSettings.clickBounce,
		clipToBounds: cursorSettings.clipToBounds,
		theme: editor.cursorTheme,
		telemetry,
		clickTimestamps: deriveCursorClickTimestamps(recordingData, telemetry),
	};

	const videoUrl = toFileUrl(screenPath);
	const webcamVideoUrl = webcamPath ? toFileUrl(webcamPath) : undefined;
	const video = await loadVideo(videoUrl);
	const exportEditor = toExportEditor(editor);
	const media: ExportMedia = {
		videoUrl,
		webcamVideoUrl,
		sourceWidth: video.videoWidth,
		sourceHeight: video.videoHeight,
		previewWidth: 0,
		previewHeight: 0,
	};
	const withPreview = <T extends { width: number; height: number }>(config: T): T => {
		const preview = getHeadlessPreviewSize(config.width, config.height);
		return { ...config, previewWidth: preview.width, previewHeight: preview.height };
	};
	const editedDurationMs = Math.round(
		computeEffectiveDurationSec(video.duration, editor.trimRegions, editor.speedRegions) * 1000,
	);

	if (job.frameMs !== undefined) {
		const config = withPreview(
			buildMp4ExporterConfig(editor.exportQuality, media, exportEditor, cursor),
		);
		const data = await renderSingleFrame(config, video, webcamVideoUrl, job.frameMs, platform);
		return { data, durationMs: 0 };
	}

	const ext = extensionOf(job.outPath);
	if (ext === ".gif") {
		const settings = buildExportSettings({
			format: "gif",
			quality: editor.exportQuality,
			gifFrameRate: editor.gifFrameRate,
			gifLoop: editor.gifLoop,
			gifSizePreset: editor.gifSizePreset,
			sourceWidth: video.videoWidth,
			sourceHeight: video.videoHeight,
			cropRegion: editor.cropRegion,
			aspectRatio: editor.aspectRatio,
		});
		if (!settings.gifConfig) throw new Error("Could not compute GIF settings");
		const exporter = new GifExporter(
			withPreview(buildGifExporterConfig(settings.gifConfig, media, exportEditor, cursor)),
		);
		const result = await exporter.export();
		if (!result.success || !result.blob) throw new Error(result.error || "GIF export failed");
		return { data: await result.blob.arrayBuffer(), durationMs: editedDurationMs };
	}

	const exporter = new VideoExporter(
		withPreview(buildMp4ExporterConfig(editor.exportQuality, media, exportEditor, cursor)),
	);
	const result = await exporter.export();
	if (!result.success || !result.blob) throw new Error(result.error || "Video export failed");
	return { data: await result.blob.arrayBuffer(), durationMs: editedDurationMs };
}

async function renderSingleFrame(
	config: ReturnType<typeof buildMp4ExporterConfig>,
	video: HTMLVideoElement,
	webcamVideoUrl: string | undefined,
	frameMs: number,
	platform: string | null,
): Promise<ArrayBuffer> {
	const webcamVideo = webcamVideoUrl ? await loadVideo(webcamVideoUrl) : null;
	const renderer = new FrameRenderer(
		buildFrameRenderConfig(
			config,
			{ width: video.videoWidth, height: video.videoHeight },
			webcamVideo ? { width: webcamVideo.videoWidth, height: webcamVideo.videoHeight } : null,
			platform ?? "unknown",
		),
	);
	let frame: VideoFrame | null = null;
	let webcamFrame: VideoFrame | null = null;
	try {
		await renderer.initialize();
		await seekVideo(video, frameMs / 1000);
		frame = new VideoFrame(video, { timestamp: Math.round(frameMs * 1000) });
		if (webcamVideo) {
			await seekVideo(webcamVideo, frameMs / 1000);
			webcamFrame = new VideoFrame(webcamVideo, { timestamp: Math.round(frameMs * 1000) });
		}

		// Run the springs up to the target time on the same picture, then render it for real.
		// Each pass needs its own VideoFrame object: Pixi caches textures per source object and
		// the renderer destroys the previous texture on every frame.
		const times: number[] = [];
		for (let t = Math.max(0, frameMs - FRAME_WARMUP_MS); t < frameMs; t += FRAME_WARMUP_STEP_MS) {
			times.push(t);
		}
		times.push(frameMs);
		let previous: VideoFrame[] = [];
		for (const t of times) {
			const pass = [frame.clone(), ...(webcamFrame ? [webcamFrame.clone()] : [])];
			await renderer.renderFrame(pass[0], Math.round(t * 1000), pass[1] ?? null);
			for (const old of previous) old.close();
			previous = pass;
		}

		const canvas = renderer.getCanvas();
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		for (const old of previous) old.close();
		if (!blob) throw new Error("Could not encode frame as PNG");
		return await blob.arrayBuffer();
	} finally {
		frame?.close();
		webcamFrame?.close();
		renderer.destroy();
	}
}

let started = false;

/** Fetches the job from main, runs it, and reports back. Main writes the file and exits. */
export async function runHeadlessRender() {
	if (started) return;
	started = true;
	const job = await window.electronAPI.chameleonGetRenderJob();
	if (!job) return;
	try {
		const output = await renderJob(job);
		await window.electronAPI.chameleonRenderDone({
			ok: true,
			data: output.data,
			durationMs: output.durationMs,
		});
	} catch (error) {
		await window.electronAPI.chameleonRenderDone({ ok: false, error: errorMessage(error) });
	}
}
