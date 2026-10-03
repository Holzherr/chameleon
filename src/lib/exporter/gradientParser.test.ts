import { describe, expect, it } from "vitest";
import {
	ditherCanvas,
	getLinearGradientPoints,
	getRadialGradientShape,
	paintGradientLayers,
	parseCssBackgroundLayers,
	parseCssGradient,
	resolveLinearGradientAngle,
} from "./gradientParser";

describe("parseCssGradient", () => {
	it("parses rgba-based gradient presets without splitting inside color functions", () => {
		const parsed = parseCssGradient(
			"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
		);

		expect(parsed?.type).toBe("linear");
		expect(parsed?.descriptor).toBe("111.6deg");
		expect(parsed?.stops).toHaveLength(4);
		expect(parsed?.stops.map((stop) => stop.color)).toEqual([
			"rgba(114,167,232,1)",
			"rgba(253,129,82,1)",
			"rgba(253,129,82,1)",
			"rgba(249,202,86,1)",
		]);
		expect(parsed?.stops[0]?.offset).toBeCloseTo(0.094);
		expect(parsed?.stops[1]?.offset).toBeCloseTo(0.439);
		expect(parsed?.stops[2]?.offset).toBeCloseTo(0.548);
		expect(parsed?.stops[3]?.offset).toBeCloseTo(0.863);
	});

	it("fills missing stop positions for simple hex gradients", () => {
		const parsed = parseCssGradient("linear-gradient(135deg, #FBC8B4, #2447B1)");

		expect(parsed?.stops).toEqual([
			{ color: "#FBC8B4", offset: 0 },
			{ color: "#2447B1", offset: 1 },
		]);
	});
});

describe("gradient geometry", () => {
	it("maps linear directions to canvas endpoints", () => {
		const angle = resolveLinearGradientAngle("to right");
		const points = getLinearGradientPoints(angle, 1920, 1080);

		expect(points.x0).toBeCloseTo(0);
		expect(points.y0).toBeCloseTo(540);
		expect(points.x1).toBeCloseTo(1920);
		expect(points.y1).toBeCloseTo(540);
	});

	it("uses radial positions from the descriptor", () => {
		const shape = getRadialGradientShape("circle farthest-corner at 10% 20%", 1000, 500);

		expect(shape.cx).toBe(100);
		expect(shape.cy).toBe(100);
		expect(shape.radius).toBeCloseTo(Math.hypot(900, 400));
	});
});

describe("layered backgrounds", () => {
	const mesh =
		"radial-gradient(circle at 10% 20%, rgba(255,0,0,0.8) 0%, rgba(255,0,0,0) 50%), radial-gradient(ellipse at 90% 80%, rgba(0,0,255,1) 0%, rgba(0,0,255,0) 60%), linear-gradient(135deg, #111 0%, #eee 100%)";

	it("splits top-level layers without breaking colour functions", () => {
		const layers = parseCssBackgroundLayers(mesh);
		expect(layers?.map((l) => l.type)).toEqual(["radial", "radial", "linear"]);
		expect(layers?.[0]?.descriptor).toBe("circle at 10% 20%");
		expect(layers?.[0]?.stops).toEqual([
			{ color: "rgba(255,0,0,0.8)", offset: 0 },
			{ color: "rgba(255,0,0,0)", offset: 0.5 },
		]);
	});

	it("parses a single gradient as one layer and rejects unsupported layers", () => {
		expect(parseCssBackgroundLayers("linear-gradient(90deg, #000, #fff)")).toHaveLength(1);
		expect(parseCssBackgroundLayers("conic-gradient(red, blue)")).toBeNull();
		expect(parseCssBackgroundLayers(`${mesh}, conic-gradient(red, blue)`)).toBeNull();
		expect(parseCssBackgroundLayers("")).toBeNull();
	});

	it("sizes ellipses to the farthest corner like CSS", () => {
		const shape = getRadialGradientShape("ellipse at 25% 50%", 1000, 500);
		expect(shape.radiusX).toBeCloseTo(750 * Math.SQRT2);
		expect(shape.radiusY).toBeCloseTo(250 * Math.SQRT2);
		const circle = getRadialGradientShape("circle at 25% 50%", 1000, 500);
		expect(circle.radiusX).toBe(circle.radius);
		expect(circle.radiusY).toBe(circle.radius);
	});

	it("paints the bottom layer first", () => {
		const calls: string[] = [];
		const gradient = { addColorStop: (o: number, c: string) => calls.push(`stop ${o} ${c}`) };
		const ctx = {
			fillStyle: "" as unknown,
			createLinearGradient: () => {
				calls.push("linear");
				return gradient;
			},
			createRadialGradient: (...args: number[]) => {
				calls.push(`radial r=${Math.round(args[5])}`);
				return gradient;
			},
			fillRect: () => calls.push("fill"),
			save: () => calls.push("save"),
			restore: () => calls.push("restore"),
			translate: () => undefined,
			scale: (_x: number, y: number) => calls.push(`scale ${y.toFixed(2)}`),
		};
		const layers = parseCssBackgroundLayers(mesh);
		expect(layers).not.toBeNull();
		paintGradientLayers(ctx as never, layers ?? [], 1000, 500);
		const kinds = calls.filter((c) => c.startsWith("linear") || c.startsWith("radial"));
		expect(kinds[0]).toBe("linear");
		// Ellipse at 90% 80%: farthest sides 900 x 400.
		expect(kinds[1]).toBe(`radial r=${Math.round(900 * Math.SQRT2)}`);
		expect(calls).toContain(`scale ${(400 / 900).toFixed(2)}`);
		expect(kinds[2]).toBe(`radial r=${Math.round(Math.hypot(900, 400))}`);
		expect(calls.filter((c) => c === "fill")).toHaveLength(3);
	});

	it("dithers by at most one level per channel, deterministically", () => {
		const make = () => {
			const data = new Uint8ClampedArray(4 * 64).fill(128);
			let out: Uint8ClampedArray | null = null;
			ditherCanvas(
				{
					getImageData: () => ({ data }) as ImageData,
					putImageData: (img: ImageData) => {
						out = img.data;
					},
				},
				8,
				8,
			);
			return out as unknown as Uint8ClampedArray;
		};
		const a = make();
		const b = make();
		expect(Array.from(a)).toEqual(Array.from(b));
		for (let i = 0; i < a.length; i += 4) {
			expect(Math.abs(a[i] - 128)).toBeLessThanOrEqual(1);
			expect(a[i + 3]).toBe(128);
		}
		expect(new Set(Array.from(a).filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(1);
	});
});
