---
title: "ADR 0001: Use VS Code's built-in GitHub authentication provider"
---

# 0001: Use VS Code's built-in GitHub authentication provider

**Status:** Accepted (2026-09-24)

## Context

The extension needs a GitHub-authenticated token with `gist` scope to read and write the sync gist. Three ways to get one:

1. **Personal Access Token** — user pastes a PAT into a prompt, stored in VS Code `SecretStorage`. No OAuth app to register; works identically on VSCodium and VS Code.
2. **OAuth device-flow login** — nicer UX than pasting a token, but requires registering a GitHub OAuth App and shipping its client ID with the extension, and VSCodium may not ship an equivalent built-in flow.
3. **VS Code's built-in GitHub authentication provider** (`vscode.authentication.getSession("github", ["gist"], { createIfNone: true })`) — the same account-picker flow VS Code's own GitHub-integrated features use.

## Decision

Use option 3, the built-in provider. This was the user's explicit choice over the initially-proposed PAT approach.

The provider is contributed by the `vscode.github-authentication` extension, which is MIT-licensed and included in VSCodium's own build (unlike Microsoft's proprietary extensions, which VSCodium excludes) — so it works the same way in both VSCodium and VS Code. It's declared as an `extensionDependency` in `package.json` to guarantee it's present.

## Consequences

- Zero-config sign-in: no token to generate, copy, or paste; VS Code's native account UI handles it.
- No OAuth app to register or maintain, unlike the device-flow alternative.
- Hard dependency on `vscode.github-authentication` being available — true for VSCodium and VS Code, but would need reconsidering for any other `vscode`-API-compatible editor that doesn't ship it.
- The token is scoped to `gist` only, via the `createIfNone` session request — the extension never sees or requests broader GitHub access.
