import { beforeEach, describe, expect, test } from "bun:test";
import type { Gist, SyncData } from "@services/gist";
import type {
	LocalState,
	SyncItem,
	SyncKey,
	WriteResult,
} from "@services/sync";
import { SyncService } from "@services/sync";
import * as vscode from "vscode";
import { memento, testLogger } from "./helpers";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-13T12:00:00Z");

/** An in-memory sync item. */
class FakeItem<K extends SyncKey> implements SyncItem<K> {
	readonly label: string;
	readonly fileName: string;
	writes: SyncData[K][] = [];
	/** Makes write() return this instead of `next`, to simulate a partly failed write. */
	writeResult?: WriteResult<SyncData[K]>;
	failRead = false;

	constructor(
		readonly key: K,
		public value: SyncData[K],
		public modifiedAt: number,
	) {
		this.label = key;
		this.fileName = `${key}.json`;
	}

	isValid(value: unknown): value is SyncData[K] {
		return this.key === "settings"
			? typeof value === "object" && value !== null && !Array.isArray(value)
			: Array.isArray(value);
	}

	async read(): Promise<LocalState<SyncData[K]>> {
		if (this.failRead) {
			throw new Error(`${this.fileName} is invalid`);
		}

		return {
			value: this.value,
			modifiedAt: this.modifiedAt,
			text: JSON.stringify(this.value),
		};
	}

	async write(
		_local: LocalState<SyncData[K]>,
		next: SyncData[K],
	): Promise<WriteResult<SyncData[K]>> {
		this.writes.push(next);
		const result = this.writeResult ?? {
			value: next,
			modifiedAt: NOW,
			text: JSON.stringify(next),
		};
		this.value = result.value;
		return result;
	}

	watch(): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}
}

/** The gist's data file as an object, plus every write made to it. */
const fakeGist = (data: Partial<SyncData>, updatedAt: number) => {
	const store = {
		data,
		writes: [] as Partial<SyncData>[],
		failWrite: false,
		readData: () => store.data,
		write: async (gist: Gist, next: Partial<SyncData>) => {
			if (store.failWrite) {
				throw new Error("GitHub /gists/G failed: 500 Server Error");
			}

			store.writes.push(next);
			store.data = next;
			return gist;
		},
	};
	const gist: Gist = {
		id: "G",
		description: "vscodium-sync",
		updated_at: new Date(updatedAt).toISOString(),
		files: {},
	};
	return { store, gist };
};

let state: ReturnType<typeof memento>;

beforeEach(() => {
	state = memento();
});

const service = (
	store: ReturnType<typeof fakeGist>["store"],
	items: SyncItem[],
) => new SyncService(store, items, state, testLogger());

describe("when both sides match", () => {
	test("does nothing and records the baseline", async () => {
		const settings = new FakeItem("settings", { a: 1, b: 2 }, NOW);
		const { store, gist } = fakeGist({ settings: { b: 2, a: 1 } }, NOW);

		const report = await service(store, [settings]).sync(gist);

		expect(report).toEqual({ changes: [], errors: [], warnings: [] });
		expect(store.writes).toEqual([]);
		expect(state.data.get("lastSynced.settings")).toEqual({ a: 1, b: 2 });
	});
});

describe("when the gist has nothing for an item", () => {
	test("pushes local, even if the gist is newer", async () => {
		const settings = new FakeItem("settings", { a: 1 }, NOW - HOUR);
		const { store, gist } = fakeGist({}, NOW);

		const report = await service(store, [settings]).sync(gist);

		expect(store.writes).toEqual([{ settings: { a: 1 } }]);
		expect(report.changes).toMatchObject([
			{ label: "settings", direction: "push" },
		]);
		expect(state.data.get("lastSynced.settings")).toEqual({ a: 1 });
	});
});

describe("with a baseline from the last sync", () => {
	test("only local changed: pushes, even if the cloud's clock says it's newer", async () => {
		state.data.set("lastSynced.settings", { a: 1 });
		const settings = new FakeItem("settings", { a: 2 }, NOW - HOUR);
		const { store, gist } = fakeGist({ settings: { a: 1 } }, NOW);

		const report = await service(store, [settings]).sync(gist);

		expect(store.writes).toEqual([{ settings: { a: 2 } }]);
		expect(report.changes[0]?.direction).toBe("push");
		expect(report.changes[0]?.before).toBe('{\n  "a": 1\n}\n');
		expect(report.changes[0]?.after).toBe('{\n  "a": 2\n}\n');
		expect(state.data.get("lastSynced.settings")).toEqual({ a: 2 });
	});

	test("only the cloud changed: pulls, even if local looks newer", async () => {
		state.data.set("lastSynced.settings", { a: 1 });
		const settings = new FakeItem("settings", { a: 1 }, NOW);
		const { store, gist } = fakeGist({ settings: { a: 3 } }, NOW - HOUR);

		const report = await service(store, [settings]).sync(gist);

		expect(settings.writes).toEqual([{ a: 3 }]);
		expect(store.writes).toEqual([]);
		expect(report.changes).toMatchObject([
			{ direction: "pull", before: '{"a":1}', after: '{"a":3}' },
		]);
		expect(state.data.get("lastSynced.settings")).toEqual({ a: 3 });
	});

	test("both changed: the newer edit wins (cloud newer)", async () => {
		state.data.set("lastSynced.settings", { a: 1 });
		const settings = new FakeItem("settings", { a: 2 }, NOW - HOUR);
		const { store, gist } = fakeGist({ settings: { a: 3 } }, NOW);

		await service(store, [settings]).sync(gist);

		expect(settings.writes).toEqual([{ a: 3 }]);
		expect(store.writes).toEqual([]);
	});

	test("both changed: the newer edit wins (local newer)", async () => {
		state.data.set("lastSynced.settings", { a: 1 });
		const settings = new FakeItem("settings", { a: 2 }, NOW);
		const { store, gist } = fakeGist({ settings: { a: 3 } }, NOW - HOUR);

		await service(store, [settings]).sync(gist);

		expect(store.writes).toEqual([{ settings: { a: 2 } }]);
		expect(settings.writes).toEqual([]);
	});
});

describe("without a baseline", () => {
	test("the newer edit wins", async () => {
		const settings = new FakeItem("settings", { a: 2 }, NOW - HOUR);
		const { store, gist } = fakeGist({ settings: { a: 3 } }, NOW);

		const report = await service(store, [settings]).sync(gist);

		expect(report.changes[0]?.direction).toBe("pull");
		expect(settings.value).toEqual({ a: 3 });
	});
});

describe("errors", () => {
	test("an invalid value in the gist fails only that item", async () => {
		const settings = new FakeItem("settings", { a: 1 }, NOW);
		const keybindings = new FakeItem("keybindings", [], NOW);
		const { store, gist } = fakeGist({ settings: [1, 2] as never }, NOW - HOUR);

		const report = await service(store, [settings, keybindings]).sync(gist);

		expect(report.errors.map((error) => error.message)).toEqual([
			"settings in the gist have an invalid format",
		]);
		expect(store.writes).toEqual([
			{ settings: [1, 2] as never, keybindings: [] },
		]);
	});

	test("an item that can't be read fails alone; the rest still sync", async () => {
		const settings = new FakeItem("settings", {}, NOW);
		settings.failRead = true;
		const keybindings = new FakeItem("keybindings", [{ key: "x" }], NOW);
		const { store, gist } = fakeGist({}, NOW - HOUR);

		const report = await service(store, [settings, keybindings]).sync(gist);

		expect(report.errors.map((error) => error.message)).toEqual([
			"settings.json is invalid",
		]);
		expect(store.writes).toEqual([{ keybindings: [{ key: "x" }] }]);
	});

	test("a failed push reports pulls only and records no baselines for the push", async () => {
		state.data.set("lastSynced.settings", { a: 1 });
		state.data.set("lastSynced.keybindings", []);
		const settings = new FakeItem("settings", { a: 2 }, NOW); // local changed: push
		const keybindings = new FakeItem("keybindings", [], NOW); // cloud changed: pull
		const { store, gist } = fakeGist(
			{ settings: { a: 1 }, keybindings: [{ key: "y" }] },
			NOW - HOUR,
		);
		store.failWrite = true;

		const report = await service(store, [settings, keybindings]).sync(gist);

		expect(report.errors).toHaveLength(1);
		expect(report.changes.map((change) => change.direction)).toEqual(["pull"]);
		expect(state.data.get("lastSynced.settings")).toEqual({ a: 1 });
		expect(state.data.get("lastSynced.keybindings")).toEqual([{ key: "y" }]);
	});
});

describe("pulls that only partly work", () => {
	test("record the actual result as the baseline and pass on warnings", async () => {
		state.data.set("lastSynced.extensions", ["a"]);
		const extensions = new FakeItem("extensions", ["a"], NOW);
		extensions.writeResult = {
			value: ["a", "b"],
			modifiedAt: NOW,
			text: "",
			warnings: ["couldn't uninstall c"],
		};
		const { store, gist } = fakeGist({ extensions: ["b"] }, NOW - HOUR);

		const report = await service(store, [extensions]).sync(gist);

		expect(report.warnings).toEqual(["couldn't uninstall c"]);
		expect(state.data.get("lastSynced.extensions")).toEqual(["a", "b"]);
	});
});

describe("several items", () => {
	test("pushes them together in one write, keeping cloud data for other keys", async () => {
		const settings = new FakeItem("settings", { a: 1 }, NOW);
		const keybindings = new FakeItem("keybindings", [{ key: "k" }], NOW);
		const { store, gist } = fakeGist(
			{ extensions: ["x"], unknownKey: true } as Partial<SyncData>,
			NOW - HOUR,
		);

		const report = await service(store, [settings, keybindings]).sync(gist);

		expect(store.writes).toEqual([
			{
				extensions: ["x"],
				unknownKey: true,
				settings: { a: 1 },
				keybindings: [{ key: "k" }],
			} as Partial<SyncData>,
		]);
		expect(report.changes.map((change) => change.label)).toEqual([
			"settings",
			"keybindings",
		]);
	});
});
