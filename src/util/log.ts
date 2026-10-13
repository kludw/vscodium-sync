import * as vscode from "vscode";

/** Writes to a "log" output channel. Scoped loggers share the channel and tag each line. */
export class Logger implements vscode.Disposable {
	private constructor(
		private readonly channel: vscode.LogOutputChannel,
		private readonly scope?: string,
	) {}

	/** Creates the output channel shown in the Output panel as `name`. */
	static create(name: string): Logger {
		return new Logger(vscode.window.createOutputChannel(name, { log: true }));
	}

	scoped(scope: string): Logger {
		return new Logger(this.channel, scope);
	}

	debug(message: string, ...args: unknown[]): void {
		this.channel.debug(this.format(message), ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.channel.info(this.format(message), ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.channel.warn(this.format(message), ...args);
	}

	error(message: string, ...args: unknown[]): void {
		this.channel.error(this.format(message), ...args);
	}

	dispose(): void {
		this.channel.dispose();
	}

	private format(message: string): string {
		return this.scope ? `[${this.scope}] ${message}` : message;
	}
}
