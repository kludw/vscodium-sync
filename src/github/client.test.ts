import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	createSyncGist,
	findSyncGist,
	GIST_FILENAME,
	getGist,
	updateSyncGist,
} from "./client";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

// biome-ignore lint/suspicious/noExplicitAny: bun-types' `typeof fetch` carries a static `preconnect` member a mock fn has no need to satisfy
function mockFetch(): any {
	return spyOn(global, "fetch");
}

afterEach(() => {
	(global.fetch as ReturnType<typeof mockFetch>).mockRestore?.();
});

describe("findSyncGist", () => {
	test("returns the gist whose files contain the sync marker filename", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([
				{ id: "unrelated", files: { "notes.md": {} } },
				{ id: "sync-gist", files: { [GIST_FILENAME]: {} } },
			]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "sync-gist",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/sync-gist",
				files: { [GIST_FILENAME]: { content: '{"a":1}' } },
			}),
		);

		const result = await findSyncGist("tok");

		expect(result).toEqual({
			id: "sync-gist",
			updatedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
			htmlUrl: "https://gist.github.com/someone/sync-gist",
			content: '{"a":1}',
		});
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/gists?per_page=100");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok",
		);
	});

	test("returns undefined when no gist matches", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([{ id: "unrelated", files: { "notes.md": {} } }]),
		);

		expect(await findSyncGist("tok")).toBeUndefined();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

describe("createSyncGist", () => {
	test("POSTs a private gist with the sync marker filename", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "new-gist",
				updated_at: "2024-02-02T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/new-gist",
				files: { [GIST_FILENAME]: { content: '{"b":2}' } },
			}),
		);

		const result = await createSyncGist("tok", '{"b":2}');

		expect(result.id).toBe("new-gist");
		expect(result.htmlUrl).toBe("https://gist.github.com/someone/new-gist");
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/gists");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.public).toBe(false);
		expect(body.files[GIST_FILENAME].content).toBe('{"b":2}');
	});
});

describe("updateSyncGist", () => {
	test("PATCHes the gist content", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-03-03T00:00:00.000Z",
				files: { [GIST_FILENAME]: { content: '{"c":3}' } },
			}),
		);

		const result = await updateSyncGist("tok", "gist-1", '{"c":3}');

		expect(result.updatedAtMs).toBe(Date.parse("2024-03-03T00:00:00.000Z"));
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/gists/gist-1");
		expect(init.method).toBe("PATCH");
	});
});

describe("getGist", () => {
	test("throws with status and body on a non-ok response", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(
			async () => new Response("nope", { status: 404 }),
		);

		await expect(getGist("tok", "missing")).rejects.toThrow(/404/);
	});
});
