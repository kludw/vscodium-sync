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

This extension **never** writes to `settings.json` or to workspace/user configuration — it only reads and overwrites the file's content wholesale during a push/pull, and it only persists its own state (`gistId`, `gistUrl`, `lastSyncedAtMs`) via VS Code's internal `context.globalState`, not as a setting. See [Architecture](./architecture.md#where-state-lives).

If you see a key like `vscodiumSync.gistId` sitting in `settings.json`, it was written by something else — most likely a different or earlier version of an extension using the same id prefix (for example, a prior prototype that used `vscode.workspace.getConfiguration().update(...)` instead of `globalState`). It's safe to delete by hand; this extension will not recreate it.

## Multiple machines aren't finding the same gist

Gist discovery matches on a specific marker file, `vscodium-sync-settings.json` (see [Architecture](./architecture.md#first-run-linking-a-gist)), inside a gist owned by the *same signed-in GitHub account*. If two machines are signed in to different GitHub accounts, they'll each create their own gist instead of sharing one.

## Starting over

The linked gist ID lives in this machine's VS Code global state, not in a file you can easily edit by hand. To force the extension to re-discover or re-create a gist on this machine, you'd need to clear its extension storage (e.g. via **Developer: Reload Window** after uninstalling/reinstalling, or by removing this extension's entry from VS Code's global state store) — there's no dedicated "reset" command yet.
