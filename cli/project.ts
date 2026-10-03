import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_CURSOR } from "@/components/video-editor/editorDefaults";
import {
	createProjectData,
	type EditorProjectData,
	normalizeProjectEditor,
	type ProjectEditorState,
	resolveProjectMedia,
	validateProjectData,
} from "@/components/video-editor/projectPersistence";
import type {
	AnnotationRegion,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "@/components/video-editor/types";
import type { ProjectMedia } from "@/lib/recordingSession";
import { isProjectFilePath, PROJECT_EXTENSION } from "../electron/chameleon/args";
import { CliError } from "./errors";
import { writeFileAtomic } from "./media";

export { isProjectFilePath, PROJECT_EXTENSION };

/**
 * A project as read from disk. `data.editor` is kept as stored (not normalized)
 * so fields the app writes but `normalizeProjectEditor` drops (e.g. a zoom's
 * `customScale`) survive a CLI edit.
 */
export interface LoadedProject {
	path: string;
	data: EditorProjectData;
	media: ProjectMedia;
}

export async function loadProject(projectPath: string): Promise<LoadedProject> {
	const abs = path.resolve(projectPath);
	let raw: string;
	try {
		raw = await fs.readFile(abs, "utf-8");
	} catch {
		throw new CliError(`project not found: ${abs}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CliError(`project is not valid JSON: ${abs}`);
	}
	if (!validateProjectData(parsed)) {
		throw new CliError(`not a Chameleon project (missing version, media or editor): ${abs}`);
	}
	const media = resolveProjectMedia(parsed);
	if (!media) throw new CliError(`project has no screen video: ${abs}`);
	return { path: abs, data: parsed, media };
}

/** Writes like the app (`JSON.stringify(data, null, 2)`), via temp file + rename. */
export async function saveProject(project: LoadedProject): Promise<void> {
	// Refuse to write anything the app would reshape on load.
	normalizeProjectEditor(project.data.editor);
	await writeFileAtomic(project.path, JSON.stringify(project.data, null, 2));
}

/**
 * Builds the project the editor would save for a fresh recording: the app seeds
 * the editor with `INITIAL_EDITOR_STATE` and saves it through
 * `normalizeProjectEditor`, which fills export/GIF defaults, plus the cursor settings.
 * `normalizeProjectEditor({})` yields the same state (asserted in project.test.ts).
 */
export function createNewProjectData(media: ProjectMedia): EditorProjectData {
	return createProjectData(media, {
		...normalizeProjectEditor({}),
		cursor: { ...DEFAULT_PROJECT_CURSOR },
	});
}

export function editorOf(project: LoadedProject): ProjectEditorState {
	return project.data.editor;
}

export function regionsOf(project: LoadedProject): {
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
} {
	const e = project.data.editor;
	return {
		trimRegions: Array.isArray(e.trimRegions) ? e.trimRegions : [],
		speedRegions: Array.isArray(e.speedRegions) ? e.speedRegions : [],
		zoomRegions: Array.isArray(e.zoomRegions) ? e.zoomRegions : [],
		annotationRegions: Array.isArray(e.annotationRegions) ? e.annotationRegions : [],
	};
}

export function defaultProjectPath(videoPath: string): string {
	const dir = path.dirname(videoPath);
	const base = path.basename(videoPath).replace(/\.[^.]+$/, "");
	return path.join(dir, `${base}${PROJECT_EXTENSION}`);
}

export function transcriptCachePath(projectOrVideoPath: string): string {
	return `${projectOrVideoPath}.transcript.json`;
}

export const REGION_KEYS = [
	"trimRegions",
	"speedRegions",
	"zoomRegions",
	"annotationRegions",
] as const;

/** Top-level editor settings `set` may change (everything except region arrays). */
export const SETTABLE_KEYS = [
	...Object.keys(normalizeProjectEditor({})).filter(
		(k) => !(REGION_KEYS as readonly string[]).includes(k),
	),
	"cursor",
] as Array<keyof ProjectEditorState>;
