---
title: "ADR 0007: Status bar item + quick-pick menu instead of a custom webview panel"
---

# 0007: Status bar item + quick-pick menu instead of a custom webview panel

**Status:** Accepted (2026-09-24)

## Context

There was no way to see sync status, and the ask was for "a panel or something" showing status with a button to see the gist next to the settings. A custom webview panel (full HTML/CSS UI, message-passing bridge to the extension host) is the most flexible option but also by far the most code to build and maintain for what's fundamentally a small amount of state (syncing / synced / error) and a handful of actions.

## Decision

A native status bar item cycling through syncing/synced/error states, which opens a native `vscode.window.showQuickPick` menu on click: **Sync Now**, **Open Settings JSON**, **Open Gist on GitHub**, **Show Sync Log**. No custom webview.

## Consequences

- A fraction of the code a webview would need — no HTML/CSS to write, no `postMessage` bridge, no manual theme handling (native components already respect the user's theme and accessibility settings).
- Matches the UX pattern of VS Code's own built-in "Settings Sync" and similar extensions, so it's immediately familiar.
- Less flexible than a custom panel: no rich inline view (e.g. a history list or live diff embedded in the panel itself). "Open Gist on GitHub" covers that need by handing off to GitHub's own UI instead of rebuilding it.
- "Open Gist on GitHub" only appears once a gist is actually linked (`store.get().gistUrl` is set) — it's omitted from the menu on the very first, still-in-progress sync rather than shown disabled.
