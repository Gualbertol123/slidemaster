# Changelog

Every user-visible change, per release (PLAN Part B §8 lists the only ones allowed during the rebuild).
Releases are made with `docs/next/release-checklist.md`.

## 4.8.0 - unreleased (PLAN M15: lines, icons, snapping; B32–B35)

(M15 writes this section on its own branch, v4/M15-lines-icons-snapping.)

What users notice
* **About 6,200 icons** (B34; Tabler Icons 3.49.0, MIT – named in the notices): ribbon 2 › *Insert shape ▾* ›
  **More icons…** opens a picker – search by name or tag (English words, e.g. "bank", "arrow up"), outline or filled,
  41 categories, the icons used last – and puts the icon on the slide in the colour, size (32–128 px) and line width
  (1–3) chosen there. A selected icon has *Change icon…* (another one, same colour, size and place), its size and its
  line width on the ribbon; each change is one undo step. The icons are in Slide Builder itself: no internet needed.
  The 17 icons of earlier versions are still in the menu and look as before.
* **Icons in PowerPoint are shapes**: each icon is an editable PowerPoint shape (custom geometry: its lines with round
  ends, or its filled outline, in its colour) – never a picture; in the PDF and on screen it is drawn as on the slide.
* **An icon Slide Builder does not have** (a deck from a newer version, a mistyped name) shows the ⓘ icon and a line in
  the Issues panel naming it, instead of standing in silently. Older versions (4.6, 4.7) show ⓘ for the new icons
  without that line – open such decks in 4.8.
* **Lines and arrows** (B33): ribbon 2 › **Insert line ▾** – a line, an arrow, a double arrow, an elbow arrow, a curved
  arrow, a bracket, a range marker (ticks at its ends and a label above it), a limiter, a dashed divider and a thin
  callout line. Drag a line to move it, its round handles to move its ends (Shift: straight, 45° or upright), its
  middle handle to move an elbow's bend or bend a curve or a bracket. **Hold Ctrl while dragging an end** to attach it
  to a table, a text box, a shape or an icon: it then follows that object when it moves, in every design and in free
  layout; *Detach* frees both ends. The ribbon sets its kind, colour, weight, dashes, the end at each side (arrow, open
  arrow, stealth, dot, diamond, tick) and a label, which can quote a cell like a callout ({Sheet!C7}). Each change is
  one undo step. If an attached end's object is deleted, the end stays where it was and the Issues panel says "Line n:
  its end lost its object". A line without its own colour takes the colour the deck sets for text boxes (else the
  design's ink); on a dark slide colour it is light, so it shows. A label sits on the colour under it – the slide, a
  consulting design's dark band or Consulting Red's panel – in white where the line's ink would not read there.
* **Lines in PowerPoint are ordinary line shapes** with PowerPoint's own arrowheads – never connectors and never
  pictures – placed where the line is drawn on the slide (PowerPoint does not keep them attached). Their labels are
  text boxes grouped with them. Dashes are kept, and the ticks of a range marker or limiter stay solid with round ends
  as on the slide (beside a dashed line or an arrowhead they are a small shape of their own in the same group). In the
  PDF and on screen they are drawn as on the slide. Older versions (4.6, 4.7) do not show the new lines – open such
  decks in 4.8.
* **Snapping for every object** (B32): moving or resizing a table in free layout, a text box, the notes section, a
  chart, a shape, an icon or a line (its ends, its bend, the whole line) lines up with the slide's edges, its centre
  lines and margins, the other objects' edges and centres, the tables' column and row borders and the other lines'
  ends. Every line it matches is shown in pink (a centre dashed); it also offers **equal spacing** (the two equal gaps
  are marked with their size in px) and, when resizing, **the same width or height** as another object (both marked).
  The pull is 8 px on screen at any zoom. **Hold Alt to drag without snapping** – now for every object in every layout
  (text boxes used to snap with Alt held outside free layout). The guides are only on screen, never in the PDF or
  PowerPoint file.
* **Objects stay exactly where they are dropped**: positions and sizes are saved on a 1/4 px grid, the same number the
  screen showed while dragging, so the PDF and PowerPoint place them identically (no half-pixel jump on drop) – also
  for a table pushed against the slide's right or bottom edge in free layout, a table resized by its top or bottom
  edge onto a guide, and an elbow's bend. An object saved by an earlier version moves by at most 1/8 px the first time
  it is dragged (only the values the drag changes; nothing moves when a deck is just opened).
* **One look for the toolbars' icons** (B35): the buttons of the top bar and both ribbons (undo, alignment, spacing,
  format painter, borders, position, text boxes, shapes, lines, zoom …) show Tabler icons in place of the hand-drawn
  icons and symbols (↻ ✦ ⚙ ⤺ 🗑 ⇄ …), all the same size and in the buttons' text colour. The buttons keep their words
  and their tooltips; nothing moved.

## 4.7.0 - unreleased (PLAN M14: charts; B30, B31)

(M14 writes this section on its own branch, v4/M14-charts. Shared preparation of both, S14.P, nothing users notice: the
data model of 09 §2.2 / §2.3 and its ops, `Stroke.join` in every backend, the arrowheads, the PowerPoint gate of 09 §7.2,
the per-kind item code paths, the page budget per milestone.)

## 4.6.0 - unreleased (PLAN M13; prepared 2026-10-21, dated at the tag)

What users notice
* **The share goes from 4.0 straight to 4.6**: users also get everything listed below for 4.1–4.5 (never released
  on their own).
* **Scan for "x" tables** (B43): in a large workbook the wizard reads a sheet only when it is selected, so its first
  step showed "not read yet" and no tables. The new button reads the selected sheets at once and shows each one's
  "x" tables, title and suggested tables there; the "x" tables are defined, as *Next* would. Sheets not selected are
  still not read.
* **Delete a saved setup** (B44): the *Saved preset found* question has *Delete setup…*: the workbook's saved setup –
  tables, slides, design, versions, comments – is deleted for everybody and the wizard starts as for a new file (the
  workbook is not changed). ⚙ Options › Administration › **Saved setups…** lists every workbook's setup (slides,
  tables, last change) with *Delete…*, and the deleted ones with *Restore…*: a deleted setup is kept as a backup on
  the shared folder. A setup open in a window is not deleted – the message says who has it open.
* **Decks with Slide Builder 4.6 objects open in 4.6 and later only** (B41, ADR-019): a deck that holds charts,
  callouts, free layouts, looks, cell gridlines or borders, or any object added from 4.6 on, is marked for 4.6 before
  the first such object is saved – once per deck, about 25 seconds of "Saving…". An older window that still has it open
  turns read-only and saves nothing more; an older version opening it shows "a journal of this deck is damaged – tell
  the maintainer": that message means **update Slide Builder** (close its black window and start it again). Decks
  without such objects keep opening in older versions.
* **New slide and Add table** (B40): *+ New slide* in the slide list's header, Ctrl+M, or right-click the slide list ›
  *New slide* adds a blank slide after the selected one, its title ready to type; ribbon 2 › Insert › *Add table* lists
  the deck's tables (those on no slide first, each with a small sketch) and puts one on the current slide – on a free
  layout in the first empty spot; *New table from cells…* makes one from cells picked on a sheet. One undo step each.
* **Google fonts through Slide Builder** (B45): adding a Google font no longer needs fonts.googleapis.com from the page
  (refused at the office: "failed to fetch"); the helper fetches it from Google's font collection on GitHub (or
  jsDelivr, googleapis last). A proxy can be written in this PC's `%LOCALAPPDATA%\SlideBuilder\proxy.txt` or the
  shared `data\proxy.txt`; every failure says what to do (e.g. *Upload font files*).
* **Font previews from a shared cache** (B46): the font picker's previews are fetched once by the helper and kept in
  `data\fonts\cache\` for the whole office (at most 200 MB); the page no longer asks Google for them.
* **Licences** (B42, LI-01): ⚙ Options › About › *Licences…*, or *Licences…* on the start screen before any workbook is
  open, shows the licences of the third-party software in Slide Builder (React, zustand, fflate, IronCalc,
  harfbuzzjs / HarfBuzz); the release ZIP carries the same text as `THIRD-PARTY-NOTICES.txt`.
* **Hide slides** (B47), as in PowerPoint: right-click a slide in the slide list › *Hide slide* hides it in the current
  design (*Show slide* brings it back), *Hide in every design* in all five. A hidden slide stays in the list, grayed,
  its number struck and marked *hidden*, and on the stage (marked "Hidden in …", still editable); it is left out of
  that design's exports – PDF, PNG of every slide, PowerPoint, every version × design, Run for each value – and the
  page numbers and the contents slide count only the slides shown (on the stage too; the hidden slide shows no page
  number). Exporting or copying the current slide still exports a hidden one. Hidden in Liquid Glass, a slide still
  shows in the other designs. Each change is one undo step. A deck with a hidden slide opens in 4.6 and later only
  (B41).

For the maintainer
* **Update day (4.0 → 4.6): every Slide Builder window and black window is closed on every PC before the update**
  (`docs/next/release-checklist.md` §6); a rollback to 4.0 keeps the decks holding 4.6 objects read-only there –
  never delete their `incident-format-5.json`.
* **`THIRD-PARTY-NOTICES.txt`** (AUDIT-2 LIC-1, ADR-020) is written by `node tools/notices.mjs` from the packages the
  page and the core worker really bundle and the licence files of the inlined WASM; `make_release.py` refuses to build
  without it, and `app/tests/notices.test.ts` / `helper/tests/test_release.py` fail when a runtime dependency has no
  entry or the file is out of date (run the script after adding or updating a dependency).
* **`Update Slide Builder.bat`** (A3) finds the newest release on the release page (github.com/…/releases/latest)
  instead of GitHub's API, whose 60 requests an hour are shared by every PC on the office's internet address, and
  downloads `slidebuilder-<ver>.zip` from there (checked against its `.sha256` file and MANIFEST.json; GitHub's
  digest too when the API answers). When nothing newer exists it says so – the version in use and GitHub's newest –
  and changes nothing (no backup). A used-up GitHub limit or no network is one sentence with the time to try again,
  not a traceback; a used-up limit is no longer retried. The new `Update Slide Builder.bat` needs Python 3.8 or
  newer and says when the update stopped, but an update never replaces that file on a share that has one: there it
  is copied by hand (docs/next/release-checklist.md §6). The share's 4.0.0 updater still asks the API, so the first
  release after 4.0.0 is installed by hand too (same section).
* **`--use` below 4.6** names the decks that hold 4.6 objects (they open read-only there; going back to Slide
  Builder 3 loses those objects) and asks before it switches (`--yes`: named, not asked). *Prepare rollback* names
  them too. New share file: `backend\data\v4\decks\<deck>\incident-format-5.json` – the mark; never delete it.

## 4.5.0 - unreleased (docs/next/07 §4, PLAN M11; B21; ADR-016 amended 2026-10-19)

What users notice
* **PowerPoint export** (B21): *Export ▾ › PowerPoint · all slides / current slide* writes a `.pptx` beside where the
  PDF goes, named as the PDF with `.pptx` ("<workbook> - slides.pptx"); *PDF + PowerPoint* makes both at once; the
  *Versions* items make PDFs, PowerPoint files or both (a switch above them), named "<workbook> - <version> -
  <design>.pptx"; *Run for each value…* has *Files: PDF · PowerPoint* (one file of each kind per value, design and
  version, "Saved N files"). Opened from disk, they are downloads.
* What is in the file: text you can edit (titles, subtitles, footers and page numbers are the layout's placeholders),
  every table a real PowerPoint table (its cells' fills, borders and texts), pie and donut charts as PowerPoint charts
  with their data (*Edit Data* works), callouts as PowerPoint shapes holding their text, the workbook's pictures and
  the logo as pictures; everything else – Liquid Glass's frosted cards, capsules, shadows, the consulting designs' bars
  and rules – as editable shapes. Each file has a slide master and one layout per kind of slide (cover, contents,
  content), made from the deck: the background and the decoration every slide shares are on the layout once, the
  theme has the design's colours and fonts. No connector shapes, no links outside the file.
* In two sentences, the fidelity: positions and sizes are the slide's, so a PowerPoint file looks like the PDF; where
  it cannot be exact, PowerPoint draws it its own way – a chart's labels and pie size, its blur for shadows and
  gradient sheens, a line that wraps one word earlier when a font is substituted. Fonts are named, not embedded: the
  Windows fonts the designs use are on every PC, and a font of the deck's library is named in the toast (PowerPoint
  substitutes it where it is not installed).

## 4.4.0 - unreleased (docs/next/07 §5, docs/next/08 §2.8, PLAN M10, M7c; B18, B20, B28, B29; ADR-017)

What users notice
* **Free layout** (B18): ribbon 2 › *Free layout* switches the current slide, in the current design, to a layout where
  every table, text box, chart and callout sits where you put it: nothing moves when you switch it on, and from then on
  nothing re-flows, shrinks or follows a table. Drag a table by its grip to move it, by its corner or any border to make
  it larger or smaller (it keeps its proportions); drag a text box, chart or callout by its body to move it and by any
  edge to size it. Everything snaps to the other boxes' edges, the content area and the slide's middle – hold **Alt**
  for no snapping. Each drag is one undo step. *Reset layout* (or *Free layout* again) asks "Back to automatic layout?"
  and brings the automatic layout back as it was; your free places are kept and come back when you switch it on again
  – one undo step each way. Each design has its own free layout (the designs draw tables at different sizes); raw Excel
  too. Exports and thumbnails show the slide as the stage does.
* **Gridlines on selected cells** (B20): *Gridlines ▾ › Selected cells* draws light lines on the selected cells –
  **H** (above and below each cell), **V** (left and right), **Outline** (around the selection) – in a colour and a
  weight (0.5–3 px) of your choice; *Clear* removes them. They are a layer of their own: they never change a border,
  and where a cell has a border that the design draws, the border shows. Liquid Glass and the consulting designs'
  card tables draw them as lines of their colour; the consulting "exhibit" tables draw none.
* **Cell borders** (B28, asked for in M10): *Borders ▾* on ribbon 2 sets the selected cells' borders as Excel's Borders
  menu does – Bottom, Top, Left, Right, All borders, Outside, Thick outside, No border – in a style (thin, medium,
  thick, dashed, dotted, double) and a colour; *Clear (as in Excel)* brings the workbook's borders back. They change
  the slide only: the workbook is never changed. They are drawn where the designs draw the workbook's borders today
  (Excel, Excel Refined, the consulting designs' ruled tables); Liquid Glass and the other consulting table styles
  draw no borders, as before.
* The format painter also copies a cell's gridlines and borders set on the slide (a cell without any removes the
  target's, as Excel's painter does).
* **Composable consulting looks** (B29, asked for 2026-10-19): in Consulting Navy and Consulting Red every part of the
  look is a selector of its own at the end of ribbon 2 – with nothing or a table selected: the table style (Exhibit,
  Cards, Ruled), all numbers or compact, **Δ bars**, **Trend**, **Latest bar**; with the title, the KPI line or the
  message panel selected: the headline (KPI line, panel, none), how many KPIs (1–3) and the ground (band, tint, white),
  and the KPI line's or the panel's font, size, bold and colour with the usual text controls. A change applies to the
  current slide (a dot marks a part the slide sets for itself); **Apply to all** makes it the deck's, **Deck's** brings
  the slide back to the deck's look – one undo step each. The *Look ▾* dropdown and *Design… › Layout* of 4.2 are gone.
  Slides with their own look show the deck's look in 4.0–4.3.
* Decks with a free layout, cell gridlines or borders open in 4.0–4.3 with the automatic layout and the workbook's
  borders (those keep the settings in the deck).

For maintainers
* `SlideDef.looks` (per consulting design, the slide's parts over `designs[d].consult`; `slide.patch` map key, ops
  vectors +2) and `render/look.ts` `slideCtx` at every slide entry; `ConsultOptions` gains bars, trend, band, kpis,
  kpiText, panelText (defaults draw the 4.4 output: goldens unchanged).
* `SlideDef.free` (per design `{on, items}`), `TableDef.cellGrid` and `TableDef.borders` – new map keys of
  `slide.patch` / `table.patch` (`shared/ops-vectors.json` +16 cases); `computeLayout`'s free branch (no bisection);
  the bench gate `free_drag_frame_ms` (16 ms, a free layout's drags).

## 4.3.0 - unreleased (docs/next/07, PLAN M9; B16, B17, B19, B24)

What users notice
* **Charts** (B16): ribbon 2 › *Insert chart ▾* makes a pie of the selected cells (the last column's numbers, named by
  the first, beside their table) or of cells you choose in the sheet view (*Choose the cells…*: drag across the numbers,
  then across their names – nothing to type), of any sheet the wizard lists, a sheet that is on no slide too (hidden
  sheets stay hidden); *Change the cells…* in its side panel chooses others the same way. It follows the workbook: a reload or a scenario's preview draws it with the new numbers. Click
  a chart to select it (a click on a slice selects that slice), drag it anywhere (it snaps; Alt does not), drag its
  corner to resize it, Del removes it – each one undo step. Its side panel sets pie or donut, the labels (names,
  values, percent), the legend (right, below, none), the title, **a colour for each slice** (↺ back to the design's)
  and shows where its numbers come from. Each design draws it in its own look: Liquid Glass in a glass card with the
  theme's colours, Excel with the accent and Office's chart colours, Excel Refined on a white card, Consulting Navy and
  Red with their own chart palettes. Labels sit inside a slice when they fit, else outside with a leader line.
* **Callouts** (B17): *Insert shape ▾* adds a rectangle, rounded rectangle, pill, circle, arrow or speech bubble, or
  one of 17 icons (arrows, check, warning, info, flag, star, bank, euro, percent, calendar, chart, target, bell, pin,
  bulb, lock). Double-click (or Enter) to write its text; *Quote a cell…* picks a cell in the sheet view and adds it as
  **{Sheet!C7}**, which quotes the cell as the workbook shows it (its
  number format) – {'Sheet name'!C7} for a name with spaces, {[Peers.xlsx]Peer!F7} for a linked workbook – and follows
  reloads and scenarios. Ribbon 2 sets the selected shape's fill, border (colour, weight, dashed, dotted, none) and
  text (size, bold, colour, alignment). Without a fill of its own a shape takes the design's material (glass, a framed
  box, a card).
* **Raw Excel draws your objects** (B19): text boxes, automated comments and the notes section now show in the Excel
  design too (and charts and callouts), as in Excel Refined; the + buttons, *Comment…* and *Notes* work there. It still
  adds nothing of its own: the tables keep the workbook's colours. A slide that kept a shared table size made in another
  design now uses it as it is.
* **The Issues panel** (B24) names a chart whose numbers cannot be found ("Chart 1: source Summary!C5:C9 not found" –
  a sheet renamed or removed; the chart shows a dashed placeholder on the slide and nothing in exports) or that has no
  numbers, and a callout quoting a cell that cannot be read ("Callout 1: Nowhere!B2 not found (shown as #REF)").
* Decks with charts or callouts open in 4.0–4.2 without them (those keep them in the deck and skip their changes).

## 4.2.0 - unreleased (docs/next/07, docs/next/08, PLAN M7, M7b, M8; B15, B22–B26)

What users notice
* **Run for each value** (B15): *Export ▾ › Run for each value…* sets an input cell (e.g. the bank of a dashboard's
  control sheet) to each value of a list – typed, pasted from Excel, or taken from a range of the workbook – and saves
  one PDF per value, design and version, named "<value> - <design>.pdf" ("<value> - <version> - <design>.pdf" with
  versions; two values that show alike get " (2)"). The workbook is recalculated by Slide Builder for each value;
  nothing is saved – the workbook file and the deck stay as they are. A panel shows the progress, *Cancel* (after the
  value being made), a report per value and *Open folder*; you can keep working on the deck meanwhile. Before the
  first value, a cell on the slides that Slide Builder computes otherwise than Excel stops the run with its list,
  unless *Run anyway and mark these cells* is ticked (they get a red corner). PowerPoint files come with 4.5.
* **Preview** one value on the slides first: a banner names it ("Previewing: Bank C – a scenario, not saved · Clear");
  the formula bar, toolbar and side panel show the scenario's values too. Edits made meanwhile are ordinary edits of
  the deck (an edit of a cell the scenario changed belongs to the workbook's value: it shows once the preview is
  cleared, and Slide Builder says so). An ordinary export during a preview uses the workbook's own values (its message
  says so).
* Workbooks made with **Italian Excel** recalculate like Excel: `TESTO(…;"mmmm aaaa")`, `TESTO(x;"#.##0,0")` and the
  like are formatted as Italian Excel does (month names, separators), so titles built with them follow a scenario; the
  Formulas line says how many ("n with TEXT in Italian, formatted by Slide Builder"). **Named ranges** (defined names)
  are recalculated too.
* **Linked workbooks** (B22): in the wizard's first step, *+ Add a linked workbook…* lists the other workbooks of the
  folder; the chosen file's sheets join the list (shown with the file's name) and its tables go on slides like any
  other. A deck remembers its linked files; if one is missing when the deck opens, its tables are reported as missing
  and everything else opens. Formulas that read another workbook of the folder are recalculated with that file.
* **The Issues panel's "Formulas" line** (B24): *Check* recomputes every formula of the workbook (and of the folder's
  workbooks it links to) and says how many give Excel's own saved value, and which do not: volatile (TODAY, NOW, RAND),
  locale-dependent (TEXT codes written by an Excel in another language), read a hidden sheet, read a workbook not in
  the folder, could not be read, or different from Excel. Nothing is changed by the check.
* The page is about 2 MB bigger (B23): it carries a formula engine (IronCalc, MIT/Apache-2.0) that is started only
  when something needs it – a scenario run or the formula self-check – so opening Slide Builder and a deck is as fast
  as before.

* **Two consulting designs** (B25, B26; M7b, docs/next/08): beside Liquid Glass, Excel and Excel Refined, the design
  switch has **Consulting Navy** (navy and electric blue, Georgia titles, Arial text, two-line action titles) and
  **Consulting Red** (red accent, Arial, a short red bar under the title). Their tables are drawn as data exhibits:
  every number of the table in right-aligned columns, with trend lines and diverging bars beside them; Navy puts a KPI
  line from the slide's first table under the title on a dark band, Red a message panel (the lead variance, how many
  rows fall short, the largest gap). Every number shown is a cell of the table – edits, versions and scenarios
  included. **Look ▾** in the top bar (and Design… › Layout, one option at a time) picks how tables are drawn
  (exhibit, cards, ruled), all numbers or compact, the headline (KPI line, message panel, none) and the background
  (dark band, tinted, white): 36 looks, saved per design with the workbook. Each design has its own colours, text
  styles and sizing, as the others. Exports name them ("weekly - Chief - Consulting Navy.pdf"), and *Export ▾ › PDF ·
  every version × all five designs* is a new item ("all three designs" stays as it is). A Slide Builder 4.0 or 4.1
  page opens such a deck in Liquid Glass and keeps its consulting settings.

For the maintainer
* Scenario runs (M8): `scenarioRun` / `scenarioCancel` and `scenario` events in the core worker (`core/src/worker/
  host.ts`); file names in `core/src/export/names.ts` (the B11 names moved there unchanged); display lists name whose
  values they draw (`SlideListsReq.scenario`: a run, "preview", or the workbook's own); a preview mirrors its cells to
  the page (slices flagged `rebuild` / `scenario`). Bench gates `scenario_one_ms`, `scenario_20_ms`,
  `scenario_task_ms`, `preview_switch_ms`.
* The formula engine reads defined names (`Workbook.names`; a constant or formula name through a cell of an internal
  sheet), evaluates once per input, and formats TEXT with Italian codes itself (`core/src/calc/textfmt.ts`). Stand-in
  corpora for the product owner's confidential dashboards, made with this PC's Italian Excel: `tests/corpus/
  workbooks/g4/` (`spikes/recalc/make_g4.ps1`) and `tests/corpus/workbooks/large/` (`make_large.ps1`: three linked
  workbooks, 22,956 formulas, and a 91,281-formula speed workbook, with Excel's recalculated copies); every formula
  equals Excel's in the self-check and in every scenario case. `app/tests/fixtures/Gate.xlsx` (`make_gate.ps1`).
* The consulting designs are one renderer with two specs (`core/src/render/consult-spec.ts`, `consult-dl.ts`,
  `exhibit.ts`; ADR-018) drawing through the display list like the others; their goldens are their own signed-off
  first render (`golden/<deck>/mckinsey|bain/`, `golden/MANIFEST-v4.json`, `tools/capture-v4.mjs`); the bench and
  `tools/export-check.mjs` measure them (export < 1.5 s for deck20, < 40 KB per slide + 150 KB).
* Workbook formulas are read (`.xlsx` and `.xlsb`), not only their cached values, and `core/src/calc/engine.ts`
  recomputes them; `core/tests/formulas.test.ts` and `engine.test.ts` check both against Excel's own files in
  `tests/corpus/workbooks/recalc/` (made with Excel by `spikes/recalc/make_linked.ps1`).

## 4.1.0 - unreleased

What users notice
* **`.xlsb` workbooks (Excel Binary Workbook) open directly, without Excel** (B10): faster, also when PowerShell or
  Excel are restricted on the PC, and from a page opened from disk. They look exactly as the same workbook saved as
  `.xlsx`. Old `.xls` workbooks and protected files are still converted by the PC's Excel, as before.
* A workbook you open in the first moments after Slide Builder starts stays open: the last workbook no longer
  reopens over it (decided 2026-10-14, PROGRESS Decisions "all yes", 4).

For the maintainer
* The Slide Builder 4 pilot is gone (4.0 went live without it): `Start Slide Builder (v4 pilot).bat`, the helper's
  `--pilot` and `Update Slide Builder.bat --pilot`. Nothing else changes.

## 4.0.0 - 2026-10-15

What users notice – decks are stored the Slide Builder 4 way (PLAN M5)
* **Other people's edits appear within about 1–2 seconds** (B5), also with many people on a slow share: every
  change is appended to the deck's journal on the share without waiting for anybody else's save.
* **When two people change the same thing at the same moment, the later change in the deck's own order wins**
  (B4: a Lamport clock, not whose save reached the share first). Everybody still ends with the same deck.
* "✓ Saved" as soon as the change is on the share (B6, as since 3.4).
* If a deck's file on the share is ever damaged, the status bar says so and the deck can be read but not changed
  until the maintainer looks at it (docs/next/04 §2.3: it must never happen; the helper writes an incident file).

What stays the same
* **Decks, settings and fonts are unchanged**: every deck keeps its slides, tables, edits, comments and looks
  (it is moved, not converted by hand); the shared defaults (`config.json`), everybody's preferences, the font
  library, logos and the workbooks keep their formats and stay where they are, shared with Slide Builder 3.
  Exports are named and saved as before.

For the maintainer
* **The move is one command on the agreed Monday** – `docs/next/cutover.md`, minute by minute. From 3.8 it is run
  once with 4.0's own updater (3.8's `Update Slide Builder.bat` refuses a 4.x release and changes nothing); later
  updates are a plain double-click again.
* **`Start Slide Builder (v3).bat`** starts Slide Builder 3 on the same data (from port 8785) for a deck given back
  to it; it is removed after four weeks without a rollback (S6.5). The newest 3.x stays installed beside 4.x, so
  `--use 3.8.0` keeps working after any 4.0.x update; after such a rollback a plain `Update Slide Builder.bat`
  refuses to move on (`--release X.Y.Z` or `--use X.Y.Z` goes forward). A release install now also adds
  `Update Slide Builder.bat` and `Start Slide Builder (v3).bat` to a folder that lacks them (never replacing them),
  and `Install Slide Builder.bat` finds the program in a folder of side-by-side versions (`app\current.json`).
* The pilot (`Start Slide Builder (v4 pilot).bat`, `Update Slide Builder.bat --pilot`, `docs/next/pilot-v4.md`)
  runs a 4.x version on a copy of the data, beside the version in use.
* **Decks move to Slide Builder 4 one by one**, the first time somebody opens them in 4.0 (or all at once with
  `Update Slide Builder.bat --migrate-all`; a deck open in 3.x at that moment is skipped and moved later). The 3.x
  file is backed up and frozen, so Slide Builder 3 refuses that deck from then on ("Slide Builder was updated").
  Going back: *Options › Administration › Prepare rollback* in 4.0, then `Update Slide Builder.bat --rollback`
  (one workbook, or every deck). A deck listed in `backend\data\v4\pinned-v3.json` stays with 3.x.
* Slide Builder 3's storage path is gone from the program (S5.5): the helper no longer applies operations
  (`ops.py`), saves v3 documents, keeps v3's 5-minute rolling backups or v3 presence; it reads v3 documents only to
  move them. `tools/loadtest.py` gave way to `tools/loadtest4.py`. The side panel shows a deck-health line (the
  deck's snapshot, the changes since and the journals they are in). The shared defaults (*Use as default for new
  decks*) are stored by compare-and-set: the page computes them, the helper replaces `defaults.style` only if nobody
  changed it meanwhile. A Slide Builder 4 started on a PC where 3.x already runs starts on the next port instead of
  opening 3.x's page.
* The program moved from `backend\` to `helper\` (PLAN S5.1). The data, the logo and the v2 settings stay in
  `backend\` (`backend\data\` is shared with Slide Builder 3); *Start* and *Install Slide Builder.bat* start
  `helper\` (or `backend\` in a folder that still has the 3.x program), and versions installed side by side keep
  working: `app\<ver>\helper\` for 4.x, `app\<ver>\backend\` for 3.x (`--use 3.8.0`).

## 3.8.0 - 2026-10-14

What users notice – the slide on screen is drawn the way the PDF is (PLAN M4)
* **The export engine is gone for good** (B1). The "Export: …" pill, the *Install export engine* dialog, the
  in-window fallback and *Export ▾ › PDF · text & tables (old engine)* are removed; every export is the one
  Slide Builder writes itself (3.7). *Install Slide Builder.bat* no longer downloads anything: it checks Python,
  the shared folder and – new – that the data folder keeps what is written to it (a small file appended to twice,
  flushed and read back), then makes the desktop shortcut and runs the self-test.
* **Liquid Glass text, and Excel Refined's text boxes, are static Segoe UI on screen too** (B2), as the PDF already
  was (no longer Segoe UI Variable); Liquid Glass tables are measured from the font files, so columns and text boxes
  are a little narrower than in 3.7 (1.5–15 %, median 4.4 %; every difference reviewed and signed off on
  2026-10-14).
* **Soft shadows are drawn as in the PDF**, five sharp layers (B3); *Options › Soft shadows on screen* keeps a true
  blur on screen only.
* **Wrapping, overflow and text-box fitting are measured from the font files** (B7): a few cells may wrap or
  shrink differently from 3.7 (each one listed and accepted, `review/S4.4/`). Fonts whose browser widths differ
  from the file's are drawn as outlines on screen, so the screen and the PDF agree.
* **Thumbnails are pictures of the slides** (B14): sharper, the same content as the slide; big tables no longer
  show "shapes only". A 100-slide deck scrolls at 60 frames per second on the test PC.
* Text on screen is smoothed in grey instead of ClearType's coloured fringes (the slide is now drawn as SVG;
  accepted 2026-10-13).
* A logo file that cannot be read draws nothing, on screen and in the PDF (3.7's PDF drew an empty bubble).
* **No more faint light lines between cells of the same dark colour** in a table shown at a scaled size, on screen
  and in pictures (decided 2026-10-14).
* **Excel size** (Cells ribbon) now puts the selected columns and rows back to the workbook's widths and heights; it
  did nothing in 3.7 when they had been set with W, H or by dragging.
* The side panel names a Windows font that is another version on another PC (e.g. "Calibri on this PC is another
  version than on PC-B"): slides may wrap or fit a little differently there.
* Opening a workbook no longer ends on "No workbook" when the connection to the helper drops for a moment: a read is
  asked again once.

For the maintainer
* The export engine's folders are no longer used and can be deleted: `engine\` in the Slide Builder folder, and on
  each PC that ran Slide Builder from a share the whole `%LOCALAPPDATA%\SlideBuilder\` folder (the engine's copy and
  its `locks`). `tools/update.py` never touches them, so they stay until removed by hand. A PC where the old
  installer put the Playwright package can drop it too: `python -m pip uninstall playwright`.
* The helper no longer has `--setup`, `/api/export`, `/api/assemble` or `/api/engine/*` (they answer 404), and no
  longer reads `SLIDEBUILDER_BROWSER` or `SLIDEBUILDER_ENGINES`; `backend\requirements.txt` and
  `backend\Install export engine.bat` are gone. It needs nothing but Python's standard library.
* For the same layout on every PC (Windows fonts copied into the shared font library), the licence owner must first
  confirm that Microsoft's fonts may be copied to the share (risk R7); then record it once:
  `python backend\slide_builder.py --allow-font-copy "<who confirmed, when>"` (`off` goes back). Until then every PC
  lays out with its own fonts, and the side panel names fonts that differ between PCs.

## 3.7.0 - 2026-10-13

What users notice – the export (PLAN S3.7–S3.8; piloted, go on 2026-10-13)
* **Slide Builder writes the PDFs and pictures itself.** No export engine (Chrome) is needed any more for
  *Export PDF*, *PDF · as pictures*, *PNG* and *Copy current slide*; the work runs in the background, the window
  keeps responding. The 20-slide test deck (3.6: the baseline in `docs/next/01-current-system.md` §3.2, and the
  3.6 way measured again on 2026-10-13 with the old-engine item; 3.7: `npm run bench`, PROGRESS.md Measurements):

  | | 3.6 (export engine) | 3.7 |
  |---|---|---|
  | Liquid Glass, click → PDF saved | 9.4–10.7 s (5.6–5.8 s on 2026-10-13) | 1.3–1.5 s |
  | Liquid Glass, PDF size | 24.7 MB (25.0 MB) | 1.3 MB |
  | Excel / Excel Refined, click → PDF saved | 2.2–2.5 s (1.5–1.6 s) | 0.33–0.44 s |
  | Excel / Excel Refined, PDF size | 2.7 MB (3.3 MB) | 0.26 MB |
  | Liquid Glass, PDF as pictures | 90 s, 125 MB (4× pages) | 7–8 s, 69 MB (2× pages) |

  Every test deck's PDF is 1.3–18× smaller than 3.6's; the text in it is the slide's text once (3.6's PDFs held
  table texts twice and "ﬁ" ligatures, so copy / search gave doubled text).
* **Opened from disk (without the helper), exports work too: the files are downloaded** (B1). The browser asks
  once to use the PC's fonts; refused, the PDF is made of pictures and the message says so. Exports of several
  files (every version, PNG of every slide) are several downloads: the browser may ask once to allow that.
* **PDF · as pictures uses lossless pictures at 2× instead of 4×** (B9): sharp on screen, a quarter of the
  pixels (Excel, 20 slides: 11.6 MB; Liquid Glass 69 MB instead of 125 MB – its wallpaper's fine grain does not
  compress further).
* **Every version export is named `<workbook> - <version> - <design>.pdf`** (B11), also in one design.
  If one of them fails, the others are still saved and the message names the failed ones.
* A message names any font that had to be replaced in the PDF (a font of the library stored as WOFF2, as most
  Google fonts, is drawn with the next font of its list; the old engine below still embeds it).
* For this release only: **Export ▾ › PDF · text & tables (old engine)** makes the PDF the 3.6 way
  (`<workbook> (old engine) - slides.pdf`), and **Report a problem with this export…** saves a short report with
  the last export's details as a JSON file in `export\feedback\` (downloaded when opened from disk).
* In a dialog's text box, Enter starts a new line.
* A variable font uploaded to the font library is stored as a static .ttf at the weight given when uploading,
  so PDFs can embed it.

What users notice (fixes found by the review before M3, `docs/next/review-pre-M3.md`; approved by the product
owner on 2026-10-12)
* **Opening a second workbook while the first one is still being read** (a second drop, or Browse… during an
  upload) opens the newer one only. Before, the slides of one workbook could be shown and saved under the
  other's name.
* **Other people's changes no longer disappear for a moment on a slow shared folder** (a late answer could
  replace a newer one).
* **The "Reading…" / "Preparing pictures…" screen never stays up after an error**: the error is shown instead.
* **A large workbook whose saved slides use no sheet** (cover or contents only) shows the data of the tables
  added later at once, without a reload.
* **If the background reader stops** (e.g. out of memory on a huge workbook), the window says so and asks to
  reload, and no further edit is taken as if it were saved.
* **Changes that are not saved yet are kept** when another workbook is opened while the shared folder is
  failing (they keep being retried), and the browser asks before the window is closed with unsaved changes.
* **A password-protected workbook** is refused at once with a clear message ("is protected …") instead of
  "Converting with Excel…" for up to 4 minutes; Excel's conversion of other files never waits on a password.
* **A shared folder that stops answering** shows an error after 60 s (5 minutes for reading, uploading and
  converting a workbook) instead of "Saving…" or "Opening…" for ever; saving is retried.
* **Opened from disk (file://), a full browser storage** shows "not saved" instead of "Saved in this browser".

Also in 3.6.0 (not listed there)
* New texts in the wizard while a large workbook is read: "Reading the workbook…", "Reading “<sheet>”…",
  "“<sheet>” could not be shown: …"; a damaged workbook's message now names the reader's reason.
* The helper accepts a burst of requests without the ~1 s TCP retry (a save could stay "Unsaved changes" for a
  moment); the start file prints clearer messages when Python or the installed version is missing.
* The core worker holds the workbook: page and worker together use about 40 MB with a 130,000-row sheet open
  (the 15 MB of 3.6.0's note was the page alone).

Under the hood
* The page receives the document from the core worker only when it changed (not with every save-state
  change), and compares it once per confirmed edit.
* Goldens re-captured from v3.4.0 on the reference PC, so geometry, pixels and PDF positions are compared again
  (`golden/README.md`); a fresh Windows checkout builds the committed page and runs the tests (LF line ends,
  `python` on Windows).
* `npm run bench` also gates the core worker's memory and the first-slide task (250 ms), and scales its time
  limits by at most 2× on slower machines.

## 3.6.0 - 2026-10-12

What users notice
* **Opening a large workbook no longer freezes the window** (B8). The workbook is read in the background:
  the window keeps responding, the progress bar moves, and a 130,000-row sheet appears in the wizard in
  under a second (about 3 seconds in 3.5). The wizard's preview of a large sheet fills in row block by row
  block instead of all at once.
* **Comment… dialog: the "Unit after amounts" and "Ignore below" boxes keep what you type.** A space can be
  typed at the end of the unit ("mln EUR"), and "Ignore below" accepts numbers that start with 0 ("0.5").
  Before, each key press cleaned the box. Approved by the product owner on 2026-10-10 (PROGRESS.md).
* Nothing else changes in the slides, the exports or the saved setups (checked against 3.5 on every test deck).

Under the hood (no visible change)
* The workbook, the shared document and undo/redo live in a background worker ("core"); the page keeps
  read-only copies of the parts it shows. The page uses about 15 MB of memory with a 130,000-row sheet
  open instead of about 300 MB.
* Workbooks are read with a small XML reader and a columnar sheet store instead of the browser's XML parser
  and one object per cell; JSZip is replaced by fflate.
* The page needs a browser from 2021 or later (Chromium 94+: Edge and Chrome on every supported PC).
* `npm run bench` measures the page in Chromium too (open a 20-slide deck, read a 130,000-row sheet, long
  tasks, memory); CI fails above the limits.

## 3.5.0 - 2026-10-09

What users notice
* Nothing changes in the slides, the exports or the saved setups (checked against 3.4 on every test deck).
* A few things on screen now update at once instead of with the next background check (up to 10 seconds
  later): a message disappears as soon as its button ("Open", "Show folder") is clicked; the export-engine
  status after an install; the undo/redo buttons after undoing a change of another workbook; "Updated by …
  n min ago" keeps counting on its own (accepted in PROGRESS.md, Decisions, 2026-10-09).
* **"Saving…" shows in the status bar while a change is being written** (B6, like "✓ Saved" in 3.4). It
  used to appear only if something else redrew the status bar during the save.

Under the hood (no visible change)
* The screen around the slides is now real React 19 (it was Preact running the same code). The page is
  larger (about 660 kB instead of 465 kB) and still opens from disk without the helper.
* One store with selectors replaces the global state: a selection change redraws only the toolbars, the
  formula bar and the status bar; a background check that brings nothing new redraws nothing.
* The sources moved from `frontend/` to `app/`, with an empty `core/` package next to it for the next
  milestone (npm workspaces).

## 3.4.0 - 2026-10-09

What users notice
* **"✓ Saved" appears as soon as the change is on the shared folder**, instead of up to 3 seconds later
  (B6). A failed save or a "reload the page" message also shows at once.
* **The Open menu reads the list of workbooks when it opens**, instead of every 6 seconds in the
  background (B13). The "saved again in Excel" banner now checks only the open workbook.
* **Slide Builder starts in an Edge app window** (no tabs, no address bar) when Microsoft Edge is
  installed, and in a normal browser tab otherwise (B12). `SLIDEBUILDER_APP_WINDOW=0` keeps the tab.

For whoever updates the shared folder
* **Side-by-side versions with rollback.** `Update Slide Builder.bat` can install a release next to the
  current one (`app\<version>\`), test it against the folder's saved setups (`--selftest`, read-only), and
  only then switch `app\current.json`. `python tools\update.py --use <version>` goes back at once; the last
  3 versions are kept. `--zip <file>` installs a release ZIP without internet. A folder that has switched
  to releases keeps following releases; others keep the git/ZIP update as before.
* Releases are built by GitHub Actions on a version tag (`tools/make_release.py`, `MANIFEST.json` with a
  SHA-256 per file, checked by the updater together with GitHub's digest).

Under the hood (no visible change)
* Presence ("bob is also here") reads one directory listing instead of every heartbeat file; together with
  the Open-menu change, an idle user's file operations on the share drop about tenfold (measured: 910 to 78
  per user per minute with 10 users and 20 other decks, `tools/loadtest.py --count-ops --idle`; see
  PROGRESS.md, S0.4). Saves and polling are unchanged.
* Continuous integration (`npm run check`, helper tests on Python 3.8 and 3.12, end-to-end tests), golden
  captures of v3 for the rebuild (`golden/`, `npm run parity`), field-test kit (`tools/sharetest.py`,
  `tools/fieldcheck.html`, `docs/next/field-results.md`).

## 3.0 - earlier

The versions before 3.4 were not numbered per release; see the git history.
