import { beforeEach, describe, expect, test } from "bun:test";
import { listLabels, NotificationService } from "@services/notifications";
import type { SyncChange } from "@services/sync";
import { DiffViewer } from "@util/diff";
import type * as vscode from "vscode";
import { fake, resetFake } from "./fake-vscode";
import { sleep, testLogger } from "./helpers";

beforeEach(resetFake);

const change = (
	label: string,
	direction: SyncChange["direction"],
): SyncChange => ({
	label,
	fileName: `${label}.json`,
	direction,
	before: `${label} before`,
	after: `${label} after`,
});

test("listLabels joins naturally", () => {
	expect(listLabels(["a"])).toBe("a");
	expect(listLabels(["a", "b"])).toBe("a and b");
	expect(listLabels(["a", "b", "c"])).toBe("a, b and c");
});

describe("changes", () => {
	test("summarizes uploads and downloads in one message", async () => {
		new NotificationService(new DiffViewer(), testLogger()).changes([
			change("settings", "push"),
			change("extensions", "push"),
			change("keybindings", "pull"),
		]);
		await sleep(5);

		expect(fake.messages).toEqual([
			{
				level: "info",
				message:
					"VSCodium Sync: uploaded settings and extensions to the cloud; updated keybindings from the cloud.",
				items: ["Show diffs"],
			},
		]);
	});

	test("Show diff opens a diff per change, with the before/after content", async () => {
		fake.respond = (message) => message.items[0];
		new NotificationService(new DiffViewer(), testLogger()).changes([
			change("settings", "push"),
			change("keybindings", "pull"),
		]);
		await sleep(5);

		const provider = fake.contentProviders.get("vscodium-sync-diff");
		const diffs = fake.commands.map(({ command, args }) => {
			const [left, right, title] = args as [vscode.Uri, vscode.Uri, string];
			return {
				command,
				title,
				left: provider?.provideTextDocumentContent(left),
				right: provider?.provideTextDocumentContent(right),
			};
		});
		expect(diffs).toEqual([
			{
				command: "vscode.diff",
				title: "Cloud settings (before ↔ after sync)",
				left: "settings before",
				right: "settings after",
			},
			{
				command: "vscode.diff",
				title: "keybindings.json (before ↔ after sync)",
				left: "keybindings before",
				right: "keybindings after",
			},
		]);
	});

	test("does nothing when nothing changed", () => {
		new NotificationService(new DiffViewer(), testLogger()).changes([]);
		expect(fake.messages).toEqual([]);
	});
});
