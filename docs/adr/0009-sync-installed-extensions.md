---
title: "ADR 0009: Sync installed extensions (full mirror, silent install)"
---

# 0009: Sync installed extensions (full mirror, silent install)

**Status:** Accepted (2026-09-24)

## Context

[0002](./0002-settings-json-only-scope.html) deliberately limited v1 to `settings.json` only, noting the extensions list as a likely later extension of scope. Adding it raises two independent questions that `settings.json` never had to answer, because installing/uninstalling an extension executes arbitrary third-party code — a JSON value doesn't:

1. **Should an uninstall on one machine propagate to others?** Mirroring `settings.json`'s last-write-wins exactly means an uninstall is just as "authoritative" as an install. The alternative, add-only, never removes something a user might be relying on, at the cost of being asymmetric with how settings.json already behaves.
2. **Should a machine install what it's missing silently, or ask first?** Silent matches the project's existing "auto sync, always on, zero-touch" philosophy ([0001](./0001-github-built-in-authentication.html), [0004](./0004-watch-and-poll-for-two-way-sync.html), [0005](./0005-zero-config-gist-discovery.html)). Asking first means nothing ever installs without a click, which matters specifically because a compromised or shared GitHub account could otherwise push and silently run arbitrary code on every linked machine.

Both were put to the user explicitly, flagging the security trade-off in (2), rather than assumed.

## Decision

**Full mirror, silent install.** Both the more automatic option, consistent with how every other sync decision in this project has gone. The entire non-builtin installed-extensions list (not a specially-tracked subset) is the syncable state, treated exactly like `settings.json`: last-write-wins by timestamp ([0003](./0003-last-write-wins-conflict-resolution.html)), sharing the same gist and the same watch-and-poll triggers ([0004](./0004-watch-and-poll-for-two-way-sync.html)).

Implementation:

- A second file, `vscodium-sync-extensions.json`, in the same gist as `vscodium-sync-settings.json`. `src/github/client.ts` fetches and patches both files together.
- `src/sync/extensions.ts` — a pure `computeExtensionDiff(currentContent, targetContent)` — decides what to install/uninstall by set difference. No merge semantics beyond that: the target list simply replaces the current one.
- `src/extension.ts` applies the diff via the documented `workbench.extensions.installExtension` / `workbench.extensions.uninstallExtension` commands, with per-extension try/catch so one failure doesn't block the rest, and logs every install/uninstall attempt and failure.
- Built-in extensions are excluded from the synced list (via `packageJSON.isBuiltin`, an undocumented-but-real runtime property) so the sync can never touch what ships with the editor.
- A notification fires only when the applied diff is non-empty ("installed N, uninstalled M"), with a "Show Log" action for detail — no per-extension confirmation prompt, per the silent-install decision.

## Consequences

- **Accepted risk:** because installs are silent and mirroring is full, anyone with write access to the linked GitHub account's gist (the account itself being compromised, or deliberately shared) can cause arbitrary extensions to be installed — and therefore arbitrary code to run — on every machine synced to it, and can uninstall extensions a user is relying on, without any local confirmation. This is a materially different risk than `settings.json` sync, which can at most corrupt configuration.
- An extension installed manually for local experimentation becomes part of the synced state the next time anything syncs — there's no "don't sync this one" escape hatch. This mirrors VS Code's own built-in Settings Sync behaviour for extensions, which is a familiar surprise to people coming from it, not a novel one.
- Because both `settings.json` and the extensions list share one gist, the gist's single `updated_at` timestamp doesn't distinguish which file actually changed — `src/sync/engine.ts` guards this with a content-equality check before treating a decided push/pull as real, so an unrelated change to one file doesn't spuriously re-push or notify about the other. (Caught by a failing test while building this — see `src/sync/engine.test.ts`.)
- Extension state (`extensionsLastSyncedAtMs`) is tracked independently from settings state, both compared against the one shared remote timestamp; a gist that predates this ADR (has `vscodium-sync-settings.json` but no `vscodium-sync-extensions.json`) gets the extensions file seeded from local content on first contact rather than treated as a conflict.
