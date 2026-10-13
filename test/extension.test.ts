/** End to end: activate() with the real services, temp files, and a fake GitHub behind fetch. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { activate } from "../src/extension";
import { fake, fireFileEvent, resetFake, setFocused } from "./fake-vscode";
import { memento, sleep, tempDir } from "./helpers";

const FILE = "vscodium-sync.json";
const realFetch = globalThis.fetch;

type FakeGist = {
	id: string;
	description: string;
	updated_at: string;
	files: Record<string, { content: string }>;
	etag: number;
};

let root: string;
let userDir: string;
let gists: FakeGist[];
let patches: number;
let subscriptions: { dispose(): unknown }[];

/** Answers the few gist endpoints the extension uses, with ETags. */
const fakeGitHub = (): typeof fetch =>
	(async (input: string, init: RequestInit = {}) => {
		const path = new URL(input).pathname;
		const method = init.method ?? "GET";
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		const json = (status: number, data: unknown, etag?: number) =>
			new Response(JSON.stringify(data), {
				status,
				headers: etag ? { etag: `"${etag}"` } : {},
			});

		if (path === "/gists" && method === "GET") {
			return json(200, gists);
		}

		if (path === "/gists" && method === "POST") {
			const gist = {
				id: `G${gists.length + 1}`,
				description: body.description,
				updated_at: new Date().toISOString(),
				files: body.files,
				etag: 1,
			};
			gists.push(gist);
			return json(201, gist, gist.etag);
		}

		const gist = gists.find((candidate) => path === `/gists/${candidate.id}`);

		if (!gist) {
			return json(404, { message: "Not Found" });
		}

		if (method === "PATCH") {
			patches++;
			Object.assign(gist.files, body.files);
			gist.updated_at = new Date().toISOString();
			gist.etag++;
		} else if (
			(init.headers as Record<string, string>)["If-None-Match"] ===
			`"${gist.etag}"`
		) {
			return new Response(null, { status: 304 });
		}

		return json(200, gist, gist.etag);
	}) as typeof fetch;

const cloudData = () => JSON.parse(gists[0]?.files[FILE]?.content ?? "{}");

const start = () => {
	const context = {
		subscriptions: [] as { dispose(): unknown }[],
		globalState: memento(),
		extension: { id: "kludw.vscodium-sync" },
		globalStorageUri: vscode.Uri.file(
			join(userDir, "globalStorage", "kludw.vscodium-sync"),
		),
	};
	activate(context as unknown as vscode.ExtensionContext);
	subscriptions = context.subscriptions;
};

const signedIn = () => {
	fake.session = {
		accessToken: "t",
		account: { label: "kludw" },
		scopes: ["gist"],
	};
};

beforeEach(() => {
	resetFake();
	root = tempDir();
	userDir = join(root, "User");
	const extensionsDir = join(root, "extensions");
	mkdirSync(join(extensionsDir, "a.one-1.0.0"), { recursive: true });
	mkdirSync(userDir, { recursive: true });
	writeFileSync(
		join(extensionsDir, "extensions.json"),
		JSON.stringify([{ identifier: { id: "a.one" } }]),
	);
	writeFileSync(
		join(userDir, "settings.json"),
		'{\n    "editor.fontSize": 16\n}\n',
	);
	fake.extensions = [
		{
			id: "a.one",
			extensionUri: vscode.Uri.file(join(extensionsDir, "a.one-1.0.0")),
		},
	];
	gists = [];
	patches = 0;
	globalThis.fetch = fakeGitHub();
});

afterEach(() => {
	for (const subscription of subscriptions) {
		subscription.dispose();
	}
	globalThis.fetch = realFetch;
});

test("at startup, asks to sign in, then creates the gist and uploads everything", async () => {
	fake.respond = (message) =>
		message.items.includes("Sign in") ? "Sign in" : undefined;
	fake.signIn = () => ({
		accessToken: "t",
		account: { label: "kludw" },
		scopes: ["gist"],
	});

	start();
	await sleep(50);

	expect(fake.messages.map((message) => message.message)).toEqual([
		"VSCodium Sync: Sign in to GitHub to sync settings.",
		"VSCodium Sync: uploaded settings, keybindings and extensions to the cloud.",
	]);
	expect(cloudData()).toEqual({
		extensions: ["a.one"],
		keybindings: [],
		settings: { "editor.fontSize": 16 },
	});
});

test("only the startup sync prompts; background syncs skip quietly when signed out", async () => {
	start();
	await sleep(50);
	expect(fake.messages).toHaveLength(1); // The sign-in prompt, dismissed.

	writeFileSync(join(userDir, "settings.json"), '{ "editor.fontSize": 20 }');
	fireFileEvent(join(userDir, "settings.json"));
	await sleep(1100);

	expect(fake.messages).toHaveLength(1);
	expect(fake.logs).toContain("info Not signed in to GitHub, skipping sync");
	expect(gists).toEqual([]);
});

test("a local edit is pushed; a cloud edit is pulled into settings.json, sorted", async () => {
	signedIn();
	start();
	await sleep(50);
	patches = 0;

	writeFileSync(join(userDir, "settings.json"), '{ "editor.fontSize": 20 }');
	fireFileEvent(join(userDir, "settings.json"));
	await sleep(1100);
	expect(patches).toBe(1);
	expect(cloudData().settings).toEqual({ "editor.fontSize": 20 });

	const gist = gists[0] as FakeGist;
	gist.files[FILE] = {
		content: JSON.stringify({
			...cloudData(),
			settings: { zoom: 1, "editor.fontSize": 22 },
		}),
	};
	gist.updated_at = new Date().toISOString();
	gist.etag++;
	setFocused(true);
	await sleep(50);

	expect(readFileSync(join(userDir, "settings.json"), "utf8")).toBe(
		'{\n    "editor.fontSize": 22,\n    "zoom": 1\n}\n',
	);
	expect(fake.messages.at(-1)?.message).toBe(
		"VSCodium Sync: updated settings from the cloud.",
	);
});

test("nothing differs: no upload and no notification", async () => {
	signedIn();
	start();
	await sleep(50);
	const messages = fake.messages.length;
	patches = 0;

	setFocused(true);
	await sleep(50);

	expect(patches).toBe(0);
	expect(fake.messages).toHaveLength(messages);
});
