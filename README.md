# VSCodium Sync

Two-way sync of your VSCodium `settings.json`, `keybindings.json`, and installed extensions through a private GitHub gist. Auto sync is always on, and there's nothing to configure: install, sign in to GitHub once, done.

## Quick start

```sh
bun install
bun run build   # bundles src/extension.ts -> dist/extension.js
```

Then open this folder in VSCodium and press `F5` to launch an Extension Development Host — see [Getting Started](docs/getting-started.md) for the full walkthrough.

## Documentation

Published at **[kludw.github.io/vscodium-sync](https://kludw.github.io/vscodium-sync/)**, or browse the source in [`docs/`](docs/index.md):

- [Getting Started](docs/getting-started.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Testing](docs/testing.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Architecture Decisions (ADRs)](docs/adr/index.md)
- [Changelog](CHANGELOG.md)

## Development

```sh
bun test              # run the test suite (43 tests, 100% coverage on the pure core)
bun run check          # lint (biome)
bun run typecheck       # tsc --noEmit
bun run format           # auto-format
```

See [Testing](docs/testing.md) for what's covered and why, and `CLAUDE.md` for the working agreement this project follows (TDD, Clean code rules, communication style).
