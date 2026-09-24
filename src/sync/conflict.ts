export type SyncAction = "push" | "pull" | "none";

export function decideSyncAction(
	localMtimeMs: number,
	remoteUpdatedAtMs: number,
	lastSyncedAtMs: number,
): SyncAction {
	const localChanged = localMtimeMs > lastSyncedAtMs;
	const remoteChanged = remoteUpdatedAtMs > lastSyncedAtMs;

	if (!localChanged && !remoteChanged) return "none";
	if (localChanged && !remoteChanged) return "push";
	if (!localChanged && remoteChanged) return "pull";

	return localMtimeMs >= remoteUpdatedAtMs ? "push" : "pull";
}
