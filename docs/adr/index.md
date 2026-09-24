---
title: Architecture Decisions
---

# Architecture Decision Records

An ADR records one significant architecture decision: the context that forced it, what was decided, and the consequences (including the trade-offs accepted, not just the upsides). They're written once and not rewritten as opinions change — if a decision is later reversed, a new ADR supersedes it rather than editing the old one.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](./0001-github-built-in-authentication.html) | Use VS Code's built-in GitHub authentication provider | Accepted |
| [0002](./0002-settings-json-only-scope.html) | Limit v1 sync scope to `settings.json` only | Accepted |
| [0003](./0003-last-write-wins-conflict-resolution.html) | Last-write-wins conflict resolution by timestamp | Accepted |
| [0004](./0004-watch-and-poll-for-two-way-sync.html) | Watch local file + poll gist for continuous two-way sync | Accepted |
| [0005](./0005-zero-config-gist-discovery.html) | Zero-config gist discovery by marker filename | Accepted |
| [0006](./0006-pure-core-vscode-glue-split.html) | Separate pure sync core from VS Code glue, to drive the test boundary | Accepted |
| [0007](./0007-status-bar-menu-over-webview.html) | Status bar item + quick-pick menu instead of a custom webview panel | Accepted |
| [0008](./0008-public-repo-for-github-pages.html) | Publish docs via GitHub Pages, making the repository public | Accepted |

## When to add one

Per `CLAUDE.md`: a new ADR is warranted for a decision with real alternatives and a consequence someone could get burned by later — an auth method, the sync/conflict strategy, a scope boundary, a major dependency, or a UI approach with a real alternative considered. Not for routine implementation choices with no meaningful alternative.

## Format

Each ADR is numbered sequentially (`NNNN-kebab-title.md`) and has four sections: **Status**, **Context**, **Decision**, **Consequences** — the lightweight format popularised by Michael Nygard, not the more elaborate MADR template.
