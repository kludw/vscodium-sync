import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	createSyncGist,
	EXTENSIONS_FILENAME,
	findSyncGist,
	getGist,
	SETTINGS_FILENAME,
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
	test("returns the gist whose files contain the settings marker filename, with both file contents", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([
				{ id: "unrelated", files: { "notes.md": {} } },
				{ id: "sync-gist", files: { [SETTINGS_FILENAME]: {} } },
			]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "sync-gist",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/sync-gist",
				files: {
					[SETTINGS_FILENAME]: { content: '{"a":1}' },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const result = await findSyncGist("tok");

		expect(result).toEqual({
			id: "sync-gist",
			updatedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
			htmlUrl: "https://gist.github.com/someone/sync-gist",
			settingsContent: '{"a":1}',
			extensionsContent: '["a.one"]',
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

describe("getGist", () => {
	test("leaves extensionsContent undefined when the gist predates extensions support", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "old-gist",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/old-gist",
				files: { [SETTINGS_FILENAME]: { content: "{}" } },
			}),
		);

		const result = await getGist("tok", "old-gist");

		expect(result.settingsContent).toBe("{}");
		expect(result.extensionsContent).toBeUndefined();
	});

	test("throws with status and body on a non-ok response", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(
			async () => new Response("nope", { status: 404 }),
		);

		await expect(getGist("tok", "missing")).rejects.toThrow(/404/);
	});
});

describe("createSyncGist", () => {
	test("POSTs a private gist with both files", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "new-gist",
				updated_at: "2024-02-02T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/new-gist",
				files: {
					[SETTINGS_FILENAME]: { content: '{"b":2}' },
					[EXTENSIONS_FILENAME]: { content: '["b.two"]' },
				},
			}),
		);

		const result = await createSyncGist("tok", '{"b":2}', '["b.two"]');

		expect(result.id).toBe("new-gist");
		expect(result.htmlUrl).toBe("https://gist.github.com/someone/new-gist");
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/gists");
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.public).toBe(false);
		expect(body.files[SETTINGS_FILENAME].content).toBe('{"b":2}');
		expect(body.files[EXTENSIONS_FILENAME].content).toBe('["b.two"]');
	});
});

describe("updateSyncGist", () => {
	test("PATCHes only the files given in the patch", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-03-03T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: { [SETTINGS_FILENAME]: { content: '{"c":3}' } },
			}),
		);

		const result = await updateSyncGist("tok", "gist-1", {
			settings: '{"c":3}',
		});

		expect(result.updatedAtMs).toBe(Date.parse("2024-03-03T00:00:00.000Z"));
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.github.com/gists/gist-1");
		expect(init.method).toBe("PATCH");
		const body = JSON.parse(init.body as string);
		expect(body.files[SETTINGS_FILENAME].content).toBe('{"c":3}');
		expect(body.files[EXTENSIONS_FILENAME]).toBeUndefined();
	});

	test("PATCHes both files when both are given", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-03-03T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: '{"c":3}' },
					[EXTENSIONS_FILENAME]: { content: '["c.three"]' },
				},
			}),
		);

		await updateSyncGist("tok", "gist-1", {
			settings: '{"c":3}',
			extensions: '["c.three"]',
		});

		const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.files[SETTINGS_FILENAME].content).toBe('{"c":3}');
		expect(body.files[EXTENSIONS_FILENAME].content).toBe('["c.three"]');
	});
});
