import { describe, expect, test } from "bun:test";
import { decideSyncAction } from "./conflict";

describe("decideSyncAction", () => {
	test("neither side changed since last sync", () => {
		expect(decideSyncAction(100, 100, 100)).toBe("none");
	});

	test("only local changed", () => {
		expect(decideSyncAction(200, 100, 100)).toBe("push");
	});

	test("only remote changed", () => {
		expect(decideSyncAction(100, 200, 100)).toBe("pull");
	});

	test("both changed, local is newer", () => {
		expect(decideSyncAction(300, 200, 100)).toBe("push");
	});

	test("both changed, remote is newer", () => {
		expect(decideSyncAction(200, 300, 100)).toBe("pull");
	});

	test("both changed, exact tie prefers local", () => {
		expect(decideSyncAction(200, 200, 100)).toBe("push");
	});
});
