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

## I see a `vscodiumSync.*` key in my real `settings.json`

This extension **never** writes to `settings.json` or to workspace/user configuration — it only reads and overwrites the file's content wholesale during a push/pull, and it only persists its own state (`gistId`, `gistUrl`, `settingsLastSyncedAtMs`, `extensionsLastSyncedAtMs`) via VS Code's internal `context.globalState`, not as a setting. See [Architecture](./architecture.html#where-state-lives).

If you see a key like `vscodiumSync.gistId` sitting in `settings.json`, it was written by something else — most likely a different or earlier version of an extension using the same id prefix (for example, a prior prototype that used `vscode.workspace.getConfiguration().update(...)` instead of `globalState`). It's safe to delete by hand; this extension will not recreate it.

## Multiple machines aren't finding the same gist

Gist discovery matches on a specific marker file, `vscodium-sync-settings.json` (see [Architecture](./architecture.html#first-run-linking-a-gist)), inside a gist owned by the *same signed-in GitHub account*. If two machines are signed in to different GitHub accounts, they'll each create their own gist instead of sharing one.

## An extension got installed or uninstalled that I didn't expect

Extension sync mirrors fully and installs/uninstalls silently by design — see [ADR 0009](./adr/0009-sync-installed-extensions.html) for why, and [Usage](./usage.html#extensions-sync) for what "mirrors fully" means in practice. Check the sync log for `Installed extension ...` / `Uninstalled extension ...` lines to see exactly what happened and when; each one is logged individually. If it wasn't something you did on *any* linked machine, treat it as a signal to check who/what has access to the GitHub account the sync gist belongs to.

## An extension failed to install

Check the log for `Failed to install extension ...` — one failure (e.g. an extension not available on your configured marketplace/registry) doesn't block the rest of the sync; every other pending install/uninstall still runs.

## Starting over

The linked gist ID lives in this machine's VS Code global state, not in a file you can easily edit by hand. To force the extension to re-discover or re-create a gist on this machine, you'd need to clear its extension storage (e.g. via **Developer: Reload Window** after uninstalling/reinstalling, or by removing this extension's entry from VS Code's global state store) — there's no dedicated "reset" command yet.
