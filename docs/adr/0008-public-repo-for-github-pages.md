---
title: "ADR 0008: Publish docs via GitHub Pages, making the repository public"
---

# 0008: Publish docs via GitHub Pages, making the repository public

**Status:** Accepted (2026-09-24)

## Context

The docs (`docs/`) needed to be viewable at a URL, specifically via GitHub Pages. The repository (`kludw/vscodium-sync`) was private at the time. GitHub Pages either isn't available at all for a private repo on the free plan, or, on a paid plan that does allow it, still publishes the resulting site publicly on the internet regardless of the source repo's visibility — there's no "private Pages, private repo" combination on a standard personal account.

Three options were presented: keep the repo private and just browse `docs/*.md` on github.com (no exposure change, no real Pages site); enable Pages on the private repo assuming a paid plan; or make the repo public and enable Pages normally.

## Decision

Make the repository public, then enable GitHub Pages sourced from `docs/` on `master`. The user's explicit choice.

## Consequences

- The source code is now public, not just the documentation — this is a repository-wide visibility change, not a docs-only toggle.
- The docs site is live at <https://kludw.github.io/vscodium-sync/>, built by GitHub's Jekyll pipeline with `jekyll-theme-minimal`.
- Every page under `docs/` needs YAML front matter to be picked up by Jekyll at all, and internal links between docs pages use `.html` (Jekyll's default output extension) rather than `.md` — codified as an ongoing rule in `CLAUDE.md` for anyone adding a new page. Links from `README.md` into `docs/` keep the `.md` extension, since those are read via GitHub's own blob viewer (outside the Pages build), not the published site.
