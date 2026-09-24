import * as vscode from "vscode";

export interface StatusBar extends vscode.Disposable {
	setSyncing(): void;
	setSynced(atMs: number): void;
	setError(message: string): void;
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
		setSyncing(): void {
			item.text = "$(sync~spin) Syncing settings";
			item.tooltip = "VSCodium Sync: syncing…";
		},
		setSynced(atMs: number): void {
			item.text = "$(check) VSCodium Sync";
			item.tooltip = `VSCodium Sync: last synced ${new Date(atMs).toLocaleTimeString()}`;
		},
		setError(message: string): void {
			item.text = "$(error) Sync failed";
			item.tooltip = `VSCodium Sync: ${message}`;
		},
		dispose(): void {
			item.dispose();
		},
	};
}
