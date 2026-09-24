import * as vscode from "vscode";

export interface StatusBar extends vscode.Disposable {
	setError(message: string): void;
	setSynced(atMs: number): void;
	setSyncing(): void;
}

export function createStatusBar(command: string): StatusBar {
	const item = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	item.name = "VSCodium Sync";
	item.command = command;
	item.show();

	return {
		dispose(): void {
			item.dispose();
		},
		setError(message: string): void {
			item.text = "$(error) Sync failed";
			item.tooltip = `VSCodium Sync: ${message}`;
		},
		setSynced(atMs: number): void {
			item.text = "$(check) VSCodium Sync";
			item.tooltip = `VSCodium Sync: last synced ${new Date(atMs).toLocaleTimeString()}`;
		},
		setSyncing(): void {
			item.text = "$(sync~spin) Syncing settings";
			item.tooltip = "VSCodium Sync: syncing…";
		},
	};
}
