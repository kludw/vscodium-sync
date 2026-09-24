import {
	createSyncGist,
	findSyncGist,
	type GistInfo,
	getGist,
	updateSyncGist,
} from "../github/client";
import { decideSyncAction, type SyncAction } from "./conflict";
import { computeExtensionDiff, type ExtensionsDiff } from "./extensions";

export interface SyncState {
	gistId: string | undefined;
	gistUrl: string | undefined;
	settingsLastSyncedAtMs: number | undefined;
	extensionsLastSyncedAtMs: number | undefined;
}

export interface SyncStateStore {
	get(): SyncState;
	update(patch: Partial<SyncState>): Promise<void>;
}

export interface SettingsSyncDeps {
	readLocal: () => string;
	writeLocal: (content: string) => void;
	getLocalChangedAtMs: () => number;
}

export interface ExtensionsSyncDeps {
	readLocal: () => string;
	applyDiff: (diff: ExtensionsDiff) => Promise<void>;
	getLocalChangedAtMs: () => number;
}

export interface SyncDeps {
	token: string;
	store: SyncStateStore;
	settings: SettingsSyncDeps;
	extensions: ExtensionsSyncDeps;
}

export interface SyncOutcome {
	/** Set only on the sync that first links a gist to this machine. */
	linked?: "found" | "created";
	settings: { action: SyncAction; remoteContentBeforePush?: string };
	extensions: { action: SyncAction; diff?: ExtensionsDiff };
}

export async function performSync(deps: SyncDeps): Promise<SyncOutcome> {
	const state = deps.store.get();

	if (!state.gistId) {
		return linkGist(deps);
	}

	const remote = await getGist(deps.token, state.gistId);

	const settingsAction = decideSyncAction(
		deps.settings.getLocalChangedAtMs(),
		remote.updatedAtMs,
		state.settingsLastSyncedAtMs ?? 0,
	);
	const extensionsAction =
		remote.extensionsContent === undefined
			? "push"
			: decideSyncAction(
					deps.extensions.getLocalChangedAtMs(),
					remote.updatedAtMs,
					state.extensionsLastSyncedAtMs ?? 0,
				);

	const outcome = await applyActions(
		deps,
		remote,
		settingsAction,
		extensionsAction,
	);

	await deps.store.update({
		gistUrl: remote.htmlUrl,
		settingsLastSyncedAtMs: Date.now(),
		extensionsLastSyncedAtMs: Date.now(),
	});

	return outcome;
}

async function applyActions(
	deps: SyncDeps,
	remote: GistInfo,
	settingsAction: SyncAction,
	extensionsAction: SyncAction,
): Promise<SyncOutcome> {
	const patch: { settings?: string; extensions?: string } = {};
	let remoteContentBeforePush: string | undefined;
	let resolvedSettingsAction = settingsAction;

	if (settingsAction === "push") {
		const localContent = deps.settings.readLocal();
		if (localContent === remote.settingsContent) {
			resolvedSettingsAction = "none";
		} else {
			patch.settings = localContent;
			remoteContentBeforePush = remote.settingsContent;
		}
	} else if (settingsAction === "pull") {
		const localContent = deps.settings.readLocal();
		if (localContent === (remote.settingsContent ?? "")) {
			resolvedSettingsAction = "none";
		} else {
			deps.settings.writeLocal(remote.settingsContent ?? "");
		}
	}

	let resolvedExtensionsAction = extensionsAction;
	let extensionsDiff: ExtensionsDiff | undefined;

	if (extensionsAction === "push") {
		const localContent = deps.extensions.readLocal();
		if (localContent === (remote.extensionsContent ?? "")) {
			resolvedExtensionsAction = "none";
		} else {
			patch.extensions = localContent;
		}
	} else if (extensionsAction === "pull") {
		extensionsDiff = computeExtensionDiff(
			deps.extensions.readLocal(),
			remote.extensionsContent,
		);
		await deps.extensions.applyDiff(extensionsDiff);
	}

	if (patch.settings !== undefined || patch.extensions !== undefined) {
		await updateSyncGist(deps.token, remote.id, patch);
	}

	return {
		settings: { action: resolvedSettingsAction, remoteContentBeforePush },
		extensions: { action: resolvedExtensionsAction, diff: extensionsDiff },
	};
}

async function linkGist(deps: SyncDeps): Promise<SyncOutcome> {
	const existing = await findSyncGist(deps.token);

	if (existing) {
		return adoptExistingGist(deps, existing);
	}

	const created = await createSyncGist(
		deps.token,
		deps.settings.readLocal(),
		deps.extensions.readLocal(),
	);
	await deps.store.update({
		gistId: created.id,
		gistUrl: created.htmlUrl,
		settingsLastSyncedAtMs: Date.now(),
		extensionsLastSyncedAtMs: Date.now(),
	});
	return {
		linked: "created",
		settings: { action: "push" },
		extensions: { action: "push" },
	};
}

async function adoptExistingGist(
	deps: SyncDeps,
	existing: GistInfo,
): Promise<SyncOutcome> {
	deps.settings.writeLocal(existing.settingsContent ?? "");

	let extensionsOutcome: SyncOutcome["extensions"];
	let gistUrl = existing.htmlUrl;

	if (existing.extensionsContent === undefined) {
		const localExtensions = deps.extensions.readLocal();
		const updated = await updateSyncGist(deps.token, existing.id, {
			extensions: localExtensions,
		});
		gistUrl = updated.htmlUrl;
		extensionsOutcome = { action: "push" };
	} else {
		const diff = computeExtensionDiff(
			deps.extensions.readLocal(),
			existing.extensionsContent,
		);
		await deps.extensions.applyDiff(diff);
		extensionsOutcome = { action: "pull", diff };
	}

	await deps.store.update({
		gistId: existing.id,
		gistUrl,
		settingsLastSyncedAtMs: Date.now(),
		extensionsLastSyncedAtMs: Date.now(),
	});

	return {
		linked: "found",
		settings: { action: "pull" },
		extensions: extensionsOutcome,
	};
}
