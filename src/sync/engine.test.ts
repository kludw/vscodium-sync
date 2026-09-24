import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { EXTENSIONS_FILENAME, SETTINGS_FILENAME } from "../github/client";
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

function noGistState(): SyncState {
	return {
		gistId: undefined,
		gistUrl: undefined,
		settingsLastSyncedAtMs: undefined,
		extensionsLastSyncedAtMs: undefined,
	};
}

describe("performSync — no gist linked yet", () => {
	test("adopts an existing gist with both files: pulls settings and diffs extensions", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([{ id: "found", files: { [SETTINGS_FILENAME]: {} } }]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "found",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/found",
				files: {
					[SETTINGS_FILENAME]: { content: '{"remote":true}' },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(noGistState());
		let writtenSettings: string | undefined;

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => '{"local":true}',
				writeLocal: (content) => {
					writtenSettings = content;
				},
				getLocalChangedAtMs: () => 0,
			},
			extensions: {
				readLocal: () => "[]",
				applyDiff: async () => {},
				getLocalChangedAtMs: () => 0,
			},
		});

		expect(outcome.linked).toBe("found");
		expect(outcome.settings.action).toBe("pull");
		expect(writtenSettings).toBe('{"remote":true}');
		expect(outcome.extensions.action).toBe("pull");
		expect(outcome.extensions.diff).toEqual({
			toInstall: ["a.one"],
			toUninstall: [],
		});
		expect(store.state.gistId).toBe("found");
		expect(store.state.gistUrl).toBe("https://gist.github.com/someone/found");
	});

	test("adopts an existing gist whose extensions already match: reports none, never applies a diff", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([{ id: "found", files: { [SETTINGS_FILENAME]: {} } }]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "found",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/found",
				files: {
					[SETTINGS_FILENAME]: { content: '{"remote":true}' },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(noGistState());

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => '{"local":true}',
				writeLocal: () => {},
				getLocalChangedAtMs: () => 0,
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error("should not apply an empty diff");
				},
				getLocalChangedAtMs: () => 0,
			},
		});

		expect(outcome.extensions.action).toBe("none");
		expect(outcome.extensions.diff).toBeUndefined();
	});

	test("adopts an existing gist that predates extensions support: seeds the extensions file", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse([{ id: "old", files: { [SETTINGS_FILENAME]: {} } }]),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "old",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/old",
				files: { [SETTINGS_FILENAME]: { content: "{}" } },
			}),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "old",
				updated_at: "2024-01-02T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/old",
				files: {
					[SETTINGS_FILENAME]: { content: "{}" },
					[EXTENSIONS_FILENAME]: { content: '["local.one"]' },
				},
			}),
		);

		const store = fakeStore(noGistState());
		let applied: unknown;

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "{}",
				writeLocal: () => {},
				getLocalChangedAtMs: () => 0,
			},
			extensions: {
				readLocal: () => '["local.one"]',
				applyDiff: async (diff) => {
					applied = diff;
				},
				getLocalChangedAtMs: () => 0,
			},
		});

		expect(outcome.extensions.action).toBe("push");
		expect(applied).toBeUndefined();
		const [, init] = fetchSpy.mock.calls[2] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.files[EXTENSIONS_FILENAME].content).toBe('["local.one"]');
		expect(body.files[SETTINGS_FILENAME]).toBeUndefined();
	});

	test("creates a new gist from local content when none exists remotely", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () => jsonResponse([]));
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "created",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/created",
				files: {
					[SETTINGS_FILENAME]: { content: '{"local":true}' },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(noGistState());

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => '{"local":true}',
				writeLocal: () => {
					throw new Error(
						"should not write local when creating from local content",
					);
				},
				getLocalChangedAtMs: () => 0,
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error(
						"should not apply a diff when creating from local content",
					);
				},
				getLocalChangedAtMs: () => 0,
			},
		});

		expect(outcome.linked).toBe("created");
		expect(outcome.settings.action).toBe("push");
		expect(outcome.extensions.action).toBe("push");
		expect(store.state.gistId).toBe("created");
		const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.files[SETTINGS_FILENAME].content).toBe('{"local":true}');
		expect(body.files[EXTENSIONS_FILENAME].content).toBe('["a.one"]');
	});
});

describe("performSync — gist already linked", () => {
	function linkedState(overrides: Partial<SyncState> = {}): SyncState {
		return {
			gistId: "gist-1",
			gistUrl: "https://gist.github.com/someone/gist-1",
			settingsLastSyncedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
			extensionsLastSyncedAtMs: Date.parse("2024-01-01T00:00:00.000Z"),
			...overrides,
		};
	}

	test("re-links by creating a new gist when the linked gist is gone (404)", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(
			async () => new Response("Not Found", { status: 404 }),
		);
		fetchSpy.mockImplementationOnce(async () => jsonResponse([]));
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-2",
				updated_at: "2024-07-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-2",
				files: {
					[SETTINGS_FILENAME]: { content: '{"local":true}' },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(linkedState());

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => '{"local":true}',
				writeLocal: () => {
					throw new Error(
						"should not write local when re-creating from local content",
					);
				},
				getLocalChangedAtMs: () => Date.parse("2024-05-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error(
						"should not apply a diff when re-creating from local content",
					);
				},
				getLocalChangedAtMs: () => Date.parse("2024-05-01T00:00:00.000Z"),
			},
		});

		expect(outcome.linked).toBe("created");
		expect(outcome.settings.action).toBe("push");
		expect(outcome.extensions.action).toBe("push");
		expect(store.state.gistId).toBe("gist-2");
		expect(store.state.gistUrl).toBe("https://gist.github.com/someone/gist-2");
	});

	test("re-throws a non-404 error instead of re-linking", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(
			async () => new Response("server error", { status: 500 }),
		);

		const store = fakeStore(linkedState());

		await expect(
			performSync({
				token: "tok",
				store,
				settings: {
					readLocal: () => "x",
					writeLocal: () => {},
					getLocalChangedAtMs: () => 0,
				},
				extensions: {
					readLocal: () => "[]",
					applyDiff: async () => {},
					getLocalChangedAtMs: () => 0,
				},
			}),
		).rejects.toThrow(/500/);
		expect(store.state.gistId).toBe("gist-1");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("pushes settings only when only settings changed locally", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "old" },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "new-local" },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(linkedState());

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "new-local",
				writeLocal: () => {
					throw new Error("should not write local on a push");
				},
				getLocalChangedAtMs: () => Date.parse("2024-05-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error("should not apply a diff when nothing changed");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
		});

		expect(outcome.settings.action).toBe("push");
		expect(outcome.extensions.action).toBe("none");
		const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.files[SETTINGS_FILENAME].content).toBe("new-local");
		expect(body.files[EXTENSIONS_FILENAME]).toBeUndefined();
	});

	test("actually writes on a settings pull, and actually pushes on an extensions push, when content differs", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "remote-new" },
					[EXTENSIONS_FILENAME]: { content: '["old.ext"]' },
				},
			}),
		);
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-02T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "remote-new" },
					[EXTENSIONS_FILENAME]: { content: '["local.ext"]' },
				},
			}),
		);

		const store = fakeStore(
			linkedState({
				extensionsLastSyncedAtMs: Date.parse("2024-06-15T00:00:00.000Z"),
			}),
		);
		let writtenSettings: string | undefined;

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "local-unchanged",
				writeLocal: (content) => {
					writtenSettings = content;
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["local.ext"]',
				applyDiff: async () => {
					throw new Error("should not apply a diff on a push");
				},
				getLocalChangedAtMs: () => Date.parse("2024-07-01T00:00:00.000Z"),
			},
		});

		expect(outcome.settings.action).toBe("pull");
		expect(writtenSettings).toBe("remote-new");
		expect(outcome.extensions.action).toBe("push");
		expect(outcome.extensions.remoteContentBeforePush).toBe('["old.ext"]');
		const [, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.files[EXTENSIONS_FILENAME].content).toBe('["local.ext"]');
		expect(body.files[SETTINGS_FILENAME]).toBeUndefined();
	});

	test("reports none (and never calls applyDiff) when a pull would apply an empty diff", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "same" },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(linkedState());

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "same",
				writeLocal: () => {
					throw new Error("should not write local");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error("should not apply an empty diff");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
		});

		expect(outcome.extensions.action).toBe("none");
		expect(outcome.extensions.diff).toBeUndefined();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("pulls and applies an extensions diff when only extensions changed remotely", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-06-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "same" },
					[EXTENSIONS_FILENAME]: { content: '["new.ext"]' },
				},
			}),
		);

		const store = fakeStore(linkedState());
		let applied: unknown;

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "same",
				writeLocal: () => {
					throw new Error("should not write local when settings unchanged");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => "[]",
				applyDiff: async (diff) => {
					applied = diff;
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-01T00:00:00.000Z"),
			},
		});

		expect(outcome.settings.action).toBe("none");
		expect(outcome.extensions.action).toBe("pull");
		expect(applied).toEqual({ toInstall: ["new.ext"], toUninstall: [] });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("skips the push and reports none when local content already matches remote", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "same" },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(
			linkedState({
				settingsLastSyncedAtMs: Date.parse("2024-01-15T00:00:00.000Z"),
			}),
		);

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "same",
				writeLocal: () => {
					throw new Error("should not write local");
				},
				getLocalChangedAtMs: () => Date.parse("2024-02-01T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error("should not apply a diff");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-20T00:00:00.000Z"),
			},
		});

		expect(outcome.settings.action).toBe("none");
		expect(outcome.extensions.action).toBe("none");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	test("does nothing when neither side changed", async () => {
		const fetchSpy = mockFetch();
		fetchSpy.mockImplementationOnce(async () =>
			jsonResponse({
				id: "gist-1",
				updated_at: "2024-01-01T00:00:00.000Z",
				html_url: "https://gist.github.com/someone/gist-1",
				files: {
					[SETTINGS_FILENAME]: { content: "same" },
					[EXTENSIONS_FILENAME]: { content: '["a.one"]' },
				},
			}),
		);

		const store = fakeStore(
			linkedState({
				settingsLastSyncedAtMs: Date.parse("2024-02-01T00:00:00.000Z"),
				extensionsLastSyncedAtMs: Date.parse("2024-02-01T00:00:00.000Z"),
			}),
		);

		const outcome = await performSync({
			token: "tok",
			store,
			settings: {
				readLocal: () => "same",
				writeLocal: () => {
					throw new Error("should not write local");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-15T00:00:00.000Z"),
			},
			extensions: {
				readLocal: () => '["a.one"]',
				applyDiff: async () => {
					throw new Error("should not apply a diff");
				},
				getLocalChangedAtMs: () => Date.parse("2024-01-15T00:00:00.000Z"),
			},
		});

		expect(outcome.settings.action).toBe("none");
		expect(outcome.extensions.action).toBe("none");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
