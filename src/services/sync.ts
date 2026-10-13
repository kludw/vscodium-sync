import type { Gist, GistService, SyncData } from "@services/gist";
import { sameJson, toSortedJson } from "@util/json";
import type { Logger } from "@util/log";
import type { Result } from "@util/result";
import type * as vscode from "vscode";

export type LocalState<T> = {
	value: T;
	/** Last local edit in ms since the epoch; 0 if unknown. Only used to settle conflicts. */
	modifiedAt: number;
	/** Shown in diffs: the file's text, or a readable rendering of `value`. */
	text: string;
};

export type SyncKey = keyof SyncData;

/** Something that syncs (settings, keybindings, extensions), stored under `key` in the gist. */
export interface SyncItem<K extends SyncKey = SyncKey, T = SyncData[K]> {
	readonly key: K;
	/** For messages, e.g. "settings". */
	readonly label: string;
	/** For diff titles and syntax highlighting, e.g. "settings.json". */
	readonly fileName: string;
	read(): Promise<Result<LocalState<T>>>;
	/** Makes local match `next`. Returns the resulting state, which may differ if parts failed. */
	write(local: LocalState<T>, next: T): Promise<Result<LocalState<T>>>;
	/** True if a value from the gist has the right shape. */
	isValid(value: unknown): value is T;
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

export type SyncReport = { changes: SyncChange[]; errors: Error[] };

/** Collects one sync run's results, so each item can be handled on its own. */
type Run = {
	remote: Partial<SyncData>;
	remoteTime: number;
	/** What the gist will contain if anything is pushed. */
	nextRemote: Partial<SyncData>;
	/** Baselines to record once the push succeeds. */
	pushed: { item: SyncItem; value: unknown }[];
	changes: SyncChange[];
	errors: Error[];
};

/**
 * Two-way sync of each item. Compares both sides with the value as of the last sync (the baseline):
 * the side that changed overwrites the other. If both changed, or there's no baseline yet, the
 * most recently edited side wins. Timestamps come from two clocks (local and GitHub's), so they're
 * only used when the baseline can't decide.
 */
export class SyncService {
	constructor(
		private readonly gistService: GistService,
		private readonly items: SyncItem[],
		private readonly state: vscode.Memento,
		private readonly log: Logger,
	) {}

	async sync(gist: Gist): Promise<Result<SyncReport>> {
		const remote = this.gistService.readData(gist);

		if (remote.error) {
			return { error: remote.error };
		}

		const run: Run = {
			remote: remote.value,
			remoteTime: Date.parse(gist.updated_at),
			nextRemote: { ...remote.value },
			pushed: [],
			changes: [],
			errors: [],
		};

		for (const item of this.items) {
			await this.syncItem(item, run);
		}

		const { pushed, changes, errors } = run;

		if (pushed.length > 0) {
			const written = await this.gistService.write(gist, run.nextRemote);

			if (written.error) {
				errors.push(written.error);
				return {
					value: {
						changes: changes.filter((change) => change.direction === "pull"),
						errors,
					},
				};
			}

			for (const { item, value } of pushed) {
				await this.setBaseline(item, value);
			}
		}

		return { value: { changes, errors } };
	}

	private async syncItem<K extends SyncKey>(
		item: SyncItem<K>,
		run: Run,
	): Promise<void> {
		const local = await item.read();

		if (local.error) {
			run.errors.push(local.error);
			return;
		}

		const remoteValue: unknown = run.remote[item.key];

		if (remoteValue !== undefined && !item.isValid(remoteValue)) {
			run.errors.push(
				new Error(`${item.label} in the gist have an invalid format`),
			);
			return;
		}

		if (remoteValue !== undefined && sameJson(local.value.value, remoteValue)) {
			this.log.debug(`${item.label}: in sync`);
			await this.setBaseline(item, local.value.value);
			return;
		}

		// Nothing in the gist yet means nothing to pull, so local wins.
		const direction =
			remoteValue === undefined
				? "push"
				: this.decide(item, local.value, remoteValue, run.remoteTime);

		if (remoteValue !== undefined && direction === "pull") {
			this.log.info(`${item.label}: pulling from the cloud`);
			const written = await item.write(local.value, remoteValue);

			if (written.error) {
				run.errors.push(written.error);
				return;
			}

			// The actual result, not remoteValue: if part of the write failed (e.g. an extension
			// couldn't be installed), the next sync retries the pull instead of pushing the gap.
			await this.setBaseline(item, written.value.value);
			run.changes.push({
				label: item.label,
				fileName: item.fileName,
				direction: "pull",
				before: local.value.text,
				after: written.value.text,
			});
			return;
		}

		this.log.info(`${item.label}: pushing to the cloud`);
		run.nextRemote[item.key] = local.value.value;
		run.pushed.push({ item, value: local.value.value });
		run.changes.push({
			label: item.label,
			fileName: item.fileName,
			direction: "push",
			before: toSortedJson(remoteValue ?? null),
			after: toSortedJson(local.value.value),
		});
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
