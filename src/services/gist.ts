import { type GitHubService, SignInRequiredError } from "@services/github";
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

export type Result<T> =
	| { value: T; error?: undefined }
	| { value?: undefined; error: Error };

export class GistService {
	constructor(
		private readonly githubService: GitHubService,
		private readonly log: Logger,
	) {}

	/** Loads the sync gist (with file contents), creating a secret one if none exists yet. */
	async loadOrCreate(): Promise<Result<Gist>> {
		try {
			const token = await this.githubService.getToken();
			const found = await this.find(token);

			if (!found) {
				this.log.info(`No gist with description "${GIST_NAME}", creating one`);
				const created = await this.create(token);
				this.log.info(`Created secret gist ${created.id}`);
				return { value: created };
			}

			this.log.info(`Found gist ${found.id}, loading contents`);
			return { value: await this.read(token, found.id) };
		} catch (error) {
			// GitHubService.getToken already logged why sign-in is needed.
			if (!(error instanceof SignInRequiredError)) {
				this.log.error("Loading or creating gist failed:", error);
			}

			return {
				error: error instanceof Error ? error : new Error(String(error)),
			};
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

	/** Fetches a gist with its file contents. */
	private read(token: string, id: string): Promise<Gist> {
		return this.githubService.request<Gist>(token, `/gists/${id}`);
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
