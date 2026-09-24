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

Docs live in `docs/` (`docs/index.md` is the entry point) and are published live via GitHub Pages (Jekyll, `jekyll-theme-midnight`) at https://kludw.github.io/vscodium-sync/. `README.md` is the GitHub-facing landing page and links into `docs/`. `CHANGELOG.md` (root, Keep a Changelog format) is the version list. `docs/adr/` holds Architecture Decision Records.

1. Behaviour changes (sync triggers, conflict rule, notifications, UI, auth) → update the matching page in `docs/`, same PR, plus a `CHANGELOG.md` entry under `[Unreleased]`.
2. New module or moved file → update `docs/architecture.md`'s module map.
3. New/changed script → update `docs/getting-started.md` and `docs/testing.md`.
4. Docs describe current behaviour only. No speculative/planned-feature sections.
5. British English spelling throughout (`-ise` not `-ize`, `colour`/`behaviour`/`favour`, etc.).
6. New page in `docs/`: add YAML front matter (`title:`) and link to it with `.html`, not `.md` — Jekyll needs front matter to render a page at all, and outputs `.html`. Links from `README.md` into `docs/` stay `.md` (GitHub renders those directly).
7. A decision with real alternatives and a consequence someone could get burned by later (auth method, sync/conflict strategy, scope boundary, major dependency, a UI approach with a real alternative considered) → add an ADR in `docs/adr/`, next sequential number (`NNNN-kebab-title.md`), and add it to `docs/adr/index.md`'s table. Status/Context/Decision/Consequences, per the existing ADRs — not the fuller MADR template. Routine implementation choices with no real alternative don't need one.
8. When work changes what an existing ADR says (reverses the decision, or a consequence it predicted turns out wrong) → don't rewrite that ADR's Context/Decision/Consequences. Add a new ADR recording the change, then go back and update the old ADR's Status line to `Superseded by NNNN` (linked) and its row in `docs/adr/index.md`. An ADR is a record of what was decided and why at the time, not a living doc to edit in place.