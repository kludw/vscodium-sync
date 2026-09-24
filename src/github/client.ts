const API_BASE = "https://api.github.com";

export const GIST_FILENAME = "vscodium-sync-settings.json";
const GIST_DESCRIPTION =
	"VSCodium Sync settings (managed by the VSCodium Sync extension)";

export interface GistInfo {
	id: string;
	updatedAtMs: number;
	htmlUrl: string;
	content: string;
}

interface RawGistFile {
	content: string;
}

interface RawGist {
	id: string;
	updated_at: string;
	html_url: string;
	files: Record<string, RawGistFile>;
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
		throw new Error(
			`GitHub API error ${response.status}: ${await response.text()}`,
		);
	}
	return response;
}

function toGistInfo(gist: RawGist): GistInfo {
	return {
		id: gist.id,
		updatedAtMs: Date.parse(gist.updated_at),
		htmlUrl: gist.html_url,
		content: gist.files[GIST_FILENAME].content,
	};
}

export async function findSyncGist(
	token: string,
): Promise<GistInfo | undefined> {
	const response = await githubRequest(token, "/gists?per_page=100");
	const gists = (await response.json()) as Array<{
		id: string;
		files: Record<string, unknown>;
	}>;
	const match = gists.find((gist) => GIST_FILENAME in gist.files);
	if (!match) return undefined;
	return getGist(token, match.id);
}

export async function getGist(
	token: string,
	gistId: string,
): Promise<GistInfo> {
	const response = await githubRequest(token, `/gists/${gistId}`);
	return toGistInfo((await response.json()) as RawGist);
}

export async function createSyncGist(
	token: string,
	content: string,
): Promise<GistInfo> {
	const response = await githubRequest(token, "/gists", {
		method: "POST",
		body: JSON.stringify({
			description: GIST_DESCRIPTION,
			public: false,
			files: { [GIST_FILENAME]: { content } },
		}),
	});
	return toGistInfo((await response.json()) as RawGist);
}

export async function updateSyncGist(
	token: string,
	gistId: string,
	content: string,
): Promise<GistInfo> {
	const response = await githubRequest(token, `/gists/${gistId}`, {
		method: "PATCH",
		body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
	});
	return toGistInfo((await response.json()) as RawGist);
}
