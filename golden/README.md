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
