# Spikes for the Slide Builder 4 design

These are throw-away prototypes and benchmarks that back the decisions in `docs/next/`. They are not product
code. Every number quoted in the design documents comes from one of these, run on a 4-vCPU Linux container
with Chromium 1194. Re-run them on a corporate Windows PC in Phase 0 (`06-plan.md`).

| Folder | Question | Run | Result file |
|---|---|---|---|
| `baseline/` | What does v3 cost today? (open, parse, edit, export per design, PDF contents) | see below | `baseline/baseline.json` |
| `pdfwriter/` | Can our own PDF writer draw Excel and Liquid Glass slides as vector, fast and small? | `node pdfwriter/bench.ts` | stdout, `out-native-*.pdf`, `pdfwriter/render_cost.json` |
| `parser/` | How fast is a columnar byte scanner vs v3's regex parser? How big is a shared parsed-sheet cache? | `cd parser && npm install && node --expose-gc parse_bench.mjs <big30.xlsx> xl/worksheets/sheet2.xml` | stdout |
| `fonts/` | Can HarfBuzz `hb-subset.wasm` subset CFF fonts and instance variable fonts? | `node fonts/subset_check.mjs <hb-subset.wasm> <font> [wght]` | stdout |
| `storage/` | Lock-free journals vs a lock, 10–20 users at 15/40 ms per SMB operation | `python3 storage/journal_sim.py --users 10 20 --fs-ms 15 40 --duration 30 --json out.json` | `storage/sim-results.json`, `storage/current-*.txt` (v3 `tools/loadtest.py`) |

## Prerequisites

* Node ≥ 22.18 (runs `.ts` files directly) and the repository's `node_modules` (`npm ci` at the root: npm workspaces).
* Python 3.8+ with `openpyxl`, `pypdf` and `pypdfium2` (dev machines only), plus `Pillow` for the blurred
  wallpaper asset.
* Chromium for the baseline: `CHROME=/path/to/chrome`, default `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
  On Windows, point it at `msedge.exe`.
* Fonts used by the PDF spike: Carlito (metric-compatible with Calibri) from `/usr/share/fonts/truetype/crosextra/`.
  Change `FONTDIR` in `pdfwriter/bench.ts` on Windows, for example to `C:\Windows\Fonts` with `calibri.ttf`.
* `hb-subset.wasm`: `npm pack harfbuzzjs@0.4.12` and take `package/hb-subset.wasm` (MIT).

## baseline/

```
python3 ../tools/make_corpus.py deck20 big30 /tmp/wb   # deck20.xlsx (20 slides x 2 weekly tables), big30.xlsx (30 MB) - moved to tools/ in S0.5
node baseline/measure.mjs /tmp/wb baseline/baseline.json
python3 pdfwriter/render_cost.py baseline/out-current-glass.pdf pdfwriter/out-native-glass.pdf
```

`measure.mjs` starts a real v3 helper on a temporary ROOT/DATA and drives the built `backend/slide_builder.html`
with Playwright:

1. Open deck20, then go through the wizard.
2. Make Ctrl+B edits until "✓ Saved". The POST timings are recorded separately.
3. Export each design twice. Every PDF is analysed by `pdfinfo.py` (size, fonts, Type 3, images, text).
4. Export once as pictures.
5. Open big30 and read one data sheet, observing long tasks.

`ONLY_EDIT=1` stops after the edit step.

## Notes and limits

* **`pdfwriter/`**: the slides are a hand-built approximation of the v3 designs, with the same table, the same
  number and kinds of primitives, and the wallpaper taken from v3's own PDF. They are not pixel copies of v3.
  Size and time are representative; visual fidelity is the job of the Phase 0–3 parity harness
  (`docs/next/05-test-and-parity.md`).
  * `ttf.ts` is a minimal TrueType subsetter (CID = GID, unused glyphs emptied). The product uses
    `hb-subset` (CFF, variable fonts).
  * Text uses advance widths without kerning; the product shapes text with `hb.wasm`.
* **`parser/`**: the byte scanner handles the cell shapes openpyxl writes (`r`, `t`, `s` attributes, `<v>`).
  The product version must also handle the full set of cell shapes v3's regex parser handles (inline
  strings, namespace prefixes, cells without `r`). The v3 loop in the benchmark omits style lookups, so its
  time is a lower bound.
* **`storage/`**: the latency model follows `backend/slidebuilder/simfs.py`, plus one charged round trip for
  every read and write on an open handle (simfs does not charge those), so it is the more pessimistic model.
  * At 20 users and 40 ms, the lock protocol's queues had not drained when the run ended; that is overload,
    not a bug.
  * **None of this replaces a run on the bank's real share** (Phase 0, `tools/sharetest.py`).
* Generated outputs (`out-*.pdf`, `node_modules`) are not committed. The two wallpaper JPEGs in
  `pdfwriter/assets/` come from v3's own Liquid Glass PDF; the blurred copy is made with Pillow.
