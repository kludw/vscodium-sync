import * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext) {
	vscode.window.showInformationMessage("Hello World");
}

export function deactivate() {}
