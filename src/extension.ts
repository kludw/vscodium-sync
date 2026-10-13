import { CloudService } from "@services/cloud";
import { ExtensionsService } from "@services/extensions";
import { type Gist, GistService } from "@services/gist";
import { GitHubService, SignInRequiredError } from "@services/github";
import { KeybindingsService } from "@services/keybindings";
import { NotificationService } from "@services/notifications";
import { SettingsService } from "@services/settings";
import { type SyncItem, SyncService } from "@services/sync";
import { DiffViewer } from "@util/diff";
import { toError } from "@util/errors";
import { Logger } from "@util/log";
import { SerialRunner } from "@util/runner";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
	const log = Logger.create("VSCodium Sync");
	const diffViewer = new DiffViewer();
	context.subscriptions.push(log, diffViewer);
	log.info("Activated");

	// No API exposes the settings path; globalStorageUri is always <User>/globalStorage/<extension id>.
	const userDir = vscode.Uri.joinPath(context.globalStorageUri, "..", "..");

	const notificationService = new NotificationService(diffViewer, log);
	const githubService = new GitHubService(log.scoped("GitHub"));
	const gistService = new GistService(githubService, log.scoped("Gist"));
	const items: SyncItem[] = [
		new SettingsService(userDir, log.scoped("Settings")),
		new KeybindingsService(userDir, log.scoped("Keybindings")),
		new ExtensionsService(
			context.extension.id,
			context.globalState,
			log.scoped("Extensions"),
		),
	];
	const syncService = new SyncService(
		gistService,
		items,
		context.globalState,
		log.scoped("Sync"),
	);

	/** Loads the gist, asking the user to sign in first if `promptSignIn` and needed. */
	const loadGist = async (promptSignIn: boolean): Promise<Gist | undefined> => {
		try {
			return await gistService.loadOrCreate();
		} catch (error) {
			if (!(error instanceof SignInRequiredError)) {
				throw error;
			}

			if (!promptSignIn) {
				log.info("Not signed in to GitHub, skipping sync");
				return undefined;
			}

			if (!(await notificationService.askToSignIn(error.message))) {
				log.info("Sign-in dismissed");
				return undefined;
			}

			try {
				await githubService.signIn();
			} catch (signInError) {
				log.error("GitHub sign-in failed:", signInError);
				return undefined;
			}

			return loadGist(false);
		}
	};

	const sync = async (promptSignIn: boolean): Promise<void> => {
		try {
			const gist = await loadGist(promptSignIn);

			if (!gist) {
				return;
			}

			const { changes, errors, warnings } = await syncService.sync(gist);

			if (errors.length > 0) {
				notificationService.error(
					new Error(errors.map((error) => error.message).join("; ")),
				);
			}

			for (const warning of warnings) {
				notificationService.warn(warning);
			}

			notificationService.changes(changes);
		} catch (error) {
			notificationService.error(toError(error));
		}
	};

	// Only the first sync (at startup) may prompt for sign-in; later ones run in the background.
	let promptSignIn = true;
	const runner = new SerialRunner(
		() => {
			const prompt = promptSignIn;
			promptSignIn = false;
			return sync(prompt);
		},
		(error) => log.error("Sync failed unexpectedly:", error),
	);

	context.subscriptions.push(
		...items.map((item) => item.watch(() => runner.run())),
		new CloudService(gistService, log.scoped("Cloud"), () => runner.run()),
	);

	// Returns immediately: the sign-in prompt shouldn't hold up activation.
	runner.run();
}

export function deactivate(): void {}
