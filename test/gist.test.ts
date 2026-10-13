import { beforeEach, describe, expect, test } from "bun:test";
import { type Gist, GistService } from "@services/gist";
import {
	GitHubRequestError,
	type GitHubRequestInit,
	type GitHubResponse,
	type GitHubService,
} from "@services/github";
import { resetFake } from "./fake-vscode";
import { testLogger } from "./helpers";

const FILE = "vscodium-sync.json";

/** An in-memory GitHub gists API with ETags. */
class FakeGitHub {
	gists = new Map<string, Gist & { etag: number }>();
	calls: string[] = [];
	private nextId = 1;
	private clock = Date.parse("2026-10-13T12:00:00Z");

	add(description: string | null, content?: string): Gist {
		const id = `G${this.nextId++}`;
		const gist: Gist & { etag: number } = {
			id,
			description,
			updated_at: this.tick(),
			files:
				content === undefined ? {} : { [FILE]: { filename: FILE, content } },
			etag: 1,
		};
		this.gists.set(id, gist);
		return gist;
	}

	/** An edit made from another machine. */
	edit(id: string, content: string): void {
		const gist = this.get(id);
		gist.files = { [FILE]: { filename: FILE, content } };
		gist.updated_at = this.tick();
		gist.etag++;
	}

	async getToken(): Promise<string> {
		return "token";
	}

	async request<T>(token: string, path: string, init: GitHubRequestInit = {}) {
		return (await this.send<T>(token, path, init)).data as T;
	}

	async send<T>(
		_token: string,
		path: string,
		init: GitHubRequestInit = {},
	): Promise<GitHubResponse<T>> {
		const method = init.method ?? "GET";
		this.calls.push(
			`${method} ${path}${init.ifNoneMatch ? " (conditional)" : ""}`,
		);
		const body = init.body as { description?: string; files?: Gist["files"] };
		const listing = /^\/gists\?per_page=(\d+)&page=(\d+)$/.exec(path);

		if (listing) {
			const [perPage, page] = [Number(listing[1]), Number(listing[2])];
			const all = [...this.gists.values()];
			return this.ok(all.slice((page - 1) * perPage, page * perPage) as T);
		}

		if (path === "/gists" && method === "POST") {
			const created = this.add(body.description ?? null);
			created.files = body.files ?? {};
			return this.ok(created as T);
		}

		const gist = this.get(path.slice("/gists/".length));

		if (method === "PATCH") {
			gist.files = { ...gist.files, ...body.files };
			gist.updated_at = this.tick();
			gist.etag++;
		} else if (init.ifNoneMatch === `"${gist.etag}"`) {
			return { status: 304, etag: init.ifNoneMatch };
		}

		return { ...this.ok(structuredClone(gist) as T), etag: `"${gist.etag}"` };
	}

	private get(id: string) {
		const gist = this.gists.get(id);
		if (!gist) {
			throw new GitHubRequestError(404, `/gists/${id}`, "Not Found");
		}
		return gist;
	}

	private ok<T>(data: T): GitHubResponse<T> {
		return { status: 200, data };
	}

	private tick(): string {
		this.clock += 1000;
		return new Date(this.clock).toISOString();
	}
}

let github: FakeGitHub;
let gists: GistService;

beforeEach(() => {
	resetFake();
	github = new FakeGitHub();
	gists = new GistService(github as unknown as GitHubService, testLogger());
});

describe("loadOrCreate", () => {
	test("finds the sync gist by description across pages and loads its contents", async () => {
		for (let i = 0; i < 100; i++) {
			github.add(`other ${i}`);
		}
		const sync = github.add("vscodium-sync", '{"settings":{}}');

		const gist = await gists.loadOrCreate();

		expect(gist.id).toBe(sync.id);
		expect(gist.files[FILE]?.content).toBe('{"settings":{}}');
		expect(github.calls).toEqual([
			"GET /gists?per_page=100&page=1",
			"GET /gists?per_page=100&page=2",
			`GET /gists/${sync.id}`,
		]);
	});

	test("creates a secret gist with a placeholder file when none exists", async () => {
		const gist = await gists.loadOrCreate();

		expect(gist.description).toBe("vscodium-sync");
		expect(gist.files[FILE]?.content).toBe("{}\n");
		expect(github.calls).toContain("POST /gists");
	});

	test("remembers the gist, and searches again if it was deleted", async () => {
		const first = github.add("vscodium-sync", "{}");
		await gists.loadOrCreate();
		github.calls = [];

		await gists.loadOrCreate();
		expect(github.calls).toEqual([`GET /gists/${first.id}`]);

		github.gists.delete(first.id);
		const second = github.add("vscodium-sync", "{}");
		github.calls = [];

		expect((await gists.loadOrCreate()).id).toBe(second.id);
		expect(github.calls[0]).toBe(`GET /gists/${first.id}`);
		expect(github.calls).toContain("GET /gists?per_page=100&page=1");
	});
});

describe("hasChanged", () => {
	test("is false before the gist has been loaded", async () => {
		expect(await gists.hasChanged()).toEqual({ changed: false });
		expect(github.calls).toEqual([]);
	});

	test("uses conditional requests and reports edits made elsewhere", async () => {
		const sync = github.add("vscodium-sync", "{}");
		await gists.loadOrCreate();

		expect((await gists.hasChanged()).changed).toBe(false);
		expect(github.calls.at(-1)).toBe(`GET /gists/${sync.id} (conditional)`);

		github.edit(sync.id, '{"settings":{"a":1}}');
		expect((await gists.hasChanged()).changed).toBe(true);
	});

	test("doesn't report our own write as a change", async () => {
		const gist = await gists.loadOrCreate();
		await gists.write(gist, { settings: { a: 1 } });

		expect((await gists.hasChanged()).changed).toBe(false);
		expect((await gists.hasChanged()).changed).toBe(false);
	});
});

describe("readData", () => {
	const gist = (content?: string, truncated = false): Gist => ({
		id: "G",
		description: "vscodium-sync",
		updated_at: "",
		files:
			content === undefined
				? {}
				: { [FILE]: { filename: FILE, content, truncated } },
	});

	test("parses the data file; a missing or placeholder file means no data", () => {
		expect(gists.readData(gist('{"settings":{"a":1}}'))).toEqual({
			settings: { a: 1 },
		});
		expect(gists.readData(gist())).toEqual({});
		expect(gists.readData(gist("{}\n"))).toEqual({});
	});

	test("rejects invalid, non-object or truncated content", () => {
		expect(() => gists.readData(gist("{nope"))).toThrow("invalid JSON");
		expect(() => gists.readData(gist("[]"))).toThrow("must contain an object");
		expect(() => gists.readData(gist("{}", true))).toThrow("too large");
	});
});

describe("write", () => {
	test("writes sorted JSON, and skips the request when nothing changed", async () => {
		const gist = await gists.loadOrCreate();

		const written = await gists.write(gist, { settings: { b: 1, a: 2 } });
		expect(written.files[FILE]?.content).toBe(
			'{\n  "settings": {\n    "a": 2,\n    "b": 1\n  }\n}\n',
		);

		github.calls = [];
		await gists.write(written, { settings: { a: 2, b: 1 } });
		expect(github.calls).toEqual([]);
	});
});
