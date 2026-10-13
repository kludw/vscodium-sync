import { CloudService } from "@services/cloud";
import { GistService } from "@services/gist";
import { GitHubService, SignInRequiredError } from "@services/github";
import { SettingsService } from "@services/settings";
import { SyncService } from "@services/sync";
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

/** Tells the user what synced, with a button to see the diff. Not awaited by callers: the
 * notification can sit unanswered in the notification center indefinitely. */
const notify = async (
	diffViewer: DiffViewer,
	direction: "push" | "pull",
	before: string,
	after: string,
): Promise<void> => {
	const action = await vscode.window.showInformationMessage(
		direction === "push"
			? "VSCodium Sync: uploaded your settings to the cloud."
			: "VSCodium Sync: updated your settings from the cloud.",
		"Show diff",
	);

	if (action === "Show diff") {
		await diffViewer.show(
			direction === "push"
				? "Cloud settings (before ↔ after sync)"
				: "settings.json (before ↔ after sync)",
			"settings.json",
			before,
			after,
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

	const outcome = synced.value;

	if (outcome.direction === "none") {
		return;
	}

	void notify(diffViewer, outcome.direction, outcome.before, outcome.after);
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
	const settingsService = new SettingsService(userDir, log.scoped("Settings"));
	const services: Services = {
		githubService,
		gistService,
		syncService: new SyncService(
			gistService,
			settingsService,
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
		settingsService.watch(() => runner.run()),
		new CloudService(gistService, log.scoped("Cloud"), () => runner.run()),
	);

	// Not awaited (run() returns immediately): the sign-in prompt shouldn't hold up activation.
	runner.run();
}

export function deactivate(): void {}
