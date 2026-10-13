import type { Logger } from "@util/log";
import * as vscode from "vscode";

const GITHUB_API = "https://api.github.com";
const SCOPES = ["gist"];

export type GitHubRequestInit = { method?: "GET" | "POST"; body?: unknown };

/** No GitHub session with the `gist` scope that this extension may use; see `GitHubService.signIn`. */
export class SignInRequiredError extends Error {
	constructor() {
		super("Sign in to GitHub to sync settings.");
	}
}

/** GitHub sign-in through the editor's built-in provider, and REST API calls. */
export class GitHubService {
	constructor(private readonly log: Logger) {}

	/** Asks the user (modal) to sign in or grant the `gist` scope. Rejects if they cancel. */
	async signIn(): Promise<void> {
		this.log.info(`Requesting sign-in with scopes: ${SCOPES.join(",")}`);
		const session = await vscode.authentication.getSession("github", SCOPES, {
			createIfNone: true,
		});
		this.log.info(`Signed in as ${session.account.label}`);
	}

	/** Returns the access token for a usable session. Throws {@link SignInRequiredError} without prompting. */
	async getToken(): Promise<string> {
		const accounts = await vscode.authentication.getAccounts("github");
		this.log.info(
			`Accounts: ${accounts.map((account) => account.label).join(", ") || "none"}`,
		);

		// Being signed in isn't enough: the session needs the `gist` scope and access granted to
		// this extension. Without createIfNone this doesn't prompt; it adds an Accounts menu badge.
		const session = await vscode.authentication.getSession("github", SCOPES);

		if (!session) {
			this.log.warn(
				`No session with scopes ${SCOPES.join(",")} available to this extension`,
			);
			throw new SignInRequiredError();
		}

		this.log.info(
			`Using session for ${session.account.label} (scopes: ${session.scopes.join(",")})`,
		);
		return session.accessToken;
	}

	/** Calls the REST API and returns the parsed JSON. Throws on non-2xx responses. */
	async request<T>(
		token: string,
		path: string,
		init: GitHubRequestInit = {},
	): Promise<T> {
		const method = init.method ?? "GET";
		this.log.debug(`${method} ${path}`);
		const response = await fetch(`${GITHUB_API}${path}`, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2026-03-10",
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});

		this.log.debug(`${method} ${path} -> ${response.status}`);

		if (!response.ok) {
			throw new Error(
				`GitHub ${path} failed: ${response.status} ${response.statusText}`,
			);
		}

		return (await response.json()) as T;
	}
}
