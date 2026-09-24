import * as vscode from "vscode";

export interface StatusMenuDeps {
	getGistUrl: () => string | undefined;
	syncNow: () => Promise<void>;
	showLog: () => void;
}

const SYNC_NOW = "$(sync) Sync Now";
const OPEN_SETTINGS = "$(settings-gear) Open Settings JSON";
const OPEN_GIST = "$(link-external) Open Sync Gist";
const SHOW_LOG = "$(output) Show Sync Log";

export async function showStatusMenu(deps: StatusMenuDeps): Promise<void> {
	const gistUrl = deps.getGistUrl();
	const items = [
		SYNC_NOW,
		OPEN_SETTINGS,
		...(gistUrl ? [OPEN_GIST] : []),
		SHOW_LOG,
	];

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: "VSCodium Sync",
	});

	if (picked === SYNC_NOW) {
		await deps.syncNow();
	} else if (picked === OPEN_SETTINGS) {
		await vscode.commands.executeCommand("workbench.action.openSettingsJson");
	} else if (picked === OPEN_GIST && gistUrl) {
		await vscode.env.openExternal(vscode.Uri.parse(gistUrl));
	} else if (picked === SHOW_LOG) {
		deps.showLog();
	}
}
