# PROGRESS · Slide Builder 4 rebuild

Tracks [`docs/next/PLAN.md`](docs/next/PLAN.md) Part C. One line per step; a step is ticked only after the
double-check protocol of [`docs/next/PROMPTS.md`](docs/next/PROMPTS.md) (tests, clean clone, review,
numbers measured twice). Measured numbers go into the step's line.

## Steps

### M0 · Foundations on v3 (v3.4)
- [x] S0.1 · CI, PROGRESS.md, one check command — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `npm run check`; `.github/workflows/ci.yml` (unit, helper 3.8 + 3.12, e2e, and parity from S0.5). Baseline 114 Vitest / 131 helper / 15 e2e. Surprises: Chrome's sandbox needs `kernel.apparmor_restrict_unprivileged_userns=0` on ubuntu-24.04; runners pinned to ubuntu-24.04 (26.04 has no Python 3.8); the helper listened with a backlog of 5, so a burst of requests waited 1 s for a TCP retry (now 128, with a test); an intermittent CI e2e failure (see Waiting for). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.2 · Release pipeline — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `tools/make_release.py` (reproducible ZIP + MANIFEST.json, `--verify`, `--notes`), `release.yml` on `v*`. The test tag is for a person (Waiting for). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.3 · Side-by-side installs, current.json, Edge app window — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `update.py --release/--zip <file>/--use`, `--selftest`, Start file reads `app\current.json` with `python -c`, Edge `--app` (B12). Rehearsed on a copy of a share folder (install, flip, rollback, start, data untouched). Not run on real Windows cmd.exe/Edge (W5, W6 in field-results.md). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.4 · v3 quick fixes found in the review — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). B6 (save state notifies), B13 (`/api/files/<name>/stat`, list only on the Open menu), presence from one directory listing. Share operations per user per minute, idle: 910 → 78; editing: 1217 → 398 (Measurements). Side effect: the e2e suite runs in ~2 min instead of ~4 (no more waiting for the 3 s tick). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.5 · Capture v3 as golden data — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `tests/corpus/` (9 workbooks, 14 decks), `tools/capture-v3.mjs`, `tools/parity.mjs` + `npm run parity` + CI job, `tools/anonymise.py`; `golden/` 135 slides, 36 screenshots (a chosen set: tests/corpus/pixels.json). Parity on v3: 0 differences, twice. Geometry/pixels are compared only where Chromium and fonts equal the capture's; the hosted CI runner compares texts and styles. 5 real decks: Waiting for. verified: tests ✓ clean clone ✓ review ✓
- [ ] S0.6 · Field tests on the real environment — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). Kit done and tests ✓ clean clone ✓ review ✓: `tools/sharetest.py`, `tools/fieldcheck.html` (+ `GET /fieldcheck`), `docs/next/field-results.md`, `docs/next/field/acrobat-*.pdf`. **Not ticked: gate G0 is for people** (Waiting for). Found on this Linux container: a module-type Blob worker fails from file:// (classic ones pass).
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
- **5 real decks (S0.5, product owner):** 5 workbooks from the share with their saved decks (`backend\data\workbooks\<name>-<hash>.json`). They are anonymised with `python tools/anonymise.py REAL.xlsx tests/corpus/workbooks/realN.xlsx --deck <deck>.json --deck-out tests/corpus/decks/realN.json --rename "<bank>=Bank A" …` (which names must be renamed?), reviewed by you, then captured into `golden/`.
- **Gate G0 (S0.6, people on the real share and PCs)** - fill in `docs/next/field-results.md`:
  1. `tools/sharetest.py` from 3–5 PCs (one over VPN), 10 writers in total, `--rdcw` → **storage decision**: journals meet 05 §3.5, or `STORAGE=lean-lock` in M5 (ADR-006);
  2. `tools/fieldcheck.html` from file:// and from the helper on each PC (Blob workers, WASM, OffscreenCanvas, fonts from bytes);
  3. the Windows policy matrix W1–W14 (05 §3.7);
  4. Acrobat and Edge with `docs/next/field/acrobat-excel.pdf` / `acrobat-glass.pdf` → **Acrobat recipe** (soft masks or flattened gradients in S3.5);
  5. the font-licence question R7 (may Windows fonts be copied to the share?) → **font decision** for S3.2;
  6. ReadDirectoryChangesW result → whether S6.3 is done.
  Then write the decisions under "Decisions".

## Measurements

| Step | What | Run 1 | Run 2 |
|---|---|---|---|
| S0.1 | e2e suite, local (15 tests) | 4.2 min | 4.1 min |
| S0.2 | release ZIP 3.4.0 | 803 103 bytes, 35 files, sha256 6ee579c4… | identical bytes on a second build |
| S0.4 | share file operations per user per minute, 10 idle users, mixed decks, 20 more decks (`tools/loadtest.py --users 10 --scenario mixed --duration 60 --count-ops --extra-books 20 --idle`; before: `--client v3.3 --helper <b2166d3>/backend/slide_builder.py`) | 909.8 → 78.2 (data 637.9 → 65.5, workbook folder 271.9 → 12.7) | 917.5 → 77.2 |
| S0.4 | the same while everybody edits (no `--idle`) | 1217.4 → 397.2 | 1217.4 → 398.1 |
| S0.4 | e2e suite, local, after B6 | 1.8 min | 2.0 min |
| S0.5 | `npm run parity` on v3 (14 decks, 135 slides, full comparison) | 0 differences, 253 s | 0 differences, 262 s |
| S0.6 | `tools/sharetest.py local --workers 3 --duration 30` on a local disk (tool check, **not** a field result): journal save p50/p95, visible p50/p95 | 0.9/1.9 ms, 1077/1707 ms | 1.0/2.1 ms, 1054/1736 ms |
| S0.6 | the same, lean lock (p95s rest on ~80 saves: one lock contention moves them) | 3.6/16.0 ms, 586/1416 ms | 3.9/13.1 ms, 592/1414 ms |
