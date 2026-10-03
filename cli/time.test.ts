import { describe, expect, it } from "vitest";
import { formatTime, parseTime } from "./time";

describe("parseTime", () => {
	it.each([
		["12.5", 12500],
		["12.5s", 12500],
		["1500ms", 1500],
		["1:02.25", 62250],
		["1:00:01", 3601000],
		["0", 0],
		[".5", 500],
		[" 3S ", 3000],
	])("%s → %d ms", (input, ms) => {
		expect(parseTime(input)).toBe(ms);
	});

	it.each(["", "abc", "-1", "1:75", "1::2", "12.5m", "1.2.3"])("rejects %j", (input) => {
		expect(() => parseTime(input)).toThrow();
	});

	it("formats seconds with ms precision", () => {
		expect(formatTime(2162)).toBe("2.162s");
	});
});
