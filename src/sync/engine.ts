import {
	createSyncGist,
	findSyncGist,
	type GistFilesPatch,
	type GistInfo,
	GitHubApiError,
	getGist,
	updateSyncGist,
} from "../github/client";
import { decideSyncAction, type SyncAction } from "./conflict";
import { computeExtensionDiff, type ExtensionsDiff } from "./extensions";

export interface ExtensionsSyncDeps {
	applyDiff: (diff: ExtensionsDiff) => Promise<void>;
	getLocalChangedAtMs: () => number;
	readLocal: () => string;
}

interface PullResult {
	changed: boolean;
	diff?: ExtensionsDiff;
}

export interface SettingsSyncDeps {
	getLocalChangedAtMs: () => number;
	readLocal: () => string;
	writeLocal: (content: string) => void;
}

export interface SyncDeps {
	extensions: ExtensionsSyncDeps;
	settings: SettingsSyncDeps;
	store: SyncStateStore;
	token: string;
}

export interface SyncOutcome {
	extensions: {
		action: SyncAction;
		diff?: ExtensionsDiff;
		remoteContentBeforePush?: string;
	};
	/** Set only on the sync that first links a gist to this machine. */
	linked?: "found" | "created";
	settings: { action: SyncAction; remoteContentBeforePush?: string };
}

export interface SyncState {
	extensionsLastSyncedAtMs: number | undefined;
	gistId: string | undefined;
	gistUrl: string | undefined;
	settingsLastSyncedAtMs: number | undefined;
}

export interface SyncStateStore {
	get(): SyncState;
	update(patch: Partial<SyncState>): Promise<void>;
}

/** A target's local side, normalised to one shape `syncTarget` can drive regardless of what syncing it actually means. */
interface SyncTarget {
	getLocalChangedAtMs: () => number;
	pull: (remoteContent: string) => Promise<PullResult>;
	readLocal: () => string;
}

async function adoptExistingGist(
	deps: SyncDeps,
	existing: GistInfo,
): Promise<SyncOutcome> {
	const extensionsTarget = resolveExtensionsTarget(deps.extensions);
	const settingsTarget = resolveSettingsTarget(deps.settings);

	const settingsResult = await syncTarget(
		existing.settingsContent,
		settingsTarget,
		"pull",
	);
	const extensionsAction: SyncAction =
		existing.extensionsContent === undefined ? "push" : "pull";
	const extensionsResult = await syncTarget(
		existing.extensionsContent,
		extensionsTarget,
		extensionsAction,
	);

	const patch: GistFilesPatch = {};
	if (extensionsResult.patchContent !== undefined)
		patch.extensions = extensionsResult.patchContent;

	const gistUrl =
		patch.extensions !== undefined
			? (await updateSyncGist(deps.token, existing.id, patch)).htmlUrl
			: existing.htmlUrl;

	await deps.store.update({
		extensionsLastSyncedAtMs: Date.now(),
		gistId: existing.id,
		gistUrl,
		settingsLastSyncedAtMs: Date.now(),
	});

	return {
		extensions: {
			action: extensionsResult.action,
			diff: extensionsResult.diff,
			remoteContentBeforePush: extensionsResult.remoteContentBeforePush,
		},
		linked: "found",
		settings: {
			action: settingsResult.action,
			remoteContentBeforePush: settingsResult.remoteContentBeforePush,
		},
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
		extensionsLastSyncedAtMs: Date.now(),
		gistId: created.id,
		gistUrl: created.htmlUrl,
		settingsLastSyncedAtMs: Date.now(),
	});
	return {
		extensions: { action: "push" },
		linked: "created",
		settings: { action: "push" },
	};
}

export async function performSync(deps: SyncDeps): Promise<SyncOutcome> {
	const state = deps.store.get();

	if (!state.gistId) {
		return linkGist(deps);
	}

	let remote: GistInfo;
	try {
		remote = await getGist(deps.token, state.gistId);
	} catch (error) {
		if (error instanceof GitHubApiError && error.status === 404) {
			// The linked gist is gone (deleted, or no longer accessible to this account) - re-link as if this were a fresh install.
			return linkGist(deps);
		}
		throw error;
	}

	const extensionsTarget = resolveExtensionsTarget(deps.extensions);
	const settingsTarget = resolveSettingsTarget(deps.settings);

	const settingsAction = decideSyncAction(
		settingsTarget.getLocalChangedAtMs(),
		remote.updatedAtMs,
		state.settingsLastSyncedAtMs ?? 0,
	);
	const extensionsAction =
		remote.extensionsContent === undefined
			? "push"
			: decideSyncAction(
					extensionsTarget.getLocalChangedAtMs(),
					remote.updatedAtMs,
					state.extensionsLastSyncedAtMs ?? 0,
				);

	const settingsResult = await syncTarget(
		remote.settingsContent,
		settingsTarget,
		settingsAction,
	);
	const extensionsResult = await syncTarget(
		remote.extensionsContent,
		extensionsTarget,
		extensionsAction,
	);

	const patch: GistFilesPatch = {};
	if (settingsResult.patchContent !== undefined)
		patch.settings = settingsResult.patchContent;
	if (extensionsResult.patchContent !== undefined)
		patch.extensions = extensionsResult.patchContent;

	if (patch.settings !== undefined || patch.extensions !== undefined) {
		await updateSyncGist(deps.token, remote.id, patch);
	}

	await deps.store.update({
		extensionsLastSyncedAtMs: Date.now(),
		gistUrl: remote.htmlUrl,
		settingsLastSyncedAtMs: Date.now(),
	});

	return {
		extensions: {
			action: extensionsResult.action,
			diff: extensionsResult.diff,
			remoteContentBeforePush: extensionsResult.remoteContentBeforePush,
		},
		settings: {
			action: settingsResult.action,
			remoteContentBeforePush: settingsResult.remoteContentBeforePush,
		},
	};
}

function resolveExtensionsTarget(deps: ExtensionsSyncDeps): SyncTarget {
	return {
		getLocalChangedAtMs: deps.getLocalChangedAtMs,
		pull: async (remoteContent) => {
			const diff = computeExtensionDiff(deps.readLocal(), remoteContent);
			if (diff.toInstall.length === 0 && diff.toUninstall.length === 0)
				return { changed: false };
			await deps.applyDiff(diff);
			return { changed: true, diff };
		},
		readLocal: deps.readLocal,
	};
}

function resolveSettingsTarget(deps: SettingsSyncDeps): SyncTarget {
	return {
		getLocalChangedAtMs: deps.getLocalChangedAtMs,
		pull: async (remoteContent) => {
			if (deps.readLocal() === remoteContent) return { changed: false };
			deps.writeLocal(remoteContent);
			return { changed: true };
		},
		readLocal: deps.readLocal,
	};
}

/** The one place push/pull actually happens, for either target: given what the remote currently holds and which action was decided, apply it and report what happened. */
async function syncTarget(
	content: string | undefined,
	target: SyncTarget,
	action: SyncAction,
): Promise<{
	action: SyncAction;
	diff?: ExtensionsDiff;
	patchContent?: string;
	remoteContentBeforePush?: string;
}> {
	if (action === "push") {
		const localContent = target.readLocal();
		if (localContent === (content ?? "")) return { action: "none" };
		return {
			action: "push",
			patchContent: localContent,
			remoteContentBeforePush: content,
		};
	}
	if (action === "pull") {
		const result = await target.pull(content ?? "");
		if (!result.changed) return { action: "none" };
		return { action: "pull", diff: result.diff };
	}
	return { action: "none" };
}
