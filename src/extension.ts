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
	type SyncResult,
	type SyncState,
	type SyncStateStore,
} from "./sync/engine";

const POLL_INTERVAL_MS = 60_000;
const WATCH_DEBOUNCE_MS = 500;
const GIST_ID_KEY = "vscodiumSync.gistId";
const GIST_URL_KEY = "vscodiumSync.gistUrl";
const LAST_SYNCED_AT_KEY = "vscodiumSync.lastSyncedAtMs";
const SHOW_STATUS_COMMAND = "vscodiumSync.showStatus";

const PULL_MESSAGE = "VSCodium Sync: settings were updated.";
const PULL_DIFF_TITLE = "settings.json: before ↔ after pull";
const PULL_RESULTS: SyncResult[] = ["pull", "init-pull"];

const PUSH_MESSAGE = "VSCodium Sync: settings synced.";
const PUSH_DIFF_TITLE = "settings.json: before ↔ after push";
const CREATED_MESSAGE = "VSCodium Sync: settings sync enabled.";

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

	const sync = async (): Promise<void> => {
		statusBar.setSyncing();
		log.info("Sync starting…");
		const localContentBeforeSync = readFileSync(settingsPath, "utf8");
		try {
			const outcome = await performSync({
				token: session.accessToken,
				store,
				readLocal: () => readFileSync(settingsPath, "utf8"),
				writeLocal: (content) => {
					writingLocally = true;
					writeFileSync(settingsPath, content, "utf8");
				},
				getLocalMtimeMs: () => statSync(settingsPath).mtimeMs,
			});
			log.info(`Sync finished: ${outcome.result}.`);
			statusBar.setSynced(Date.now());

			const logError = (message: string) => log.error(message);

			if (PULL_RESULTS.includes(outcome.result)) {
				log.info("Settings pulled from gist, notifying user.");
				void notifySynced({
					message: PULL_MESSAGE,
					diffTitle: PULL_DIFF_TITLE,
					beforeContent: localContentBeforeSync,
					settingsPath,
					logError,
				});
			} else if (outcome.result === "push") {
				log.info("Settings pushed to gist, notifying user.");
				void notifySynced({
					message: PUSH_MESSAGE,
					diffTitle: PUSH_DIFF_TITLE,
					beforeContent: outcome.remoteContentBeforePush ?? "",
					settingsPath,
					logError,
				});
			} else if (outcome.result === "init-push") {
				notifyCreated(CREATED_MESSAGE);
			}
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
	const watcher = watch(settingsPath, () => {
		if (writingLocally) {
			writingLocally = false;
			return;
		}
		log.debug("Local settings.json changed, scheduling sync.");
		clearTimeout(debounceHandle);
		debounceHandle = setTimeout(sync, WATCH_DEBOUNCE_MS);
	});

	const pollHandle = setInterval(() => {
		log.debug("Polling gist for remote changes.");
		void sync();
	}, POLL_INTERVAL_MS);

	context.subscriptions.push({
		dispose: () => {
			watcher.close();
			clearInterval(pollHandle);
			clearTimeout(debounceHandle);
		},
	});
}

export function deactivate(): void {}

function ensureSettingsFileExists(settingsPath: string): void {
	if (existsSync(settingsPath)) return;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, "{}\n", "utf8");
}

function createGlobalStateStore(
	context: vscode.ExtensionContext,
): SyncStateStore {
	return {
		get(): SyncState {
			return {
				gistId: context.globalState.get<string>(GIST_ID_KEY),
				gistUrl: context.globalState.get<string>(GIST_URL_KEY),
				lastSyncedAtMs: context.globalState.get<number>(LAST_SYNCED_AT_KEY),
			};
		},
		async update(patch: Partial<SyncState>): Promise<void> {
			if (patch.gistId !== undefined) {
				await context.globalState.update(GIST_ID_KEY, patch.gistId);
			}
			if (patch.gistUrl !== undefined) {
				await context.globalState.update(GIST_URL_KEY, patch.gistUrl);
			}
			if (patch.lastSyncedAtMs !== undefined) {
				await context.globalState.update(
					LAST_SYNCED_AT_KEY,
					patch.lastSyncedAtMs,
				);
			}
		},
	};
}
