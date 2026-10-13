import { sameJson } from "@util/json";
import type { Logger } from "@util/log";
import { type Result, toError } from "@util/result";
// The package's default UMD build loads its internals with runtime require() calls the bundler
// can't follow (the bundle then fails with "Cannot find module ./impl/format"), so use the ESM build.
import {
	applyEdits,
	type FormattingOptions,
	modify,
	type ParseError,
	parse,
	printParseErrorCode,
} from "jsonc-parser/lib/esm/main.js";
import * as vscode from "vscode";

export type Settings = Record<string, unknown>;

export type LocalSettings = {
	settings: Settings;
	/** The file's text, comments included. */
	text: string;
	/** Last modified time in ms since the epoch; 0 if the file doesn't exist. */
	modifiedAt: number;
};

const WATCH_DEBOUNCE_MS = 1000;

/** Reads, writes and watches the user's settings.json (JSON with comments). */
export class SettingsService {
	readonly file: vscode.Uri;
	/** Text of our own last write, so the watcher can ignore it. */
	private lastWritten?: string;

	/** @param userDir The editor's `User` folder, which holds settings.json. */
	constructor(
		userDir: vscode.Uri,
		private readonly log: Logger,
	) {
		this.file = vscode.Uri.joinPath(userDir, "settings.json");
	}

	/**
	 * Calls `onChange` when settings.json is created or edited, once edits settle. Our own writes
	 * are ignored, so pulling from the cloud doesn't trigger a push straight back.
	 */
	watch(onChange: () => void): vscode.Disposable {
		const dir = vscode.Uri.joinPath(this.file, "..");
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(dir, "settings.json"),
			false,
			false,
			true,
		);
		let timer: ReturnType<typeof setTimeout> | undefined;

		const changed = (): void => {
			clearTimeout(timer);
			timer = setTimeout(async () => {
				const text = await this.readText();

				if (text !== undefined && text === this.lastWritten) {
					this.log.debug("settings.json event from our own write, ignoring");
					return;
				}

				this.log.info("settings.json changed");
				onChange();
			}, WATCH_DEBOUNCE_MS);
		};

		const subscriptions = [
			watcher,
			watcher.onDidChange(changed),
			watcher.onDidCreate(changed),
		];

		return new vscode.Disposable(() => {
			clearTimeout(timer);
			for (const subscription of subscriptions) {
				subscription.dispose();
			}
		});
	}

	async read(): Promise<Result<LocalSettings>> {
		let text: string;
		let modifiedAt: number;

		try {
			const stat = await vscode.workspace.fs.stat(this.file);
			modifiedAt = stat.mtime;
			text = new TextDecoder().decode(
				await vscode.workspace.fs.readFile(this.file),
			);
		} catch (error) {
			if (
				error instanceof vscode.FileSystemError &&
				error.code === "FileNotFound"
			) {
				this.log.info(`${this.file.fsPath} doesn't exist, using {}`);
				return { value: { settings: {}, text: "{}\n", modifiedAt: 0 } };
			}

			this.log.error(`Reading ${this.file.fsPath} failed:`, error);
			return { error: toError(error) };
		}

		const errors: ParseError[] = [];
		const settings: unknown = parse(text, errors, {
			allowTrailingComma: true,
		});

		if (errors.length > 0) {
			const details = errors
				.map(
					(error) =>
						`${printParseErrorCode(error.error)} at line ${lineOf(text, error.offset)}`,
				)
				.join(", ");
			this.log.error(`Parsing ${this.file.fsPath} failed: ${details}`);
			return { error: new Error(`settings.json is invalid: ${details}`) };
		}

		if (
			typeof settings !== "object" ||
			settings === null ||
			Array.isArray(settings)
		) {
			return { error: new Error("settings.json must contain an object") };
		}

		this.log.info(
			`Read ${Object.keys(settings).length} setting(s) from ${this.file.fsPath}`,
		);
		return { value: { settings: settings as Settings, text, modifiedAt } };
	}

	/**
	 * Updates settings.json to contain exactly `next`. Only settings that differ are edited, so
	 * comments and formatting elsewhere in the file are kept. Returns the new text.
	 */
	async write(current: LocalSettings, next: Settings): Promise<Result<string>> {
		const formattingOptions = detectFormatting(current.text);
		let text = current.text;

		for (const key of Object.keys(current.settings)) {
			if (!(key in next)) {
				text = applyEdits(
					text,
					modify(text, [key], undefined, { formattingOptions }),
				);
			}
		}

		for (const [key, value] of Object.entries(next)) {
			if (!sameJson(current.settings[key], value)) {
				text = applyEdits(
					text,
					modify(text, [key], value, { formattingOptions }),
				);
			}
		}

		try {
			await vscode.workspace.fs.writeFile(
				this.file,
				new TextEncoder().encode(text),
			);
			this.lastWritten = text;
			this.log.info(`Wrote ${this.file.fsPath}`);
			return { value: text };
		} catch (error) {
			this.log.error(`Writing ${this.file.fsPath} failed:`, error);
			return { error: toError(error) };
		}
	}

	/** Current text of the file, or undefined if it can't be read. */
	private async readText(): Promise<string | undefined> {
		try {
			return new TextDecoder().decode(
				await vscode.workspace.fs.readFile(this.file),
			);
		} catch {
			return undefined;
		}
	}
}

const lineOf = (text: string, offset: number): number =>
	text.slice(0, offset).split("\n").length;

/** Matches new edits to the file's existing indentation and line endings. */
const detectFormatting = (text: string): FormattingOptions => {
	const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "    ";
	return {
		insertSpaces: !indent.startsWith("\t"),
		tabSize: indent.startsWith("\t") ? 4 : indent.length,
		eol: text.includes("\r\n") ? "\r\n" : "\n",
	};
};
