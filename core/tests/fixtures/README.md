# Test fixtures of the core

| File | What | Licence / origin |
|---|---|---|
| `fonts/Carlito-Regular.ttf`, `fonts/Carlito-Bold.ttf` | metric-compatible with Calibri; the display-list, PDF and text tests draw with them | SIL Open Font License 1.1 (`fonts/Carlito-OFL.txt`), unmodified files from github.com/google/fonts `ofl/carlito` |
| `fonts/Quicksand[wght].ttf` | a variable font (one wght axis): refused by the PDF writer, made static by the core | SIL OFL 1.1 (`fonts/Quicksand-OFL.txt`), unmodified from github.com/google/fonts `ofl/quicksand` |
| `fonts/SourceSans3-Regular.otf` | a CFF (OpenType) font: subset as CFF, embedded as FontFile3 | SIL OFL 1.1 (`fonts/SourceSans3-LICENSE.md`), unmodified from github.com/adobe-fonts/source-sans `release/OTF` |
| `text/chromium-widths.json` | the golden slides' text lines measured by Chromium's canvas with Carlito (14.67 and 40 px): the reference of the shaping test | `node tools/textref.mjs` |
| `v41/ops.ts`, `v41/style.ts`, `v41/types.ts` | the 4.1 page's operations and style resolution, frozen (main at 4.1, before M7b): what an older page does with a deck in a consulting design (`design-fallback.test.ts`) | this repository |
| `items-4.3.json` | a deck with charts and callouts (`SlideDef.items`, 4.3) read and edited by the frozen 4.1 operations (`items-fallback.test.ts`) | made by hand for M9 (S9.1) |
| `free-4.4.json` | a deck with a free layout (`SlideDef.free`, 4.4) read and edited by the frozen 4.1 operations (`free-fallback.test.ts`) | made by hand for M10 (S10.1) |
| `cellgrid-4.4.json` | a deck with gridlines on selected cells (`TableDef.cellGrid`, 4.4) read and edited by the frozen 4.1 operations (`cellgrid-fallback.test.ts`) | made by hand for M10 (S10.3) |
| `consult-4.2.json` | a deck saved in Consulting Navy with settings of both consulting designs | made by hand for M7b |
| `images/wall-blur.jpg` | a small JPEG (800 × 450, the spike's blurred wallpaper) | `spikes/pdfwriter/assets/` |
