import {
	GitHubRequestError,
	type GitHubService,
	SignInRequiredError,
} from "@services/github";
import type { Settings } from "@services/settings";
import type { Logger } from "@util/log";
import { type Result, toError } from "@util/result";

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

/** What gets synced. Stored as JSON in the gist's {@link FILE_NAME} file. */
export type SyncData = {
	settings: Settings;
};

export type ChangeCheck = {
	changed: boolean;
	/** Seconds GitHub asks pollers to wait before checking again, if it said so. */
	pollInterval?: number;
};

export class GistService {
	/** The sync gist as of the last time it was read or written. */
	private known?: { id: string; updatedAt: string; etag?: string };

	constructor(
		private readonly githubService: GitHubService,
		private readonly log: Logger,
	) {}

	/** Loads the sync gist (with file contents), creating a secret one if none exists yet. */
	async loadOrCreate(): Promise<Result<Gist>> {
		try {
			const token = await this.githubService.getToken();

			if (this.known) {
				try {
					return { value: await this.read(token, this.known.id) };
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

			if (!found) {
				this.log.info(`No gist with description "${GIST_NAME}", creating one`);
				const created = await this.create(token);
				this.log.info(`Created secret gist ${created.id}`);
				this.known = { id: created.id, updatedAt: created.updated_at };
				return { value: created };
			}

			this.log.info(`Found gist ${found.id}, loading contents`);
			return { value: await this.read(token, found.id) };
		} catch (error) {
			// GitHubService.getToken already logged why sign-in is needed.
			if (!(error instanceof SignInRequiredError)) {
				this.log.error("Loading or creating gist failed:", error);
			}

			return { error: toError(error) };
		}
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

	/**
	 * Cheaply checks whether the gist changed since it was last read or written, using a conditional
	 * request (a 304 doesn't count against the rate limit). Always false before the first load.
	 */
	async hasChanged(): Promise<Result<ChangeCheck>> {
		const known = this.known;

		if (!known) {
			return { value: { changed: false } };
		}

		try {
			const token = await this.githubService.getToken();
			const response = await this.githubService.send<Gist>(
				token,
				`/gists/${known.id}`,
				{ ifNoneMatch: known.etag },
			);
			known.etag = response.etag ?? known.etag;

			// A new etag alone doesn't mean new content (e.g. after our own write), so compare times.
			const changed =
				response.data !== undefined &&
				response.data.updated_at !== known.updatedAt;
			this.log.debug(
				`Change check: ${response.status}, ${changed ? "changed" : "unchanged"}`,
			);
			return { value: { changed, pollInterval: response.pollInterval } };
		} catch (error) {
			return { error: toError(error) };
		}
	}

	/** Parses the gist's data file. `undefined` if it holds no data yet (the placeholder of a new gist). */
	readData(gist: Gist): Result<SyncData | undefined> {
		const file = gist.files[FILE_NAME];

		if (!file?.content) {
			return { value: undefined };
		}

		if (file.truncated) {
			return { error: new Error(`${FILE_NAME} is too large (over 1 MB)`) };
		}

		try {
			const data = JSON.parse(file.content) as Partial<SyncData>;
			return { value: data.settings ? { settings: data.settings } : undefined };
		} catch (error) {
			this.log.error(`Parsing ${FILE_NAME} in gist ${gist.id} failed:`, error);
			return { error: new Error(`${FILE_NAME} in the gist is invalid JSON`) };
		}
	}

	/** Overwrites the gist's data file with `data`. Skips the request if the content is already identical. */
	async write(gist: Gist, data: SyncData): Promise<Result<Gist>> {
		const content = `${JSON.stringify(data, null, 2)}\n`;

		if (gist.files[FILE_NAME]?.content === content) {
			this.log.info(`Gist ${gist.id} already up to date`);
			return { value: gist };
		}

		try {
			const token = await this.githubService.getToken();
			const updated = await this.githubService.request<Gist>(
				token,
				`/gists/${gist.id}`,
				{ method: "PATCH", body: { files: { [FILE_NAME]: { content } } } },
			);
			this.log.info(`Wrote ${FILE_NAME} to gist ${gist.id}`);
			this.known = { id: updated.id, updatedAt: updated.updated_at };
			return { value: updated };
		} catch (error) {
			if (!(error instanceof SignInRequiredError)) {
				this.log.error("Writing gist failed:", error);
			}

			return { error: toError(error) };
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
