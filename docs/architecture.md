---
title: Architecture
---

# Architecture

## Module map

The codebase is split into a **pure, unit-tested core** and a **thin VS Code glue layer**. Only the glue layer imports `vscode`.

```
src/
  extension.ts            entry point: auth, wiring, watcher, poller (glue, untested)
  github/
    client.ts              GitHub Gist REST client (pure)
    client.test.ts
  sync/
    conflict.ts             last-write-wins decision (pure)
    conflict.test.ts
    engine.ts                sync orchestration (pure)
    engine.test.ts
  settings/
    path.ts                  per-platform settings.json path (pure)
    path.test.ts
  status/
    statusBar.ts              status bar item (glue, untested)
    menu.ts                    quick-pick menu (glue, untested)
    notifications.ts           toast + diff view (glue, untested)
```

See [Testing](./testing.html) for why the split lands exactly there.

## The sync algorithm

`performSync()` in `src/sync/engine.ts` is the whole engine, and it's plain TypeScript with injected dependencies (`token`, a `store` for persisted state, and `readLocal`/`writeLocal`/`getLocalMtimeMs` callbacks) — no `fs`, no `vscode`. `src/extension.ts` supplies the real implementations of those callbacks.

### First run: linking a gist

If no gist is linked yet (`state.gistId` is unset):

1. Search the signed-in user's gists for one containing a file named `vscodium-sync-settings.json` (the marker filename, `GIST_FILENAME` in `github/client.ts`).
2. **Found one** → adopt it: overwrite local `settings.json` with the gist's content (`init-pull`).
3. **Found none** → create a new private gist from the current local `settings.json` (`init-push`).

This is what makes multi-machine setup zero-config: the second machine just needs the same GitHub account — no gist ID to copy anywhere.

### Steady state: push, pull, or nothing

Once a gist is linked, every sync:

1. Fetches the gist's current content and `updated_at`.
2. Compares local `settings.json`'s mtime and the gist's `updated_at` against the timestamp of the last successful sync to decide: `push`, `pull`, or `none`.
3. Acts accordingly, then records the new sync timestamp.

### Conflict resolution

The decision is made by the pure function `decideSyncAction(localMtimeMs, remoteUpdatedAtMs, lastSyncedAtMs)` in `src/sync/conflict.ts`:

| Local changed since last sync? | Remote changed since last sync? | Result |
| --- | --- | --- |
| No | No | `none` |
| Yes | No | `push` |
| No | Yes | `pull` |
| Yes | Yes | whichever timestamp is newer wins; an exact tie favours local (`push`) |

This is **last-write-wins** — the loser is silently overwritten, no merge, no prompt. See [Usage](./usage.html#conflict-resolution) for the user-facing consequence.

## Where state lives

Three fields — `gistId`, `gistUrl`, `lastSyncedAtMs` — are persisted via `context.globalState` in `src/extension.ts`. This is VS Code's own per-machine extension storage (backed by a local SQLite database), and it is **never** written into `settings.json` or synced as a workspace/user setting. The gist's content is an exact mirror of `settings.json` — nothing is ever injected into either file to track sync state.

## Authentication

`vscode.authentication.getSession("github", ["gist"], { createIfNone: true })` — VS Code's built-in GitHub auth provider, scoped to the `gist` permission. `package.json` declares `vscode.github-authentication` as an `extensionDependency` so it's guaranteed to be present. This works identically in VSCodium and VS Code (the auth provider extension is MIT-licensed and ships in VSCodium's build too), and needs no OAuth app registration or manual token entry.

## Diff view

For push and pull notifications, the "before" content is written to a fixed temp file (`vscodium-sync-diff-before.json` in the OS temp dir) and opened against the live `settings.json` via the built-in `vscode.diff` command — no custom diff UI, no content-provider scheme.
