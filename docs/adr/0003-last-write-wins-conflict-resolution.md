---
title: "ADR 0003: Last-write-wins conflict resolution by timestamp"
---

# 0003: Last-write-wins conflict resolution by timestamp

**Status:** Accepted (2026-09-24)

## Context

Two-way sync can hit a genuine conflict: both the local `settings.json` and the gist changed since the last successful sync. Two realistic strategies:

1. **Last-write-wins** — compare local file mtime against the gist's `updated_at`, and let whichever is newer overwrite the other. No UI, no blocking.
2. **Prompt the user** — show a diff and let them choose which side wins.

## Decision

Last-write-wins, implemented as the pure function `decideSyncAction(localMtimeMs, remoteUpdatedAtMs, lastSyncedAtMs)` in `src/sync/conflict.ts`. An exact timestamp tie favours local. This was the user's explicit choice over the prompt-based option.

## Consequences

- Fits the "plug and play, auto sync always on" goal — sync never blocks waiting on a decision.
- The losing side is silently overwritten. There's no merge and no built-in undo; the only after-the-fact visibility is the "View Diff" notification action (see `docs/usage.md#notifications`), which shows what changed but doesn't let you reject it.
- A genuinely concurrent edit (both sides changed within the same sync window) can lose the older one even if it was made in good faith — accepted as a known trade-off, documented in `docs/usage.md#conflict-resolution`.
- Because the decision is a pure function with no `vscode`/`fs` dependency, every branch (`none`/`push`/`pull`, plus the tie-break) is unit tested with 100% coverage.
