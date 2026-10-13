---
name: vscode-extension
description: VS Code / VSCodium extension API reference for this project. Use whenever writing extension code (anything importing "vscode"), editing package.json manifest fields (contributes, activationEvents, engines, main), choosing activation events, running/debugging the Extension Development Host, testing, packaging (.vsix), or publishing (Open VSX).
---

# VS Code Extension API (https://code.visualstudio.com/api)

Target editor is **VSCodium** (VS Code build without Microsoft branding/telemetry). Extension API is identical to VS Code at the same version; marketplace is not.

Do not rely on your training data, APIs and manifest fields change every release. Before using any `vscode.*` API, contribution point, activation event, or manifest field not listed below: find the page in https://code.visualstudio.com/llms.txt (section "Extension API"), fetch its `.md` (append `.md` to the URL, e.g. `https://code.visualstudio.com/api/references/activation-events.md`), follow it. Unsure + no doc found = ask me.

## Docs index (all fetchable as `.md`)

1. API reference (every namespace/class): `https://code.visualstudio.com/api/references/vscode-api.md`
2. Manifest (`package.json`) fields: `https://code.visualstudio.com/api/references/extension-manifest.md`
3. Contribution points (`contributes.*`): `https://code.visualstudio.com/api/references/contribution-points.md`
4. Activation events: `https://code.visualstudio.com/api/references/activation-events.md`
5. Built-in commands: `https://code.visualstudio.com/api/references/commands.md`
6. Theme colors / icons: `https://code.visualstudio.com/api/references/theme-color.md`, `.../api/references/icons-in-labels.md`
7. Guides (commands, webviews, tree views, LSP, ...): `https://code.visualstudio.com/api/extension-guides/overview.md`
8. UX guidelines: `https://code.visualstudio.com/api/ux-guidelines/overview.md`
9. Testing: `https://code.visualstudio.com/api/working-with-extensions/testing-extension.md`
10. Samples: https://github.com/microsoft/vscode-extension-samples
11. VSCodium extensions/marketplace: `https://raw.githubusercontent.com/VSCodium/vscodium/master/docs/extensions.md`
12. Open VSX publishing: `https://raw.githubusercontent.com/wiki/eclipse/openvsx/Publishing-Extensions.md`

## Project setup (verified)

1. Entry: `src/extension.ts`, exports `activate(context)` / `deactivate()`. Push every disposable to `context.subscriptions`.
2. Build: `bun run build` (dev: sourcemap) / `bun run build:prod` (typecheck, clean `dist`, `--production` = minified, no sourcemap) → `dist/extension.js` (CJS, `--target node`, `vscode` external; VS Code injects `vscode` at runtime, never bundle it). Mirrors the esbuild setup in `https://code.visualstudio.com/api/working-with-extensions/bundling-extension.md`.
3. Types: `@types/vscode` pinned `~X.Y.0` matching `engines.vscode: ^X.Y.0`. Bump both together, never types above engines. Not every version has a types release (e.g. no 1.135): then use the highest types version below engines. Using a newer API = bump both.
4. Run/debug: F5 ("Run Extension" in `.vscode/launch.json`) builds then opens an Extension Development Host window.
5. Logs: Extension Development Host → Output panel → "Extension Host"; or `~/Library/Application Support/VSCodium/logs/<session>/window*/exthost/exthost.log`. Activation shows as `ExtensionService#_doActivateExtension kludw.vscodium-sync`.

## Gotchas

1. Activation is lazy. Commands in `contributes.commands` auto-activate on invoke (since 1.74, no `onCommand:` needed). Code that must run without user action needs an explicit event (`onStartupFinished` preferred over `*`).
2. Command IDs must match exactly between `contributes.commands[].command` and `registerCommand(...)`.
3. Proposed APIs (`enabledApiProposals`) don't work in published extensions. Don't use them.

## Packaging & publishing

1. Package: `bun run package` (`bunx @vscode/vsce package --no-dependencies`; deps are bundled, so `--no-dependencies`). vsce runs `vscode:prepublish` → `build:prod` automatically. `.vscodeignore` whitelists `dist/` + manifest.
2. VSCodium uses **Open VSX**, not the Microsoft Marketplace. Publish with `bunx ovsx publish <file.vsix> -p <token>`; namespace = `publisher` field, created once via `bunx ovsx create-namespace <publisher> -p <token>`.
3. Publishing is outward-facing: confirm with me before running it.
