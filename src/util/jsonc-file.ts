import { toSortedJson } from "@util/json";
import type { Logger } from "@util/log";
import { type Result, toError } from "@util/result";
// The package's default UMD build loads its internals with runtime require() calls the bundler
// can't follow (the bundle then fails with "Cannot find module ./impl/format"), so use the ESM build.
import {
	type ParseError,
	parse,
	printParseErrorCode,
} from "jsonc-parser/lib/esm/main.js";
import * as vscode from "vscode";

const WATCH_DEBOUNCE_MS = 1000;

export type JsoncSnapshot = {
	value: unknown;
	/** The file's text, comments included. */
	text: string;
	/** Last modified time in ms since the epoch; 0 if the file doesn't exist. */
	modifiedAt: number;
};

/** A JSON-with-comments file (like settings.json): read, write and watch. */
export class JsoncFile {
	/** Text of our own last write, so the watcher can ignore it. */
	private lastWritten?: string;

	/** @param emptyText Used as the content when the file doesn't exist. */
	constructor(
		readonly uri: vscode.Uri,
		private readonly emptyText: string,
		private readonly log: Logger,
	) {}

	get name(): string {
		return basename(this.uri);
	}

	async read(): Promise<Result<JsoncSnapshot>> {
		let text: string;
		let modifiedAt: number;

		try {
			const stat = await vscode.workspace.fs.stat(this.uri);
			modifiedAt = stat.mtime;
			text = new TextDecoder().decode(
				await vscode.workspace.fs.readFile(this.uri),
			);
		} catch (error) {
			if (
				error instanceof vscode.FileSystemError &&
				error.code === "FileNotFound"
			) {
				this.log.info(
					`${this.uri.fsPath} doesn't exist, using ${this.emptyText}`,
				);
				text = this.emptyText;
				modifiedAt = 0;
			} else {
				this.log.error(`Reading ${this.uri.fsPath} failed:`, error);
				return { error: toError(error) };
			}
		}

		const errors: ParseError[] = [];
		const value: unknown = parse(text, errors, { allowTrailingComma: true });

		if (errors.length > 0) {
			const details = errors
				.map(
					(error) =>
						`${printParseErrorCode(error.error)} at line ${lineOf(text, error.offset)}`,
				)
				.join(", ");
			this.log.error(`Parsing ${this.uri.fsPath} failed: ${details}`);
			return { error: new Error(`${this.name} is invalid: ${details}`) };
		}

		return { value: { value, text, modifiedAt } };
	}

	/**
	 * Replaces the file with `value` as JSON, keys sorted alphabetically at every level. Keeps the
	 * indentation and line endings of `currentText`; comments are not kept. Returns the new text.
	 */
	async write(currentText: string, value: unknown): Promise<Result<string>> {
		const { indent, eol } = detectFormatting(currentText);
		const next = toSortedJson(value, indent, eol);

		try {
			await vscode.workspace.fs.writeFile(
				this.uri,
				new TextEncoder().encode(next),
			);
			this.lastWritten = next;
			this.log.info(`Wrote ${this.uri.fsPath}`);
			return { value: next };
		} catch (error) {
			this.log.error(`Writing ${this.uri.fsPath} failed:`, error);
			return { error: toError(error) };
		}
	}

	/**
	 * Calls `onChange` when the file is created or edited, once edits settle. Our own writes are
	 * ignored, so pulling from the cloud doesn't trigger a push straight back.
	 */
	watch(onChange: () => void): vscode.Disposable {
		// Every file in a folder watches it with the same "*.json" pattern and filters by name here.
		// Watch requests for the same folder can be merged by the editor, keeping only one request's
		// pattern; with per-file patterns, only one of settings.json / keybindings.json got events.
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.joinPath(this.uri, ".."), "*.json"),
			false,
			false,
			true,
		);
		let timer: ReturnType<typeof setTimeout> | undefined;

		const changed = (uri: vscode.Uri): void => {
			if (basename(uri).toLowerCase() !== this.name.toLowerCase()) {
				return;
			}

			this.log.debug(`File event: ${uri.fsPath}`);
			clearTimeout(timer);
			timer = setTimeout(async () => {
				const text = await this.readText();

				if (text !== undefined && text === this.lastWritten) {
					this.log.debug(`${this.name} event from our own write, ignoring`);
					return;
				}

				this.log.info(`${this.name} changed`);
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

	/** Current text of the file, or undefined if it can't be read. */
	private async readText(): Promise<string | undefined> {
		try {
			return new TextDecoder().decode(
				await vscode.workspace.fs.readFile(this.uri),
			);
		} catch {
			return undefined;
		}
	}
}

const basename = (uri: vscode.Uri): string =>
	uri.path.split("/").pop() ?? uri.path;

const lineOf = (text: string, offset: number): number =>
	text.slice(0, offset).split("\n").length;

/** The file's existing indentation (one level) and line ending; 4 spaces and \n by default. */
const detectFormatting = (text: string): { indent: string; eol: string } => {
	const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "    ";
	return {
		indent: indent.startsWith("\t") ? "\t" : indent,
		eol: text.includes("\r\n") ? "\r\n" : "\n",
	};
};
