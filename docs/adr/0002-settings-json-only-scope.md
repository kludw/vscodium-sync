---
title: "ADR 0002: Limit v1 sync scope to settings.json only"
---

# 0002: Limit v1 sync scope to `settings.json` only

**Status:** Accepted (2026-09-24)

## Context

"Settings Sync"-style tools typically sync several things: `settings.json`, `keybindings.json`, snippets, and the installed-extensions list. Building watch/merge logic for all of them up front means more surface to get right before any of it is validated, for a project whose starting requirement was specifically "push settings to gist."

## Decision

v1 syncs only the global `settings.json`. This was the user's explicit choice over building `settings.json` + `keybindings.json` + snippets together.

## Consequences

- Much smaller surface for the first working version: one file, one watcher, one conflict-resolution path.
- Keybindings, snippets, and the extensions list are not synced yet — documented as a known limitation in `docs/index.md`'s Scope section, not hidden.
- The gist-discovery and conflict-resolution mechanisms (see [0003](./0003-last-write-wins-conflict-resolution.html), [0005](./0005-zero-config-gist-discovery.html)) aren't `settings.json`-specific — extending scope later means adding more watched files and more marker filenames in the same gist, not a redesign.
