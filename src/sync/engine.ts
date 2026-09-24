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

/** A raw file synced by wholesale overwrite - settings.json and keybindings.json both use this shape. */
export interface FileSyncDeps {
	getLocalChangedAtMs: () => number;
	readLocal: () => string;
	writeLocal: (content: string) => void;
}

interface PullResult {
	changed: boolean;
	diff?: ExtensionsDiff;
}

export interface SyncDeps {
	extensions: ExtensionsSyncDeps;
	keybindings: FileSyncDeps;
	settings: FileSyncDeps;
	store: SyncStateStore;
	token: string;
}

export interface SyncOutcome {
	extensions: {
		action: SyncAction;
		diff?: ExtensionsDiff;
		remoteContentBeforePush?: string;
	};
	keybindings: { action: SyncAction; remoteContentBeforePush?: string };
	/** Set only on the sync that first links a gist to this machine. */
	linked?: "found" | "created";
	settings: { action: SyncAction; remoteContentBeforePush?: string };
}

export interface SyncState {
	extensionsLastSyncedAtMs: number | undefined;
	gistId: string | undefined;
	gistUrl: string | undefined;
	keybindingsLastSyncedAtMs: number | undefined;
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

/** What `syncTarget` did for one item - the raw material `toOutcome` turns into a `SyncOutcome` entry. */
interface TargetResult {
	action: SyncAction;
	diff?: ExtensionsDiff;
	patchContent?: string;
	remoteContentBeforePush?: string;
}

async function adoptExistingGist(
	deps: SyncDeps,
	existing: GistInfo,
): Promise<SyncOutcome> {
	const { extensionsTarget, keybindingsTarget, settingsTarget } =
		resolveTargets(deps);

	const settingsResult = await syncTarget(
		existing.settingsContent,
		settingsTarget,
		"pull",
	);

	const keybindingsAction: SyncAction =
		existing.keybindingsContent === undefined ? "push" : "pull";
	const keybindingsResult = await syncTarget(
		existing.keybindingsContent,
		keybindingsTarget,
		keybindingsAction,
	);

	const extensionsAction: SyncAction =
		existing.extensionsContent === undefined ? "push" : "pull";
	const extensionsResult = await syncTarget(
		existing.extensionsContent,
		extensionsTarget,
		extensionsAction,
	);

	const patch: GistFilesPatch = {};
	if (keybindingsResult.patchContent !== undefined)
		patch.keybindings = keybindingsResult.patchContent;
	if (extensionsResult.patchContent !== undefined)
		patch.extensions = extensionsResult.patchContent;

	const gistUrl =
		Object.keys(patch).length > 0
			? (await updateSyncGist(deps.token, existing.id, patch)).htmlUrl
			: existing.htmlUrl;

	await touchSyncedAt(deps.store, gistUrl, existing.id);

	return toOutcome(
		settingsResult,
		keybindingsResult,
		extensionsResult,
		"found",
	);
}

async function linkGist(deps: SyncDeps): Promise<SyncOutcome> {
	const existing = await findSyncGist(deps.token);

	if (existing) {
		return adoptExistingGist(deps, existing);
	}

	const created = await createSyncGist(deps.token, {
		extensions: deps.extensions.readLocal(),
		keybindings: deps.keybindings.readLocal(),
		settings: deps.settings.readLocal(),
	});
	await touchSyncedAt(deps.store, created.htmlUrl, created.id);

	const pushed: TargetResult = { action: "push" };
	return toOutcome(pushed, pushed, pushed, "created");
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

	const { extensionsTarget, keybindingsTarget, settingsTarget } =
		resolveTargets(deps);

	const settingsAction = decideSyncAction(
		settingsTarget.getLocalChangedAtMs(),
		remote.updatedAtMs,
		state.settingsLastSyncedAtMs ?? 0,
	);
	const keybindingsAction =
		remote.keybindingsContent === undefined
			? "push"
			: decideSyncAction(
					keybindingsTarget.getLocalChangedAtMs(),
					remote.updatedAtMs,
					state.keybindingsLastSyncedAtMs ?? 0,
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
	const keybindingsResult = await syncTarget(
		remote.keybindingsContent,
		keybindingsTarget,
		keybindingsAction,
	);
	const extensionsResult = await syncTarget(
		remote.extensionsContent,
		extensionsTarget,
		extensionsAction,
	);

	const patch: GistFilesPatch = {};
	if (settingsResult.patchContent !== undefined)
		patch.settings = settingsResult.patchContent;
	if (keybindingsResult.patchContent !== undefined)
		patch.keybindings = keybindingsResult.patchContent;
	if (extensionsResult.patchContent !== undefined)
		patch.extensions = extensionsResult.patchContent;

	if (Object.keys(patch).length > 0) {
		await updateSyncGist(deps.token, remote.id, patch);
	}

	await touchSyncedAt(deps.store, remote.htmlUrl);

	return toOutcome(settingsResult, keybindingsResult, extensionsResult);
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

function resolveFileTarget(deps: FileSyncDeps): SyncTarget {
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

function resolveTargets(deps: SyncDeps): {
	extensionsTarget: SyncTarget;
	keybindingsTarget: SyncTarget;
	settingsTarget: SyncTarget;
} {
	return {
		extensionsTarget: resolveExtensionsTarget(deps.extensions),
		keybindingsTarget: resolveFileTarget(deps.keybindings),
		settingsTarget: resolveFileTarget(deps.settings),
	};
}

/** The one place push/pull actually happens, for any target: given what the remote currently holds and which action was decided, apply it and report what happened. */
async function syncTarget(
	content: string | undefined,
	target: SyncTarget,
	action: SyncAction,
): Promise<TargetResult> {
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

function toOutcome(
	settingsResult: TargetResult,
	keybindingsResult: TargetResult,
	extensionsResult: TargetResult,
	linked?: "found" | "created",
): SyncOutcome {
	return {
		extensions: {
			action: extensionsResult.action,
			diff: extensionsResult.diff,
			remoteContentBeforePush: extensionsResult.remoteContentBeforePush,
		},
		keybindings: {
			action: keybindingsResult.action,
			remoteContentBeforePush: keybindingsResult.remoteContentBeforePush,
		},
		...(linked ? { linked } : {}),
		settings: {
			action: settingsResult.action,
			remoteContentBeforePush: settingsResult.remoteContentBeforePush,
		},
	};
}

function touchSyncedAt(
	store: SyncStateStore,
	gistUrl: string,
	gistId?: string,
): Promise<void> {
	return store.update({
		extensionsLastSyncedAtMs: Date.now(),
		...(gistId !== undefined ? { gistId } : {}),
		gistUrl,
		keybindingsLastSyncedAtMs: Date.now(),
		settingsLastSyncedAtMs: Date.now(),
	});
}
