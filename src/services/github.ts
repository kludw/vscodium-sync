import type { Logger } from "@util/log";
import * as vscode from "vscode";

const GITHUB_API = "https://api.github.com";
const SCOPES = ["gist"];

export type GitHubRequestInit = {
	method?: "GET" | "POST" | "PATCH";
	body?: unknown;
	/** Makes a conditional GET: GitHub answers 304 (free against the rate limit) if unchanged. */
	ifNoneMatch?: string;
};

export type GitHubResponse<T> = {
	status: number;
	etag?: string;
	/** Seconds GitHub asks pollers to wait (`x-poll-interval`), if sent. */
	pollInterval?: number;
	/** Absent on 304 Not Modified. */
	data?: T;
};

/** A non-2xx (and non-304) response from the REST API. */
export class GitHubRequestError extends Error {
	constructor(
		readonly status: number,
		path: string,
		statusText: string,
	) {
		super(`GitHub ${path} failed: ${status} ${statusText}`);
	}
}

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
		this.log.debug(
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

		this.log.debug(
			`Using session for ${session.account.label} (scopes: ${session.scopes.join(",")})`,
		);
		return session.accessToken;
	}

	/** Calls the REST API and returns the parsed JSON. Throws {@link GitHubRequestError} on non-2xx responses. */
	async request<T>(
		token: string,
		path: string,
		init: GitHubRequestInit = {},
	): Promise<T> {
		return (await this.send<T>(token, path, init)).data as T;
	}

	/** Like {@link request}, but also returns status and headers, and treats 304 Not Modified as success. */
	async send<T>(
		token: string,
		path: string,
		init: GitHubRequestInit = {},
	): Promise<GitHubResponse<T>> {
		const method = init.method ?? "GET";
		this.log.debug(`${method} ${path}`);
		const response = await fetch(`${GITHUB_API}${path}`, {
			method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2026-03-10",
				...(init.ifNoneMatch ? { "If-None-Match": init.ifNoneMatch } : {}),
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		});

		this.log.debug(`${method} ${path} -> ${response.status}`);

		if (!response.ok && response.status !== 304) {
			throw new GitHubRequestError(response.status, path, response.statusText);
		}

		const pollInterval = Number(response.headers.get("x-poll-interval"));
		return {
			status: response.status,
			etag: response.headers.get("etag") ?? undefined,
			pollInterval: pollInterval > 0 ? pollInterval : undefined,
			data:
				response.status === 304 ? undefined : ((await response.json()) as T),
		};
	}
}
