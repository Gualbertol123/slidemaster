# Changelog

Every user-visible change, per release (PLAN Part B §8 lists the only ones allowed during the rebuild).
Releases are made with `docs/next/release-checklist.md`.

## 4.13.0 - 2026-10-23

What users notice
* **KPI cards** (the owner's request of 2026-10-23): *Insert chart ▾ › KPI cards from table…* makes a row of cards from
  a table like the owner's (one card per product); each card shows the name in a dark header bar, the current value
  green / red by sign and its changes against the budget, the previous week and the end of month – details below.
* **Chart cards** (the owner's request of 2026-10-23): a line, column, bar, area or combo chart can carry its own numbers
  inside its box – the chart panel's new **Card** section:
  * a **stats row** under the title: up to 4 chips, each a small label over a big number – the latest value, the first,
    the previous, the lowest or the highest, a cell of any sheet, the reference line's value (e.g. the EoM budget) or
    the **gap to it** (−1,700 in red, 210 in green; % too). *+ Stats and momentum* sets up the usual card in one step;
  * a **tag** in the title line's corner ("ILLUSTRATIVE" in red, "ACTUAL LOANS" in grey) – typed or from a cell;
  * a **separator** under the stats row;
  * a **momentum row** at the bottom: the latest value's change against the first period ("−1,420 (−16.9%) vs Q3"),
    since the trough or the peak, against the previous period ("WoW") or a cell – absolute, %, or both, green / red by
    sign, and *Down is good* for numbers that should fall (costs, outflows);
  * the plot makes room for them; every number follows the workbook, a reload, a scenario and Run for each value.
* **A chart from a long table**: *Filter* in the Card section picks the column (e.g. Product) and the value to keep
  (e.g. Deposits) – typed, or from a cell, so Run for each value can draw each product in turn. The periods become the
  chart's categories.
* PowerPoint: the card's numbers are text boxes and a line over the native chart (editable), never pictures.
* Decks that use a KPI card or a chart card open only in Slide Builder 4.13 or later (older versions show them
  read-only); `Update Slide Builder` names those decks before going back to an older version.

Details
- B54 · KPI card item (new item kind "kpi", core/src/model/kpi.ts, render/kpi-dl.ts): a dark header bar with the title in caps (typed or a cell), the big current value coloured by sign and good direction, a thin divider and N delta rows – a % read from a cell, or computed from a reference cell (% = (cur − ref) / |ref|, absolute, or both) – each with its label, good direction (up / down / neutral) and number format (the cell's, or its own). A zero reference shows "n/a" with an Issues line; a missing or non-numeric cell gives an Issues line, never a crash. Drawn in all five designs on the design's card (glass, plain card, outlined box, consulting tint); cells read as a chart's, so a reload, a scenario and "Run for each value" redraw it; PDF through the display list, PowerPoint as native shapes and text boxes (group "KPI card").
- B54 · Insert chart ▾ › KPI cards from table…: pick a range with a header row and one row per product (image 16); one card per row, evenly across the slide, in one undo step, each independent afterwards. Columns found by header name (Product, Current, Budget_reference / Previous_week / EoM_reference, Delta_*: a reference column gives a computed %, a Delta column alone a cell row), else by column order; labels "vs Bdg", "vs prev. Week", "vs EoM".
- B54 · review fixes: a sheet only a KPI card reads is loaded on reload, scenario and Run for each value (preset.ts kpiSheets); the format painter copies a card's direction; PowerPoint writes each text of a card as its own text box and the header bar as one shape of its height, rounded on top only; a long value or change shrinks to fit (cut with an Issues line only below the minimum size), rows that do not fit a small card are not drawn (Issues line); a near-zero change takes its sign and colour from the number as shown (never "−0"); the absolute difference defaults to #,##0.0 for a General cell; the fold drops malformed rows and formats. KPI cards from table: at most 4 cards a row (more rows below), a first row of numbers is data, Current never matches Currency, a second column of the same kind is reported.
- B54 · KPI card panel (ui/KpiPanel.tsx, fits a 280 px side panel): title typed or from a cell, the value's cell, direction and format; delta rows added, removed, reordered, each with its source (%, Δ, % Δ from a reference cell, or a cell), label, direction and format; cells picked in the sheet view.

## 4.12.0 - 2026-10-22

What users notice
* **Ctrl + mouse wheel zooms the slide, not the page** (the owner's request of 2026-10-22): over the slide the point
  under the pointer stays where it is; a trackpad pinch does the same. Over the side panel and the toolbars Ctrl + wheel
  zooms the slide too (about its middle); with a deck open the page itself never zooms any more, in a dialog neither
  (on the start page, with no deck, Ctrl + wheel and Ctrl + + / − / 0 are the browser's own page zoom as before). While
  a mouse button is held (a drag) the zoom waits. 25 % to 400 %.
* **Ctrl + + / Ctrl + − / Ctrl + 0** step the slide's zoom in and out and fit it to the window (the + key of an Italian
  keyboard and the numeric pad's too). Zoomed in, the mouse wheel scrolls the slide, Shift + wheel sideways.
* **The zoom is in the status bar**: − , the zoom (a click: 100 %), + and Fit. Fit is how every window starts; a window
  resized at Fit fits again, a chosen zoom stays. The zoom is your view only – not saved in the deck, not seen by
  colleagues, not kept for the next time.
* Zoomed in, the selection rings and the handles keep their size on screen; drags, snapping, resizing, label drags and
  typing on the slide work as at any zoom.
* **The toolbars fit the window** (1024 px wide and up; Windows' 125 % and 150 % display scaling too): the top bar and the
  text toolbar stay on one row, the layout toolbar on at most two. When a window is too narrow, groups first show their
  icons alone (each button keeps its name as a tooltip), then the least used groups move into **More ▾** at the end of
  the row – click it to use them. Nothing runs off the window's edge any more (before, Options and Export could be cut
  off on a small screen), and a menu opened near the edge stays inside the window.
* **The side panel folds to a thin rail** (« on its head, » on the rail to open it again): the slides by number, New
  slide, and the slide gets the room. Below 1100 px wide it starts folded until you open it; your choice is kept in
  this browser, like its width.
* The status bar's texts give way on a narrow window; the save state and the zoom always show.
* **One window for icons and shapes.** *Insert shape ▾* (a menu of six shapes, 17 built-in icons and *More icons…*) is
  now one button, *Shapes & icons…*, that opens one large window: about 6,200 icons to search by name or tag (English
  or Italian), by category, outline or filled, with the new icon's colour, size and line; the shapes that carry text
  sit in a column at its side – a **text box** (new: no fill, no border, text on the left), rectangle, rounded
  rectangle, pill, circle, arrow and speech bubble. In a narrower window (up to about 1,100 px) that column sits above
  the icons. The window fits screens from 1024 × 768 to 1920 × 1080, its icons in as many columns as fit.
* **The 17 built-in icons are no longer offered** – each has the same picture among the new icons (e.g. *warning* →
  *alert triangle*, *bank* → *building bank*, *pin* → *map pin*). Decks that already have them are unchanged: they are
  drawn, exported to PDF, PNG and PowerPoint and edited exactly as before (colour, size, place, undo). *Change icon…* on
  one opens the new window at its counterpart.
* The keyboard in the window: the search box has the focus; ↓ goes into the icons, the arrow keys, Home, End and
  Page Up / Down move through them (↑ from the first row back to the search), Enter inserts, Tab stays in the window,
  Escape closes it and gives the focus back to the button.
* No change to the deck format: a deck made with 4.12 opens in 4.11 (a text box is a rectangle without fill or border).

Under the hood
* app/src/stage/zoom.ts (the zoom's maths, the wheel and the keys), app/src/ui/OverflowBar.tsx (the toolbars' plan:
  measured, compact, More ▾), app/src/ui/NavRail.tsx; the zoom left the personal prefs (a zoom an older page kept there is
  not read). No change to the slides, the exports or the deck's format.
* Tests: tests/zoom.test.tsx, tests/responsive.test.tsx, e2e/responsive.spec.ts (RZ-01–RZ-03, its own workbook
  tests/fixtures/Zoom.xlsx); page budget page-budget/responsive.json.
* app/src/ui/IconPicker.tsx (the one window), ShapeColumn.tsx (its side column), icon-legacy.ts (the built-in icons'
  Tabler counterparts); tests/icon-picker.test.tsx, e2e/icons-412.spec.ts (ICW-01–ICW-05, its own workbook
  tests/fixtures/Icons.xlsx); page budget page-budget/icons.json.

## 4.11.0 - 2026-10-22 (B53: chart labels)

What users notice
* **More room for the chart itself** (B53): a chart keeps on its right only the width of the labels that are really
  there – a reference line's label may use the card's own margin, and a gap arrow's label is measured on its own
  difference (e.g. "−348") instead of on a number as wide as the line's value. A chart of one series with a reference
  line, gap arrow or change pills has no legend unless a place is chosen for it (as Excel's single-series chart). A
  value label above the highest point no longer runs over the title: the plot starts a little lower instead.
* **A reference line's value shows as the axis does** (B53): a value cell in Excel's General format (and a typed value)
  is shown in the format of the axis's numbers – "12.000", not "12000"; a line without a name shows its value alone.
* **More places for every label** (B53): point values *Auto* (below a dip, above the rest, on the free side where two
  would collide), and each point's own place (Chart panel › click a point › Label › Place); a reference line's label
  right of the plot (as before), on the line inside the plot, above or below its right end, or above its left end; a gap
  arrow from the line to the point (as Excel) or from the point to the line, its label left or right of the arrow, its
  caption under or over the number; change pills above the axis, under the line, under each point, along the top or
  below the category labels, their caption left, right or under the row.
* **Drag any chart label on the slide** (B53): with the chart selected, drag its title, a point value, a reference
  line's label, the gap arrow's label, a pill or a caption to where you want it. It keeps that place relative to where
  the chart would put it, so it follows the data when the workbook changes. Each drag is one undo step; *Chart panel ›
  Moved labels › Reset* puts every label back. PDF, PNG and PowerPoint draw them there (in PowerPoint a moved point
  value is the chart's own data label, moved).
* **An axis's minimum, maximum and step from Excel** (B53): *Chart panel › Axes › Cell…* under Min, Max or Step picks a
  cell in the sheet view; the axis follows it on a reload, a scenario's value and *Run for each value*; × goes back to the
  typed (or automatic) value. A cell without a number is named in the Issues panel. PowerPoint gets the same bounds.
* Smoothed lines and markers stay per series (*Chart panel › Series › ▸ › Line: Smoothed, Markers*).
* A deck that uses one of these is marked for Slide Builder 4.11 (format 8; the first such edit shows "Saving…" for
  about 23 seconds once): Slide Builder 4.10 and older open it read-only and ask to update.
* **Update day:** a Slide Builder 4.10 window still open during the update shows "⚠ a journal of this deck is damaged
  (incident-format-8.json) – the deck is read-only; tell the maintainer" for decks that now use 4.11's chart labels.
  This is expected and harmless: close the window and start Slide Builder again. Update everyone together.

## 4.10.2 - 2026-10-22

What users notice
* **The side panel is wider and can be resized.** The panel left of the slide (the slides, a chart's settings, Issues)
  is now 340 px wide instead of 250; drag its edge by the slide to make it wider or narrower (from 280 px up to half the
  window) – the width is remembered in this browser, and a double-click on the edge goes back to the usual width. The
  edge also works from the keyboard (Tab to it, ←/→, Home, End, Enter for the usual width). The slide fits itself to
  the space that is left: on wide 16:9 screens it keeps its size; on taller 16:10 or 4:3 windows the wider panel can
  make the slide smaller (about 9 % on a 1280×1024 screen, more on narrower ones) – drag the edge back to give it the
  room again.
* **A chart's panel is no longer squashed.** The chart types are a grid of equal buttons that never overlap; text boxes
  take the room left on their row and are no longer cut off; Min, Max and Step of an axis sit in three tidy columns; the
  small buttons of a series, a reference line, a gap arrow or change pills stay on their row (the × is never alone on
  a line). With a chart selected, the side panel scrolls as one page, so the end of a long chart panel is reachable.

## 4.10.1 - 2026-10-22

What users notice
* **.xlsb workbooks that failed with "a string is longer than its record" now open.** A conditional format (or a table
  style) that sets a number format – e.g. a rule that shows a figure as `0.0%` – made the Sheets step stop with *Could
  not read the sheets*; such workbooks now read, and those rules draw with their number format as in the .xlsx.
* **Unreadable extras are skipped and listed in Issues** instead of stopping the workbook: a conditional format, a
  format of a rule, a cell or a column width of an .xlsb that cannot be read is left out and named on the slide's Issues
  panel ("Sheet: a conditional format could not be read and is not drawn"). When something the deck needs cannot be
  read (the sheet list, the shared text), the message names the part and the record.

## 4.10.0 - 2026-10-22 (B52: targets on charts)

What users notice
* **Reference lines from a cell** (B52): in a column, line, area or combo chart's panel, *Targets › + Reference line from
  a cell…* asks for one cell in the sheet view – a budget, an ambition, on any sheet or a linked workbook – and draws a
  line across the chart at its value, labelled at the right end with its name and value in the cell's number format
  (the workbook's separators). The line follows the workbook: a reload, a scenario's value and *Run for each value* move
  it. Its name can be typed or come from a cell; *+ Typed* draws one at a typed value instead. Each line has its own
  dash (dashed, dotted, solid), colour, width and label (name and value, name, value or none; at the right end, the left
  end or above the line), and the chart's scale makes room for it. Several lines per chart.
* **Gap arrows** (B52): *+ Gap arrow* draws an arrow from the last point (or the selected one) to a reference line with
  the live difference (e.g. "−348") and a caption ("gap to budget"), red below the line and green above it by default;
  the %, the number format, the side, the arrow heads and one fixed colour can be chosen.
* **Change pills** (B52): *+ Change pills* puts a pill between each pair of consecutive points with the change and its %
  (e.g. "−165 (−1.4%)"), coloured by sign (own colours for a rise, a fall and no change), above the axis or under the
  line, for every pair or the last one only, with a caption ("Week-on-week change"). *Point values* switches the line's
  value labels on or off.
* Every extra is switched on or off on its own (its settings kept), and each change is one undo step. Defaults follow the
  design – the Intesa Sanpaolo template's blue, grey and green in Excel and Excel Refined.
* **PowerPoint**: each reference line is a real series of the native chart (*Edit Data* shows its value; changing the
  first row moves the line), the gap arrow a line with a real arrowhead, the pills rounded rectangles with text – placed
  where the slide draws them; never pictures.
* Where an extra can't be drawn faithfully it is left out and the Issues panel says so: reference lines on a 100 %
  stacked chart, gap arrows from a stacked series, a line whose value cell the shown version empties; on a chart whose
  lines are stacked, PowerPoint gets the reference line as a plain dashed line shape instead of a chart series.
* A deck that holds one of these is marked for Slide Builder 4.10 (format 7; the first such edit shows "Saving…" for
  about 23 seconds once): Slide Builder 4.9 and older open it read-only and ask to update ("a journal of this deck is
  damaged … tell the maintainer" in 4.0–4.9 means: update Slide Builder).
* **Update day:** a Slide Builder 4.9 window still open during the update shows "⚠ a journal of this deck is damaged
  (incident-format-7.json) – the deck is read-only; tell the maintainer" for decks that now use 4.10's chart targets.
  This is expected and harmless – the 4.9 helper reads the format-7 marker as an incident; nothing is damaged or lost:
  close the window and start Slide Builder again to use 4.10. Update everyone together.

## 4.9.0 - 2026-10-22 (PLAN M16: tables; B36–B39; S13.7; M17 audit fixes (docs/next/AUDIT-3.md); B51; docs/next/09 §3)

What users notice
* **Hidden rows and columns per slide** (S16.1, B36): Ribbon 2 › Cells › *Hide ▾* – *Hide rows*, *Hide columns*,
  *Unhide all on this table*. The table closes up on that slide only (the same table on another slide keeps them); a
  thin double mark on the stage shows where rows or columns are closed up, a click on it unhides them. A chart on the
  slide that reads the table skips the hidden rows too; a chart on another slide keeps them. Exports (PDF, PNG,
  PowerPoint's real table) leave them out. A table keeps at least one row and one column; each action is one undo step.
* **Delete rows and columns per version** (S16.2, B37): the wizard's step 4 has *Delete rows* and *Delete columns*
  beside *Remove cells* (struck through on the grid, ✕ restores one), and Ribbon 2 › Cells › *For this version ▾*
  deletes rows / columns, empties cells or restores them for the version shown. That version's tables close up, its
  charts and callouts skip the deleted cells, and every export and run of that version follows; the full deck and the
  other versions keep them. A delete that would leave a table empty is refused; should two people's changes still
  reach it, that version is not exported (the export names the version and the table) until some rows are restored
  (AUDIT-3 DATA-8). Undoing a version's delete puts the version back at its place in the list (UNDO-1).
* **The fuller format painter** (S16.3, B38): new *Number* buttons – fewer / more decimals, percent, thousands –
  and the top / middle / bottom buttons now work on cells; *Clear format* clears both. The painter also copies the
  number display and the vertical position (a date keeps its own date format). Ctrl+click several ranges – on any
  table of the slide – or several objects, let go of Ctrl: one paste, one undo step. A chart's, callout's, icon's or
  line's look can be painted onto others of its kind (a chart keeps its own data, scale and titles).
* **Excel's conditional formats on the slides** (S16.4, B39): every rule type Excel 2016 writes – colour scales, data
  bars, icon sets, top / bottom, above / below average, unique / duplicate, text, dates, blanks / errors, cell value
  and formula rules – is drawn as in Excel, in every design (icons in the design's colours), in PDF / PNG and in
  PowerPoint (a real table, with the bars and icons as shapes – never a picture). What is not reproduced is listed in
  the Issues panel. A text edit made on the text a rule shows stays.
* **Delete slide and Duplicate slide** (S13.7, owner Q12), as in PowerPoint: right-click a slide in the slide list ›
  *Duplicate slide* puts a copy right after it – its tables, texts, formats, charts and callouts, free layout, looks and
  hidden designs – and shows it; it exports exactly as the original but for its page number. *Delete slide* (or the
  Delete key on a selected slide in the list) asks first; the slide's tables stay in the deck (*Add table* puts them on
  a slide again). Each is one undo step. The cover and the contents slide are not duplicated (the deck keeps one of
  each), and the last slide of a deck is not deleted.
  A deck with a duplicated slide still opens in 4.6.0 (no new op or key) – unless the slide has hidden rows (below).
* **Move the contents and its title freely** (B51): *Free layout* now works on the contents slide too. Its list and its
  title (with the subtitle) each get a table's handles – drag the grip to move it anywhere on the slide, the corner or
  an edge to make it larger or smaller (its proportions kept), with the same snapping (Alt: none). Each move is one undo
  step and is kept per slide and design; PDF, PNG and PowerPoint draw them where they were dropped (in PowerPoint the
  title stays the slide's title placeholder, the entries text boxes). The list still follows the deck – new, renamed or
  hidden slides and the page numbers. A contents slide never moved looks exactly as before, in every design.
* **Decks using 4.9 features open read-only in 4.0–4.8: update everyone together** (AUDIT-3 COMPAT-1, format 6).
  The 4.9 features are rows or columns deleted for a version, hidden rows or columns, a cell's vertical position or
  number display, a moved contents list or title. Before the first such change a 4.9 window prepares the deck (about
  23 s of "Saving…", once per deck); from then on older windows show it read-only and ask to update – without this,
  a 4.6–4.8 window's wizard could erase a version's deleted rows, and its exports showed them.
  `Update Slide Builder.bat --use 4.6–4.8` names these decks and asks first. On update day close every Slide Builder
  window on every PC, as for 4.8 (`docs/next/release-checklist.md` §6).
* **The slide no longer stays at its old size after a right-click** (the M15 speed fix's review): the slide keeps its
  size only while the left button is held; a context menu, or a button let go outside the window, fits it again.

For the maintainer
* New keys and ops – `slide.patch` `hidden`, `version.patch` (a version's `drop`), `cell.patch` `valign` / `num` – are
  **format 6** (ADR-019 amendment of 2026-10-22: `needsV6` / `docNeedsV6` from 4.8.0's frozen lists, marker
  `incident-format-6.json`, `X-SB-Deck-Formats: 4,5,6`, route `POST /api/decks/<key>/format6`; CP-01 cases `m15`,
  `m16`) (vectors `shared/ops-vectors.d/m16-*.json`; saved fixtures `hidden-4.9.json`, `versions-4.9.json`,
  `cells-4.9.json`, `cf-edits-4.8.json`).
* Integration on M14 and M15 (branch `v4/M16-tables`, release branch `v4/release-4.9.0`): S16.1's chart rule (`chartHide`) lives in `render/chart-data.ts` and
  covers the series charts too; S16.4's `editedCellText` is used by `chart-data.ts`'s `shown`; S16.3's painter takes a
  line's look on M15's lines too (`stage/lines.tsx`); B51's parts snap with M15's snapping (`stage/drags.ts` `freePart`);
  M16's Hide ▾, For this version ▾ and fewer-decimals buttons take Tabler icons (B35's rule).
* M17 audit fixes (docs/next/AUDIT-3.md): COMPAT-1 (format 6; `tools/capture-v3.mjs` reads it), DATA-8, UNDO-1, VEC-1
  (a waterfall's `points[i].total` vector), VEC-2 (S13.7's vector in `m16-slides.json`); CP-01 (`tools/compat-old.mjs`)
  now runs against 4.7 (`v4.7.0`) and 4.8 (`v4.8.0`, else `36d689a`) as well.
* B51: the contents slide's parts are boxes of the slide's existing `free` entry (keys `c:title`, `c:toc`, with their
  `scale`; `render/contents.ts`) – no new op or key; a free entry holding one is format 6 (`needsV6` / `docNeedsV6`:
  4.6–4.8 keep it but draw the contents unmoved) (vectors `shared/ops-vectors.d/b51.json`).
* Page budget parts: `m16-hidden.json`, `m16-versions.json`, `m16-painter.json`, `m16-cf.json`, `s13-7.json`, `b51.json`, `m17.json` (the release page 4,874,382 bytes against 4,887,562).

## 4.8.0 - 2026-10-22 (PLAN M15: lines, icons, snapping; B32–B35)

What users notice
* **About 6,200 icons** (B34; Tabler Icons 3.49.0, MIT – named in the notices): ribbon 2 › *Insert shape ▾* ›
  **More icons…** opens a picker – search by name or tag (English words, e.g. "bank", "arrow up"), outline or filled,
  41 categories, the icons used last – and puts the icon on the slide in the colour, size (32–128 px) and line width
  (1–3) chosen there. A selected icon has *Change icon…* (another one, same colour, size and place), its size and its
  line width on the ribbon; each change is one undo step. The icons are in Slide Builder itself: no internet needed.
  The 17 icons of earlier versions are still in the menu and look as before.
* **Search the icons in Italian too** (09 §9 Q11): about 300 common Italian words – "banca", "obiettivo", "grafico",
  "freccia su", "stretta di mano", "città" or "citta" – find their icons first, beside the English names and tags.
* **Icons in charts** (4.7's chart marks): a chart's icon mark with a Tabler name (the reference chart's targets) now
  draws that Tabler icon – its lines with round ends, its filled dots – instead of the built-in icon of the same name,
  on the slide, in the PDF and as shapes over the PowerPoint chart.
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
  consulting design's dark band or Consulting Red's panel – in white where the line's ink would not read there; a line
  in a light colour (white, light grey) whose label sits on a light ground has its label in the design's ink, so it
  reads.
* **Lines in PowerPoint are ordinary line shapes** with PowerPoint's own arrowheads – never connectors and never
  pictures – placed where the line is drawn on the slide (PowerPoint does not keep them attached). Their labels are
  text boxes grouped with them. Dashes are kept, and the ticks of a range marker or limiter stay solid with round ends
  as on the slide (beside a dashed line or an arrowhead they are a small shape of their own in the same group). In the
  PDF and on screen they are drawn as on the slide. Older versions (4.6, 4.7) do not show the new lines – open such
  decks in 4.8.
* **Lines in a free layout and older windows**: a 4.6 or 4.7 window that switches the free layout of a slide with a
  line off and on again saves the line's place without its ends. 4.8 then draws that line with its own ends moved as
  its box moved: a line whose ends were dragged in the free layout loses that shape (its ends attached to objects still
  follow them). Moving objects in 4.6 or 4.7 keeps it. Close every older window on update day (below).
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
  and their tooltips; nothing moved. Messages that named a button by its old symbol (✦ Wizard, ⚙ Options) now name it
  by its words.

For the maintainer
* **Update day (4.6 / 4.7 → 4.8): every Slide Builder window and black window is closed on every PC before the
  update** (`docs/next/release-checklist.md` §6). Lines, Tabler icons and an icon's line width are 4.6 objects
  (ADR-019): a deck holding them is marked for 4.6 before the first one is saved, as in 4.6 (once per deck, about 25
  seconds of "Saving…"). 4.6 and 4.7 open such decks and keep the new objects but do not draw the lines and show ⓘ
  for the Tabler icons; 4.0–4.5 open them read-only – never delete their `incident-format-5.json`.
* **The Tabler set is inside the page** (`core/src/icons/data.ts`, ≈ 0.5 MB of the page, deflated; ADR-020
  amended): no network, no npm package. `node tools/vendor-tabler.mjs` / `tools/vendor-ui-icons.mjs` rebuild it from
  the 3.49.0 release tarball, checked against the registry's integrity; `THIRD-PARTY-NOTICES.txt` names Tabler Icons
  (MIT).
* **The PowerPoint gate** (`tools/pptxcheck.py`) checks two more things: (6) every icon is a custom-geometry shape, never
  a picture, round line ends; (7) every line is plain line shapes with PowerPoint's own ends – no connector
  (`p:cxnSp`), no picture – and the shapes a check names for the 1/4 px grid sit on multiples of 1,905 EMU.

## 4.7.0 - 2026-10-22 (PLAN M14: charts; B30, B31; docs/next/09; ADR-015 amended 2026-10-21)

What users notice
* **New chart types** (B30): column and bar (clustered, stacked, 100 %), line (straight or smoothed; circle, square,
  diamond or triangle markers; a blank cell leaves a gap), area (standard, stacked, 100 %; a blank cell is drawn at
  zero, as Excel and PowerPoint draw it), scatter (points at their x and y on a numeric x axis, an optional straight or
  smoothed line), waterfall (steps floating on the running total in the design's positive and negative colours, columns
  marked "a total" standing on the axis, thin connectors, values shown by default; legend Increase / Decrease / Total)
  and combined charts – columns, lines and areas together, each series on the left value axis or on a second one on the
  right (drawn only while a shown series uses it). In every design (Liquid Glass: gradient bars with a rounded end, on
  its glass card).
* **Several series per chart**, each from its own cells: any sheet, another slide's table, a linked workbook. Hidden
  rows are left out; a version's removed cells and text cells are gaps. **Category groups** side by side on one axis
  (for example the weeks, then the month-end targets), with a divider between them and, when named, their names in a
  second row of labels.
* **Axes** with Excel's automatic bounds and steps, or their own minimum, maximum, step and number format; gridlines on
  request; gap width and overlap as Excel. **Data labels** (value, name, category, percent; outside or inside the end,
  centre, inside the base; above, below, left, right or centred on a line's points – one that would overlap its
  neighbour, a bar or the line moves to the other side or is left out). **"Actual inside target"** columns: the value
  filled, its target outlined over it at the same width, the label "97 %" (value ÷ target). **Per-point** colours,
  marker colours and labels (or none).
* **The legend** (B31) right, left, top, bottom, top right or inside the plot; one entry or all of it hidden.
* **Annotations that follow the data**: an arrow from the axis to a point, a line or a band at values, an icon or a text
  (which can quote cells, as callouts do) above a column – they move with a reload, a scenario's value or a version.
* **The chart's side panel**: the type switch offers every chart type (a pie or donut becomes a series chart of its own
  numbers, keeping its slice colours as the points' colours and its name and value labels, and can go back); the series
  list – add a series from cells chosen in the sheet view (any sheet, a linked workbook's too), remove, move up or down,
  its name (typed or from a cell), colour, numbers, x values, targets, type and axis in a combined chart, smoothed line
  and markers, labels and their place, hidden; the selected point's colour, marker colour, label and, in a waterfall,
  "a total"; each axis; the legend; category groups; marks at the selected point; a frame and a line under the title.
  A click on a point or a mark selects it (a ring shows it; the status line names it). Each change is one undo step;
  two people changing two different series at once both keep their change, as do two people adding a series, a group
  or a mark at the same time; on the same series the later change wins.
* A stack per series is not offered: PowerPoint stacks a whole chart, never one series apart (the panel shows it
  switched off and says why); the chart's own Stack setting is there.
* **Charts made by earlier versions** look exactly as before: a chart without series draws as a pie (or a donut)
  whatever type it was saved with; the panel shows it as the pie it draws, and choosing Column (or any series type)
  gives it its first series.
* **Issues line**: when a series on the left axis runs under a series on the right axis, the Issues panel says that
  PowerPoint will draw the right axis's series on top (the slide draws them in the list's order).
* The owner's "Loans Volume – Weekly Evolution" chart is rebuilt in the chart corpus (`tests/corpus/charts/lines.json`).
* **PowerPoint export** of every chart type – column, bar, line, area, scatter, combined on two axes, waterfall, pie,
  donut – as a native PowerPoint chart drawn where the slide draws it (the same plot area, axis bounds, bars, labels and
  legend), its data in the embedded workbook: *Edit Data* shows each value with its own number format, and on a
  waterfall moves its columns when a value changes (while each step keeps its side of zero). Named groups are
  multi-level categories; targets an outlined series over the actual one; a waterfall the classic stacked construction
  every PowerPoint opens. Arrows and lines on a chart are PowerPoint lines with PowerPoint's own arrowheads (triangle,
  open arrow, stealth, oval, diamond; small / medium / large); dividers, bands, icons and texts are plain shapes over
  the chart in its group. No picture, no connector shape, no link to the workbook.
* **Italian separators in PowerPoint charts**: numbers inside a PowerPoint chart (axes, labels taken from the cells,
  *Edit Data*) are shown with the separators of the computer that opens the file, as Excel does – on an Italian
  Windows 11.576 and 2,5 %, on an English one 11,576 and 2.5 %. The slide, the PDF and the PNG always show the
  workbook's Italian separators; the "97 %" of "actual inside target" is written as text, the same everywhere.
* **The first save after a deck's first chart may take about 25 seconds** ("Saving…"): a deck holding a 4.7 chart is
  marked for 4.6 and later once (the format guard's one-time wait, 4.6.0; Decisions 2026-10-21). An export started in
  those seconds waits for that save, so **the first export right after adding a deck's first chart may take ~25 s**;
  later saves and exports are as fast as before (a PowerPoint deck of 20 slides with 6 combined charts: about 2 s).
* **Excel and Excel Refined in the Intesa Sanpaolo template** (B48): the cover has the template's blue band, the deck's
  logo above the title, the title in 26 pt bold blue and the subtitle in grey; titles and subtitles, the page number
  (top right; on by default unless the deck turned it off, none on the cover), the logo (bottom right), Century Gothic, the contents slide, bullets as tilted squares, outlined boxes and
  the template's colours follow it. Long titles shrink to fit before they are cut. Liquid Glass and the consulting
  designs are unchanged.
* **Comment borders** (B49): a comment's box gets a border of the weight and colour you pick, or none (in Excel and
  Excel Refined a border without a colour takes the template's grey, #7F7F7F).
* **Comments as the macro writes them** (B50): vs Budget – Budget Performance and vs Previous Week – Weekly Momentum,
  with the top contributors, the concentration ("largely driven by …"), the downside and the alerts (−5 % vs Budget,
  −1 % week on week; editable); each section can still be added or removed, and has a rule: always, only in the last
  week of the month, only in the first week, or from day N (e.g. "vs monthly Budget" only at the end of the month).
  Comments written before keep their text until you switch them.
* **Charts in the template** (Excel and Excel Refined, with the Aurora or Intesa Sanpaolo colour theme): every chart
  starts in the template's chart colours (its blue first, at 25 % transparency), lines are drawn 2 pt wide, an area chart
  is drawn as lines – stacked areas as stacked lines, each on the series below it – and doughnuts are thinner; the same
  in PowerPoint (a native line chart). Liquid Glass and the consulting designs draw charts as before.
* **Chart colours** (owner's decision, 2026-10-21): a chart starts in its design's colours and follows the design you
  switch to; a colour you set for a series, a point or a slice stays in every design. ↺ beside a series' colour gives it
  the design's colour again (as slices and points already had).
* **A 4.6.0 window on a 4.7 deck** (both read format 5): it keeps every border, macro comment and chart as saved, but
  shows a macro comment as a summary, draws no comment border, has no default page number in Excel, and draws a series
  chart as 4.6 drew charts (a pie of the cells the chart was first made from), without its series, axes, legend
  settings or marks – update to 4.7.

For the maintainer
* A deck holding any of the new chart fields (`sers`, `groups`, `axes`, `marks`, `legendHide`, `titleFmt`, …) is
  format 5 (ADR-019): 4.0–4.5 refuse it; a 4.6 page opens it, keeps every chart field byte for byte when it edits and
  compacts (CP-01 case m14, `tools/compat-old.mjs`).
* `tools/pptxcheck.py` checks the chart kinds of every export (`kinds`), and on Windows `plots` compares PowerPoint's
  own plot areas, axis bounds and mark ends with the export's (`node tools/m14-package.mjs --out DIR` makes the
  package).
* B48–B50 (branch `v4/B48-B50-isp`) and M14 merged: the template's chart rules live in `render/isp.ts` (`ISP.chart`)
  and reach the charts through `chartLook` (`ChartLook.hole`, `ChartLook.trend`); `core/tests/dlhash.test.ts` keeps
  Liquid Glass and the consulting designs as they were (its fixture re-recorded for M14's embedded chart workbooks only).
* The page grows by about 150 KB for M14 and 41 KB for B48–B50: 4,167,645 bytes (`app/tests/page-budget/m14.json`,
  `b48.json`, `b49-b50.json`).

## 4.6.0 - 2026-10-21 (PLAN M13)

What users notice
* **The share goes from 4.0 straight to 4.6**: users also get everything listed for 4.1–4.5 in CHANGELOG.md (never released
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
