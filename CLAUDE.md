# Working agreement

## Bun

This is not the bun you know, API might have changed since your training. Refer to docs at https://bun.com/docs.

## Communication

1. Don't assume. Surface confusion and tradeoffs immediately.
2. Be extremely concise. Sacrifice grammar for concision.
3. Push back when you disagree. Don't defer reflexively.
4. When blocked, stop and ask. Don't guess forward.

## Code

1. Minimum code that solves the problem. Nothing speculative.
2. Tests and logging needed for verification are not speculative.
3. Match existing style over "best practice."
4. Simplicity and clarity over cleverness.
5. Development done using TDD -> red -> green -> refactor. No exceptions unless user specifically says so.
6. Follow Clean (see below).

## Clean

1. Single-responsibility per function. Top-level orchestrates; helpers do the work.
2. Names describe purpose. No `temp`, `data2`, vague verbs. Rename when meaning shifts.
3. Extract focused helpers when logic has a name or repeats. One concept = one function.
4. Flatten nesting. Errors first, early `continue`/`return`, happy path falls through.

## Docs

Docs live in `docs/` (`docs/index.md` is the entry point), plain Markdown meant to be dropped into a doc-site generator as-is. `README.md` is the GitHub-facing landing page and links into `docs/`.

1. Behaviour changes (sync triggers, conflict rule, notifications, UI, auth) → update the matching page in `docs/`, same PR.
2. New module or moved file → update `docs/architecture.md`'s module map.
3. New/changed script → update `docs/getting-started.md` and `docs/testing.md`.
4. Docs describe current behaviour only. No speculative/planned-feature sections.
5. British English spelling throughout (`-ise` not `-ize`, `colour`/`behaviour`/`favour`, etc.).