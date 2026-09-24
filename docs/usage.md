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
- **Open Sync Gist** — opens the linked gist in your browser (both `settings.json` and the extensions list live in the same gist). Only shown once a gist has been linked (i.e. not on the very first, still-in-progress sync).
- **Show Sync Log** — opens the `VSCodium Sync` output channel (see [Troubleshooting](./troubleshooting.html#reading-the-log)).

## What triggers a sync

Auto sync is always on — there's no setting to turn it off:

- **On activation** — one sync runs immediately when VSCodium starts.
- **Local → remote**: a file watcher on `settings.json` triggers a sync 500ms after the last detected change (debounced, so rapid edits collapse into one push). Installing or uninstalling an extension triggers the same debounced sync.
- **Remote → local**: a 60-second poll checks the gist for changes made elsewhere and pulls them down.
- **On demand**: the "Sync Now" menu item.

## Notifications

**Settings and extensions notify the same way** — one flow, applied to whichever item actually changed. Whenever a sync pushes or pulls something, you get a notification with a **View Diff** button that opens a before/after comparison in a normal diff editor:

| Item | Direction | Message | View Diff shows |
| --- | --- | --- | --- |
| Settings | Pulled | *"VSCodium Sync: settings were updated."* | Your local `settings.json` before ↔ after the pull |
| Settings | Pushed | *"VSCodium Sync: settings synced."* | The gist's old content ↔ what you just pushed |
| Extensions | Pulled | *"VSCodium Sync: extensions were updated."* | Your installed-extensions list before ↔ after the installs/uninstalls |
| Extensions | Pushed | *"VSCodium Sync: extensions synced."* | The gist's old list ↔ what you just pushed |

Two exceptions, both because there's nothing to compare against yet:

- **First-time setup** (a new gist was created because none existed yet): *"VSCodium Sync: settings sync enabled."* — one notification, no diff button, covering both files.
- **No changes**: nothing — a no-op sync is silent by design, for either item independently.

> **Note:** VS Code has no API for an extension to auto-dismiss a notification after a fixed delay while it still carries an action button (dismissing it would drop the button along with it). So these notifications follow VS Code's own default fade/history behaviour rather than a fixed "N seconds" — they don't sit there forever, but the extension doesn't control the exact timing.

## Conflict resolution

If both your local `settings.json` and the gist changed since the last sync, **the more recently modified one wins** and silently overwrites the other — there's no merge prompt. See [Architecture](./architecture.html#conflict-resolution) for the exact rule.

## Extensions sync

Installed extensions sync the same way settings do — same gist, same triggers, same last-write-wins rule, same notification flow above — with two differences worth knowing:

- **It mirrors fully**: uninstall an extension on one machine and it gets uninstalled everywhere else too, next time that machine syncs. There's no "keep this one anyway."
- **It installs silently**: a missing extension installs with no confirmation prompt. Because this executes third-party code with no local review step, it's worth understanding what that means for your GitHub account — see [ADR 0009](./adr/0009-sync-installed-extensions.html).

Built-in extensions (the ones that ship with the editor) are never touched by this — only what you've separately installed.
