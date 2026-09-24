import {
	createSyncGist,
	findSyncGist,
	getGist,
	updateSyncGist,
} from "../github/client";
import { decideSyncAction } from "./conflict";

export interface SyncState {
	gistId: string | undefined;
	gistUrl: string | undefined;
	lastSyncedAtMs: number | undefined;
}

export interface SyncStateStore {
	get(): SyncState;
	update(patch: Partial<SyncState>): Promise<void>;
}

export interface SyncDeps {
	token: string;
	store: SyncStateStore;
	readLocal: () => string;
	writeLocal: (content: string) => void;
	getLocalMtimeMs: () => number;
}

export type SyncResult = "init-pull" | "init-push" | "push" | "pull" | "none";

export interface SyncOutcome {
	result: SyncResult;
	/** The gist's content immediately before this sync overwrote it with local content. Only set for "push". */
	remoteContentBeforePush?: string;
}

export async function performSync(deps: SyncDeps): Promise<SyncOutcome> {
	const state = deps.store.get();

	if (!state.gistId) {
		return { result: await linkGist(deps) };
	}

	const remote = await getGist(deps.token, state.gistId);
	const action = decideSyncAction(
		deps.getLocalMtimeMs(),
		remote.updatedAtMs,
		state.lastSyncedAtMs ?? 0,
	);

	if (action === "push") {
		await updateSyncGist(deps.token, state.gistId, deps.readLocal());
	} else if (action === "pull") {
		deps.writeLocal(remote.content);
	}

	await deps.store.update({
		gistUrl: remote.htmlUrl,
		lastSyncedAtMs: Date.now(),
	});

	return action === "push"
		? { result: action, remoteContentBeforePush: remote.content }
		: { result: action };
}

async function linkGist(deps: SyncDeps): Promise<"init-pull" | "init-push"> {
	const existing = await findSyncGist(deps.token);

	if (existing) {
		deps.writeLocal(existing.content);
		await deps.store.update({
			gistId: existing.id,
			gistUrl: existing.htmlUrl,
			lastSyncedAtMs: Date.now(),
		});
		return "init-pull";
	}

	const created = await createSyncGist(deps.token, deps.readLocal());
	await deps.store.update({
		gistId: created.id,
		gistUrl: created.htmlUrl,
		lastSyncedAtMs: Date.now(),
	});
	return "init-push";
}
