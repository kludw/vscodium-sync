---
title: Troubleshooting
---

# Troubleshooting

## Reading the log

Everything the extension does — sign-in, sync start/finish, watcher and poll triggers, errors — goes to the **VSCodium Sync** output channel. Open it via:

- The status bar menu → **Show Sync Log**, or
- **View: Toggle Output** from the Command Palette, then pick "VSCodium Sync" from the channel dropdown.

Log level can be adjusted with **Developer: Set Log Level...** if you need more or less detail than the default.

## No status bar item

The status bar item only appears once GitHub sign-in succeeds (see `src/extension.ts`). If it's missing:

1. Check whether a GitHub sign-in prompt is waiting for you (it can appear as a notification or in the accounts menu, bottom-left).
2. Check the sync log for `"GitHub sign-in was declined or failed."`
3. Reload the window and try again.

## Sync isn't happening

1. Check the log for `Sync failed: ...` entries and the error message.
2. Confirm your GitHub account actually granted the `gist` scope during sign-in — VS Code's account menu (bottom-left) shows what's currently authorised.
3. Confirm you have network access to `api.github.com`.

## The linked gist is gone (404 error)

Seeing `VSCodium Sync failed: GitHub API error 404: ...get-a-gist...`? If you deleted the linked gist (or it's otherwise inaccessible — e.g. a different GitHub account is now signed in than the one that created it), the next sync recovers on its own: a `404` fetching the previously-linked gist is treated as "no gist linked yet," and the extension re-runs the same discovery-or-create flow a fresh install would — see [ADR 0010](./adr/0010-recover-from-missing-gist.html). You'll see `linked: created` (or `linked: found`, if another marker gist exists under the current account) in the log, and the usual first-time-setup notification.

Worth knowing: the old gist's content is gone for good — this creates a *new* gist from whatever's currently on this machine, it doesn't restore the deleted one. And if the 404 was actually caused by the wrong GitHub account being signed in, this will create a new gist under that account rather than telling you the account is wrong — check the account VS Code's account menu shows if that seems off.

Any other error (network failure, a 5xx from GitHub, etc.) does **not** trigger this — it fails normally and retries next cycle, same as before.

## I see a `vscodiumSync.*` key in my real `settings.json`

This extension **never** writes to `settings.json` or to workspace/user configuration — it only reads and overwrites the file's content wholesale during a push/pull, and it only persists its own state (`gistId`, `gistUrl`, `settingsLastSyncedAtMs`, `extensionsLastSyncedAtMs`) via VS Code's internal `context.globalState`, not as a setting. See [Architecture](./architecture.html#where-state-lives).

If you see a key like `vscodiumSync.gistId` sitting in `settings.json`, it was written by something else — most likely a different or earlier version of an extension using the same id prefix (for example, a prior prototype that used `vscode.workspace.getConfiguration().update(...)` instead of `globalState`). It's safe to delete by hand; this extension will not recreate it.

## Multiple machines aren't finding the same gist

Gist discovery matches on a specific marker file, `vscodium-sync-settings.json` (see [Architecture](./architecture.html#first-run-linking-a-gist)), inside a gist owned by the *same signed-in GitHub account*. If two machines are signed in to different GitHub accounts, they'll each create their own gist instead of sharing one.

## An extension got installed or uninstalled that I didn't expect

Extension sync mirrors fully and installs/uninstalls silently by design — see [ADR 0009](./adr/0009-sync-installed-extensions.html) for why, and [Usage](./usage.html#extensions-sync) for what "mirrors fully" means in practice. Check the sync log for `Installed extension ...` / `Uninstalled extension ...` lines to see exactly what happened and when; each one is logged individually. If it wasn't something you did on *any* linked machine, treat it as a signal to check who/what has access to the GitHub account the sync gist belongs to.

## An extension failed to install

Check the log for `Failed to install extension ...` — one failure (e.g. an extension not available on your configured marketplace/registry) doesn't block the rest of the sync; every other pending install/uninstall still runs.

## Starting over (without deleting the gist)

If the linked gist still exists but you want this machine to stop using it — switch to a different GitHub account's gist, for instance — deleting the gist itself and letting [the recovery above](#the-linked-gist-is-gone-404-error) kick in would affect every other machine sharing it too. To unlink just this one machine instead, you'd need to clear its extension storage directly (e.g. via **Developer: Reload Window** after uninstalling/reinstalling, or by removing this extension's entry from VS Code's global state store) — there's no dedicated "reset" command yet.
