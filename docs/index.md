---
title: VSCodium Sync
permalink: /
---

# VSCodium Sync

VSCodium Sync keeps your global `settings.json` and installed extensions in sync across machines using a private GitHub gist. It's plug and play: install it, sign in to GitHub once, and it stays in sync in the background — no config file, no manual "sync now" step required (though one's available).

## What it does

- **Two-way sync** of your global `settings.json` and installed extensions through a private GitHub gist.
- **Auto sync, always on** — no toggle, no setting. Local changes push within half a second; remote changes are picked up by polling every 15 seconds.
- **Zero-config pairing** — the first machine creates the gist, every other machine auto-discovers it by a marker filename. No gist ID to copy around.
- **Last-write-wins conflict resolution** by timestamp, so you're never blocked waiting on a merge prompt.
- **Extensions mirror fully and install silently** — install or uninstall an extension on one machine and it happens on every other one too, with no confirmation prompt. See [Architecture Decision 0009](./adr/0009-sync-installed-extensions.html) for the trade-off this accepts.
- **Status bar indicator** with a menu to sync on demand, open the gist, jump to `settings.json`, or view the log.
- **Notifications** whenever settings or extensions actually change — settings notifications include a diff view.

## Scope

`settings.json` (global user settings) and the installed-extensions list are synced. Keybindings and snippets aren't yet — see [Architecture](./architecture.html) for how that could extend.

## Where to go next

| Page | What's in it |
| --- | --- |
| [Getting Started](./getting-started.html) | Install, build, and run it for the first time |
| [Usage](./usage.html) | Status bar, menu, notifications, what triggers a sync |
| [Architecture](./architecture.html) | Module map, sync algorithm, conflict resolution rules |
| [Testing](./testing.html) | What's covered, what's deliberately not, and why |
| [Troubleshooting](./troubleshooting.html) | Common issues and how to read the sync log |
| [Architecture Decisions](./adr/index.html) | Why it's built this way — the alternatives considered and trade-offs accepted |
| [Changelog](https://github.com/kludw/vscodium-sync/blob/master/CHANGELOG.md) | What's changed, release by release |

---

*Published from this `docs/` folder via GitHub Pages (Jekyll, `jekyll-theme-minimal`). Pages here link to each other with `.html` extensions to match Jekyll's output; browsing this same folder directly on GitHub, use the `.md` files instead (e.g. [`README.md`](https://github.com/kludw/vscodium-sync)).*
