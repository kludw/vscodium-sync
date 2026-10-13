import type { SyncChange } from "@services/sync";
import type { DiffViewer } from "@util/diff";
import type { Logger } from "@util/log";
import * as vscode from "vscode";

const PREFIX = "VSCodium Sync";

/** Everything the user sees: errors, warnings, the sign-in prompt, and what synced (with diffs). */
export class NotificationService {
	constructor(
		private readonly diffViewer: DiffViewer,
		private readonly log: Logger,
	) {}

	error(error: Error): void {
		const message = `${PREFIX}: ${error.message}`;
		this.log.error(message);
		void vscode.window.showErrorMessage(message);
	}

	warn(message: string): void {
		this.log.warn(message);
		void vscode.window.showWarningMessage(`${PREFIX}: ${message}`);
	}

	/** Resolves to true if the user chose to sign in. */
	async askToSignIn(message: string): Promise<boolean> {
		const action = await vscode.window.showWarningMessage(
			`${PREFIX}: ${message}`,
			"Sign in",
		);
		return action === "Sign in";
	}

	/**
	 * Tells the user what synced, with a button to see the diffs. Returns immediately: the
	 * notification can sit unanswered in the notification center indefinitely, and syncing
	 * shouldn't wait for it.
	 */
	changes(changes: SyncChange[]): void {
		if (changes.length > 0) {
			void this.showChanges(changes);
		}
	}

	private async showChanges(changes: SyncChange[]): Promise<void> {
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
			`${PREFIX}: ${parts.join("; ")}.`,
			changes.length > 1 ? "Show diffs" : "Show diff",
		);

		if (!action) {
			return;
		}

		for (const change of changes) {
			await this.diffViewer.show(
				change.direction === "push"
					? `Cloud ${change.label} (before ↔ after sync)`
					: `${change.fileName} (before ↔ after sync)`,
				change.fileName,
				change.before,
				change.after,
			);
		}
	}
}

/** "a", "a and b", "a, b and c" */
export const listLabels = (labels: string[]): string =>
	labels.length > 1
		? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
		: (labels[0] ?? "");
