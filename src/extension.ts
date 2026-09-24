import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import * as vscode from "vscode";
import { resolveKeybindingsPath, resolveSettingsPath } from "./settings/path";
import { sortJsonKeys } from "./settings/sortJson";
import { showStatusMenu } from "./status/menu";
import { notifyCreated, notifySynced } from "./status/notifications";
import { createStatusBar } from "./status/statusBar";
import {
	performSync,
	type SyncOutcome,
	type SyncState,
	type SyncStateStore,
} from "./sync/engine";
import type { ExtensionsDiff } from "./sync/extensions";

const CREATED_MESSAGE = "VSCodium Sync: sync enabled.";
const EXTENSIONS_LAST_SYNCED_AT_KEY = "vscodiumSync.extensionsLastSyncedAtMs";
const GIST_ID_KEY = "vscodiumSync.gistId";
const GIST_URL_KEY = "vscodiumSync.gistUrl";
const KEYBINDINGS_LAST_SYNCED_AT_KEY = "vscodiumSync.keybindingsLastSyncedAtMs";
const POLL_INTERVAL_MS = 15_000;
const SETTINGS_LAST_SYNCED_AT_KEY = "vscodiumSync.settingsLastSyncedAtMs";
const SHOW_STATUS_COMMAND = "vscodiumSync.showStatus";
const WATCH_DEBOUNCE_MS = 500;

interface ItemNotificationConfig {
	id: "settings" | "extensions" | "keybindings";
	pullDiffTitle: string;
	pullMessage: string;
	pushDiffTitle: string;
	pushMessage: string;
}

const EXTENSIONS_NOTIFICATION: ItemNotificationConfig = {
	id: "extensions",
	pullDiffTitle: "extensions: before ↔ after pull",
	pullMessage: "VSCodium Sync: extensions were updated.",
	pushDiffTitle: "extensions: before ↔ after push",
	pushMessage: "VSCodium Sync: extensions synced.",
};

const KEYBINDINGS_NOTIFICATION: ItemNotificationConfig = {
	id: "keybindings",
	pullDiffTitle: "keybindings.json: before ↔ after pull",
	pullMessage: "VSCodium Sync: keybindings were updated.",
	pushDiffTitle: "keybindings.json: before ↔ after push",
	pushMessage: "VSCodium Sync: keybindings synced.",
};

const SETTINGS_NOTIFICATION: ItemNotificationConfig = {
	id: "settings",
	pullDiffTitle: "settings.json: before ↔ after pull",
	pullMessage: "VSCodium Sync: settings were updated.",
	pushDiffTitle: "settings.json: before ↔ after push",
	pushMessage: "VSCodium Sync: settings synced.",
};

interface NotifyOutcomeContext {
	extensionsAfterSync: string;
	extensionsBeforeSync: string;
	keybindingsAfterSync: string;
	keybindingsBeforeSync: string;
	log: vscode.LogOutputChannel;
	settingsAfterSync: string;
	settingsBeforeSync: string;
}

export async function activate(
	context: vscode.ExtensionContext,
): Promise<void> {
	const log = vscode.window.createOutputChannel("VSCodium Sync", { log: true });
	context.subscriptions.push(log);

	log.info("Activating, requesting GitHub session…");
	const session = await vscode.authentication.getSession("github", ["gist"], {
		createIfNone: true,
	});
	if (!session) {
		log.error("GitHub sign-in was declined or failed.");
		vscode.window.showErrorMessage(
			"VSCodium Sync: GitHub sign-in is required to sync settings.",
		);
		return;
	}
	log.info(`Signed in to GitHub as ${session.account.label}.`);

	const settingsPath = resolveSettingsPath(process.platform, homedir());
	const keybindingsPath = resolveKeybindingsPath(process.platform, homedir());
	ensureFileExists(settingsPath, "{}\n");
	ensureFileExists(keybindingsPath, "[]\n");
	log.debug(`Watching settings file at ${settingsPath}.`);
	log.debug(`Watching keybindings file at ${keybindingsPath}.`);

	const store = createGlobalStateStore(context);
	const statusBar = createStatusBar(SHOW_STATUS_COMMAND);
	context.subscriptions.push(statusBar);

	let writingSettingsLocally = false;
	let writingKeybindingsLocally = false;
	let extensionsChangedAtMs = Date.now();

	const sync = async (): Promise<void> => {
		statusBar.setSyncing();
		log.info("Sync starting…");
		const settingsBeforeSync = readSettings(settingsPath);
		const keybindingsBeforeSync = readKeybindings(keybindingsPath);
		const extensionsBeforeSync = readLocalExtensions();
		try {
			const outcome = await performSync({
				extensions: {
					applyDiff: (diff) => applyExtensionsDiff(diff, log),
					getLocalChangedAtMs: () => extensionsChangedAtMs,
					readLocal: readLocalExtensions,
				},
				keybindings: {
					getLocalChangedAtMs: () => statSync(keybindingsPath).mtimeMs,
					readLocal: () => readKeybindings(keybindingsPath),
					writeLocal: (content) => {
						writingKeybindingsLocally = true;
						writeKeybindings(keybindingsPath, content);
					},
				},
				settings: {
					getLocalChangedAtMs: () => statSync(settingsPath).mtimeMs,
					readLocal: () => readSettings(settingsPath),
					writeLocal: (content) => {
						writingSettingsLocally = true;
						writeSettings(settingsPath, content);
					},
				},
				store,
				token: session.accessToken,
			});
			log.info(
				`Sync finished: settings=${outcome.settings.action}, keybindings=${outcome.keybindings.action}, extensions=${outcome.extensions.action}` +
					(outcome.linked ? ` (linked: ${outcome.linked}).` : "."),
			);
			statusBar.setSynced(Date.now());

			notifyOutcome(outcome, {
				extensionsAfterSync: readLocalExtensions(),
				extensionsBeforeSync,
				keybindingsAfterSync: readKeybindings(keybindingsPath),
				keybindingsBeforeSync,
				log,
				settingsAfterSync: readSettings(settingsPath),
				settingsBeforeSync,
			});
		} catch (error) {
			const message = (error as Error).message;
			log.error(`Sync failed: ${message}`);
			statusBar.setError(message);
			vscode.window.showErrorMessage(`VSCodium Sync failed: ${message}`);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(SHOW_STATUS_COMMAND, () =>
			showStatusMenu({
				getGistUrl: () => store.get().gistUrl,
				syncNow: sync,
				showLog: () => log.show(),
			}),
		),
	);

	await sync();

	let debounceHandle: ReturnType<typeof setTimeout> | undefined;
	const scheduleSync = () => {
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(sync, WATCH_DEBOUNCE_MS);
	};

	const settingsWatcher = watch(settingsPath, () => {
		if (writingSettingsLocally) {
			writingSettingsLocally = false;
			return;
		}
		log.debug("Local settings.json changed, scheduling sync.");
		scheduleSync();
	});

	const keybindingsWatcher = watch(keybindingsPath, () => {
		if (writingKeybindingsLocally) {
			writingKeybindingsLocally = false;
			return;
		}
		log.debug("Local keybindings.json changed, scheduling sync.");
		scheduleSync();
	});

	const extensionsListener = vscode.extensions.onDidChange(() => {
		extensionsChangedAtMs = Date.now();
		log.debug("Installed extensions changed, scheduling sync.");
		scheduleSync();
	});

	const pollHandle = setInterval(() => {
		log.debug("Polling gist for remote changes.");
		void sync();
	}, POLL_INTERVAL_MS);

	context.subscriptions.push(extensionsListener, {
		dispose: () => {
			settingsWatcher.close();
			keybindingsWatcher.close();
			clearInterval(pollHandle);
			clearTimeout(debounceHandle);
		},
	});
}

async function applyExtensionsDiff(
	diff: ExtensionsDiff,
	log: vscode.LogOutputChannel,
): Promise<void> {
	await runExtensionCommands(
		diff.toInstall,
		"install",
		"workbench.extensions.installExtension",
		log,
	);
	await runExtensionCommands(
		diff.toUninstall,
		"uninstall",
		"workbench.extensions.uninstallExtension",
		log,
	);
}

function createGlobalStateStore(
	context: vscode.ExtensionContext,
): SyncStateStore {
	return {
		get(): SyncState {
			return {
				extensionsLastSyncedAtMs: context.globalState.get<number>(
					EXTENSIONS_LAST_SYNCED_AT_KEY,
				),
				gistId: context.globalState.get<string>(GIST_ID_KEY),
				gistUrl: context.globalState.get<string>(GIST_URL_KEY),
				keybindingsLastSyncedAtMs: context.globalState.get<number>(
					KEYBINDINGS_LAST_SYNCED_AT_KEY,
				),
				settingsLastSyncedAtMs: context.globalState.get<number>(
					SETTINGS_LAST_SYNCED_AT_KEY,
				),
			};
		},
		async update(patch: Partial<SyncState>): Promise<void> {
			await updateIfDefined(
				context,
				EXTENSIONS_LAST_SYNCED_AT_KEY,
				patch.extensionsLastSyncedAtMs,
			);
			await updateIfDefined(context, GIST_ID_KEY, patch.gistId);
			await updateIfDefined(context, GIST_URL_KEY, patch.gistUrl);
			await updateIfDefined(
				context,
				KEYBINDINGS_LAST_SYNCED_AT_KEY,
				patch.keybindingsLastSyncedAtMs,
			);
			await updateIfDefined(
				context,
				SETTINGS_LAST_SYNCED_AT_KEY,
				patch.settingsLastSyncedAtMs,
			);
		},
	};
}

export function deactivate(): void {}

function ensureFileExists(path: string, seedContent: string): void {
	if (existsSync(path)) return;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, seedContent, "utf8");
}

function isBuiltinExtension(extension: vscode.Extension<unknown>): boolean {
	// VS Code marks its bundled extensions this way at runtime; there's no typed API for it.
	return (extension.packageJSON as { isBuiltin?: boolean }).isBuiltin === true;
}

function notifyItemOutcome(
	config: ItemNotificationConfig,
	result: {
		action: SyncOutcome["settings"]["action"];
		remoteContentBeforePush?: string;
	},
	beforeSync: string,
	afterSync: string,
	logError: (message: string) => void,
): void {
	if (result.action === "pull") {
		void notifySynced({
			id: config.id,
			message: config.pullMessage,
			diffTitle: config.pullDiffTitle,
			beforeContent: beforeSync,
			afterContent: afterSync,
			logError,
		});
	} else if (result.action === "push") {
		void notifySynced({
			id: config.id,
			message: config.pushMessage,
			diffTitle: config.pushDiffTitle,
			beforeContent: result.remoteContentBeforePush ?? "",
			afterContent: afterSync,
			logError,
		});
	}
}

function notifyOutcome(outcome: SyncOutcome, ctx: NotifyOutcomeContext): void {
	if (outcome.linked === "created") {
		notifyCreated(CREATED_MESSAGE);
		return;
	}

	const logError = (message: string) => ctx.log.error(message);

	notifyItemOutcome(
		SETTINGS_NOTIFICATION,
		outcome.settings,
		ctx.settingsBeforeSync,
		ctx.settingsAfterSync,
		logError,
	);
	notifyItemOutcome(
		KEYBINDINGS_NOTIFICATION,
		outcome.keybindings,
		ctx.keybindingsBeforeSync,
		ctx.keybindingsAfterSync,
		logError,
	);
	notifyItemOutcome(
		EXTENSIONS_NOTIFICATION,
		outcome.extensions,
		ctx.extensionsBeforeSync,
		ctx.extensionsAfterSync,
		logError,
	);
}

function readKeybindings(keybindingsPath: string): string {
	return sortJsonKeys(readFileSync(keybindingsPath, "utf8"));
}

function readLocalExtensions(): string {
	const ids = vscode.extensions.all
		.filter((extension) => !isBuiltinExtension(extension))
		.map((extension) => extension.id)
		.sort();
	// One per line: a single-line array is unreadable in the gist file and in the diff view.
	return JSON.stringify(ids, null, 2);
}

function readSettings(settingsPath: string): string {
	return sortJsonKeys(readFileSync(settingsPath, "utf8"));
}

async function runExtensionCommands(
	ids: string[],
	verb: "install" | "uninstall",
	command: string,
	log: vscode.LogOutputChannel,
): Promise<void> {
	for (const id of ids) {
		try {
			await vscode.commands.executeCommand(command, id);
			log.info(
				`${verb === "install" ? "Installed" : "Uninstalled"} extension ${id}.`,
			);
		} catch (error) {
			log.error(
				`Failed to ${verb} extension ${id}: ${(error as Error).message}`,
			);
		}
	}
}

function updateIfDefined<T>(
	context: vscode.ExtensionContext,
	key: string,
	value: T | undefined,
): Thenable<void> {
	return value === undefined
		? Promise.resolve()
		: context.globalState.update(key, value);
}

function writeKeybindings(keybindingsPath: string, content: string): void {
	writeFileSync(keybindingsPath, sortJsonKeys(content), "utf8");
}

function writeSettings(settingsPath: string, content: string): void {
	writeFileSync(settingsPath, sortJsonKeys(content), "utf8");
}
