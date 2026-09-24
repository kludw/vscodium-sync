import * as vscode from "vscode";
import { EXTENSIONS_FILENAME, SETTINGS_FILENAME } from "../github/client";

export interface StatusMenuDeps {
	getGistUrl: () => string | undefined;
	syncNow: () => Promise<void>;
	showLog: () => void;
}

const SYNC_NOW = "$(sync) Sync Now";
const OPEN_SETTINGS = "$(settings-gear) Open Settings JSON";
const OPEN_SETTINGS_GIST = "$(link-external) Open Settings Gist";
const OPEN_EXTENSIONS_GIST = "$(link-external) Open Extensions Gist";
const SHOW_LOG = "$(output) Show Sync Log";

function gistFileUrl(gistUrl: string, filename: string): string {
	return `${gistUrl}#file-${filename.replace(/\./g, "-")}`;
}

export async function showStatusMenu(deps: StatusMenuDeps): Promise<void> {
	const gistUrl = deps.getGistUrl();
	const items = [
		SYNC_NOW,
		OPEN_SETTINGS,
		...(gistUrl ? [OPEN_SETTINGS_GIST, OPEN_EXTENSIONS_GIST] : []),
		SHOW_LOG,
	];

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: "VSCodium Sync",
	});

	if (picked === SYNC_NOW) {
		await deps.syncNow();
	} else if (picked === OPEN_SETTINGS) {
		await vscode.commands.executeCommand("workbench.action.openSettingsJson");
	} else if (picked === OPEN_SETTINGS_GIST && gistUrl) {
		await vscode.env.openExternal(
			vscode.Uri.parse(gistFileUrl(gistUrl, SETTINGS_FILENAME)),
		);
	} else if (picked === OPEN_EXTENSIONS_GIST && gistUrl) {
		await vscode.env.openExternal(
			vscode.Uri.parse(gistFileUrl(gistUrl, EXTENSIONS_FILENAME)),
		);
	} else if (picked === SHOW_LOG) {
		deps.showLog();
	}
}
