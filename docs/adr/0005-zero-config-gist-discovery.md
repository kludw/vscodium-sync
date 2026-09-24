---
title: "ADR 0005: Zero-config gist discovery by marker filename"
---

# 0005: Zero-config gist discovery by marker filename

**Status:** Accepted (2026-09-24)

## Context

Multi-machine sync requires every machine to sync against the *same* gist. The obvious naive approach — create a gist on the first machine, have the user copy its ID into a setting on every other machine — works but breaks the "plug and play" goal: it's a manual step, and getting it wrong (typo, wrong gist) silently creates a second, disconnected gist.

## Decision

Tag the sync gist with a fixed, distinctive file name inside it, `vscodium-sync-settings.json` (`GIST_FILENAME` in `src/github/client.ts`). On first run with no gist linked yet, `findSyncGist` searches the signed-in GitHub account's own gists for one containing that file name:

- **Found** → adopt it, pull its content (`init-pull`).
- **Not found** → create a new private gist containing that file, seeded from local `settings.json` (`init-push`).

## Consequences

- True zero-config pairing: linking a second machine requires nothing but signing in to the same GitHub account. No ID to copy, no setting to paste it into.
- Only works within one GitHub account — two machines signed in to different accounts will each create their own gist rather than share one (documented in `docs/troubleshooting.md`).
- `findSyncGist` lists only the first 100 gists (`GET /gists?per_page=100`, one page) — a known simplification; an account with more than 100 gists where the sync gist isn't among the most recent 100 wouldn't be found. Not addressed, since the target use case (a personal dev machine's own gists) makes this unlikely in practice.
