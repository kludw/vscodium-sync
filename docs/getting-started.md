---
title: Getting Started
---

# Getting Started

## Prerequisites

- [Bun](https://bun.com) 1.4+ (this project uses Bun as the package manager, test runner, and bundler — not Node/npm)
- VSCodium (or VS Code) `^1.85.0`
- A GitHub account

## Install dependencies

```sh
bun install
```

## Build the extension

```sh
bun run build
```

This bundles `src/extension.ts` into `dist/extension.js` (the entry point declared in `package.json#main`), targeting Node with `vscode` left external.

## Run it

There's no packaged `.vsix` release yet. To try it locally, open this folder in VSCodium/VS Code and launch the Extension Development Host (`F5`, or `Run > Start Debugging`) — a `.vscode/launch.json` is already set up for this.

On activation the extension will:

1. Prompt you to sign in to GitHub (via VS Code's built-in GitHub auth provider, scoped to `gist`). This is a native VS Code sign-in flow — no token to paste in, nothing to configure.
2. Look for an existing gist tagged as this extension's sync target. If one exists (e.g. you set this up on another machine already), it adopts it and pulls your settings. If not, it creates a new private gist from your current `settings.json`.
3. Start watching your local `settings.json` for changes and polling the gist every 60 seconds — see [Usage](./usage.html) for the full behaviour.

## Everyday commands

```sh
bun test              # run the test suite
bun test --coverage   # same, with a coverage table
bun run check          # lint (biome check .)
bun run format          # auto-format (biome format --write .)
bun run build          # bundle to dist/extension.js
bun run clean          # remove dist/ and node_modules/
```

A Husky `pre-commit` hook runs `biome check --write .` and re-stages any changes automatically, so committed code is always formatted and lint-clean.

## Where to go next

- [Usage](./usage.html) — what you'll actually see day to day
- [Architecture](./architecture.html) — how the sync engine and auth are wired together
