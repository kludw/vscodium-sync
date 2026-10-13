import type { Gist, GistService, SyncData } from "@services/gist";
import { SignInRequiredError } from "@services/github";
import { toError } from "@util/errors";
import { sameJson, toSortedJson } from "@util/json";
import type { Logger } from "@util/log";
import type * as vscode from "vscode";

export type SyncKey = keyof SyncData;

export type LocalState<T> = {
	value: T;
	/** Last local edit in ms since the epoch; 0 if unknown. Only used to settle conflicts. */
	modifiedAt: number;
	/** Shown in diffs: the file's text, or a readable rendering of `value`. */
	text: string;
};

/** The state after a write, plus anything that only partly worked (e.g. an install that failed). */
export type WriteResult<T> = LocalState<T> & { warnings?: string[] };

/** Something that syncs (settings, keybindings, extensions), stored under `key` in the gist. */
export interface SyncItem<K extends SyncKey = SyncKey, T = SyncData[K]> {
	readonly key: K;
	/** For messages, e.g. "settings". */
	readonly label: string;
	/** For diff titles and syntax highlighting, e.g. "settings.json". */
	readonly fileName: string;
	/** True if a value from the gist has the right shape. */
	isValid(value: unknown): value is T;
	read(): Promise<LocalState<T>>;
	/** Makes local match `next`. The result may differ from `next` if parts failed. */
	write(local: LocalState<T>, next: T): Promise<WriteResult<T>>;
	/** Calls `onChange` when the local side changes. */
	watch(onChange: () => void): vscode.Disposable;
}

export type SyncChange = {
	label: string;
	fileName: string;
	/** push: local overwrote the cloud. pull: the cloud overwrote local. */
	direction: "push" | "pull";
	/** The overwritten side's content before and after, for showing a diff. */
	before: string;
	after: string;
};

export type SyncReport = {
	changes: SyncChange[];
	/** Items that failed; the others still synced. */
	errors: Error[];
	warnings: string[];
};

/** The part of GistService that syncing needs. */
export type GistStore = Pick<GistService, "readData" | "write">;

/** One sync run's state, shared by the items as they're handled one by one. */
type Run = {
	remote: Partial<SyncData>;
	remoteTime: number;
	/** What the gist will contain if anything is pushed. */
	nextRemote: Partial<SyncData>;
	/** Baselines to record once the push succeeds. */
	pushed: { item: SyncItem; value: unknown }[];
	report: SyncReport;
};

/**
 * Two-way sync of each item. Compares both sides with the value as of the last sync (the baseline):
 * the side that changed overwrites the other. If both changed, or there's no baseline yet, the
 * most recently edited side wins. Timestamps come from two clocks (local and GitHub's), so they're
 * only used when the baseline can't decide.
 */
export class SyncService {
	constructor(
		private readonly gistStore: GistStore,
		private readonly items: SyncItem[],
		private readonly state: vscode.Memento,
		private readonly log: Logger,
	) {}

	/** Syncs every item with `gist`. Throws only if the gist itself is unusable. */
	async sync(gist: Gist): Promise<SyncReport> {
		const remote = this.gistStore.readData(gist);
		const run: Run = {
			remote,
			remoteTime: Date.parse(gist.updated_at),
			nextRemote: { ...remote },
			pushed: [],
			report: { changes: [], errors: [], warnings: [] },
		};

		for (const item of this.items) {
			try {
				await this.syncItem(item, run);
			} catch (error) {
				this.log.error(`${item.label}: sync failed:`, error);
				run.report.errors.push(toError(error));
			}
		}

		if (run.pushed.length > 0) {
			await this.push(gist, run);
		}

		return run.report;
	}

	private async syncItem<K extends SyncKey>(
		item: SyncItem<K>,
		run: Run,
	): Promise<void> {
		const local = await item.read();
		const remoteValue: unknown = run.remote[item.key];

		if (remoteValue !== undefined && !item.isValid(remoteValue)) {
			throw new Error(`${item.label} in the gist have an invalid format`);
		}

		if (remoteValue !== undefined && sameJson(local.value, remoteValue)) {
			this.log.debug(`${item.label}: in sync`);
			await this.setBaseline(item, local.value);
			return;
		}

		// Nothing in the gist yet means nothing to pull, so local wins.
		const direction =
			remoteValue === undefined
				? "push"
				: this.decide(item, local, remoteValue, run.remoteTime);

		if (remoteValue !== undefined && direction === "pull") {
			this.log.info(`${item.label}: pulling from the cloud`);
			const written = await item.write(local, remoteValue);
			run.report.warnings.push(...(written.warnings ?? []));

			// The actual result, not remoteValue: if part of the write failed (e.g. an extension
			// couldn't be uninstalled), the next sync retries the pull instead of pushing the gap.
			await this.setBaseline(item, written.value);
			run.report.changes.push({
				label: item.label,
				fileName: item.fileName,
				direction: "pull",
				before: local.text,
				after: written.text,
			});
			return;
		}

		this.log.info(`${item.label}: pushing to the cloud`);
		run.nextRemote[item.key] = local.value;
		run.pushed.push({ item, value: local.value });
		run.report.changes.push({
			label: item.label,
			fileName: item.fileName,
			direction: "push",
			before: toSortedJson(remoteValue ?? null),
			after: toSortedJson(local.value),
		});
	}

	/** Writes every pushed item to the gist in one request, then records their baselines. */
	private async push(gist: Gist, run: Run): Promise<void> {
		try {
			await this.gistStore.write(gist, run.nextRemote);
		} catch (error) {
			if (!(error instanceof SignInRequiredError)) {
				this.log.error("Writing the gist failed:", error);
			}

			run.report.errors.push(toError(error));
			run.report.changes = run.report.changes.filter(
				(change) => change.direction === "pull",
			);
			return;
		}

		for (const { item, value } of run.pushed) {
			await this.setBaseline(item, value);
		}
	}

	/** Which side should overwrite the other, given that they differ. */
	private decide(
		item: SyncItem,
		local: LocalState<unknown>,
		remote: unknown,
		remoteTime: number,
	): "push" | "pull" {
		const baseline = this.state.get(baselineKey(item));

		if (baseline !== undefined) {
			const localChanged = !sameJson(local.value, baseline);
			const remoteChanged = !sameJson(remote, baseline);

			if (localChanged && !remoteChanged) {
				this.log.info(`${item.label}: only local changed since the last sync`);
				return "push";
			}

			if (remoteChanged && !localChanged) {
				this.log.info(
					`${item.label}: only the cloud changed since the last sync`,
				);
				return "pull";
			}

			this.log.info(
				`${item.label}: both changed since the last sync, newest wins`,
			);
		} else {
			this.log.info(`${item.label}: no previous sync recorded, newest wins`);
		}

		this.log.info(
			`${item.label}: local edited ${new Date(local.modifiedAt).toISOString()}, cloud ${new Date(remoteTime).toISOString()}`,
		);
		return local.modifiedAt >= remoteTime ? "push" : "pull";
	}

	private async setBaseline(item: SyncItem, value: unknown): Promise<void> {
		await this.state.update(baselineKey(item), value);
	}
}

/** globalState key for an item's value as of the last sync. */
const baselineKey = (item: SyncItem): string => `lastSynced.${item.key}`;
