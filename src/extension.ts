import { CloudService } from "@services/cloud";
import { ExtensionsService } from "@services/extensions";
import { GistService } from "@services/gist";
import { GitHubService, SignInRequiredError } from "@services/github";
import { KeybindingsService } from "@services/keybindings";
import { SettingsService } from "@services/settings";
import { type SyncChange, SyncService } from "@services/sync";
import { DiffViewer } from "@util/diff";
import { Logger } from "@util/log";
import { SerialRunner } from "@util/runner";
import * as vscode from "vscode";

type Services = {
	githubService: GitHubService;
	gistService: GistService;
	syncService: SyncService;
	diffViewer: DiffViewer;
};

const showError = (log: Logger, error: Error): void => {
	const message = `VSCodium Sync: ${error.message}`;
	log.error(message);
	vscode.window.showErrorMessage(message);
};

/** "a", "a and b", "a, b and c" */
const listLabels = (labels: string[]): string =>
	labels.length > 1
		? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
		: (labels[0] ?? "");

/** Tells the user what synced, with a button to see the diffs. Not awaited by callers: the
 * notification can sit unanswered in the notification center indefinitely. */
const notify = async (
	diffViewer: DiffViewer,
	changes: SyncChange[],
): Promise<void> => {
	const labels = (direction: SyncChange["direction"]): string[] =>
		changes
			.filter((change) => change.direction === direction)
			.map((change) => change.label);
	const pushed = labels("push");
	const pulled = labels("pull");
	const parts = [
		pushed.length > 0 ? `uploaded ${listLabels(pushed)} to the cloud` : "",
		pulled.length > 0 ? `updated ${listLabels(pulled)} from the cloud` : "",
	].filter(Boolean);

	const action = await vscode.window.showInformationMessage(
		`VSCodium Sync: ${parts.join("; ")}.`,
		changes.length > 1 ? "Show diffs" : "Show diff",
	);

	if (!action) {
		return;
	}

	for (const change of changes) {
		await diffViewer.show(
			change.direction === "push"
				? `Cloud ${change.label} (before ↔ after sync)`
				: `${change.fileName} (before ↔ after sync)`,
			change.fileName,
			change.before,
			change.after,
		);
	}
};

/** @param promptSignIn Ask the user to sign in if needed; background syncs only log it. */
const sync = async (
	log: Logger,
	services: Services,
	promptSignIn: boolean,
): Promise<void> => {
	const { githubService, gistService, syncService, diffViewer } = services;
	const result = await gistService.loadOrCreate();

	if (result.error instanceof SignInRequiredError && !promptSignIn) {
		log.info("Not signed in to GitHub, skipping sync");
		return;
	}

	if (result.error instanceof SignInRequiredError) {
		const action = await vscode.window.showWarningMessage(
			`VSCodium Sync: ${result.error.message}`,
			"Sign in",
		);

		if (action !== "Sign in") {
			log.info("Sign-in dismissed");
			return;
		}

		try {
			await githubService.signIn();
		} catch (error) {
			log.error("GitHub sign-in failed:", error);
			return;
		}

		return sync(log, services, false);
	}

	if (result.error) {
		showError(log, result.error);
		return;
	}

	log.debug(
		`VSCodium Sync: using gist ${result.value.id} (${Object.keys(result.value.files).length} file(s)).`,
	);

	const synced = await syncService.sync(result.value);

	if (synced.error) {
		showError(log, synced.error);
		return;
	}

	const { changes, errors } = synced.value;

	if (errors.length > 0) {
		showError(log, new Error(errors.map((error) => error.message).join("; ")));
	}

	if (changes.length > 0) {
		void notify(diffViewer, changes);
	}
};

export function activate(context: vscode.ExtensionContext): void {
	const log = Logger.create("VSCodium Sync");
	context.subscriptions.push(log);
	log.info("Activated");

	// No API exposes the settings path; globalStorageUri is always <User>/globalStorage/<extension id>.
	const userDir = vscode.Uri.joinPath(context.globalStorageUri, "..", "..");

	const diffViewer = new DiffViewer();
	context.subscriptions.push(diffViewer);

	const githubService = new GitHubService(log.scoped("GitHub"));
	const gistService = new GistService(githubService, log.scoped("Gist"));
	const items = [
		new SettingsService(userDir, log.scoped("Settings")),
		new KeybindingsService(userDir, log.scoped("Keybindings")),
		new ExtensionsService(
			context.extension.id,
			context.globalState,
			log.scoped("Extensions"),
		),
	];
	const services: Services = {
		githubService,
		gistService,
		syncService: new SyncService(
			gistService,
			items,
			context.globalState,
			log.scoped("Sync"),
		),
		diffViewer,
	};

	// Only the first sync (at startup) may prompt for sign-in; later ones run in the background.
	let promptSignIn = true;
	const runner = new SerialRunner(
		async () => {
			const prompt = promptSignIn;
			promptSignIn = false;
			await sync(log, services, prompt);
		},
		(error) => log.error("Sync failed unexpectedly:", error),
	);

	context.subscriptions.push(
		...items.map((item) => item.watch(() => runner.run())),
		new CloudService(gistService, log.scoped("Cloud"), () => runner.run()),
	);

	// Not awaited (run() returns immediately): the sign-in prompt shouldn't hold up activation.
	runner.run();
}

export function deactivate(): void {}
