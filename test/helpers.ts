import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@util/log";
import type * as vscode from "vscode";

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const tempDir = (): string =>
	mkdtempSync(join(tmpdir(), "vscodium-sync-"));

export const testLogger = (): Logger => Logger.create("test");

/** An in-memory globalState. */
export const memento = (
	initial: Record<string, unknown> = {},
): vscode.Memento & { data: Map<string, unknown> } => {
	const data = new Map(Object.entries(initial));
	return {
		data,
		keys: () => [...data.keys()],
		get: <T>(key: string, fallback?: T) =>
			(data.has(key) ? data.get(key) : fallback) as T,
		update: async (key: string, value: unknown) => {
			if (value === undefined) {
				data.delete(key);
			} else {
				data.set(key, value);
			}
		},
	};
};
