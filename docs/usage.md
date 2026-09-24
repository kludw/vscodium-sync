---
title: Usage
---

# Usage

## Status bar

Once signed in, a status bar item appears on the right side of the window and cycles through three states:

| State | Text | Meaning |
| --- | --- | --- |
| Syncing | `$(sync~spin) Syncing settings` | A sync is in progress |
| Synced | `$(check) VSCodium Sync` | Last sync succeeded; tooltip shows the time |
| Error | `$(error) Sync failed` | Last sync failed; tooltip shows the error message |

## The sync menu

Click the status bar item, or run **VSCodium Sync: Show Status** from the Command Palette (`Cmd/Ctrl+Shift+P`), to open a menu with:

- **Sync Now** — trigger a sync immediately, without waiting for the watcher or the next poll.
- **Open Settings JSON** — jumps straight to your `settings.json` (same as the built-in `workbench.action.openSettingsJson` command).
- **Open Settings Gist** / **Open Extensions Gist** — opens the linked gist in your browser, scrolled to the relevant file (both files live in the same gist). Only shown once a gist has been linked (i.e. not on the very first, still-in-progress sync).
- **Show Sync Log** — opens the `VSCodium Sync` output channel (see [Troubleshooting](./troubleshooting.html#reading-the-log)).

## What triggers a sync

Auto sync is always on — there's no setting to turn it off:

- **On activation** — one sync runs immediately when VSCodium starts.
- **Local → remote**: a file watcher on `settings.json` triggers a sync 500ms after the last detected change (debounced, so rapid edits collapse into one push). Installing or uninstalling an extension triggers the same debounced sync.
- **Remote → local**: a 60-second poll checks the gist for changes made elsewhere and pulls them down.
- **On demand**: the "Sync Now" menu item.

## Notifications

Whenever a sync actually changes something, you get a notification:

- **Settings pulled** (someone else's changes came in): *"VSCodium Sync: settings were updated."* with a **View Diff** button showing what changed in your local `settings.json`.
- **Settings pushed** (your local changes went out): *"VSCodium Sync: settings synced."* with **View Diff** showing what changed in the gist.
- **First-time setup** (a new gist was created because none existed yet): *"VSCodium Sync: settings sync enabled."* — no diff button, since there's nothing to compare against yet.
- **Extensions changed** (installs/uninstalls were applied to match the synced list): *"VSCodium Sync: extensions installed N, uninstalled M."* with a **Show Log** button listing exactly which ones.
- **No changes**: nothing — a no-op sync is silent by design.

> **Note:** VS Code has no API for an extension to auto-dismiss a notification after a fixed delay while it still carries an action button (dismissing it would drop the button along with it). So these notifications follow VS Code's own default fade/history behaviour rather than a fixed "N seconds" — they don't sit there forever, but the extension doesn't control the exact timing.

## Conflict resolution

If both your local `settings.json` and the gist changed since the last sync, **the more recently modified one wins** and silently overwrites the other — there's no merge prompt. See [Architecture](./architecture.html#conflict-resolution) for the exact rule.

## Extensions sync

Installed extensions sync the same way settings do, sharing the same gist, the same triggers, and the same last-write-wins rule — with two differences worth knowing:

- **It mirrors fully**: uninstall an extension on one machine and it gets uninstalled everywhere else too, next time that machine syncs. There's no "keep this one anyway."
- **It installs silently**: a missing extension installs with no confirmation prompt. Because this executes third-party code with no local review step, it's worth understanding what that means for your GitHub account — see [ADR 0009](./adr/0009-sync-installed-extensions.html).

Built-in extensions (the ones that ship with the editor) are never touched by this — only what you've separately installed.
