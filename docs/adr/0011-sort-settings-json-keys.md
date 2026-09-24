---
title: "ADR 0011: Sort settings.json keys on both sides of the sync"
---

# 0011: Sort settings.json keys on both sides of the sync

**Status:** Accepted (2026-09-24)

## Context

Since [0001](./0001-github-built-in-authentication.html)/the original design, `settings.json` has been synced as an opaque string — pushed and pulled verbatim, whatever key order and formatting the user's editor happened to produce. That's what made "the gist is an exact mirror" true (see [Architecture: Where state lives](../architecture.html#where-state-lives)). In practice, that means the gist reads however VS Code/VSCodium happened to leave the keys — usually insertion order, not anything a person would choose, and unreadable when actually looking at the gist on GitHub.

Two ways to fix that:

1. **Leave it alone.** Simple, no risk, but the gist stays disorganised — the thing actually complained about.
2. **Sort object keys alphabetically before syncing**, recursively, using `JSON.parse` → sort → `JSON.stringify`.

Option 2 has two real costs, surfaced and accepted explicitly rather than assumed:

- **`JSON.parse` doesn't understand comments.** VS Code's `settings.json` is JSONC — it allows `// comments`. A plain `JSON.parse` throws on one. Sorting can't silently strip a comment; it fails to parse at all if one is present.
- **Consistency requirement.** Sorting only the content pushed to the gist, while leaving the local file's actual on-disk order untouched, would make every subsequent sync see local (unsorted) and remote (sorted) as different — a spurious diff notification and a pointless push/pull on every cycle. Sorting has to apply uniformly everywhere `settings.json` content is read for comparison, not just at push time.

## Decision

Sort recursively (object keys at every depth, array element order left untouched) via `sortJsonKeys()` in `src/settings/sortJson.ts` — a pure, tested function. If `JSON.parse` fails for any reason (comments, or genuinely invalid JSON), it returns the original content **unchanged** rather than throwing — a parse failure degrades to "don't sort this," not a broken sync.

Applied at every point `src/extension.ts` reads or writes `settings.json` content — the `readLocal`/`writeLocal` callbacks passed to `performSync`, and the separate before/after reads used for the diff notification — so local and remote are compared and stored in the same canonical form throughout, not just at the moment of pushing.

## Consequences

- The gist (and, going forward, the local file too, once a sync writes it) reads in a predictable, sorted order — the thing this was for.
- **If `settings.json` contains `// comments`, sorting silently does nothing** for that file — it keeps syncing as an unsorted, verbatim mirror, same as before this ADR, with no error and no notification that sorting didn't happen. This was accepted knowingly: the alternative (deleting comments) was worse, and failing the sync entirely over a formatting preference was worse still.
- The local `settings.json` file itself now gets reformatted (2-space indent, sorted keys) by this extension whenever it's involved in a sync that touches it — not just mirrored. `src/settings/sortJson.ts`'s output convention (2-space indent, trailing newline) may not match whatever indentation the user's editor otherwise uses; the extension doesn't try to match it.
- `docs/architecture.md`'s "exact mirror" description no longer holds literally for `settings.json` containing no comments — it's now a *canonicalised* mirror (semantically identical, not necessarily byte-identical to what the editor last wrote). It still holds for the *extensions* list, which was never subject to user-authored formatting in the first place.
