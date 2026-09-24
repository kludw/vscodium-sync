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
import { resolveSettingsPath } from "./settings/path";
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

const POLL_INTERVAL_MS = 15_000;
const WATCH_DEBOUNCE_MS = 500;
const GIST_ID_KEY = "vscodiumSync.gistId";
const GIST_URL_KEY = "vscodiumSync.gistUrl";
const SETTINGS_LAST_SYNCED_AT_KEY = "vscodiumSync.settingsLastSyncedAtMs";
const EXTENSIONS_LAST_SYNCED_AT_KEY = "vscodiumSync.extensionsLastSyncedAtMs";
const SHOW_STATUS_COMMAND = "vscodiumSync.showStatus";

const CREATED_MESSAGE = "VSCodium Sync: sync enabled.";

const SETTINGS_PULL_MESSAGE = "VSCodium Sync: settings were updated.";
const SETTINGS_PULL_DIFF_TITLE = "settings.json: before ↔ after pull";
const SETTINGS_PUSH_MESSAGE = "VSCodium Sync: settings synced.";
const SETTINGS_PUSH_DIFF_TITLE = "settings.json: before ↔ after push";

const EXTENSIONS_PULL_MESSAGE = "VSCodium Sync: extensions were updated.";
const EXTENSIONS_PULL_DIFF_TITLE = "extensions: before ↔ after pull";
const EXTENSIONS_PUSH_MESSAGE = "VSCodium Sync: extensions synced.";
const EXTENSIONS_PUSH_DIFF_TITLE = "extensions: before ↔ after push";

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
	ensureSettingsFileExists(settingsPath);
	log.debug(`Watching settings file at ${settingsPath}.`);

	const store = createGlobalStateStore(context);
	const statusBar = createStatusBar(SHOW_STATUS_COMMAND);
	context.subscriptions.push(statusBar);

	let writingLocally = false;
	let extensionsChangedAtMs = Date.now();

	const sync = async (): Promise<void> => {
		statusBar.setSyncing();
		log.info("Sync starting…");
		const settingsBeforeSync = readFileSync(settingsPath, "utf8");
		const extensionsBeforeSync = readLocalExtensions();
		try {
			const outcome = await performSync({
				extensions: {
					applyDiff: (diff) => applyExtensionsDiff(diff, log),
					getLocalChangedAtMs: () => extensionsChangedAtMs,
					readLocal: readLocalExtensions,
				},
				settings: {
					getLocalChangedAtMs: () => statSync(settingsPath).mtimeMs,
					readLocal: () => readFileSync(settingsPath, "utf8"),
					writeLocal: (content) => {
						writingLocally = true;
						writeFileSync(settingsPath, content, "utf8");
					},
				},
				store,
				token: session.accessToken,
			});
			log.info(
				`Sync finished: settings=${outcome.settings.action}, extensions=${outcome.extensions.action}` +
					(outcome.linked ? ` (linked: ${outcome.linked}).` : "."),
			);
			statusBar.setSynced(Date.now());

			notifyOutcome(outcome, {
				settingsBeforeSync,
				settingsAfterSync: readFileSync(settingsPath, "utf8"),
				extensionsBeforeSync,
				extensionsAfterSync: readLocalExtensions(),
				log,
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

	const watcher = watch(settingsPath, () => {
		if (writingLocally) {
			writingLocally = false;
			return;
		}
		log.debug("Local settings.json changed, scheduling sync.");
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
			watcher.close();
			clearInterval(pollHandle);
			clearTimeout(debounceHandle);
		},
	});
}

export function deactivate(): void {}

interface NotifyOutcomeContext {
	settingsBeforeSync: string;
	settingsAfterSync: string;
	extensionsBeforeSync: string;
	extensionsAfterSync: string;
	log: vscode.LogOutputChannel;
}

function notifyOutcome(outcome: SyncOutcome, ctx: NotifyOutcomeContext): void {
	if (outcome.linked === "created") {
		notifyCreated(CREATED_MESSAGE);
		return;
	}

	const logError = (message: string) => ctx.log.error(message);

	if (outcome.settings.action === "pull") {
		void notifySynced({
			id: "settings",
			message: SETTINGS_PULL_MESSAGE,
			diffTitle: SETTINGS_PULL_DIFF_TITLE,
			beforeContent: ctx.settingsBeforeSync,
			afterContent: ctx.settingsAfterSync,
			logError,
		});
	} else if (outcome.settings.action === "push") {
		void notifySynced({
			id: "settings",
			message: SETTINGS_PUSH_MESSAGE,
			diffTitle: SETTINGS_PUSH_DIFF_TITLE,
			beforeContent: outcome.settings.remoteContentBeforePush ?? "",
			afterContent: ctx.settingsAfterSync,
			logError,
		});
	}

	if (outcome.extensions.action === "pull") {
		void notifySynced({
			id: "extensions",
			message: EXTENSIONS_PULL_MESSAGE,
			diffTitle: EXTENSIONS_PULL_DIFF_TITLE,
			beforeContent: ctx.extensionsBeforeSync,
			afterContent: ctx.extensionsAfterSync,
			logError,
		});
	} else if (outcome.extensions.action === "push") {
		void notifySynced({
			id: "extensions",
			message: EXTENSIONS_PUSH_MESSAGE,
			diffTitle: EXTENSIONS_PUSH_DIFF_TITLE,
			beforeContent: outcome.extensions.remoteContentBeforePush ?? "",
			afterContent: ctx.extensionsAfterSync,
			logError,
		});
	}
}

function ensureSettingsFileExists(settingsPath: string): void {
	if (existsSync(settingsPath)) return;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, "{}\n", "utf8");
}

function isBuiltinExtension(extension: vscode.Extension<unknown>): boolean {
	// VS Code marks its bundled extensions this way at runtime; there's no typed API for it.
	return (extension.packageJSON as { isBuiltin?: boolean }).isBuiltin === true;
}

function readLocalExtensions(): string {
	const ids = vscode.extensions.all
		.filter((extension) => !isBuiltinExtension(extension))
		.map((extension) => extension.id)
		.sort();
	// One per line: a single-line array is unreadable in the gist file and in the diff view.
	return JSON.stringify(ids, null, 2);
}

async function applyExtensionsDiff(
	diff: ExtensionsDiff,
	log: vscode.LogOutputChannel,
): Promise<void> {
	for (const id of diff.toInstall) {
		try {
			await vscode.commands.executeCommand(
				"workbench.extensions.installExtension",
				id,
			);
			log.info(`Installed extension ${id}.`);
		} catch (error) {
			log.error(
				`Failed to install extension ${id}: ${(error as Error).message}`,
			);
		}
	}
	for (const id of diff.toUninstall) {
		try {
			await vscode.commands.executeCommand(
				"workbench.extensions.uninstallExtension",
				id,
			);
			log.info(`Uninstalled extension ${id}.`);
		} catch (error) {
			log.error(
				`Failed to uninstall extension ${id}: ${(error as Error).message}`,
			);
		}
	}
}

function createGlobalStateStore(
	context: vscode.ExtensionContext,
): SyncStateStore {
	return {
		get(): SyncState {
			return {
				gistId: context.globalState.get<string>(GIST_ID_KEY),
				gistUrl: context.globalState.get<string>(GIST_URL_KEY),
				settingsLastSyncedAtMs: context.globalState.get<number>(
					SETTINGS_LAST_SYNCED_AT_KEY,
				),
				extensionsLastSyncedAtMs: context.globalState.get<number>(
					EXTENSIONS_LAST_SYNCED_AT_KEY,
				),
			};
		},
		async update(patch: Partial<SyncState>): Promise<void> {
			if (patch.gistId !== undefined) {
				await context.globalState.update(GIST_ID_KEY, patch.gistId);
			}
			if (patch.gistUrl !== undefined) {
				await context.globalState.update(GIST_URL_KEY, patch.gistUrl);
			}
			if (patch.settingsLastSyncedAtMs !== undefined) {
				await context.globalState.update(
					SETTINGS_LAST_SYNCED_AT_KEY,
					patch.settingsLastSyncedAtMs,
				);
			}
			if (patch.extensionsLastSyncedAtMs !== undefined) {
				await context.globalState.update(
					EXTENSIONS_LAST_SYNCED_AT_KEY,
					patch.extensionsLastSyncedAtMs,
				);
			}
		},
	};
}
