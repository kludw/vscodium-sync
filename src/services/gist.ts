import type { ExtensionList } from "@services/extensions";
import { GitHubRequestError, type GitHubService } from "@services/github";
import type { Keybindings } from "@services/keybindings";
import type { Settings } from "@services/settings";
import { toSortedJson } from "@util/json";
import type { Logger } from "@util/log";

const GIST_NAME = "vscodium-sync";
const FILE_NAME = "vscodium-sync.json";
const PAGE_SIZE = 100;

export type GistFile = {
	filename: string;
	content?: string;
	truncated?: boolean;
};

export type Gist = {
	id: string;
	description: string | null;
	updated_at: string;
	files: Record<string, GistFile>;
};

/** What gets synced, keyed by item. Stored as JSON in the gist's {@link FILE_NAME}. */
export type SyncData = {
	settings: Settings;
	extensions: ExtensionList;
	keybindings: Keybindings;
};

export type ChangeCheck = {
	changed: boolean;
	/** Seconds GitHub asks pollers to wait before checking again, if it said so. */
	pollInterval?: number;
};

/** The secret gist that holds the synced data: finding or creating it, reading and writing it. */
export class GistService {
	/** The sync gist as of the last time it was read or written. */
	private known?: { id: string; updatedAt: string; etag?: string };

	constructor(
		private readonly githubService: GitHubService,
		private readonly log: Logger,
	) {}

	/**
	 * Loads the sync gist (with file contents), creating a secret one if none exists yet. Throws
	 * SignInRequiredError when there's no usable GitHub session.
	 */
	async loadOrCreate(): Promise<Gist> {
		const token = await this.githubService.getToken();

		if (this.known) {
			try {
				return await this.read(token, this.known.id);
			} catch (error) {
				if (!(error instanceof GitHubRequestError && error.status === 404)) {
					throw error;
				}

				this.log.warn(
					`Gist ${this.known.id} no longer exists, searching again`,
				);
				this.known = undefined;
			}
		}

		const found = await this.find(token);

		if (found) {
			this.log.info(`Found gist ${found.id}, loading contents`);
			return this.read(token, found.id);
		}

		this.log.info(`No gist with description "${GIST_NAME}", creating one`);
		const created = await this.create(token);
		this.log.info(`Created secret gist ${created.id}`);
		this.known = { id: created.id, updatedAt: created.updated_at };
		return created;
	}

	/**
	 * Cheaply checks whether the gist changed since it was last read or written, using a conditional
	 * request (a 304 doesn't count against the rate limit). Always false before the first load.
	 */
	async hasChanged(): Promise<ChangeCheck> {
		const known = this.known;

		if (!known) {
			return { changed: false };
		}

		const token = await this.githubService.getToken();
		const response = await this.githubService.send<Gist>(
			token,
			`/gists/${known.id}`,
			{
				ifNoneMatch: known.etag,
			},
		);
		known.etag = response.etag ?? known.etag;

		// A new etag alone doesn't mean new content (e.g. after our own write), so compare times.
		const changed =
			response.data !== undefined &&
			response.data.updated_at !== known.updatedAt;
		this.log.debug(
			`Change check: ${response.status}, ${changed ? "changed" : "unchanged"}`,
		);
		return { changed, pollInterval: response.pollInterval };
	}

	/** Parses the gist's data file. Empty if it holds no data yet (the placeholder of a new gist). */
	readData(gist: Gist): Partial<SyncData> {
		const file = gist.files[FILE_NAME];

		if (!file?.content) {
			return {};
		}

		if (file.truncated) {
			throw new Error(`${FILE_NAME} is too large (over 1 MB)`);
		}

		let data: unknown;

		try {
			data = JSON.parse(file.content);
		} catch {
			throw new Error(`${FILE_NAME} in the gist is invalid JSON`);
		}

		if (typeof data !== "object" || data === null || Array.isArray(data)) {
			throw new Error(`${FILE_NAME} in the gist must contain an object`);
		}

		return data as Partial<SyncData>;
	}

	/**
	 * Overwrites the gist's data file with `data`, keys sorted alphabetically at every level (arrays
	 * keep their order). Skips the request if the content is already identical.
	 */
	async write(gist: Gist, data: Partial<SyncData>): Promise<Gist> {
		const content = toSortedJson(data);

		if (gist.files[FILE_NAME]?.content === content) {
			this.log.info(`Gist ${gist.id} already up to date`);
			return gist;
		}

		const token = await this.githubService.getToken();
		const updated = await this.githubService.request<Gist>(
			token,
			`/gists/${gist.id}`,
			{
				method: "PATCH",
				body: { files: { [FILE_NAME]: { content } } },
			},
		);
		this.log.info(`Wrote ${FILE_NAME} to gist ${gist.id}`);
		this.known = { id: updated.id, updatedAt: updated.updated_at };
		return updated;
	}

	/** Finds the sync gist among the user's gists. The result has no file contents; see {@link read}. */
	private async find(token: string): Promise<Gist | undefined> {
		for (let page = 1; ; page++) {
			const gists = await this.githubService.request<Gist[]>(
				token,
				`/gists?per_page=${PAGE_SIZE}&page=${page}`,
			);
			const match = gists.find((gist) => gist.description === GIST_NAME);

			this.log.debug(
				`Page ${page}: ${gists.length} gist(s), match: ${match?.id ?? "none"}`,
			);

			if (match || gists.length < PAGE_SIZE) {
				return match;
			}
		}
	}

	/** Fetches a gist with its file contents and remembers it. */
	private async read(token: string, id: string): Promise<Gist> {
		const response = await this.githubService.send<Gist>(token, `/gists/${id}`);
		const gist = response.data as Gist;
		this.known = { id, updatedAt: gist.updated_at, etag: response.etag };
		return gist;
	}

	/** Creates a secret sync gist containing only the placeholder file. */
	private create(token: string): Promise<Gist> {
		return this.githubService.request<Gist>(token, "/gists", {
			method: "POST",
			body: {
				description: GIST_NAME,
				public: false,
				files: { [FILE_NAME]: { content: "{}\n" } },
			},
		});
	}
}
