const API_BASE = "https://api.github.com";
export const EXTENSIONS_FILENAME = "vscodium-sync-extensions.json";
const GIST_DESCRIPTION =
	"VSCodium Sync settings (managed by the VSCodium Sync extension)";
export const KEYBINDINGS_FILENAME = "vscodium-sync-keybindings.json";
export const SETTINGS_FILENAME = "vscodium-sync-settings.json";

export interface GistFilesPatch {
	extensions?: string;
	keybindings?: string;
	settings?: string;
}

export interface GistInfo {
	extensionsContent: string | undefined;
	htmlUrl: string;
	id: string;
	keybindingsContent: string | undefined;
	settingsContent: string | undefined;
	updatedAtMs: number;
}

export class GitHubApiError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GitHubApiError";
	}
}

interface RawGist {
	files: Record<string, RawGistFile>;
	html_url: string;
	id: string;
	updated_at: string;
}

interface RawGistFile {
	content: string;
}

export async function createSyncGist(
	token: string,
	files: GistFilesPatch,
): Promise<GistInfo> {
	return requestGistInfo(token, "/gists", {
		method: "POST",
		body: JSON.stringify({
			description: GIST_DESCRIPTION,
			public: false,
			files: toFilesPayload(files),
		}),
	});
}

export async function findSyncGist(
	token: string,
): Promise<GistInfo | undefined> {
	const response = await githubRequest(token, "/gists?per_page=100");
	const gists = (await response.json()) as Array<{
		id: string;
		files: Record<string, unknown>;
	}>;
	const match = gists.find((gist) => SETTINGS_FILENAME in gist.files);
	if (!match) return undefined;
	return getGist(token, match.id);
}

export async function getGist(
	token: string,
	gistId: string,
): Promise<GistInfo> {
	return requestGistInfo(token, `/gists/${gistId}`);
}

async function githubRequest(
	token: string,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...init?.headers,
		},
	});
	if (!response.ok) {
		throw new GitHubApiError(
			response.status,
			`GitHub API error ${response.status}: ${await response.text()}`,
		);
	}
	return response;
}

async function requestGistInfo(
	token: string,
	path: string,
	init?: RequestInit,
): Promise<GistInfo> {
	const response = await githubRequest(token, path, init);
	return toGistInfo((await response.json()) as RawGist);
}

function toFilesPayload(
	patch: GistFilesPatch,
): Record<string, { content: string }> {
	const files: Record<string, { content: string }> = {};
	if (patch.extensions !== undefined)
		files[EXTENSIONS_FILENAME] = { content: patch.extensions };
	if (patch.keybindings !== undefined)
		files[KEYBINDINGS_FILENAME] = { content: patch.keybindings };
	if (patch.settings !== undefined)
		files[SETTINGS_FILENAME] = { content: patch.settings };
	return files;
}

function toGistInfo(gist: RawGist): GistInfo {
	return {
		extensionsContent: gist.files[EXTENSIONS_FILENAME]?.content,
		htmlUrl: gist.html_url,
		id: gist.id,
		keybindingsContent: gist.files[KEYBINDINGS_FILENAME]?.content,
		settingsContent: gist.files[SETTINGS_FILENAME]?.content,
		updatedAtMs: Date.parse(gist.updated_at),
	};
}

export async function updateSyncGist(
	token: string,
	gistId: string,
	patch: GistFilesPatch,
): Promise<GistInfo> {
	return requestGistInfo(token, `/gists/${gistId}`, {
		method: "PATCH",
		body: JSON.stringify({ files: toFilesPayload(patch) }),
	});
}
