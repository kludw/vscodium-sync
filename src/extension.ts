import { GistService } from "@services/gist";
import { GitHubService, SignInRequiredError } from "@services/github";
import { Logger } from "@util/log";
import * as vscode from "vscode";

const sync = async (
	log: Logger,
	githubService: GitHubService,
	gistService: GistService,
	afterSignIn = false,
): Promise<void> => {
	const result = await gistService.loadOrCreate();

	if (result.error instanceof SignInRequiredError && !afterSignIn) {
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

		return sync(log, githubService, gistService, true);
	}

	if (result.error) {
		const message = `VSCodium Sync: ${result.error.message}`;
		log.error(message);
		vscode.window.showErrorMessage(message);
		return;
	}

	log.debug(
		`VSCodium Sync: using gist ${result.value.id} (${Object.keys(result.value.files).length} file(s)).`,
	);
};

export function activate(context: vscode.ExtensionContext): void {
	const log = Logger.create("VSCodium Sync");
	context.subscriptions.push(log);
	log.info("Activated");

	const githubService = new GitHubService(log.scoped("GitHub"));
	const gistService = new GistService(githubService, log.scoped("Gist"));

	// Not awaited: the sign-in prompt shouldn't hold up activation.
	void sync(log, githubService, gistService);
}

export function deactivate(): void {}
