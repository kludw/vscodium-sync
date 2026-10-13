import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExtensionsService } from "@services/extensions";
import * as vscode from "vscode";
import { fake, resetFake } from "./fake-vscode";
import { memento, tempDir, testLogger } from "./helpers";

let dir: string;
let state: ReturnType<typeof memento>;
const registry = () => join(dir, "extensions.json");

/** Writes the editor's registry, as installs and uninstalls do. */
const setInstalled = (ids: string[]) =>
	writeFileSync(
		registry(),
		JSON.stringify(ids.map((id) => ({ identifier: { id }, version: "1.0.0" }))),
	);
const installed = (): string[] =>
	JSON.parse(readFileSync(registry(), "utf8")).map(
		(entry: { identifier: { id: string } }) => entry.identifier.id,
	);

/** Installing or uninstalling updates the registry; `unavailable` IDs fail to install. */
const fakeMarketplace = (unavailable: string[] = []) => {
	fake.runCommand = async (command, id) => {
		if (command === "workbench.extensions.installExtension") {
			if (unavailable.includes(String(id))) {
				throw new Error("not found on Open VSX");
			}
			setInstalled([...installed(), String(id)]);
		}
		if (command === "workbench.extensions.uninstallExtension") {
			setInstalled(installed().filter((other) => other.toLowerCase() !== id));
		}
	};
};

const service = () =>
	new ExtensionsService(
		"kludw.vscodium-sync",
		state,
		testLogger(),
		vscode.Uri.file(dir),
	);

beforeEach(() => {
	resetFake();
	dir = tempDir();
	state = memento();
});

describe("read", () => {
	test("lists installed extensions from the registry: lowercase, sorted, without this one", async () => {
		setInstalled(["Biomejs.Biome", "a.one", "kludw.vscodium-sync", "a.one"]);

		const local = await service().read();

		expect(local.value).toEqual(["a.one", "biomejs.biome"]);
		expect(local.modifiedAt).toBeGreaterThan(0);
	});

	test("counts unavailable extensions as present", async () => {
		setInstalled(["a.one"]);
		state.data.set("extensions.unavailable", ["missing.ext"]);

		expect((await service().read()).value).toEqual(["a.one", "missing.ext"]);
	});
});

describe("write", () => {
	test("installs what's missing and uninstalls what's extra", async () => {
		setInstalled(["a.one", "b.two"]);
		fakeMarketplace();
		const extensions = service();

		const result = await extensions.write(await extensions.read(), [
			"b.two",
			"c.three",
		]);

		expect(result.value).toEqual(["b.two", "c.three"]);
		expect(result.warnings).toEqual([]);
		expect(installed()).toEqual(["b.two", "c.three"]);
	});

	test("a failed install becomes unavailable: kept in the list, warned about, retried next pull", async () => {
		setInstalled(["a.one"]);
		fakeMarketplace(["missing.ext"]);
		const extensions = service();

		const result = await extensions.write(await extensions.read(), [
			"a.one",
			"missing.ext",
		]);

		expect(result.value).toEqual(["a.one", "missing.ext"]);
		expect(result.warnings?.[0]).toContain("couldn't install missing.ext");
		expect(state.data.get("extensions.unavailable")).toEqual(["missing.ext"]);

		fakeMarketplace();
		await extensions.write(await extensions.read(), ["a.one", "missing.ext"]);
		expect(installed()).toEqual(["a.one", "missing.ext"]);
		expect(state.data.get("extensions.unavailable")).toEqual([]);
	});

	test("an unavailable extension dropped from the cloud is forgotten, not uninstalled", async () => {
		setInstalled(["a.one"]);
		state.data.set("extensions.unavailable", ["missing.ext"]);
		fakeMarketplace();
		const extensions = service();

		const result = await extensions.write(await extensions.read(), ["a.one"]);

		expect(result.value).toEqual(["a.one"]);
		expect(fake.commands).toEqual([]);
		expect(state.data.get("extensions.unavailable")).toEqual([]);
	});

	test("throws if nothing could be uninstalled", async () => {
		setInstalled(["a.one"]);
		fake.runCommand = async () => {
			throw new Error("in use");
		};
		const extensions = service();

		await expect(extensions.write(await extensions.read(), [])).rejects.toThrow(
			"Extensions: couldn't uninstall a.one (in use)",
		);
	});
});

test("finds the extensions folder next to an installed extension's folder", () => {
	setInstalled([]);
	mkdirSync(join(dir, "a.one-1.0.0"));
	fake.extensions = [
		{
			id: "vscode.git",
			extensionUri: vscode.Uri.file(`${fake.appRoot}/extensions/git`),
		},
		{ id: "a.one", extensionUri: vscode.Uri.file(join(dir, "a.one-1.0.0")) },
	];

	new ExtensionsService("kludw.vscodium-sync", state, testLogger());

	expect(fake.logs).toContain(`info Extensions folder: ${dir}`);
});
