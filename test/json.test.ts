import { describe, expect, test } from "bun:test";
import { sameJson, sortKeys, toSortedJson } from "@util/json";

describe("sortKeys", () => {
	test("sorts object keys at every level", () => {
		expect(JSON.stringify(sortKeys({ b: 1, a: { d: 1, c: 2 } }))).toBe(
			'{"a":{"c":2,"d":1},"b":1}',
		);
	});

	test("keeps array order but sorts objects inside arrays", () => {
		expect(sortKeys([{ z: 1, a: 2 }, 3, 1])).toEqual([{ a: 2, z: 1 }, 3, 1]);
		expect(JSON.stringify(sortKeys([{ z: 1, a: 2 }]))).toBe('[{"a":2,"z":1}]');
	});

	test("sorts alphabetically regardless of case, the same on every machine", () => {
		expect(
			Object.keys(sortKeys({ beta: 1, Alpha: 2, zeta: 3 }) as object),
		).toEqual(["Alpha", "beta", "zeta"]);
	});
});

describe("toSortedJson", () => {
	test("pretty-prints sorted JSON with a trailing newline", () => {
		expect(toSortedJson({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
	});

	test("uses the given indentation and line ending", () => {
		expect(toSortedJson({ a: 1 }, "\t", "\r\n")).toBe('{\r\n\t"a": 1\r\n}\r\n');
	});
});

describe("sameJson", () => {
	test("ignores object key order", () => {
		expect(
			sameJson({ a: 1, b: { c: 1, d: 2 } }, { b: { d: 2, c: 1 }, a: 1 }),
		).toBe(true);
	});

	test("respects array order", () => {
		expect(sameJson([1, 2], [2, 1])).toBe(false);
	});
});
