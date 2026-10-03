// Curated backgrounds: soft mesh-style gradients (radial colour blobs over a linear base).
// The project file stores the CSS value; ids are stable handles for the CLI and presets.
// Fade-outs use the blob colour at alpha 0 (not `transparent`) so canvas and CSS
// interpolate the same way.

import { WALLPAPER_PATHS } from "./wallpaper";

export interface Background {
	id: string;
	name: string;
	/** CSS value stored as the project's `wallpaper`. */
	value: string;
	tone: "light" | "dark";
}

function blob(x: number, y: number, rgb: string, alpha: number, reach: number): string {
	return `radial-gradient(circle at ${x}% ${y}%, rgba(${rgb},${alpha}) 0%, rgba(${rgb},0) ${reach}%)`;
}

function mesh(base: string, ...blobs: string[]): string {
	return [...blobs, base].join(", ");
}

export const BACKGROUNDS: readonly Background[] = [
	{
		id: "dusk",
		name: "Dusk",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #6d5bd0 0%, #b06ab3 50%, #f0a07c 100%)",
			blob(12, 18, "120,140,255", 0.85, 55),
			blob(88, 82, "255,190,140", 0.8, 55),
			blob(78, 12, "236,120,190", 0.6, 45),
		),
	},
	{
		id: "dawn",
		name: "Dawn",
		tone: "light",
		value: mesh(
			"linear-gradient(160deg, #fbd3c4 0%, #f5b8cf 50%, #c9b8f2 100%)",
			blob(15, 20, "255,224,196", 0.9, 50),
			blob(85, 75, "186,170,255", 0.75, 55),
			blob(70, 15, "255,170,200", 0.55, 40),
		),
	},
	{
		id: "sky",
		name: "Sky",
		tone: "light",
		value: mesh(
			"linear-gradient(180deg, #a9cdfb 0%, #c7dcfa 55%, #e8eefc 100%)",
			blob(20, 15, "120,170,250", 0.7, 50),
			blob(85, 85, "200,215,255", 0.8, 50),
			blob(80, 20, "170,225,250", 0.6, 40),
		),
	},
	{
		id: "mint",
		name: "Mint",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #b6f0d8 0%, #a6e3e9 55%, #c7d8f8 100%)",
			blob(15, 80, "150,235,190", 0.8, 50),
			blob(85, 20, "150,205,245", 0.7, 50),
			blob(55, 10, "220,250,210", 0.6, 40),
		),
	},
	{
		id: "lavender",
		name: "Lavender",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #d9c8fb 0%, #c3c9f7 50%, #e9d3f4 100%)",
			blob(20, 25, "190,160,250", 0.8, 50),
			blob(85, 75, "245,195,235", 0.75, 50),
			blob(75, 15, "170,185,250", 0.5, 40),
		),
	},
	{
		id: "rose",
		name: "Rose",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #f7c6c7 0%, #f3a6b8 50%, #f8d6c8 100%)",
			blob(15, 20, "255,215,200", 0.85, 50),
			blob(85, 80, "235,140,170", 0.7, 50),
			blob(80, 15, "250,190,210", 0.55, 40),
		),
	},
	{
		id: "sand",
		name: "Sand",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #f3e7d7 0%, #ead8c0 55%, #e2d6cc 100%)",
			blob(15, 15, "255,245,228", 0.9, 50),
			blob(85, 85, "220,190,160", 0.6, 50),
			blob(80, 20, "245,215,190", 0.5, 40),
		),
	},
	{
		id: "ocean",
		name: "Ocean",
		tone: "dark",
		value: mesh(
			"linear-gradient(135deg, #0b3a6f 0%, #0e5f8a 50%, #1a8a9a 100%)",
			blob(15, 20, "40,110,220", 0.8, 50),
			blob(85, 80, "40,190,180", 0.7, 50),
			blob(75, 15, "80,150,240", 0.45, 40),
		),
	},
	{
		id: "sunset",
		name: "Sunset",
		tone: "light",
		value: mesh(
			"linear-gradient(135deg, #f6866a 0%, #f59f6b 50%, #f6c37a 100%)",
			blob(15, 80, "240,100,120", 0.75, 50),
			blob(85, 20, "255,205,120", 0.8, 50),
			blob(30, 10, "250,140,100", 0.5, 40),
		),
	},
	{
		id: "aurora",
		name: "Aurora",
		tone: "dark",
		value: mesh(
			"linear-gradient(160deg, #0d1b2a 0%, #13293d 55%, #1b1f3a 100%)",
			blob(20, 25, "40,200,160", 0.55, 50),
			blob(80, 70, "120,80,220", 0.55, 50),
			blob(60, 10, "60,150,220", 0.4, 40),
		),
	},
	{
		id: "graphite",
		name: "Graphite",
		tone: "dark",
		value: mesh(
			"linear-gradient(160deg, #2a2d34 0%, #1f2228 55%, #17191d 100%)",
			blob(20, 15, "90,100,120", 0.5, 50),
			blob(85, 85, "60,66,80", 0.6, 50),
		),
	},
	{
		id: "midnight",
		name: "Midnight",
		tone: "dark",
		value: mesh(
			"linear-gradient(135deg, #10123a 0%, #1c1650 50%, #2a1446 100%)",
			blob(15, 20, "60,70,200", 0.6, 50),
			blob(85, 80, "150,60,160", 0.5, 50),
			blob(70, 15, "90,80,220", 0.35, 40),
		),
	},
];

export const DEFAULT_BACKGROUND_ID = "dusk";

/** Bundled image wallpapers as `wallpaper1`…`wallpaper18`. */
export const IMAGE_BACKGROUNDS: readonly { id: string; name: string; value: string }[] =
	WALLPAPER_PATHS.map((value, i) => ({
		id: `wallpaper${i + 1}`,
		name: `Wallpaper ${i + 1}`,
		value,
	}));

export function getBackground(id: string): Background | undefined {
	return BACKGROUNDS.find((b) => b.id === id);
}

export const DEFAULT_BACKGROUND_VALUE = (getBackground(DEFAULT_BACKGROUND_ID) as Background).value;

/** Background id (curated or `wallpaperN`) → stored wallpaper value, or undefined. */
export function resolveBackgroundId(id: string): string | undefined {
	const key = id.trim().toLowerCase();
	return (
		BACKGROUNDS.find((b) => b.id === key)?.value ??
		IMAGE_BACKGROUNDS.find((b) => b.id === key)?.value
	);
}

/** Stored wallpaper value → its background id, or null for custom values. */
export function backgroundIdOf(value: string): string | null {
	return (
		BACKGROUNDS.find((b) => b.value === value)?.id ??
		IMAGE_BACKGROUNDS.find((b) => b.value === value)?.id ??
		null
	);
}
