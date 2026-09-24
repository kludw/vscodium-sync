import * as vscode from "vscode";

export interface StatusMenuDeps {
	getGistUrl: () => string | undefined;
	showLog: () => void;
	syncNow: () => Promise<void>;
}

const OPEN_GIST = "$(link-external) Open Sync Gist";
const OPEN_KEYBINDINGS = "$(keyboard) Open Keybindings JSON";
const OPEN_SETTINGS = "$(settings-gear) Open Settings JSON";
const SHOW_LOG = "$(output) Show Sync Log";
const SYNC_NOW = "$(sync) Sync Now";

export async function showStatusMenu(deps: StatusMenuDeps): Promise<void> {
	const gistUrl = deps.getGistUrl();
	// Display order is deliberate (primary action, then navigation, then log) - not alphabetical.
	const items = [
		SYNC_NOW,
		OPEN_SETTINGS,
		OPEN_KEYBINDINGS,
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
	} else if (picked === OPEN_KEYBINDINGS) {
		await vscode.commands.executeCommand(
			"workbench.action.openGlobalKeybindingsFile",
		);
	} else if (picked === OPEN_GIST && gistUrl) {
		await vscode.env.openExternal(vscode.Uri.parse(gistUrl));
	} else if (picked === SHOW_LOG) {
		deps.showLog();
	}
}
