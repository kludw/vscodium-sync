# Changelog

Notable changes to this project, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). No version has been tagged/released yet, so everything so far is under [Unreleased].

## [Unreleased]

### Added

- Two-way sync of global `settings.json` through a private GitHub gist, auto-sync always on (no toggle).
- Zero-config gist discovery: the first machine creates the gist; other machines on the same GitHub account auto-adopt it by marker filename (`vscodium-sync-settings.json`), with nothing to configure by hand.
- GitHub sign-in via VS Code's built-in GitHub authentication provider (`gist` scope) — no token entry, no OAuth app to register.
- Last-write-wins conflict resolution by timestamp.
- Local → remote sync on file save (debounced file watcher); remote → local sync via 15-second polling; sync also runs once on activation and on demand.
- Status bar indicator (syncing / synced / error) with a quick-pick menu: Sync Now, Open Settings JSON, Open Sync Gist, Show Sync Log.
- Notifications on push/pull with a "View Diff" action opening a diff editor against the pre-sync content.
- `VSCodium Sync` output channel logging sign-in, sync results, and errors.
- Test suite with 100% function/line coverage on the pure sync core (`github/client.ts`, `sync/conflict.ts`, `sync/engine.ts`, `settings/path.ts`).
- Documentation site published via GitHub Pages: <https://kludw.github.io/vscodium-sync/>
- Version list: this changelog.
- Architecture Decision Records under `docs/adr/`, covering the auth method, sync scope, conflict resolution, sync triggers, gist discovery, the pure-core/glue split, and the status bar UI.
- Installed-extensions sync: full two-way mirror (install/uninstall follows whichever side changed most recently), sharing the same gist, watcher/poll triggers, and last-write-wins rule as `settings.json`. Installs and uninstalls apply silently, with a notification and full logging of what changed — see [ADR 0009](https://kludw.github.io/vscodium-sync/adr/0009-sync-installed-extensions.html) for the trade-off this accepts.

### Changed

- Standardised notifications: settings and extensions now go through the exact same flow (`notifySynced`) — same message shape, same "View Diff" action, same before/after diff editor. Extensions previously got a different, count-only notification with a "Show Log" action instead of a diff; that's gone in favour of one consistent behaviour, documented as a single flow in [Usage](https://kludw.github.io/vscodium-sync/usage.html#notifications).
- The synced extensions list is now one ID per line (`JSON.stringify(ids, null, 2)`) instead of a single-line array, in both `vscodium-sync-extensions.json` on GitHub and the View Diff editor — a one-line array made every change highlight the whole line.
- The status menu's "Open Settings Gist" and "Open Extensions Gist" are one item again, "Open Sync Gist" — both pointed at the same gist, so the split was redundant.
- Poll interval shortened from 60s to 15s, so remote changes show up faster — see [ADR 0004](https://kludw.github.io/vscodium-sync/adr/0004-watch-and-poll-for-two-way-sync.html).
- `sync/engine.ts` internals modularised: settings and extensions now share one `syncTarget(content, target, action)` function instead of two near-identical inline push/pull blocks, with each item adapted into a common shape via `resolveSettingsTarget`/`resolveExtensionsTarget`. No behaviour change — same 33 tests pass unchanged. Declarations are now ordered alphabetically throughout `src/` (consts, interface/type fields, functions, each as its own alphabetical group) — initially applied to `sync/` only, then extended to the whole codebase once `extension.ts` and `github/client.ts` turned out not to have been kept consistent with it.
- Further deduplication after an audit for repeated code: `github/client.ts`'s three gist-fetching functions share one `requestGistInfo`; `sync/engine.ts`'s `performSync`/`adoptExistingGist` share `toOutcome`/`touchSyncedAt`/`resolveTargets` instead of each rebuilding the same shapes; `extension.ts`'s install/uninstall loop, per-field `globalState` writes, and settings/extensions notification branches are each now one shared helper called twice instead of two near-identical blocks. A new `src/shared/` holds code duplicated across files with no single domain owner — currently just the `bun:test` fetch-mock helpers `github/client.test.ts` and `sync/engine.test.ts` both needed. No behaviour change throughout; same 33 tests pass unchanged, and the built `dist/extension.js` shrank as a result.

- `settings.json` keys are now sorted alphabetically and recursively (arrays left in element order) on every sync that reads, compares, or writes it, so both the gist and your local file are readable rather than whatever order the editor left them in — see [ADR 0011](https://kludw.github.io/vscodium-sync/adr/0011-sort-settings-json-keys.html). Sorting is safely skipped (verbatim mirror, as before) for any `settings.json` that contains a `// comment`, since `JSON.parse` can't round-trip one without deleting it.

### Fixed

- Extensions sync didn't notify when it pushed a local install/uninstall up to the gist — only a pull (something arriving from elsewhere) showed a notification. Fixed by the standardisation above, since push now follows the same notified flow settings.json already had.
- An extensions pull could report `pull` and fire a notification even when the computed diff was empty (nothing actually installed or uninstalled). `sync/engine.ts` now downgrades that case to `none`, matching how settings.json already handled an unchanged pull.
- A gist that stopped existing (deleted, or the signed-in GitHub account changed) permanently broke sync — every subsequent attempt failed with a `404` and there was no way to recover short of manually clearing extension storage. `performSync` now treats a `404` re-fetching the linked gist as "no gist linked," and re-links automatically. See [ADR 0010](https://kludw.github.io/vscodium-sync/adr/0010-recover-from-missing-gist.html).

[Unreleased]: https://github.com/kludw/vscodium-sync/commits/master
