export interface ParsedGradientStop {
	color: string;
	offset: number;
}

export interface ParsedGradient {
	type: "linear" | "radial";
	descriptor: string | null;
	stops: ParsedGradientStop[];
}

const COLOR_TOKEN_RE = /^(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)|[a-zA-Z-]+)/;

export function parseCssGradient(input: string): ParsedGradient | null {
	const gradientMatch = input.match(/^(linear|radial)-gradient\((.*)\)$/i);
	if (!gradientMatch) {
		return null;
	}

	const type = gradientMatch[1].toLowerCase() as ParsedGradient["type"];
	const rawArgs = splitGradientArgs(gradientMatch[2]);
	if (rawArgs.length === 0) {
		return null;
	}

	let descriptor: string | null = null;
	let stopArgs = rawArgs;

	if (isGradientDescriptor(type, rawArgs[0])) {
		descriptor = rawArgs[0];
		stopArgs = rawArgs.slice(1);
	}

	const parsedStops = stopArgs
		.map((part) => parseColorStop(part))
		.filter((stop): stop is { color: string; offset: number | null } => stop !== null);

	if (parsedStops.length === 0) {
		return null;
	}

	return {
		type,
		descriptor,
		stops: normalizeStopOffsets(parsedStops),
	};
}

export function getLinearGradientPoints(angleDeg: number, width: number, height: number) {
	const radians = (angleDeg * Math.PI) / 180;
	const vx = Math.sin(radians);
	const vy = -Math.cos(radians);
	const halfSpan = (Math.abs(vx) * width + Math.abs(vy) * height) / 2;
	const cx = width / 2;
	const cy = height / 2;

	return {
		x0: cx - vx * halfSpan,
		y0: cy - vy * halfSpan,
		x1: cx + vx * halfSpan,
		y1: cy + vy * halfSpan,
	};
}

export function resolveLinearGradientAngle(descriptor: string | null): number {
	if (!descriptor) {
		return 180;
	}

	const angleMatch = descriptor.match(/(-?\d*\.?\d+)deg/i);
	if (angleMatch) {
		return Number.parseFloat(angleMatch[1]);
	}

	const normalized = descriptor.trim().toLowerCase().replace(/\s+/g, " ");
	const directionMap: Record<string, number> = {
		"to top": 0,
		"to top right": 45,
		"to right": 90,
		"to bottom right": 135,
		"to bottom": 180,
		"to bottom left": 225,
		"to left": 270,
		"to top left": 315,
	};

	return directionMap[normalized] ?? 180;
}

export function getRadialGradientShape(descriptor: string | null, width: number, height: number) {
	const atMatch = descriptor?.match(/at\s+(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%/i);
	const cx = atMatch ? (Number.parseFloat(atMatch[1]) / 100) * width : width / 2;
	const cy = atMatch ? (Number.parseFloat(atMatch[2]) / 100) * height : height / 2;

	const distances = [
		Math.hypot(cx, cy),
		Math.hypot(width - cx, cy),
		Math.hypot(cx, height - cy),
		Math.hypot(width - cx, height - cy),
	];
	const radius = Math.max(...distances);

	// CSS defaults to an ellipse; farthest-corner keeps the farthest-side aspect ratio and
	// scales it by sqrt(2) so the ellipse passes through the corner.
	const isCircle = /\bcircle\b/i.test(descriptor ?? "");
	const farX = Math.max(cx, width - cx);
	const farY = Math.max(cy, height - cy);
	const radiusX = isCircle || farX === 0 || farY === 0 ? radius : farX * Math.SQRT2;
	const radiusY = isCircle || farX === 0 || farY === 0 ? radius : farY * Math.SQRT2;

	return {
		cx,
		cy,
		radius,
		radiusX,
		radiusY,
	};
}

/**
 * Splits a CSS background with several comma-separated gradient layers (first = top)
 * and parses each. Returns null if any layer is not a gradient the exporter can draw.
 */
export function parseCssBackgroundLayers(input: string): ParsedGradient[] | null {
	const layers = splitGradientArgs(input.trim());
	if (layers.length === 0) return null;
	const parsed: ParsedGradient[] = [];
	for (const layer of layers) {
		const gradient = parseCssGradient(layer);
		if (!gradient) return null;
		parsed.push(gradient);
	}
	return parsed;
}

type GradientCanvasContext = Pick<
	CanvasRenderingContext2D,
	| "createLinearGradient"
	| "createRadialGradient"
	| "fillRect"
	| "save"
	| "restore"
	| "translate"
	| "scale"
> & { fillStyle: CanvasRenderingContext2D["fillStyle"] };

/** Paints parsed layers bottom-up, matching how CSS stacks `background` layers. */
export function paintGradientLayers(
	ctx: GradientCanvasContext,
	layers: ParsedGradient[],
	width: number,
	height: number,
): void {
	for (const layer of [...layers].reverse()) {
		if (layer.type === "linear") {
			const p = getLinearGradientPoints(
				resolveLinearGradientAngle(layer.descriptor),
				width,
				height,
			);
			const gradient = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
			for (const stop of layer.stops) gradient.addColorStop(stop.offset, stop.color);
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, width, height);
			continue;
		}
		const shape = getRadialGradientShape(layer.descriptor, width, height);
		const sy = shape.radiusX > 0 ? shape.radiusY / shape.radiusX : 1;
		ctx.save();
		ctx.translate(shape.cx, shape.cy);
		ctx.scale(1, sy);
		const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, shape.radiusX);
		for (const stop of layer.stops) gradient.addColorStop(stop.offset, stop.color);
		ctx.fillStyle = gradient;
		ctx.fillRect(-shape.cx, -shape.cy / sy, width, height / sy);
		ctx.restore();
	}
}

/**
 * Adds +-1 level of deterministic noise per channel so smooth gradients don't band in
 * 8-bit output (and survive H.264 better). Skips silently when pixels can't be read.
 */
export function ditherCanvas(
	ctx: Pick<CanvasRenderingContext2D, "getImageData" | "putImageData">,
	width: number,
	height: number,
): void {
	let image: ImageData;
	try {
		image = ctx.getImageData(0, 0, width, height);
	} catch {
		return;
	}
	const data = image.data;
	let seed = 0x2f6b4e1d;
	for (let i = 0; i < data.length; i += 4) {
		// xorshift32: fast and identical on every run.
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		const n = ((seed >>> 0) % 3) - 1;
		data[i] = data[i] + n;
		data[i + 1] = data[i + 1] + n;
		data[i + 2] = data[i + 2] + n;
	}
	ctx.putImageData(image, 0, 0);
}

function splitGradientArgs(input: string): string[] {
	const parts: string[] = [];
	let current = "";
	let depth = 0;

	for (const char of input) {
		if (char === "(") {
			depth += 1;
			current += char;
			continue;
		}

		if (char === ")") {
			depth = Math.max(0, depth - 1);
			current += char;
			continue;
		}

		if (char === "," && depth === 0) {
			const trimmed = current.trim();
			if (trimmed) {
				parts.push(trimmed);
			}
			current = "";
			continue;
		}

		current += char;
	}

	const trimmed = current.trim();
	if (trimmed) {
		parts.push(trimmed);
	}

	return parts;
}

function isGradientDescriptor(type: ParsedGradient["type"], part: string) {
	if (type === "linear") {
		return /^\s*to\s+/i.test(part) || /-?\d*\.?\d+deg/i.test(part);
	}

	return /\b(circle|ellipse|closest|farthest)\b/i.test(part) || /\bat\b/i.test(part);
}

function parseColorStop(part: string): { color: string; offset: number | null } | null {
	const match = part.trim().match(COLOR_TOKEN_RE);
	if (!match) {
		return null;
	}

	const color = match[1];
	const rest = part.slice(match[0].length);
	const percentMatch = rest.match(/(-?\d*\.?\d+)%/);
	const offset = percentMatch ? clamp(Number.parseFloat(percentMatch[1]) / 100, 0, 1) : null;

	return { color, offset };
}

function normalizeStopOffsets(
	stops: Array<{ color: string; offset: number | null }>,
): ParsedGradientStop[] {
	const explicitCount = stops.filter((stop) => stop.offset !== null).length;
	if (explicitCount === 0) {
		if (stops.length === 1) {
			return [{ color: stops[0].color, offset: 0 }];
		}

		return stops.map((stop, index) => ({
			color: stop.color,
			offset: index / (stops.length - 1),
		}));
	}

	const resolved = stops.map((stop) => stop.offset);
	const firstExplicit = resolved.findIndex((offset) => offset !== null);
	const lastExplicit = findLastDefinedIndex(resolved);

	for (let index = 0; index < firstExplicit; index += 1) {
		const end = resolved[firstExplicit] ?? 0;
		resolved[index] = firstExplicit === 0 ? end : (end * index) / firstExplicit;
	}

	for (let index = lastExplicit + 1; index < resolved.length; index += 1) {
		const start = resolved[lastExplicit] ?? 1;
		const denominator = resolved.length - 1 - lastExplicit;
		resolved[index] =
			denominator <= 0 ? start : start + ((1 - start) * (index - lastExplicit)) / denominator;
	}

	let runStart = firstExplicit;
	while (runStart < lastExplicit) {
		const nextExplicit = resolved.findIndex((offset, index) => index > runStart && offset !== null);
		if (nextExplicit === -1) {
			break;
		}

		const start = resolved[runStart] ?? 0;
		const end = resolved[nextExplicit] ?? start;
		const gap = nextExplicit - runStart;

		for (let index = runStart + 1; index < nextExplicit; index += 1) {
			resolved[index] = start + ((end - start) * (index - runStart)) / gap;
		}

		runStart = nextExplicit;
	}

	return stops.map((stop, index) => ({
		color: stop.color,
		offset: clamp(resolved[index] ?? 0, 0, 1),
	}));
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function findLastDefinedIndex(values: Array<number | null>) {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		if (values[index] !== null) {
			return index;
		}
	}

	return -1;
}
