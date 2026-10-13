# Pilot of the native export (PLAN S3.8, gate 🚦)

Slide Builder 3.7 writes PDFs and pictures itself (PLAN S3.7): no export engine, about 1–2 s for 20 slides,
PDFs 1.3–18× smaller. Before 3.7 ships to everybody, a few pilot users make their **real weekly decks** with it for
**two weekly cycles**, export each deck **with both engines**, and compare. This page is the plan, the
checks and the report form. The result decides the release (go / no-go) and is written under "Decisions" in
`PROGRESS.md`.

## Who and when

| | |
|---|---|
| Pilot users | 3–5 people who make the weekly decks (at least one Liquid Glass and one Excel / Excel Refined user, one on VPN) |
| Themes | between them, at least one deck in each theme the test corpus does not cover – **Ocean, Forest, Sunset, Graphite** (G1 decision 5 of 2026-10-12: they come with this pilot); a user switches theme for one export if nobody uses it |
| Cycle 1 | week 1: the normal weekly deck(s), exported with both engines |
| Cycle 2 | week 2: the same, after any fixes from cycle 1 (a new pilot build if something was fixed) |
| Product owner | collects the reports, decides go / no-go |

## Installing the pilot build (a copy, side by side)

The pilot build is `dist/slidebuilder-3.7.0-pilot.zip` (`python tools/make_release.py --version 3.7.0-pilot`). It is
installed **next to** the current version, so everybody else keeps 3.6 and a pilot user can go back at once:

```
python tools/update.py --root "T:\Slide Builder" --zip dist\slidebuilder-3.7.0-pilot.zip --yes  # installs app\3.7.0-pilot\ (self-test) and makes it current…
python tools/update.py --root "T:\Slide Builder" --use 3.6.0 --yes                           # …so switch everybody back to 3.6 at once
```

Between the two commands (a few seconds) a colleague who starts Slide Builder gets the pilot build; that is
harmless (same data formats), they just see the new export. A pilot user starts the pilot build with
`py -3 "T:\Slide Builder\app\3.7.0-pilot\backend\slide_builder.py"` (`python …` where `py` is missing, as the start file does; or a shortcut to it); everybody else's
`Start Slide Builder.bat` starts 3.6. Both versions read and write the same decks. A pilot user closes the black
3.6 window first (one Slide Builder per PC). (The person who installs it runs the commands; an agent never touches
the real share.)

Check the ZIP before installing it: `python tools/make_release.py --verify dist\slidebuilder-3.7.0-pilot.zip`. (A rehearsal on a
copy of a share folder: `docs/next/release-checklist.md` §4.)

## Each week, for each deck

1. Make the deck as usual (wizard, edits, versions).
2. **Export ▾ › PDF · text & tables** (the new engine, also the *Export PDF* button): `<workbook> - slides.pdf`.
3. **Export ▾ › PDF · text & tables (old engine)**: `<workbook> (old engine) - slides.pdf`, next to it.
4. If you use versions: **PDF · every version × …** (new names: `<workbook> - <version> - <design>.pdf`).
5. Once a week also: **PDF · as pictures**, **PNG · current slide**, **Copy current slide** (paste into PowerPoint).
   *As pictures* is remembered: afterwards the *Export PDF* button and *every version* also make picture PDFs
   (" (images)" in the name) – choose **PDF · text & tables** once to go back before comparing again.
6. Compare the two PDFs side by side **in Acrobat Reader** and **in Edge** (the checks below).
7. Problem? **Export ▾ › Report a problem with this export…**, see below. No problem? A one-line report
   "all fine" is useful too.

## What to compare (new vs old engine)

| # | Check | How | Blocking if |
|---|---|---|---|
| P1 | Same number of pages, same slide on each page | page thumbnails | any page missing, extra or in another order |
| P2 | Every number and text is there and the same | read the tables; Ctrl+F a few numbers in both | a value missing, different or cut off where the screen shows it |
| P3 | Same look as the screen | colours, borders, glass cards, shadows, cover, contents, page numbers, logo, footer, comments, text boxes | a visible difference you would not send to a client |
| P4 | Fonts | the fonts look as on screen (Segoe UI in Liquid Glass, the workbook's fonts in Excel) | a font replaced (the toast says so: "drawn with a default font" / "could not be embedded") |
| P5 | Text selectable and searchable | select a table row; Ctrl+F | text cannot be selected or found |
| P6 | **W14 · Acrobat Reader** (current) | open: under 1 s; scroll the whole deck; zoom 400 % | slow to open or scroll; anything drawn wrong |
| P7 | **W14 · Edge's PDF viewer** | the same | the same |
| P8 | Size and speed | file size (Explorer); the seconds in the toast | larger than the old engine's, or more than 2 s for 20 slides |
| P9 | Printing (one deck per cycle) | print one page to the office printer | anything missing or different on paper |
| P10 | Versions × designs | names `<workbook> - <version> - <design>.pdf`, each version's hidden cells empty | a wrong name or wrong content |

Known and accepted differences (not to report): the old engine's PDF text repeats some runs (copy/paste from
it gives table text twice) and contains "ﬁ" ligatures – the new one does not; the new PDFs are smaller;
"as pictures" pages are 2× instead of 4× (sharp on screen, a quarter of the pixels – B9); version PDFs have the
design in their name (B11). Decided on 2026-10-13 (PROGRESS, Decisions): "as pictures" in Liquid Glass stays
lossless (deck20: ≈ 70 MB, Excel ≈ 12 MB); a 1–3-slide PDF may be over the per-slide size budget (the fonts and the
glass wallpaper are a cost per document) – only a PDF larger than the old engine's is a P8 problem. Known gap: a
library font stored as WOFF2 (most Google fonts) is drawn with the next font of its list in the new PDF and the
toast names it – report it under P4 if it matters for your deck (a fix can follow in the pilot).

## Reporting a problem (offline)

**Export ▾ › Report a problem with this export…** opens a short form: *what is wrong* (the checks P1–P10 above,
or "something else"), *in which file* (new PDF, old engine's PDF, both, as pictures, PNG / copied slide – preset
from the last export), *slide* (preset to the current one) and *what you see*. **The report is a JSON file, not an
e-mail:** *Save report* writes one new file `export\feedback\<date>-<time>-<user>.json` in the shared export
folder – nothing leaves the PC, no internet needed. It holds the form and what the app knows: Slide Builder's
version, user, PC, time, the workbook, its slide count, design, theme and version, the last export (kind, files,
seconds, fonts it replaced or could not embed, or why it failed), where its time went and the browser. Opened from
disk (no helper), the button is *Download report* and the file (`export-feedback-<time>.json`) goes to the
browser's downloads; send it to the product owner. Please also keep the two PDFs (new and old) of that deck: the
report names them.

The product owner reads `export\feedback\*.json` after each cycle (one file per report; a report never replaces
another).

## Report form (one per user per cycle, besides the problem reports)

```
Pilot user:            Cycle: 1 / 2           Week of:
Decks exported:        (workbook, design(s), versions)
Both engines compared in Acrobat:  yes / no        in Edge:  yes / no
P1 pages  ok / problem      P2 texts  ok / problem      P3 look  ok / problem      P4 fonts  ok / problem
P5 select ok / problem      P6 Acrobat (W14) ok / slow / problem      P7 Edge (W14) ok / problem
P8 size/speed ok / problem  P9 print ok / problem / not tried         P10 versions ok / problem / not used
Problems reported in the app (how many):
Would you send the new PDF to a client as it is?  yes / no – why:
```

## Go / no-go

* **Go** when, after two cycles, no blocking difference (table above) is open and W14 (P6, P7) passes for
  every pilot user. Then: S3.9 – v3.7 is released with the native export as the default and the old engine
  as a menu item for this one release.
* **No-go / fix**: each blocking problem is fixed in an `S3.8-fix · …` commit, a new pilot build is installed,
  and the cycle is repeated for the decks it affected.

Write the result under "Decisions" in `PROGRESS.md`, e.g. "2026-10-26 · S3.8 pilot: go (5 users, 2 cycles,
W14 passed in Acrobat 2026 and Edge 155; 2 reports, both fixed in S3.8-fix …)".
