# Changelog

Notable changes to this project, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). No version has been tagged/released yet, so everything so far is under [Unreleased].

## [Unreleased]

### Added

- Two-way sync of global `settings.json` through a private GitHub gist, auto-sync always on (no toggle).
- Zero-config gist discovery: the first machine creates the gist; other machines on the same GitHub account auto-adopt it by marker filename (`vscodium-sync-settings.json`), with nothing to configure by hand.
- GitHub sign-in via VS Code's built-in GitHub authentication provider (`gist` scope) — no token entry, no OAuth app to register.
- Last-write-wins conflict resolution by timestamp.
- Local → remote sync on file save (debounced file watcher); remote → local sync via 60-second polling; sync also runs once on activation and on demand.
- Status bar indicator (syncing / synced / error) with a quick-pick menu: Sync Now, Open Settings JSON, Open Settings Gist, Open Extensions Gist, Show Sync Log.
- Notifications on push/pull with a "View Diff" action opening a diff editor against the pre-sync content.
- `VSCodium Sync` output channel logging sign-in, sync results, and errors.
- Test suite with 100% function/line coverage on the pure sync core (`github/client.ts`, `sync/conflict.ts`, `sync/engine.ts`, `settings/path.ts`).
- Documentation site published via GitHub Pages: <https://kludw.github.io/vscodium-sync/>
- Version list: this changelog.
- Architecture Decision Records under `docs/adr/`, covering the auth method, sync scope, conflict resolution, sync triggers, gist discovery, the pure-core/glue split, and the status bar UI.
- Installed-extensions sync: full two-way mirror (install/uninstall follows whichever side changed most recently), sharing the same gist, watcher/poll triggers, and last-write-wins rule as `settings.json`. Installs and uninstalls apply silently, with a notification and full logging of what changed — see [ADR 0009](https://kludw.github.io/vscodium-sync/adr/0009-sync-installed-extensions.html) for the trade-off this accepts.

### Changed

- Standardised notifications: settings and extensions now go through the exact same flow (`notifySynced`) — same message shape, same "View Diff" action, same before/after diff editor. Extensions previously got a different, count-only notification with a "Show Log" action instead of a diff; that's gone in favour of one consistent behaviour, documented as a single flow in [Usage](https://kludw.github.io/vscodium-sync/usage.html#notifications).

### Fixed

- Extensions sync didn't notify when it pushed a local install/uninstall up to the gist — only a pull (something arriving from elsewhere) showed a notification. Fixed by the standardisation above, since push now follows the same notified flow settings.json already had.
- An extensions pull could report `pull` and fire a notification even when the computed diff was empty (nothing actually installed or uninstalled). `sync/engine.ts` now downgrades that case to `none`, matching how settings.json already handled an unchanged pull.

[Unreleased]: https://github.com/kludw/vscodium-sync/commits/master
