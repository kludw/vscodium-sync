/**
 * A minimal stand-in for the editor-provided "vscode" module, covering only what the extension
 * uses. File APIs are backed by the real file system (tests use temp folders); everything else is
 * recorded or driven through {@link fake}.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, posix } from "node:path";

type Listener<T> = (value: T) => void;

class Uri {
	private constructor(
		readonly scheme: string,
		readonly path: string,
	) {}

	get fsPath(): string {
		return this.path;
	}

	static file(path: string): Uri {
		return new Uri("file", posix.normalize(path));
	}

	static from({ scheme, path }: { scheme: string; path: string }): Uri {
		return new Uri(scheme, path);
	}

	static joinPath(base: Uri, ...segments: string[]): Uri {
		return new Uri(base.scheme, posix.join(base.path, ...segments));
	}

	toString(): string {
		return `${this.scheme}://${this.path}`;
	}
}

class Disposable {
	constructor(private readonly onDispose: () => void) {}

	dispose(): void {
		this.onDispose();
	}
}

class RelativePattern {
	constructor(
		readonly base: Uri,
		readonly pattern: string,
	) {}
}

class FileSystemError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
	}
}

type Watcher = {
	base: string;
	pattern: string;
	change: Listener<Uri>[];
	create: Listener<Uri>[];
};

type Message = {
	level: "info" | "warning" | "error";
	message: string;
	items: string[];
};

type Session = {
	accessToken: string;
	account: { label: string };
	scopes: readonly string[];
};

/** Test controls and recordings. Reset with {@link resetFake} between tests. */
export const fake = {
	watchers: [] as Watcher[],
	/** Lines written to log output channels, e.g. "info [Sync] settings: in sync". */
	logs: [] as string[],
	messages: [] as Message[],
	/** Picks the button the user "clicks" for a message; undefined dismisses it. */
	respond: (_message: Message): string | undefined => undefined,
	commands: [] as { command: string; args: unknown[] }[],
	runCommand: async (_command: string, ..._args: unknown[]): Promise<unknown> =>
		undefined,
	/** The session getSession returns without prompting; undefined means not signed in. */
	session: undefined as Session | undefined,
	/** What signing in (getSession with createIfNone) yields; throw to simulate cancelling. */
	signIn: (): Session => {
		throw new Error("User did not consent");
	},
	focused: true,
	focusListeners: [] as Listener<{ focused: boolean }>[],
	extensions: [] as { id: string; extensionUri: Uri }[],
	contentProviders: new Map<
		string,
		{ provideTextDocumentContent(uri: Uri): string | undefined }
	>(),
	appRoot: "/Applications/VSCodium.app/Contents/Resources/app",
};

export const resetFake = (): void => {
	fake.watchers = [];
	fake.logs = [];
	fake.messages = [];
	fake.respond = () => undefined;
	fake.commands = [];
	fake.runCommand = async () => undefined;
	fake.session = undefined;
	fake.signIn = () => {
		throw new Error("User did not consent");
	};
	fake.focused = true;
	fake.focusListeners = [];
	fake.extensions = [];
	fake.contentProviders.clear();
};

const matches = (pattern: string, name: string): boolean =>
	pattern === name ||
	(pattern.startsWith("*") && name.endsWith(pattern.slice(1)));

/** Simulates the editor reporting that `path` changed (or was created). */
export const fireFileEvent = (
	path: string,
	kind: "change" | "create" = "change",
): void => {
	for (const watcher of fake.watchers) {
		if (
			watcher.base === dirname(path) &&
			matches(watcher.pattern, basename(path))
		) {
			for (const listener of watcher[kind]) {
				listener(Uri.file(path));
			}
		}
	}
};

export const setFocused = (focused: boolean): void => {
	fake.focused = focused;
	for (const listener of fake.focusListeners) {
		listener({ focused });
	}
};

const fileNotFound = (error: unknown): unknown =>
	(error as { code?: string }).code === "ENOENT"
		? new FileSystemError(String(error), "FileNotFound")
		: error;

const showMessage =
	(level: Message["level"]) =>
	async (message: string, ...items: string[]): Promise<string | undefined> => {
		const entry = { level, message, items };
		fake.messages.push(entry);
		return fake.respond(entry);
	};

const outputChannel = () => {
	const write =
		(level: string) =>
		(message: string, ...args: unknown[]): void => {
			fake.logs.push(
				[level, message, ...args.map((arg) => String(arg))].join(" "),
			);
		};
	return {
		trace: write("trace"),
		debug: write("debug"),
		info: write("info"),
		warn: write("warn"),
		error: write("error"),
		dispose: () => {},
	};
};

export const fakeVscode = {
	Uri,
	Disposable,
	RelativePattern,
	FileSystemError,
	env: {
		get appRoot() {
			return fake.appRoot;
		},
	},
	extensions: {
		get all() {
			return fake.extensions;
		},
	},
	workspace: {
		fs: {
			stat: async (uri: Uri) => {
				try {
					return { mtime: statSync(uri.fsPath).mtimeMs };
				} catch (error) {
					throw fileNotFound(error);
				}
			},
			readFile: async (uri: Uri) => {
				try {
					return new Uint8Array(readFileSync(uri.fsPath));
				} catch (error) {
					throw fileNotFound(error);
				}
			},
			writeFile: async (uri: Uri, content: Uint8Array) => {
				mkdirSync(dirname(uri.fsPath), { recursive: true });
				writeFileSync(uri.fsPath, content);
			},
		},
		createFileSystemWatcher: (pattern: RelativePattern) => {
			const watcher: Watcher = {
				base: pattern.base.fsPath,
				pattern: pattern.pattern,
				change: [],
				create: [],
			};
			fake.watchers.push(watcher);
			const on =
				(kind: "change" | "create") =>
				(listener: Listener<Uri>): Disposable => {
					watcher[kind].push(listener);
					return new Disposable(() => {});
				};
			return {
				onDidChange: on("change"),
				onDidCreate: on("create"),
				dispose: () => {
					fake.watchers = fake.watchers.filter((other) => other !== watcher);
				},
			};
		},
		registerTextDocumentContentProvider: (
			scheme: string,
			provider: { provideTextDocumentContent(uri: Uri): string | undefined },
		) => {
			fake.contentProviders.set(scheme, provider);
			return new Disposable(() => fake.contentProviders.delete(scheme));
		},
	},
	window: {
		get state() {
			return { focused: fake.focused };
		},
		onDidChangeWindowState: (listener: Listener<{ focused: boolean }>) => {
			fake.focusListeners.push(listener);
			return new Disposable(() => {
				fake.focusListeners = fake.focusListeners.filter(
					(other) => other !== listener,
				);
			});
		},
		createOutputChannel: outputChannel,
		showInformationMessage: showMessage("info"),
		showWarningMessage: showMessage("warning"),
		showErrorMessage: showMessage("error"),
	},
	commands: {
		executeCommand: async (command: string, ...args: unknown[]) => {
			fake.commands.push({ command, args });
			return fake.runCommand(command, ...args);
		},
	},
	authentication: {
		getAccounts: async () => (fake.session ? [fake.session.account] : []),
		getSession: async (
			_provider: string,
			_scopes: readonly string[],
			options?: { createIfNone?: boolean },
		) => {
			if (fake.session) {
				return fake.session;
			}

			if (options?.createIfNone) {
				fake.session = fake.signIn();
				return fake.session;
			}

			return undefined;
		},
	},
};
