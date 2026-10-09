# PROGRESS · Slide Builder 4 rebuild

Tracks [`docs/next/PLAN.md`](docs/next/PLAN.md) Part C. One line per step; a step is ticked only after the
double-check protocol of [`docs/next/PROMPTS.md`](docs/next/PROMPTS.md) (tests, clean clone, review,
numbers measured twice). Measured numbers go into the step's line.

## Steps

### M0 · Foundations on v3 (v3.4)
- [x] S0.1 · CI, PROGRESS.md, one check command — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `npm run check`; `.github/workflows/ci.yml` (unit, helper 3.8 + 3.12, e2e, and parity from S0.5). Baseline 114 Vitest / 131 helper / 15 e2e. Surprises: Chrome's sandbox needs `kernel.apparmor_restrict_unprivileged_userns=0` on ubuntu-24.04; runners pinned to ubuntu-24.04 (26.04 has no Python 3.8); the helper listened with a backlog of 5, so a burst of requests waited 1 s for a TCP retry (now 128, with a test); an intermittent CI e2e failure (see Waiting for). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.2 · Release pipeline — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `tools/make_release.py` (reproducible ZIP + MANIFEST.json, `--verify`, `--notes`), `release.yml` on `v*`. The test tag is for a person (Waiting for). verified: tests ✓ clean clone ✓ review ✓
- [ ] S0.3 · Side-by-side installs, current.json, Edge app window
- [ ] S0.4 · v3 quick fixes found in the review
- [ ] S0.5 · Capture v3 as golden data
- [ ] S0.6 · Field tests on the real environment
- [ ] S0.7 · Ship v3.4

### M1 · The React app (v3.5)
- [ ] S1.1 · React API on the Preact runtime
- [ ] S1.2 · Repository layout
- [ ] S1.3 · Store with selectors replaces the global S
- [ ] S1.4 · Switch to real React 19
- [ ] S1.5 · Ship v3.5

### M2 · The core in workers (v3.6)
- [ ] S2.1 · Move pure code into core/
- [ ] S2.2 · XML tokenizer instead of DOMParser
- [ ] S2.3 · Columnar SheetStore and byte scanner
- [ ] S2.4 · Core worker, typed RPC, the document moves into the worker
- [ ] S2.5 · Wizard and formula bar read cells through the worker
- [ ] S2.6 · Smoothness gate for opening
- [ ] S2.7 · Ship v3.6

### M3 · Display list and native export (v3.7)
- [ ] S3.1 · Display list, PDF writer, test tools
- [ ] S3.2 · Fonts and text shaping
- [ ] S3.3 · Excel and Excel Refined → display list
- [ ] S3.4 · Liquid Glass → display list
- [ ] S3.5 · Slide furniture → display list
- [ ] S3.6 · Pixel review
- [ ] S3.7 · Native export, in workers
- [ ] S3.8 · Pilot of the export
- [ ] S3.9 · Ship v3.7

### M4 · The screen draws the display list (v3.8)
- [ ] S4.1 · React stage on SVG
- [ ] S4.2 · Smooth drags
- [ ] S4.3 · Thumbnails as bitmaps
- [ ] S4.4 · Measurement from font files; screen = PDF
- [ ] S4.5 · Delete the old renderer and the export engine
- [ ] S4.6 · Ship v3.8

### M5 · Storage v4 and cut-over (v4.0)
- [ ] S5.1 · Helper: decks
- [ ] S5.2 · Core: fold, Lamport, DocSync v4
- [ ] S5.3 · Migration, freeze, rollback
- [ ] S5.4 · Load tests
- [ ] S5.5 · Delete the v3 storage path
- [ ] S5.6 · Pilot on a copy
- [ ] S5.7 · Cut-over

### M6 · Hardening (v4.1)
- [ ] S6.1 · Native .xlsb reader
- [ ] S6.2 · Shared parsed-sheet cache
- [ ] S6.3 · ReadDirectoryChangesW wake-up hint
- [ ] S6.4 · Documentation (README and ARCHITECTURE for v4)
- [ ] S6.5 · Remove the v3 start file

## Decisions

(Human decisions the plan needs, e.g. gate G0 outcomes. An agent never writes here on its own.)

## Waiting for

- **CI e2e, intermittent (S0.1):** `e2e/app.spec.ts:471` (notes section) failed in 2 of about 12 CI runs before S0.4 (save stayed "Unsaved changes…"; never reproduced locally in 9 runs, CI uses Chromium 153, local 141). A likely cause was fixed (the helper's listen backlog, 1 s TCP retries under request bursts). If it fails again, the helper logs are now in the CI output: please look at that run with me.
- **Test the release pipeline (S0.2, a person):** after merging, `git tag v3.4.0-rc1 && git push origin v3.4.0-rc1`; check the GitHub release has `slidebuilder-3.4.0-rc1.zip` + `.sha256` and that `python tools/make_release.py --verify slidebuilder-3.4.0-rc1.zip` says OK; then delete the pre-release and the tag.

## Measurements

| Step | What | Run 1 | Run 2 |
|---|---|---|---|
| S0.1 | e2e suite, local (15 tests) | 4.2 min | 4.1 min |
| S0.2 | release ZIP 3.4.0 | 803 103 bytes, 35 files, sha256 6ee579c4… | identical bytes on a second build |
