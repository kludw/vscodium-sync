---
title: "ADR 0010: Auto-recover by re-linking when the linked gist is gone"
---

# 0010: Auto-recover by re-linking when the linked gist is gone

**Status:** Accepted (2026-09-24)

## Context

`state.gistId` is the one piece of state that makes every subsequent sync skip discovery ([0005](./0005-zero-config-gist-discovery.html)) and go straight to fetching that specific gist. If that gist stops existing — deleted by hand on GitHub, or the signed-in GitHub account changed since it was linked — `GET /gists/{id}` returns `404`, and before this decision, that 404 simply propagated: every sync attempt failed the same way, forever, with no code path that noticed the gist was gone and did anything about it. The only documented fix was clearing this machine's extension storage by hand (see `docs/troubleshooting.md`).

Two ways to handle it: (a) keep failing loudly until someone manually resets, which is honest about something being wrong but leaves the extension permanently broken with no self-service fix; (b) treat a 404 specifically as "no gist linked" and re-run the same find-or-create flow a fresh install would.

## Decision

(b). `performSync` in `src/sync/engine.ts` now catches a `GitHubApiError` with `status === 404` from the steady-state `getGist` call and falls through to `linkGist(deps)` — the exact same discovery/creation path used when `state.gistId` is unset. `github/client.ts` gained a typed `GitHubApiError` (carrying `status`) specifically so this can be distinguished from other failures — a network error, a 5xx, or an auth problem still propagates and shows the existing error notification rather than silently re-linking.

## Consequences

- Self-heals: deleting the gist (as happened in practice — see the conversation this ADR came from) no longer leaves sync permanently broken. The next sync just creates a fresh gist (or adopts another marker gist under the same account, if one exists) and carries on.
- The old gist's history is gone for good once this happens — a fresh gist starts with whatever `settings.json` and the installed-extensions list currently are, not the old gist's content. There's no way to recover what was in the deleted gist through this extension.
- Only a `404` triggers recovery. A transient network failure or a 5xx from GitHub still surfaces as a normal sync failure (logged, status bar error, error notification) rather than being treated as "go make a new gist" — re-linking on anything other than a confirmed "this specific gist doesn't exist" would risk spawning duplicate gists on a flaky connection.
- This only handles the gist itself disappearing. It doesn't address the account-mismatch case specifically (a 404 there looks identical to a deletion) — if the wrong account is signed in, this will recover by creating a *new* gist under that account rather than surfacing "wrong account," which could be confusing. Not solved here.
