---
title: Testing
---

# Testing

## Running the suite

```sh
bun test              # run everything
bun test --coverage   # with a per-file coverage table
```

As of this writing: **19 tests, 41 assertions, across 4 files** — `github/client.test.ts`, `sync/conflict.test.ts`, `sync/engine.test.ts`, `settings/path.test.ts` — all passing, with **100% function and line coverage** on the four modules they cover. Run `bun test --coverage` yourself for current numbers; this snapshot will drift as the code grows.

## What's tested, and what isn't

The codebase is deliberately split so that everything with real branching logic is pure TypeScript, and everything that talks to `vscode` is a thin pass-through. See [Architecture](./architecture.html#module-map) for the file layout this produces.

**Unit tested (the pure core):**

- `src/sync/conflict.ts` — every branch of the last-write-wins decision (`none` / `push` / `pull`, plus the tie-break case).
- `src/sync/engine.ts` — the full sync orchestration: linking a new gist by discovery vs. creation, and steady-state push/pull/none, with `global.fetch` mocked (via `bun:test`'s `spyOn`) and every collaborator (`store`, `readLocal`, `writeLocal`, `getLocalMtimeMs`) injected as a fake.
- `src/github/client.ts` — every gist API call (`findSyncGist`, `createSyncGist`, `getGist`, `updateSyncGist`), including the non-2xx error path, against a mocked `fetch`.
- `src/settings/path.ts` — path resolution for `darwin`, `win32`, and the Linux/XDG fallback.

**Not unit tested (the vscode glue):** `src/extension.ts` and everything in `src/status/` (`statusBar.ts`, `menu.ts`, `notifications.ts`). These call `vscode.window`, `vscode.authentication`, `vscode.commands`, etc., which only exist inside a real (or `@vscode/test-electron`-simulated) extension host — running them requires infrastructure this project doesn't currently have. They're kept intentionally small and declarative (wire callbacks together, format a string, call one `vscode.*` API) specifically so that the risk of leaving them untested stays low — any logic with a decision to get wrong (conflict resolution, gist discovery, path resolution) lives in the tested core instead.

Practically: these files are verified by building (`bun run build`) and running the extension for real in a VSCodium Extension Development Host (see [Getting Started](./getting-started.html#run-it)), not by an automated suite.

## TDD workflow

Per the project's working agreement (`CLAUDE.md`), new logic in the pure core is written red → green → refactor: a failing test first, then the minimum implementation to pass it. When extending `sync/engine.ts`, `sync/conflict.ts`, `github/client.ts`, or `settings/path.ts`, follow the same loop rather than writing the implementation first.

## Type checking and linting

These aren't "tests" but are run alongside them as the full verification pass:

```sh
bun run check        # biome check . — lint + format check
bun run typecheck    # tsc --noEmit
```
