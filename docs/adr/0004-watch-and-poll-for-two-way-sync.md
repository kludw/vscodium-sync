---
title: "ADR 0004: Watch local file + poll gist for continuous two-way sync"
---

# 0004: Watch local file + poll gist for continuous two-way sync

**Status:** Accepted (2026-09-24)

## Context

"Auto sync, always on" needs both directions to actually be continuous, not just on demand. Two realistic options:

1. **Push on local save, pull on startup/manual command only** — simpler, but not really continuous: changes made on another machine only arrive when this one restarts or the user remembers to sync.
2. **Push on local save (debounced file watcher) + pull via periodic polling** — genuinely continuous in both directions, at the cost of a recurring API call even when nothing changed.

## Decision

Option 2. This was the user's explicit choice. A `fs.watch` on `settings.json` triggers a push 500ms after the last detected change (debounced, so rapid edits collapse into one push); a 60-second `setInterval` polls the gist for a pull. A sync also runs once immediately on activation, and on demand via the "Sync Now" menu item.

## Consequences

- Remote changes made on another machine arrive within 60 seconds, without any action on this machine — real background sync.
- A recurring `GET` gist call every 60 seconds even when idle. At one call per minute this is far under GitHub's authenticated rate limit; not a practical concern at this scale.
- Risk of an echo loop: a pull writes to `settings.json`, which the watcher would otherwise see as a local change and re-push. Guarded with a `writingLocally` flag in `src/extension.ts` that the watcher checks before scheduling a sync.
- Polling interval (60s) and debounce (500ms) are hardcoded constants, not user-configurable — consistent with the "no config, plug and play" goal, at the cost of no way to tune them without editing the code.
