import { describe, expect, test } from "bun:test";
import { computeExtensionDiff } from "./extensions";

describe("computeExtensionDiff", () => {
	test("no difference when current matches target", () => {
		const diff = computeExtensionDiff('["a.one","b.two"]', '["a.one","b.two"]');
		expect(diff).toEqual({ toInstall: [], toUninstall: [] });
	});

	test("installs extensions present in target but not current", () => {
		const diff = computeExtensionDiff("[]", '["a.one","b.two"]');
		expect(diff).toEqual({ toInstall: ["a.one", "b.two"], toUninstall: [] });
	});

	test("uninstalls extensions present in current but not target", () => {
		const diff = computeExtensionDiff('["a.one","b.two"]', "[]");
		expect(diff).toEqual({ toInstall: [], toUninstall: ["a.one", "b.two"] });
	});

	test("handles a mix of installs and uninstalls", () => {
		const diff = computeExtensionDiff(
			'["keep.me","drop.me"]',
			'["keep.me","add.me"]',
		);
		expect(diff).toEqual({ toInstall: ["add.me"], toUninstall: ["drop.me"] });
	});

	test("treats missing/undefined target as empty", () => {
		const diff = computeExtensionDiff('["a.one"]', undefined);
		expect(diff).toEqual({ toInstall: [], toUninstall: ["a.one"] });
	});
});
