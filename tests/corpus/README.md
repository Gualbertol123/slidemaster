# Parity corpus

Inputs of the golden capture (`docs/next/05-test-and-parity.md` §2, PLAN S0.5). Everything here is data.

| Path | What | Made by |
|---|---|---|
| `workbooks/report.xlsx`, `plain.xlsx`, `big.xlsx`, `weekly.xlsx` | the e2e fixtures | copies of `frontend/tests/fixtures` (`make_fixtures.py`) |
| `workbooks/deck20.xlsx` | 20 slide sheets × 2 weekly-report tables | `python tools/make_corpus.py` |
| `workbooks/edge-*.xlsx`, `edge-macro.xlsm` | number formats and locale tags, rich text, merges, hidden rows/columns, colour scales and rule CF, 1904 dates, pictures (cropped, rotated, flipped, SVG), shapes, text boxes, a group, a macro-enabled file | `python tools/make_corpus.py` |
| `big30.xlsx` (not committed, ~30 MB) | 3 × 130 000-row data sheets, for opening speed | `python tools/make_corpus.py big30` |
| `assets/logo.png` | the logo the decks use | `python tools/make_corpus.py logo` |
| `decks/<id>.json` | saved decks: `{workbook, ops}`, applied through the helper's API like the app saves them | `node tools/capture-v3.mjs --make-decks` (wizard presets + option variants), then committed |
| `pixels.json` | the slides whose screenshots are kept as goldens | by hand |

The decks exercise these option families of 05 §4: the three designs; glass subtle (the default), medium and
strong; colour, radius, contrast; a named theme (Intesa Sanpaolo) and a custom one; custom colours, per design
too; text styles and fonts; versions (cells removed); cover and contents slides; text boxes beside a table, as a
card, moved anywhere, centred and bottom-aligned, with line and paragraph spacing, with markup (`#`, `**`,
`[[+x]]`), and a box beside all tables (`span`); the notes section; automated comments (summary and sections,
short/full, top N, units, bullets, names, titles, a title of its own, exclusions, several tables, kinds,
minimum amount); colour scales, merges, gridlines, per-design table sizes and slide sizing; cell edits (bold,
highlight, cell colour, text colour, size, alignment, roles total/header/caption); conditional formats copied
with the painter; page numbers (formats, positions, start, on the cover); footer with `{workbook}`, `{title}`,
`{date}` as a capsule and plain; logo, logo bubble, a slide without its logo; a slide with a missing table.

Not in the corpus yet (05 §2): an EMF picture and a `.xlsb` converted once - both need Excel or Windows
conversion, so their goldens would differ between machines; they come with the Windows field tests (S0.6) and
with S6.1 (`.xlsb`). Also still to come: the 5 anonymised real decks (see "Waiting for" below).

`--make-decks` only adds decks that are missing: it takes the presets of the committed base decks (the wizard
would make new random ids) and runs the wizard only for a workbook without one. `--rewrite` rewrites them all;
do that only together with new goldens.

**Waiting for (PROGRESS.md):** 5 real decks from the share, anonymised with `tools/anonymise.py`, then added
here (workbook in `workbooks/`, `{workbook, ops: [preset.set, style.patch, …]}` in `decks/`).
