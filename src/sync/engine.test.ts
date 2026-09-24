import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { GIST_FILENAME } from "../github/client";
import { performSync, type SyncState, type SyncStateStore } from "./engine";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function fakeStore(initial: SyncState): SyncStateStore & { state: SyncState } {
	const store = {
		state: initial,
		get(): SyncState {
			return store.state;
		},
		async update(patch: Partial<SyncState>): Promise<void> {
			store.state = { ...store.state, ...patch };
		},
	};
	return store;
}

// biome-ignore lint/suspicious/noExplicitAny: bun-types' `typeof fetch` carries a static `preconnect` member a mock fn has no need to satisfy
function mockFetch(): any {
	return spyOn(global, "fetch");
}

afterEach(() => {
	(global.fetch as ReturnType<typeof mockFetch>).mockRestore?.();
});

describe("performSync — no gist linked yet", () => {
	test("adopts an existing remote gist by writing it locally", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([{ id: "found", files: { [GIST_FILENAME]: {} } }]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "found",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/found",
				files: { [GIST_FILENAME]: { content: '{"remote":true}' } },
			}),
		);

		const store = fakeStore({
			gistId: undefined,
			gistUrl: undefined,
			lastSyncedAtMs: undefined,
		});
		let written: string | undefined;

		const outcome = await performSync({
			token: "tok",
			store,
			readLocal: () => '{"local":true}',
			writeLocal: (content) => {
				written = content;
			},
			getLocalMtimeMs: () => 0,
		});

		expect(outcome.result).toBe("init-pull");
		expect(written).toBe('{"remote":true}');
		expect(store.state.gistId).toBe("found");
		expect(store.state.gistUrl).toBe("https://gist.github.com/someone/found");
		expect(store.state.lastSyncedAtMs).toBeGreaterThan(0);
	});

	test("creates a new gist from local content when none exists remotely", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () => jsonResponse([]));
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "created",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/created",
				files: { [GIST_FILENAME]: { content: '{"local":true}' } },
			}),
		);

		const store = fakeStore({
			gistId: undefined,
			gistUrl: undefined,
			lastSyncedAtMs: undefined,
		});

		const outcome = await performSync({
			token: "tok",
			store,
			readLocal: () => '{"local":true}',
			writeLocal: () => {
				throw new Error(
					"should not write local when creating from local content",
				);
			},
			getLocalMtimeMs: () => 0,
		});

		expect(outcome.result).toBe("init-push");
		expect(store.state.gistId).toBe("created");
		expect(store.state.gistUrl).toBe("https://gist.github.com/someone/created");
	});
});

describe("performSync — gist already linked", () => {
	test("pushes local changes when only local changed since last sync", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-01-01T00:00:00.000Z",
				files: { [GIST_FILENAME]: { content: "old" } },
			}),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: { [GIST_FILENAME]: { content: "new-local" } },
			}),
		);

		const store = fakeStore({
			gistId: "gist-1",
			gistUrl: "https://gist.github.com/someone/gist-1",
			lastSyncedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
		});

		const outcome = await performSync({
			token: "tok",
			store,
			readLocal: () => "new-local",
			writeLocal: () => {
				throw new Error("should not write local on a push");
			},
			getLocalMtimeMs: () => Date.parse("2024-05-01T00:00:00.000Z"),
		});

		expect(outcome.result).toBe("push");
		expect(outcome.remoteContentBeforePush).toBe("old");
		const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
		expect(init.method).toBe("PATCH");
	});

	test("pulls remote changes when only remote changed since last sync", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: { [GIST_FILENAME]: { content: "new-remote" } },
			}),
		);

		const store = fakeStore({
			gistId: "gist-1",
			gistUrl: "https://gist.github.com/someone/gist-1",
			lastSyncedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
		});
		let written: string | undefined;

		const outcome = await performSync({
			token: "tok",
			store,
			readLocal: () => "unchanged",
			writeLocal: (content) => {
				written = content;
			},
			getLocalMtimeMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
		});

		expect(outcome.result).toBe("pull");
		expect(outcome.remoteContentBeforePush).toBeUndefined();
		expect(written).toBe("new-remote");
	});

	test("does nothing when neither side changed", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: { [GIST_FILENAME]: { content: "same" } },
			}),
		);

		const lastSyncedAtMs = Date.parse("2024-02-01T00:00:00.000Z");
		const store = fakeStore({
			gistId: "gist-1",
			gistUrl: "https://gist.github.com/someone/gist-1",
			lastSyncedAtMs,
		});

		const outcome = await performSync({
			token: "tok",
			store,
			readLocal: () => "same",
			writeLocal: () => {
				throw new Error("should not write local when nothing changed");
			},
			getLocalMtimeMs: () => Date.parse("2024-01-15T00:00:00.000Z"),
		});

		expect(outcome.result).toBe("none");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
