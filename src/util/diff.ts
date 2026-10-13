import * as vscode from "vscode";

const SCHEME = "vscodium-sync-diff";
/** Diffs kept available for reopening; older ones are dropped so memory doesn't grow forever. */
const KEEP_DIFFS = 20;

/** Opens before/after text in the diff editor, served as read-only virtual documents. */
export class DiffViewer implements vscode.Disposable {
	private readonly documents = new Map<string, string>();
	private readonly registration: vscode.Disposable;
	private next = 0;

	constructor() {
		this.registration = vscode.workspace.registerTextDocumentContentProvider(
			SCHEME,
			{ provideTextDocumentContent: (uri) => this.documents.get(uri.path) },
		);
	}

	/** `fileName` sets the language (e.g. `settings.json` gets JSON highlighting). */
	async show(
		title: string,
		fileName: string,
		before: string,
		after: string,
	): Promise<void> {
		const id = this.next++;
		const left = this.add(`/${id}/before/${fileName}`, before);
		const right = this.add(`/${id}/after/${fileName}`, after);
		this.forget(id - KEEP_DIFFS);
		await vscode.commands.executeCommand("vscode.diff", left, right, title);
	}

	dispose(): void {
		this.registration.dispose();
		this.documents.clear();
	}

	private add(path: string, content: string): vscode.Uri {
		this.documents.set(path, content);
		return vscode.Uri.from({ scheme: SCHEME, path });
	}

	private forget(id: number): void {
		for (const path of this.documents.keys()) {
			if (path.startsWith(`/${id}/`)) {
				this.documents.delete(path);
			}
		}
	}
}
