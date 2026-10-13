import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsoncFile } from "@util/jsonc-file";
import * as vscode from "vscode";
import { fireFileEvent, resetFake } from "./fake-vscode";
import { sleep, tempDir, testLogger } from "./helpers";

let dir: string;

beforeEach(() => {
	resetFake();
	dir = tempDir();
});

const file = (name = "settings.json") =>
	new JsoncFile(vscode.Uri.file(join(dir, name)), "{}\n", testLogger());

describe("read", () => {
	test("parses comments and trailing commas", async () => {
		writeFileSync(
			join(dir, "settings.json"),
			'{\n  // note\n  "a": 1, /* x */ "b": [1, 2,],\n}\n',
		);

		const snapshot = await file().read();

		expect(snapshot.value).toEqual({ a: 1, b: [1, 2] });
		expect(snapshot.text).toContain("// note");
		expect(snapshot.modifiedAt).toBeGreaterThan(0);
	});

	test("uses the empty text, modified at 0, when the file doesn't exist", async () => {
		expect(await file().read()).toEqual({
			value: {},
			text: "{}\n",
			modifiedAt: 0,
		});
	});

	test("reports parse errors with line numbers", async () => {
		writeFileSync(join(dir, "settings.json"), '{\n  "a": 1\n  "b": 2\n}\n');

		await expect(file().read()).rejects.toThrow(
			"settings.json is invalid: CommaExpected at line 3",
		);
	});
});

describe("write", () => {
	test("writes sorted JSON in the file's indentation, dropping comments", async () => {
		const target = file();
		const text = await target.write('{\n\t// old\n\t"z": 1\n}\n', {
			z: 1,
			a: { d: 1, c: 2 },
		});

		expect(text).toBe(
			'{\n\t"a": {\n\t\t"c": 2,\n\t\t"d": 1\n\t},\n\t"z": 1\n}\n',
		);
		expect(readFileSync(join(dir, "settings.json"), "utf8")).toBe(text);
	});

	test("keeps Windows line endings and defaults to 4 spaces", async () => {
		expect(await file().write("{}\r\n", { a: 1 })).toBe(
			'{\r\n    "a": 1\r\n}\r\n',
		);
	});
});

describe("watch", () => {
	test("files in the same folder share one *.json watch pattern and filter by name", async () => {
		const settings: string[] = [];
		const keybindings: string[] = [];
		file("settings.json").watch(() => settings.push("changed"));
		file("keybindings.json").watch(() => keybindings.push("changed"));
		writeFileSync(join(dir, "keybindings.json"), "[]");

		fireFileEvent(join(dir, "keybindings.json"), "create");
		fireFileEvent(join(dir, "chatLanguageModels.json"));
		await sleep(1100);

		expect(settings).toEqual([]);
		expect(keybindings).toEqual(["changed"]);
	});

	test("debounces bursts of events", async () => {
		const changes: string[] = [];
		file().watch(() => changes.push("changed"));
		writeFileSync(join(dir, "settings.json"), "{}");

		for (let i = 0; i < 5; i++) {
			fireFileEvent(join(dir, "settings.json"));
		}
		await sleep(1100);

		expect(changes).toHaveLength(1);
	});

	test("ignores events caused by its own writes", async () => {
		const target = file();
		const changes: string[] = [];
		target.watch(() => changes.push("changed"));

		await target.write("{}\n", { a: 1 });
		fireFileEvent(join(dir, "settings.json"));
		await sleep(1100);
		expect(changes).toEqual([]);

		writeFileSync(join(dir, "settings.json"), '{ "a": 2 }');
		fireFileEvent(join(dir, "settings.json"));
		await sleep(1100);
		expect(changes).toEqual(["changed"]);
	});
});
