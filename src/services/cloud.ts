import type { GistService } from "@services/gist";
import { SignInRequiredError } from "@services/github";
import type { Logger } from "@util/log";
import * as vscode from "vscode";

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls the sync gist for changes made elsewhere and calls `onChange` when it was updated.
 * Only the focused window polls (each window runs its own copy of the extension), and a window
 * checks straight away when it gains focus.
 */
export class CloudService implements vscode.Disposable {
	private timer?: ReturnType<typeof setTimeout>;
	private checking = false;
	private readonly focusListener: vscode.Disposable;

	constructor(
		private readonly gistService: GistService,
		private readonly log: Logger,
		private readonly onChange: () => void,
	) {
		this.focusListener = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused) {
				void this.check();
			}
		});
		this.schedule(POLL_INTERVAL_MS);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.focusListener.dispose();
	}

	private schedule(delayMs: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(async () => {
			const pollInterval = vscode.window.state.focused
				? await this.check()
				: undefined;
			this.schedule(Math.max(POLL_INTERVAL_MS, (pollInterval ?? 0) * 1000));
		}, delayMs);
	}

	/** Returns GitHub's requested poll interval in seconds, if it sent one. */
	private async check(): Promise<number | undefined> {
		if (this.checking) {
			return undefined;
		}

		this.checking = true;

		try {
			const result = await this.gistService.hasChanged();

			if (result.error) {
				if (result.error instanceof SignInRequiredError) {
					this.log.debug("Not signed in, skipping cloud check");
				} else {
					this.log.warn(`Cloud check failed: ${result.error.message}`);
				}

				return undefined;
			}

			if (result.value.changed) {
				this.log.info("Cloud gist changed");
				this.onChange();
			}

			return result.value.pollInterval;
		} finally {
			this.checking = false;
		}
	}
}
