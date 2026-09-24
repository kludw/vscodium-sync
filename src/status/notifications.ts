import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

const DIFF_BEFORE_FILENAME = "vscodium-sync-diff-before.json";
const VIEW_DIFF = "View Diff";

export interface SyncedNotificationDeps {
	message: string;
	diffTitle: string;
	beforeContent: string;
	settingsPath: string;
	logError: (message: string) => void;
}

export async function notifySynced(
	deps: SyncedNotificationDeps,
): Promise<void> {
	const choice = await vscode.window.showInformationMessage(
		deps.message,
		VIEW_DIFF,
	);
	if (choice !== VIEW_DIFF) return;

	try {
		const beforeUri = vscode.Uri.file(join(tmpdir(), DIFF_BEFORE_FILENAME));
		await vscode.workspace.fs.writeFile(
			beforeUri,
			Buffer.from(deps.beforeContent, "utf8"),
		);
		await vscode.commands.executeCommand(
			"vscode.diff",
			beforeUri,
			vscode.Uri.file(deps.settingsPath),
			deps.diffTitle,
		);
	} catch (error) {
		deps.logError(`Failed to open sync diff: ${(error as Error).message}`);
	}
}

export function notifyCreated(message: string): void {
	vscode.window.showInformationMessage(message);
}
