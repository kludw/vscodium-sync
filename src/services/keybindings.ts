import type { LocalState, SyncItem } from "@services/sync";
import { JsoncFile } from "@util/jsonc-file";
import type { Logger } from "@util/log";
import * as vscode from "vscode";

export type Keybindings = unknown[];

/** The user's keybindings.json (an array of bindings). */
export class KeybindingsService implements SyncItem<"keybindings"> {
	readonly key = "keybindings";
	readonly label = "keybindings";
	readonly fileName = "keybindings.json";
	private readonly file: JsoncFile;

	/** @param userDir The editor's `User` folder, which holds keybindings.json. */
	constructor(
		userDir: vscode.Uri,
		private readonly log: Logger,
	) {
		this.file = new JsoncFile(
			vscode.Uri.joinPath(userDir, this.fileName),
			"[]\n",
			log,
		);
	}

	isValid(value: unknown): value is Keybindings {
		return Array.isArray(value);
	}

	async read(): Promise<LocalState<Keybindings>> {
		const { value, text, modifiedAt } = await this.file.read();

		if (!Array.isArray(value)) {
			throw new Error("keybindings.json must contain an array");
		}

		this.log.debug(`Read ${value.length} keybinding(s)`);
		return { value, text, modifiedAt };
	}

	/**
	 * Replaces keybindings.json with `next`. Keys inside each binding are sorted alphabetically;
	 * the bindings keep their order, since later ones override earlier ones. Comments are not kept.
	 */
	async write(
		local: LocalState<Keybindings>,
		next: Keybindings,
	): Promise<LocalState<Keybindings>> {
		const text = await this.file.write(local.text, next);
		return { value: next, text, modifiedAt: Date.now() };
	}

	watch(onChange: () => void): vscode.Disposable {
		return this.file.watch(onChange);
	}
}
