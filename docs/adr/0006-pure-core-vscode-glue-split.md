---
title: "ADR 0006: Separate pure sync core from VS Code glue, to drive the test boundary"
---

# 0006: Separate pure sync core from VS Code glue, to drive the test boundary

**Status:** Accepted (2026-09-24)

## Context

The working agreement (`CLAUDE.md`) requires TDD: red, green, refactor, no exceptions. But most of the code that matters here — conflict resolution, gist discovery, path resolution — is naturally entangled with `vscode` and `fs` APIs that only run inside a real (or heavily simulated) extension host, which this project has no infrastructure for.

## Decision

Draw the module boundary around that constraint rather than around "layers" in the abstract:

- `src/sync/conflict.ts`, `src/sync/engine.ts`, `src/github/client.ts`, `src/settings/path.ts` import neither `vscode` nor `fs`. Every effectful dependency (the GitHub token, a state store, `readLocal`/`writeLocal`/`getLocalMtimeMs`) is passed in as a plain function or object, so tests supply fakes and mock `fetch`.
- `src/extension.ts` and everything under `src/status/` (`statusBar.ts`, `menu.ts`, `notifications.ts`) call `vscode.*` directly, stay deliberately small and declarative (wire callbacks together, format a string, call one API), and are not unit tested.

## Consequences

- 100% function/line coverage on the four core modules, verified by `bun test --coverage` — every branch of the sync algorithm and conflict rule is actually exercised.
- The glue layer's correctness is verified only by building and running the extension for real in a VSCodium Extension Development Host, not by an automated suite — a real gap, but a deliberately bounded one: because that layer has almost no branching logic of its own, the risk of a silent bug hiding there is low.
- Any new logic with a decision to get wrong belongs in the pure core, written test-first — not in `extension.ts` or `status/*`. This is now a standing rule (see `docs/testing.md` and `CLAUDE.md`), not just how it happened to end up.
