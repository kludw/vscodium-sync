import type { Gist, GistService } from "@services/gist";
import type { Settings, SettingsService } from "@services/settings";
import { sameJson } from "@util/json";
import type { Logger } from "@util/log";
import type { Result } from "@util/result";
import type * as vscode from "vscode";

/** globalState key for the settings as of the last sync. */
const BASELINE_KEY = "lastSyncedSettings";

export type SyncOutcome =
	| { direction: "none" }
	| {
			/** push: local overwrote the cloud. pull: the cloud overwrote local. */
			direction: "push" | "pull";
			/** The overwritten side's content before and after, for showing a diff. */
			before: string;
			after: string;
	  };

const pretty = (value: unknown): string =>
	`${JSON.stringify(value, null, 2)}\n`;

/**
 * Two-way settings sync. Compares both sides with the settings as of the last sync (the baseline):
 * the side that changed overwrites the other. If both changed, or there's no baseline yet, the
 * most recently edited side wins. Timestamps come from two clocks (local and GitHub's), so they're
 * only used when the baseline can't decide.
 */
export class SyncService {
	constructor(
		private readonly gistService: GistService,
		private readonly settingsService: SettingsService,
		private readonly state: vscode.Memento,
		private readonly log: Logger,
	) {}

	private get baseline(): Settings | undefined {
		return this.state.get<Settings>(BASELINE_KEY);
	}

	private async setBaseline(settings: Settings): Promise<void> {
		await this.state.update(BASELINE_KEY, settings);
	}

	/** Which side should overwrite the other, given that they differ. */
	private decide(
		local: Settings,
		localTime: number,
		remote: Settings,
		remoteTime: number,
	): "push" | "pull" {
		const baseline = this.baseline;

		if (baseline) {
			const localChanged = !sameJson(local, baseline);
			const remoteChanged = !sameJson(remote, baseline);

			if (localChanged && !remoteChanged) {
				this.log.info("Only local changed since the last sync");
				return "push";
			}

			if (remoteChanged && !localChanged) {
				this.log.info("Only the cloud changed since the last sync");
				return "pull";
			}

			this.log.info("Both changed since the last sync, newest edit wins");
		} else {
			this.log.info("No previous sync recorded, newest edit wins");
		}

		this.log.info(
			`Local edited ${new Date(localTime).toISOString()}, cloud ${new Date(remoteTime).toISOString()}`,
		);
		return localTime >= remoteTime ? "push" : "pull";
	}

	async sync(gist: Gist): Promise<Result<SyncOutcome>> {
		const local = await this.settingsService.read();

		if (local.error) {
			return { error: local.error };
		}

		const remote = this.gistService.readData(gist);

		if (remote.error) {
			return { error: remote.error };
		}

		const remoteSettings = remote.value?.settings;

		if (remoteSettings && sameJson(local.value.settings, remoteSettings)) {
			this.log.info("Local and cloud settings match, nothing to sync");
			await this.setBaseline(local.value.settings);
			return { value: { direction: "none" } };
		}

		// An empty gist has nothing to pull, so local always wins then.
		const direction = remoteSettings
			? this.decide(
					local.value.settings,
					local.value.modifiedAt,
					remoteSettings,
					Date.parse(gist.updated_at),
				)
			: "push";

		if (remoteSettings && direction === "pull") {
			this.log.info("Pulling cloud settings into settings.json");
			const written = await this.settingsService.write(
				local.value,
				remoteSettings,
			);

			if (written.error) {
				return { error: written.error };
			}

			await this.setBaseline(remoteSettings);
			return {
				value: {
					direction: "pull",
					before: local.value.text,
					after: written.value,
				},
			};
		}

		this.log.info(
			remoteSettings
				? "Pushing local settings to the cloud"
				: "Cloud has no settings yet, pushing local",
		);
		const written = await this.gistService.write(gist, {
			settings: local.value.settings,
		});

		if (written.error) {
			return { error: written.error };
		}

		await this.setBaseline(local.value.settings);
		return {
			value: {
				direction: "push",
				before: pretty(remoteSettings ?? {}),
				after: pretty(local.value.settings),
			},
		};
	}
}
