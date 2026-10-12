# Goldens of Slide Builder v3

Captured by `node tools/capture-v3.mjs` (see its header) from the decks in `tests/corpus/decks/`; compared by
`npm run parity` (`tools/parity.mjs`). **Never edit these files** (PLAN Part A): a new capture is a new
commit with a reason, and an accepted difference goes into `tests/parity/accepted.json`.

    <deck>/<design>/<version>/slide-<n>.json   geometry, text, font and colour of every slide element
    <deck>/<design>/<version>/slide-<n>.png    screenshot, 1600 × 900 – only the slides of tests/corpus/pixels.json (glass
                                               slides are ~1 MB each; the full set would be ~130 MB)
    <deck>/<design>/<version>/pdf.json         the exported PDF: pages, sizes, fonts, picture count, text runs, the
                                               page's normalised text (no positions: see tools/pdftext.py)
    <deck>/<design>/<version>/comments.json    automated comment texts with their settings
    <deck>/<design>/<version>/issues.json      the issues panel of every slide
    MANIFEST.json                              git sha, page sha256, clock, Chromium version, font fingerprint
                                               ("git" is the commit the capture ran on; the branch may have been
                                               rebased since - "page" identifies the build exactly)

Geometry and pixels depend on the Chromium build and the installed fonts (`MANIFEST.json` → `environment`).
`parity.mjs` compares them only on a machine with the same fingerprint, and texts everywhere.

## Where they were captured (decision 2026-10-12)

The goldens are a capture of **v3.4.0** (`df30223`, page sha256 `8aaf99b6…`, the same page as the first capture) on the
**reference PC** of PROGRESS.md (Windows 11, its installed fonts, Playwright's pinned Chromium 153 from
`npm ci`), made with

    git worktree add ../wt-v340 v3.4.0
    node tools/capture-v3.mjs --backend ../wt-v340/backend --out golden

They replace the first capture (S0.5: a Linux container with Chromium 141 and Linux substitute fonts), which no
available machine could reproduce, so geometry, pixels and PDF positions had only been compared at S1.1. Checked
before the replacement: the new capture's texts equal the first capture's (text comparison, 0 differences); two
captures on the reference PC are identical (full comparison, 0 differences); main (M2) against the new capture:
full comparison, 0 differences. Hosted CI (Linux) keeps comparing texts and styles only; the full comparison is
part of the double-check on the reference PC (`npm run parity` prints "full comparison").
