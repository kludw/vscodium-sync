import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

const VIEW_DIFF = "View Diff";

export interface SyncedNotificationDeps {
	/** Namespaces the temp diff files so a settings diff and an extensions diff never collide. */
	id: string;
	message: string;
	diffTitle: string;
	beforeContent: string;
	afterContent: string;
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
		const beforeUri = vscode.Uri.file(
			join(tmpdir(), `vscodium-sync-diff-${deps.id}-before.json`),
		);
		const afterUri = vscode.Uri.file(
			join(tmpdir(), `vscodium-sync-diff-${deps.id}-after.json`),
		);
		await vscode.workspace.fs.writeFile(
			beforeUri,
			Buffer.from(deps.beforeContent, "utf8"),
		);
		await vscode.workspace.fs.writeFile(
			afterUri,
			Buffer.from(deps.afterContent, "utf8"),
		);
		await vscode.commands.executeCommand(
			"vscode.diff",
			beforeUri,
			afterUri,
			deps.diffTitle,
		);
	} catch (error) {
		deps.logError(`Failed to open sync diff: ${(error as Error).message}`);
	}
}

export function notifyCreated(message: string): void {
	vscode.window.showInformationMessage(message);
}
