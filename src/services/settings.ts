import type { LocalState, SyncItem } from "@services/sync";
import { JsoncFile } from "@util/jsonc-file";
import type { Logger } from "@util/log";
import type { Result } from "@util/result";
import * as vscode from "vscode";

export type Settings = Record<string, unknown>;

const isSettings = (value: unknown): value is Settings =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The user's settings.json. */
export class SettingsService implements SyncItem<"settings"> {
	readonly key = "settings";
	readonly label = "settings";
	readonly fileName = "settings.json";
	private readonly file: JsoncFile;

	/** @param userDir The editor's `User` folder, which holds settings.json. */
	constructor(
		userDir: vscode.Uri,
		private readonly log: Logger,
	) {
		this.file = new JsoncFile(
			vscode.Uri.joinPath(userDir, this.fileName),
			"{}\n",
			log,
		);
	}

	isValid(value: unknown): value is Settings {
		return isSettings(value);
	}

	async read(): Promise<Result<LocalState<Settings>>> {
		const snapshot = await this.file.read();

		if (snapshot.error) {
			return { error: snapshot.error };
		}

		const { value, text, modifiedAt } = snapshot.value;

		if (!isSettings(value)) {
			return { error: new Error("settings.json must contain an object") };
		}

		this.log.debug(`Read ${Object.keys(value).length} setting(s)`);
		return { value: { value, text, modifiedAt } };
	}

	/** Replaces settings.json with `next`, keys sorted alphabetically. Comments are not kept. */
	async write(
		local: LocalState<Settings>,
		next: Settings,
	): Promise<Result<LocalState<Settings>>> {
		const text = await this.file.write(local.text, next);

		if (text.error) {
			return { error: text.error };
		}

		return { value: { value: next, text: text.value, modifiedAt: Date.now() } };
	}

	watch(onChange: () => void): vscode.Disposable {
		return this.file.watch(onChange);
	}
}
