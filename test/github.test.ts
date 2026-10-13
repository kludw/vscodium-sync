import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	GitHubRequestError,
	GitHubService,
	SignInRequiredError,
} from "@services/github";
import { fake, resetFake } from "./fake-vscode";
import { testLogger } from "./helpers";

const realFetch = globalThis.fetch;
let requests: { url: string; init: RequestInit }[];

const respond = (
	status: number,
	body?: unknown,
	headers: Record<string, string> = {},
) => {
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		requests.push({ url, init });
		return new Response(body === undefined ? null : JSON.stringify(body), {
			status,
			headers,
		});
	}) as typeof fetch;
};

beforeEach(() => {
	resetFake();
	requests = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("send", () => {
	test("sends the API headers and JSON body", async () => {
		respond(200, { id: "G" }, { etag: '"e1"' });

		const response = await new GitHubService(testLogger()).send(
			"token",
			"/gists",
			{
				method: "POST",
				body: { a: 1 },
			},
		);

		expect(response).toEqual({
			status: 200,
			etag: '"e1"',
			pollInterval: undefined,
			data: { id: "G" },
		});
		expect(requests[0]?.url).toBe("https://api.github.com/gists");
		expect(requests[0]?.init.method).toBe("POST");
		expect(requests[0]?.init.body).toBe('{"a":1}');
		expect(requests[0]?.init.headers).toMatchObject({
			Accept: "application/vnd.github+json",
			Authorization: "Bearer token",
			"X-GitHub-Api-Version": "2026-03-10",
		});
	});

	test("makes conditional requests and treats 304 as success without data", async () => {
		respond(304, undefined, { etag: '"e1"', "x-poll-interval": "120" });

		const response = await new GitHubService(testLogger()).send(
			"t",
			"/gists/G",
			{
				ifNoneMatch: '"e1"',
			},
		);

		expect(requests[0]?.init.headers).toMatchObject({
			"If-None-Match": '"e1"',
		});
		expect(response).toEqual({
			status: 304,
			etag: '"e1"',
			pollInterval: 120,
			data: undefined,
		});
	});

	test("throws GitHubRequestError with the status on other failures", async () => {
		respond(404, { message: "Not Found" });

		const error = await new GitHubService(testLogger())
			.send("t", "/gists/G")
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(GitHubRequestError);
		expect((error as GitHubRequestError).status).toBe(404);
	});
});

describe("sign-in", () => {
	test("getToken returns the session's token without prompting", async () => {
		fake.session = {
			accessToken: "abc",
			account: { label: "kludw" },
			scopes: ["gist"],
		};

		expect(await new GitHubService(testLogger()).getToken()).toBe("abc");
	});

	test("getToken throws SignInRequiredError when there's no usable session", async () => {
		await expect(
			new GitHubService(testLogger()).getToken(),
		).rejects.toBeInstanceOf(SignInRequiredError);
	});

	test("signIn asks for a session, which getToken then uses", async () => {
		fake.signIn = () => ({
			accessToken: "new",
			account: { label: "kludw" },
			scopes: ["gist"],
		});
		const github = new GitHubService(testLogger());

		await github.signIn();

		expect(await github.getToken()).toBe("new");
	});
});
