import { describe, expect, test } from "bun:test";
import { sortJsonKeys } from "./sortJson";

describe("sortJsonKeys", () => {
	test("sorts top-level keys alphabetically", () => {
		const result = sortJsonKeys('{"b":1,"a":2}');
		expect(result).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
	});

	test("sorts nested object keys recursively", () => {
		const result = sortJsonKeys('{"z":{"b":1,"a":2}}');
		expect(JSON.parse(result)).toEqual({ z: { a: 2, b: 1 } });
		expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
	});

	test("sorts keys of objects inside arrays but leaves array element order untouched", () => {
		const result = sortJsonKeys('{"list":[{"b":1,"a":2},"z","a"]}');
		expect(JSON.parse(result)).toEqual({ list: [{ a: 2, b: 1 }, "z", "a"] });
	});

	test("is idempotent: sorting already-sorted content changes nothing", () => {
		const once = sortJsonKeys('{"b":1,"a":2}');
		expect(sortJsonKeys(once)).toBe(once);
	});

	test("falls back to the original content unchanged when it isn't valid JSON", () => {
		const withComment = '{\n  // a comment\n  "b": 1,\n  "a": 2\n}';
		expect(sortJsonKeys(withComment)).toBe(withComment);
	});
});
