---
title: Architecture
---

# Architecture

This page describes *how* the pieces fit together. For *why* each significant choice was made — the alternatives considered and the trade-offs accepted — see the [Architecture Decision Records](./adr/index.html).

## Module map

The codebase is split into a **pure, unit-tested core** and a **thin VS Code glue layer**. Only the glue layer imports `vscode`.

```
src/
  extension.ts            entry point: auth, wiring, watcher, poller (glue, untested)
  github/
    client.ts              GitHub Gist REST client, both synced files (pure)
    client.test.ts
  sync/
    conflict.ts             last-write-wins decision (pure)
    conflict.test.ts
    engine.ts                sync orchestration for both items (pure)
    engine.test.ts
    extensions.ts             installed-extensions diff (pure)
    extensions.test.ts
  settings/
    path.ts                  per-platform settings.json path (pure)
    path.test.ts
  status/
    statusBar.ts              status bar item (glue, untested)
    menu.ts                    quick-pick menu (glue, untested)
    notifications.ts           toasts + diff view (glue, untested)
```

See [Testing](./testing.html) for why the split lands exactly there.

## The sync algorithm

`performSync()` in `src/sync/engine.ts` is the whole engine, and it's plain TypeScript with injected dependencies — no `fs`, no `vscode`. It syncs **two independent items sharing one gist**: `settings.json` content and the installed-extensions list. `src/extension.ts` supplies the real `settings`/`extensions` callback objects (read/write/apply, and "when did this last change locally").

### First run: linking a gist

If no gist is linked yet (`state.gistId` is unset):

1. Search the signed-in user's gists for one containing a file named `vscodium-sync-settings.json` (the marker filename, `SETTINGS_FILENAME` in `github/client.ts`).
2. **Found one** → adopt it: overwrite local `settings.json` with the gist's content, and diff/apply the gist's extensions list against what's installed locally (`linked: "found"`). If that gist predates extensions support (no `vscodium-sync-extensions.json` file in it yet), the local extensions list is pushed up to seed it instead of pulled.
3. **Found none** → create a new private gist containing both files, seeded from local `settings.json` and the local extensions list (`linked: "created"`).

This is what makes multi-machine setup zero-config: the second machine just needs the same GitHub account — no gist ID to copy anywhere.

### Steady state: push, pull, or nothing — per item

Once a gist is linked, every sync fetches the gist **once** (one `GET`, both files come back together), then decides an action independently for each item, and — if either needs to push — sends **one** combined `PATCH` covering whichever changed.

### Conflict resolution

Each item's action is decided by the same pure function, `decideSyncAction(localChangedAtMs, remoteUpdatedAtMs, lastSyncedAtMs)` in `src/sync/conflict.ts`:

| Local changed since last sync? | Remote changed since last sync? | Result |
| --- | --- | --- |
| No | No | `none` |
| Yes | No | `push` |
| No | Yes | `pull` |
| Yes | Yes | whichever timestamp is newer wins; an exact tie favours local (`push`) |

This is **last-write-wins** — the loser is silently overwritten, no merge, no prompt. See [Usage](./usage.html#conflict-resolution) for the user-facing consequence, and [ADR 0009](./adr/0009-sync-installed-extensions.html) for what "loser" means specifically for extensions (a full mirror — uninstalls propagate too).

**A caveat that shapes the code:** a GitHub gist has one `updated_at` for the whole gist, not one per file. So a change to *either* `settings.json` or the extensions list bumps the timestamp both items compare against, which would otherwise make an unrelated change look like "the other item changed too." `applyActions()` in `src/sync/engine.ts` guards this: before actually writing a pull or sending a push, it compares content directly and downgrades to `none` if nothing really differs — no spurious write, no spurious notification, no wasted API call. (This was caught by a failing test while building extensions support, not designed upfront — see the engine's test suite.)

### Extensions specifically

`computeExtensionDiff(currentContent, targetContent)` in `src/sync/extensions.ts` is a pure set difference between two JSON arrays of extension IDs — everything to install (in target, not current) and everything to uninstall (in current, not target). `src/extension.ts` supplies `currentContent` from `vscode.extensions.all` (filtered to exclude built-ins) and applies the resulting diff via `workbench.extensions.installExtension` / `workbench.extensions.uninstallExtension`, logging each attempt and continuing past individual failures.

## Where state lives

Four fields — `gistId`, `gistUrl`, `settingsLastSyncedAtMs`, `extensionsLastSyncedAtMs` — are persisted via `context.globalState` in `src/extension.ts`. This is VS Code's own per-machine extension storage (backed by a local SQLite database), and it is **never** written into `settings.json` or synced as a workspace/user setting. The gist's `vscodium-sync-settings.json` file is an exact mirror of `settings.json`, and `vscodium-sync-extensions.json` an exact mirror of the installed-extensions list — nothing is ever injected into either to track sync state.

## Authentication

`vscode.authentication.getSession("github", ["gist"], { createIfNone: true })` — VS Code's built-in GitHub auth provider, scoped to the `gist` permission. `package.json` declares `vscode.github-authentication` as an `extensionDependency` so it's guaranteed to be present. This works identically in VSCodium and VS Code (the auth provider extension is MIT-licensed and ships in VSCodium's build too), and needs no OAuth app registration or manual token entry.

## Diff view

For push and pull notifications on `settings.json`, the "before" content is written to a fixed temp file (`vscodium-sync-diff-before.json` in the OS temp dir) and opened against the live `settings.json` via the built-in `vscode.diff` command — no custom diff UI, no content-provider scheme. Extensions notifications don't use this: there's no meaningful text diff for "which extensions changed," so that notification just states counts, with a "Show Log" action for the actual IDs.
