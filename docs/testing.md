---
title: Testing
---

# Testing

## Running the suite

```sh
bun test              # run everything
bun test --coverage   # with a per-file coverage table
```

As of this writing: **38 tests, 95 assertions, across 6 files** — `github/client.test.ts`, `sync/conflict.test.ts`, `sync/engine.test.ts`, `sync/extensions.test.ts`, `settings/path.test.ts`, `settings/sortJson.test.ts` — all passing, with **100% function and line coverage** on the modules they cover. Run `bun test --coverage` yourself for current numbers; this snapshot will drift as the code grows.

## What's tested, and what isn't

The codebase is deliberately split so that everything with real branching logic is pure TypeScript, and everything that talks to `vscode` is a thin pass-through. See [Architecture](./architecture.html#module-map) for the file layout this produces.

**Unit tested (the pure core):**

- `src/sync/conflict.ts` — every branch of the last-write-wins decision (`none` / `push` / `pull`, plus the tie-break case).
- `src/sync/engine.ts` — the full two-item sync orchestration: linking a new gist by discovery vs. creation, seeding an extensions file onto a gist that predates it, steady-state push/pull/none for settings and extensions independently, the content-equality guard that prevents the shared gist timestamp from causing a spurious push or pull, and re-linking when a previously-linked gist 404s versus re-throwing any other error — with `global.fetch` mocked (via `bun:test`'s `spyOn`) and every collaborator injected as a fake.
- `src/sync/extensions.ts` — `computeExtensionDiff`'s install/uninstall set difference, including empty-diff and missing-target cases.
- `src/github/client.ts` — every gist API call (`findSyncGist`, `createSyncGist`, `getGist`, `updateSyncGist`) across both synced files, including the non-2xx error path, against a mocked `fetch`.
- `src/settings/path.ts` — path resolution for `darwin`, `win32`, and the Linux/XDG fallback.
- `src/settings/sortJson.ts` — recursive key sorting, arrays left in place, and the parse-failure fallback that leaves unparsable content (e.g. JSONC comments) untouched.

**Not unit tested (the vscode glue):** `src/extension.ts` and everything in `src/status/` (`statusBar.ts`, `menu.ts`, `notifications.ts`). These call `vscode.window`, `vscode.authentication`, `vscode.commands`, etc., which only exist inside a real (or `@vscode/test-electron`-simulated) extension host — running them requires infrastructure this project doesn't currently have. They're kept intentionally small and declarative (wire callbacks together, format a string, call one `vscode.*` API) specifically so that the risk of leaving them untested stays low — any logic with a decision to get wrong (conflict resolution, gist discovery, path resolution, extension diffing) lives in the tested core instead. This includes the actual `workbench.extensions.installExtension`/`uninstallExtension` calls — what gets installed/uninstalled is decided by the tested `computeExtensionDiff`; only the mechanical act of calling the command is untested.

Practically: these files are verified by building (`bun run build`) and running the extension for real in a VSCodium Extension Development Host (see [Getting Started](./getting-started.html#run-it)), not by an automated suite.

## TDD workflow

Per the project's working agreement (`CLAUDE.md`), new logic in the pure core is written red → green → refactor: a failing test first, then the minimum implementation to pass it. When extending `sync/engine.ts`, `sync/conflict.ts`, `sync/extensions.ts`, `github/client.ts`, `settings/path.ts`, or `settings/sortJson.ts`, follow the same loop rather than writing the implementation first. This loop is what caught the shared-gist-timestamp bug mentioned above: a test asserted settings shouldn't be touched when only extensions changed remotely, the (initially over-simple) engine implementation failed it, and the content-equality guard was added specifically to make it pass — not designed upfront.

## Type checking and linting

These aren't "tests" but are run alongside them as the full verification pass:

```sh
bun run check        # biome check . — lint + format check
bun run typecheck    # tsc --noEmit
```
