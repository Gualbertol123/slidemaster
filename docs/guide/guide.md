# Slide Builder 4 – the guide

For the team: the people who make the decks, the product owner and the maintainer.
Program version 4.6.0 (`helper/slidebuilder/__init__.py`): everything of 4.1–4.6, which reach the shared folder together
as 4.6. Written on 21 October 2026. Every picture is a screenshot of the program, taken on the test workbooks of the
repository.

<!-- Placeholders for the parts being merged after 4.6 (a later pass fills them in, here and in guide.html; each is an
     HTML comment of exactly these words where its text goes):
     "4.7: charts"                            part 4, Charts – M14: the new chart kinds (CHANGELOG 4.7.0)
     "4.8: lines, icons, snapping"           part 4, Shapes and icons / Free layout – M15 (CHANGELOG 4.8.0)
     "4.9: tables"                           part 3, three places: Slides (the slide list's Delete slide / Duplicate
                                               slide, Q12), Cells (per-cell number display – decimals −/+, %, thousands –
                                               and vertical alignment, Q9; the painter on a multi-selection, Q19) and
                                               Tables (the same for whole tables)
     "template, comments B48–B50"            part 3, Automated comments and Designs – the ISP template for Excel and
                                               Excel Refined (B48), comment borders (B49), the macro comments (B50) -->

---

## 1. What Slide Builder is

Slide Builder turns tables in an Excel workbook into a deck of 16:9 slides. The workbook stays on the shared
folder; Slide Builder reads it and draws the slides from its numbers. When the workbook changes, the slides change
with it.

**Five designs.** *Glass* (Liquid Glass) redraws each table as translucent glass cards, capsules and fine lines
over a coloured background. *Excel* draws the table exactly as the workbook formats it. *Refined* (Excel Refined)
draws it like Excel in one polished style. *Navy* and *Red* (Consulting Navy, Consulting Red) draw each table as a
data exhibit with trend lines and bars, under a headline of key figures. One click switches; each design keeps its
own table sizes. Text boxes, comments, notes, charts and shapes show in every design.

**Many people at once.** Everybody opens the same workbook from the shared folder and edits the same deck. Other
people's changes appear on your screen within 1–2 seconds. Nothing has to be "checked out" or locked.

**Never touches the workbook.** Everything you change (a bold cell, a text box, a colour) is stored beside the
workbook, in the folder `backend\data\`. The `.xlsx` file itself is never written.

**Exports.** PDF with real text and lines, PDF made of pictures, PowerPoint files with editable text and real tables
and charts, PNG pictures of slides, and a copy of the slide for pasting. Several versions and designs – or one file
for each value of an input cell – can be exported in one go.

*Picture: the window, with its parts numbered.*
1 Open – the workbooks of the folder. 2 ↻ – read the workbook again. 3 ✦ Wizard – sheets, tables, slides, versions.
4 the workbook's name and number of slides (with versions, the *Version* list follows it, and the initials of the
colleagues in the same workbook). 5 Glass · Excel · Refined · Navy · Red – the design. 6 Design… – colours, text
styles, fonts. 7 Subtle · Medium · Strong and Colour – the glass strength and how colourful the background is (Glass
only). 8 ⚙ Options – page numbers, footer, logo, look, administration. 9 Export PDF ▾. 10 the text toolbar. 11 the
layout toolbar (cells, tables, insert, text boxes). 12 the formula bar. 13 the slide list and + New slide. 14 notes
about the current slide (the Issues panel). 15 the Formulas line. 16 the deck's health line. 17 the slide. 18 zoom.
19 the status bar. 20 whether your changes are saved.

---

## 2. Getting started

### The shared folder
All workbooks live in one shared folder, for example `T:\Slide Builder\`. Its main parts:

| In the folder | What it is |
|---|---|
| `Start Slide Builder.bat` | starts Slide Builder on your PC (use the desktop shortcut it made) |
| `Install Slide Builder.bat` | the first-time set-up on a PC: checks Python and the folder, makes the shortcut |
| `Update Slide Builder.bat` | for the maintainer: installs a new version for everybody; it runs `tools\update.py` |
| `Start Slide Builder (v3).bat` | while it exists: Slide Builder 3 on the same data (part 9) |
| your `.xlsx`, `.xlsm`, `.xlsb` (`.xls`) workbooks | read, never changed |
| `export\` | where PDFs, PowerPoint files and pictures are saved |
| `app\<version>\` | the program, one folder per installed version, with its licences (`THIRD-PARTY-NOTICES.txt`) |
| `backend\data\` | everything people changed: the decks, settings, fonts, logos, backups |

### Starting
Double-click the desktop shortcut (or `Start Slide Builder.bat`). A black console window opens – keep it open, it
is the small program that reads and saves files for you (the *helper*; if it cannot start, it says to run
`Install Slide Builder.bat` first). Slide Builder then opens in its own Edge
window, without tabs or address bar. It reopens the last workbook you used – unless you already opened one in the first
moments. Starting it a second time opens the one already running (the helper uses port 8765, or the next free one up to
8784). Before any workbook is open, the start screen offers *Open* and *Licences…*.

### Opening a workbook
*Open* lists the workbooks of the folder, newest first, with the time they were saved and "slides by <name>" – the
last person who changed that workbook's slides ("No .xlsx files next to the app" when there are none). *Browse for a
workbook…* picks a file elsewhere; you can also drop a file anywhere on the window. A file that is not in the folder is
handed to the helper and its name says "· not in the folder" ("· preview only" if that fails); the same file as one of
the folder opens as that one. *Reload "…" from disk* (and the ↻ button) reads the workbook again after it was saved in
Excel.

`.xlsx`, `.xlsm` and `.xlsb` are read directly; a large one shows a progress bar while it is read. An old `.xls`, or a file protected in a way the page cannot read, is
converted by the PC's Excel first ("…was converted by Excel for reading – the original file is unchanged"). A file
encrypted with a password or a sensitivity label cannot be read; Slide Builder says so.

The first time a workbook is opened, the wizard starts. If the workbook has sheets whose name contains "slide" with
"x" tables on them, the deck is made directly at start-up and you can open the wizard later.

A workbook that has a saved setup asks *Saved preset found*: *Continue with preset*, *Open editing wizard*, *Cancel*, or – unless
this window has that deck open already – **Delete setup…** – the workbook's whole setup (tables, slides, design, versions, comments) is deleted for everybody
and the wizard starts as for a new file. The workbook is not changed and a backup is kept (part 9, Saved setups).

### The wizard (✦ Wizard)
Four steps; the step buttons at the top go back and forth; ✕ or Esc asks before closing.

1. **Sheets.** Tick the sheets to use. Sheets whose name contains "slide" are ticked for you. Each line shows the
   sheet's size, its title and how many tables were found. *Only "slide" sheets*, *All*, *None*. Hidden sheets are
   never listed; a sheet that cannot be read is greyed, with the reason. In a large workbook only the ticked sheets are read ("not read yet"; the line "N of M · X MB to read" counts them); **Scan for "x" tables** reads
   the ticked sheets at once and shows each one's "x" tables, title and suggested tables (they are defined, as *Next*
   would). *+ Add a linked workbook…*: part 7.
2. **Tables.** The sheet is shown like Excel. Drag across the cells of a table (or Shift+click, Shift+arrows) and
   press Enter or *Add table*; or type a range such as `C4:T56`. *grows when rows are added below* keeps a range
   table following new rows. *Use "x" tables* takes the tables marked with "x"; *Add detected tables* takes the dashed
   suggestions. The list on the right names each table, its range and size and the slides it is on, and warns about
   very large ones; a click on a table in the sheet scrolls the list to it.
3. **Slides.** Drag tables onto slides (or click a slide, then click tables). *One slide per sheet*, *+ New slide*,
   ↑ ↓ to reorder, ✕ to remove. Tick *Cover slide* (title, subtitle, date – automatic means today –, a small note)
   and *Index slide* (the list of slides with page numbers, *with subtitles* or without). *Logo* per slide.
4. **Versions.** A version is the same deck with some cells removed – for example *Chief* (everything) and *All*
   (without the budget figures). Add a version (or *+ Chief*, *+ All*), pick it, drag over the cells it must not
   show and press *Remove*. Removed cells are drawn completely empty in that version.

*Save preset & show slides* saves the setup (the *preset*). If somebody else changed the slides while you were in
the wizard, you are asked whether to keep yours or theirs.

### "x" markers
Put an `x` in the cell just above and to the left of a table's top-left corner, and another just below and to
the right of its bottom-right corner. Slide Builder finds the table between them. The marker cells themselves are
not part of the table.

---

## 3. Editing

The slide works like a sheet in Excel: click a cell, Shift+click or drag to select more – or arrows and Shift+arrows
(hidden rows are skipped), Ctrl+A for the whole table. Type to replace the text, F2 or a double-click to edit it,
Enter / Shift+Enter or Tab / Shift+Tab to move on, Esc to cancel, Del to clear; Ctrl+B and Ctrl+I set bold and italic. Everything you change is stored as a change
to the deck, keyed by sheet and cell; the workbook is not touched.

### Slides: new, hidden
* **+ New slide** in the slide list's header, **Ctrl+M**, or right-click the list › *New slide* adds a blank slide
  after the selected one, its title ready to type. One undo step.
* **Hide slide**, as in PowerPoint: right-click a slide › *Hide slide* hides it in the current design (*Show slide*
  brings it back); *Hide in every design* hides it in all five. A hidden slide stays in the list – grayed, its number
  struck, marked *HIDDEN* – and on the stage, where you can still edit it. It is left out of that design's exports
  (PDF, PNG of every slide, PowerPoint, every version × design, Run for each value); page numbers and the index count
  only the slides shown. Exporting or copying the current slide still exports a hidden one. Hidden in Glass, a slide
  still shows in Navy. One undo step each.
<!-- 4.9: tables -->

### The text toolbar (first row)
One toolbar for any text: cells, a text box, the notes section, the title, subtitle, cover note or date. The grey
label on the left says what it will change (*No text selected*, *Cell C13*, *Cells D10:G12*, *Text box*, *Notes*,
*Title*…). It holds: undo / redo; the font (*Design font*, *Font from Excel*, the library, Windows and Google fonts);
A− / A+ (1 pt steps below 12 pt, 2 pt above) and the size in points; **B**, *I*; text colour (12 colours,
*Automatic*, *Custom…*); cell colour and highlight; align left / centre / right / *Auto*; line spacing, and top /
middle / bottom for text boxes; *Clear format*; *Format* (the format painter); *Aa Text styles…*.

### Cells
* **Cell colour** replaces the fill from Excel (16 colours, *No colour*, *Colour from Excel*). In Glass it becomes the
  colour of the block.
* **Highlight** puts a capsule behind the value in Glass; green and red keep their positive / negative meaning.
* **Role** (Auto, Header, Total, Body, Note) tells Glass how to draw the cells; *Auto* is detected from the Excel
  formatting.
* **Merge / Unmerge** joins cells (the top-left value is kept) or splits merges that come from Excel.
* **Borders ▾** sets the selected cells' borders as Excel's Borders menu does – Bottom, Top, Left, Right, All borders,
  Outside, Thick outside, No border – in a style (thin, medium, thick, dashed, dotted, double) and a colour; *Clear (as
  in Excel)* brings the workbook's borders back. They change the slide only. Excel, Refined and the consulting designs'
  ruled tables draw them; Glass and the other consulting table styles draw no borders.
* **Format painter** (*Format*): click it, then click or drag over cells to copy size, bold, italic, colours,
  highlight, alignment, role, conditional formats, colour scales, and the gridlines and borders set on the slide.
  Double-click keeps it on; Esc stops.
* **Formula bar.** The name box shows the cell; type there and press Enter. *↺ Excel value* goes back to the
  workbook's own text. A text you typed applies only while Excel's value stays the same; if the figure changes in
  the workbook, your text pauses and the Issues panel says so.
<!-- 4.9: tables -->

### Tables
* **W / H** set the width of the selected columns and the height of the rows in pixels; *Excel size* goes back to
  the workbook's. On the slide, drag a column or row border; double-click it for the Excel size.
* **Drags.** When you point at a table, handles appear: drag an edge to stretch it, the corner to scale it, the grip
  (with the table's name) to move it next to, above or below another table. Each drag is one change and one undo
  step.
* **⇔ Same size** makes the tables of this slide the same size. **Sizes…** does it across slides: pick slides and
  tables, *Make same size* (as the largest, the smallest or the first), copy column widths from one table to others,
  align the tables of several slides, or *Reset to Excel sizes*.
* **Position ▾** places the tables left / centre / right and top / middle / bottom. **Reset layout** puts this
  slide back to the automatic layout (in this design).
* **Gridlines ▾** per table: horizontal and vertical, each *As in Excel*, *All* or *None*. **Selected cells**: light
  lines on the selected cells – H (above and below each cell), V (left and right), Outline (around the selection) – in
  a colour and a weight (0.5–3 px); *Clear* removes them. They never change a border; where a design draws a border,
  the border shows.
* **Add table ▾** lists the deck's tables (those on no slide first, each with a small sketch) and puts one on the
  current slide – on a free layout in the first empty spot; *New table from cells…* makes one from cells picked on a
  sheet. One undo step each.
* **Free layout**: part 4.
* **Colour scale**: deeper green or red the bigger the number – across each row, down each column or over the whole
  selection; green for positive / red for negative, or low red → high green; on the cell colour or the number colour;
  reverse; with a preview. Scales are listed and can be removed with ✕.

Table sizes belong to the design they were made in: a table can be wide in Glass and narrow in Excel.
<!-- 4.9: tables -->

### Text boxes and the notes section
* **Text box ↑ ↓ ← →** adds a box above, below, left or right of the selected table and opens it for writing. On the
  slide, the small + buttons around a table do the same.
* Write plain text; `# Title`, `## Heading`, `**bold**` and `[[+12,3]]` (green or red by its sign) format it.
  Ctrl+Enter or a click elsewhere closes the box; Esc cancels. An empty box you never wrote in disappears.
* Select a box to drag it anywhere (guides snap it to the tables and the slide), stretch it by its edges, give it
  a bubble (◯), put it back next to its table (⤺ *Attach*) or delete it (🗑 or Del). The text shrinks to fit.
* **✎ Notes** adds the notes section: a text box of the slide itself, where the footer goes (sources, remarks). Navy
  and Red draw text boxes as takeaway cards (bullets, a box can span columns) and the notes section as footnotes or a
  takeaway bar.
* Text boxes, comments and notes appear in every design, Excel included (it adds nothing of its own: the tables keep
  the workbook's colours).

### Automated comments (✎ Comment…)
A comment written from the table's own numbers, in the style of an analyst. It is rewritten every time the slide is
drawn, so it follows new figures, your edits and the version you look at.
* *Summary* (default): one paragraph per block of the table, e.g. "Total Banks Loans: +192 mln (+0,2%) w/w · −43 mln
  vs Budget… Slightly positive week, driven by BIB (+36 mln) and ISP RO (+36 mln)."
* *Detailed*: one section per comparison found in the headers.
* Options: which tables; which comparisons to join (Budget, previous week, end of month, quarter, beginning of
  year…); title, names at the start, bullets; length; how many names per side; ignore movements below a value; the
  unit after amounts (default "mln"); what the rows are (countries, banks…); which rows to include; where it goes
  (beside all tables, or above / below / left / right of this table), its width, a bubble. A live preview shows the
  result. *Insert comment* (greyed while no comparison is found), later *Update*; *Remove comment*.
* If you edit a comment's text by hand it becomes ordinary fixed text; *Update* never overwrites a text you typed.
<!-- template, comments B48–B50 -->

### Designs
* **Glass**, **Excel**, **Refined** as in part 1.
* **Navy** (Consulting Navy: navy and electric blue, Georgia titles (Gelasio when the font library has it), Arial text, two-line action titles, a KPI line
  from the slide's first table on a dark band) and **Red** (Consulting Red: a red accent, Arial, a short red bar under
  the title, a message panel with the lead variance, how many rows fall short and the largest gap). Their tables are
  data exhibits: every number in right-aligned columns, with trend lines and Δ bars. Every number shown is a cell of the
  table – edits, versions and scenarios included.
* **The consulting look** is set at the end of ribbon 2 (Navy and Red only). With nothing or a table selected: the
  table style (*Exhibit*, *Cards*, *Ruled*), *All* numbers or *Compact*, *Δ bars*, *Trend*, *Latest bar*. With the title,
  the KPI line or the message panel selected: the headline (KPI line, panel, none), how many KPIs (1–3), the ground
  (band, tint, white), and the KPI line's or panel's font, size, bold and colour from the text toolbar. A change applies
  to the current slide (a dot marks a part the slide sets itself); *Apply to all* makes it the deck's; *Deck's* brings the
  slide back to the deck's look. One undo step each.
<!-- template, comments B48–B50 -->

### Design… – themes, colours, text styles, fonts
* **Apply to:** *This design only* or *All designs*: each design can have its own look.
* **Colours.** A theme – Aurora, Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo or Custom (four background and two
  accent colours of your own) – gives the background of Glass and the accent of titles, cover, index and page
  numbers. Navy and Red keep their own palette: a theme chosen for *All designs* does not change them; with *This
  design only* they take another one, and their first swatch (“This design's own colours”) goes back. *Your colours* override single colours: accent, table text, negative, positive, slide background (Excel,
  Refined, Navy and Red). *Reset all to the theme*.
* **Text styles.** One row per kind of text, deck-wide: slide titles, subtitles and text boxes (font, size, bold,
  italic, colour, alignment; text boxes also line spacing), tables (the font), the contents list (font, size, colour),
  page numbers & footer (font, bold, italic, colour). A format you give a single cell or box stays on top.
* **Fonts.** The shared font library: add a Google font (fetched once by Slide Builder's helper into the folder,
  then available to everybody) or upload your own font files (.ttf, .otf, .woff, .woff2; a variable font is stored as its fixed styles); see who added each and
  remove it. If the office network refuses a download, the message says what to do (e.g. *Upload font files*). The font
  menu's previews come from a cache on the shared folder, filled once for the whole office.
* *Use as default for new decks* makes this look the starting point of every new deck.
* In the top bar: the glass strength *Subtle / Medium / Strong* and *Colour* 0–100 % (how colourful the background
  is) apply to Glass.

### Cover, index, page numbers, footer, logo (⚙ Options)
* **Cover and index** are made in the wizard (step 3). Double-click the cover's title, subtitle, note or date to
  edit it on the slide. The index lists the content slides with their page numbers; *Subtitles* (on the index
  slide's toolbar) shows or hides their subtitles.
* **Page numbers** (they count only the slides shown in the design): on / off, start at, six positions, size, format (3 · 3 / 12 · Page 3 · p. 3), glass capsule or
  plain text, also on the cover.
* **Footer**: a text with `{date}`, `{workbook}`, `{title}`, six positions, size, style, also on the cover. It sits
  next to the page number when both use the same corner.
* **Logo**: the file (*Choose…* uploads one, copied to the folder for everybody), a bubble around it, and the *Logo*
  button of the toolbar to hide it on single slides.
* **Look**: corners (0–200 %, roundness of tables, bubbles and logo) and, in Glass, contrast; *Soft shadows on screen* (a
  personal choice: a true blur on screen only).
* All these are saved with the workbook's deck and shared with everybody who opens it.

### Versions
The *Version* list in the top bar shows the deck as any version (*Full deck* or a version from wizard step 4).
Removed cells are empty – no value, no colour, borders kept – and comments ignore them. Slide Builder remembers the
version you looked at last, per workbook.

### Undo, the side panel and the status bar
* **Undo / Redo** (↶ ↷, Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z) undo **only your own** changes, up to 200 steps
  (forgotten when you open another workbook); a toast says what was undone ("Undo: Bold"). Someone else's later change is never undone by you.
  Moving a slider counts as one step.
* **The slide list** shows a picture of every slide, *COVER* / *INDEX* tags and a yellow badge with the number of
  warnings and errors the Issues panel has for that slide. PgUp / PgDn or Alt+↑ / Alt+↓ go to the previous / next slide.
* **The Issues panel** (under the list) describes the current slide: its tables (sheet, range, size), error values,
  small text, charts or pictures that cannot be shown, edited cells and paused edits, a missing logo or table. See
  part 9.
* **The status bar** describes the selection and the keys, shows "Updated by <name> just now" and the save state.

---

## 4. Charts, shapes and free layout

### Charts
*Insert chart ▾* makes a pie of the selected cells (the last column's numbers, named by the first column, placed beside
their table) or of cells you choose on any sheet the wizard lists, also one on no slide (*Choose the cells…*: drag
across the numbers, then across their names – nothing to type). The chart follows the workbook: a reload or a
scenario's preview draws it with the new numbers.

Click a chart to select it (a click on a slice selects that slice), drag it anywhere (it snaps; hold Alt for no
snapping), drag its corner to resize it, Del removes it – one undo step each. Its side panel: *Pie* or *Donut*; the
labels (names, values, percent); the legend (right, below, none); the title (from the data, or your own); a colour for
each slice (↺ back to the design's); *Change the cells…*; where its numbers come from; *Delete chart*. Each design draws
it in its own look. Labels sit inside a slice when they fit, else outside with a leader line.
<!-- 4.7: charts -->

### Shapes and icons (callouts)
*Insert shape ▾* adds a rectangle, rounded rectangle, pill, circle, arrow or speech bubble, or one of 17 icons. Double-
click (or Enter) to write its text. *Quote a cell…* picks a cell on a sheet and adds it as `{Sheet!C7}`: the shape shows
the cell as the workbook formats it, and follows reloads and scenarios (`{'Sheet name'!C7}` for a name with spaces,
`{[Peers.xlsx]Peer!F7}` for a linked workbook). With a shape selected, ribbon 2 sets its fill, border (colour, weight,
dashed, dotted, none) and text (size, bold, colour, alignment). Without a fill of its own a shape takes the design's
material (glass, a framed box, a card).
<!-- 4.8: lines, icons, snapping -->

### Free layout
*Free layout* (ribbon 2) switches the current slide, in the current design, to a layout where every table, text box,
chart and shape stays where you put it: nothing moves when you switch it on, and nothing re-flows, shrinks or follows a
table afterwards. Drag a table by its grip to move it, by its corner or a border to resize it (it keeps its
proportions); drag a text box, chart or shape by its body to move it and by an edge to size it. Everything snaps to the
other boxes' edges, the content area and the slide's middle – hold Alt for no snapping. *Reset layout* (or *Free
layout* again) asks "Back to automatic layout?"; your free places are kept and come back when you switch it on again.
Each design has its own free layout. One undo step each.
<!-- 4.8: lines, icons, snapping -->

---

## 5. Working together

* **Others' edits appear within about 1–2 seconds**, with their name in the status bar: "Updated by bob just now".
* **"✓ Saved"** appears as soon as your change is on the shared folder. Before that you see "Unsaved changes…" or
  "Saving…". If the folder does not answer, "⚠ Not saved yet – retrying"; your change is kept and sent again.
* **Presence.** The round initials next to the version list show who else has this workbook open (up to three
  initials, then "anna is also here" or "3 others here"; "(another window)" when it is you in a second window).
* **Two people, two things.** Changes are merged field by field: if you change a column width and a colleague the
  colour of another cell, both stay.
* **Two people, the same thing at the same moment.** The later change in the deck's own order wins, on every PC
  alike; everybody ends with the same deck.
* **Typing is never interrupted.** The slide is not redrawn while you are writing in a cell or box.
* **Undo** touches only your own changes, so it never removes a colleague's work.
* **Changed on disk.** When somebody saves the workbook again in Excel, a banner says "The workbook was saved again in
  Excel." with *Reload now*.
* **Read-only.** If a deck's file on the share is ever damaged, the deck can still be read but not changed until the
  maintainer looks at it; the status bar and the deck's health line say "read-only".
* **Updates and 4.6 objects.** Somebody installed a version that changed the saved formats while you were working: the
  status bar asks you to reload the page (F5), and Slide Builder stops saving until you do. The first chart, shape, free
  layout, look, cell gridline or border or hidden slide of a deck costs once about 25 seconds of "Saving…" (part 8, the
  4.6 mark). A 4.0 or 4.1 window shows a Navy or Red deck in Glass and keeps its settings.

---

## 6. Export

*Export PDF* exports the whole deck in the mode you chose last. The ▾ menu:

| Menu item | What you get |
|---|---|
| PDF · text & tables | one page per slide, real text and lines (the default) |
| PDF · as pictures | each slide as a 192 dpi picture |
| PDF · current slide only | the slide on screen |
| PowerPoint · all slides / current slide | a `.pptx` with editable text, real tables and charts |
| PDF + PowerPoint · all slides / current slide | both files at once |
| Copy current slide · PNG · current slide / every slide | 4800 × 2700 pictures: on the clipboard, or as files |
| Versions: PDF · PowerPoint · PDF + PowerPoint, then *every version* or *every version × Liquid Glass + Excel / all three / all five designs* | one file per version (in this design) or per version and design |
| Run for each value… | one file per value of an input cell (part 7) |
| Report a problem with this export… | a short report in `export\feedback\` |

**File names.** `<workbook> - slides.pdf` and `.pptx`; one slide: `<workbook> - <slide>.pdf`; pictures:
`<workbook> - <slide>.png`; versions: `<workbook> - <version> - <design>.pdf` / `.pptx`; a run: `<value> - <design>.pdf`
(`<value> - <version> - <design>.pdf` with versions). Pictures in a PDF add " (images)". A name in use gets " (2)".

**PowerPoint.** Titles, subtitles, footers and page numbers are the layout's placeholders; every table is a real
PowerPoint table; pie and donut charts are PowerPoint charts with their data (*Edit Data* works); shapes hold their
text; the workbook's pictures and the logo are pictures; everything else – Glass's cards and capsules, the consulting
designs' bars and rules – is editable shapes. Each file has a slide master and one layout per kind of slide (cover,
contents, content), with the design's colours and fonts. No connector shapes, no links outside the file. Positions and
sizes are the slide's, so it looks like the PDF; PowerPoint draws a chart's labels and pie size and its shadows its own
way. Fonts are named, not embedded.

**What to expect.** 20-slide test deck: Glass PDF ≈1.4 s / 1.3 MB, Excel PDF ≈0.4 s / 0.3 MB; PowerPoint Glass ≈0.6 s /
0.5 MB, Excel ≈0.3 s / 0.14 MB. Hidden slides are left out.

**Fonts in the PDF.** The fonts used are embedded, so the PDF looks the same everywhere. A font nobody has is
replaced by a default one, and the toast names it. Opened from disk without the helper (part 9), the files are
downloads instead.

---

## 7. Linked workbooks, formulas and scenarios

### Linked workbooks
A deck can draw tables from more than one workbook of the folder. In wizard step 1 press *+ Add a linked
workbook…* and pick a file. Its sheets join the list with the file's name beside them; tick them and pick their
tables like any other. On the slides and in the Issues panel such a sheet is named `[Peers.xlsx]Peer` – the file in
square brackets, then the sheet. The deck remembers its linked files. If one is missing when the deck opens, the
Issues panel says "Linked workbook "Peers.xlsx" not found in the folder: its tables are missing until it is back (the
deck keeps them)", and everything else opens.

### The Formulas line
At the bottom of the side panel, *Check* recomputes every formula of the workbook – and of the folder's workbooks it
links to – and compares each result with the value Excel saved in the file. Nothing is changed by the check. The line
then reads, for example, "Formulas: 205 of 208 recompute like Excel · 3 locale-dependent (TEXT)" ("not checked yet"
before, "checking…" during):
* **recompute like Excel** – the result is Excel's own.
* **volatile (TODAY, NOW, RAND)** – the value changes every time by nature.
* **locale-dependent (TEXT)** – a TEXT format code written by an Excel in another language.
* **read a hidden sheet**, **read a workbook not in the folder**, **could not be read** – the check could not judge
  these cells.
* **different from Excel** – shown as a warning. The slides still show Excel's saved values; tell the maintainer
  which workbook it was.

Outside a scenario the slides show the values Excel saved. The formula engine starts only when needed, so opening a deck
is as fast as before.

### Run for each value (scenarios)
*Export ▾ › Run for each value…* sets an input cell (e.g. the bank of a control sheet) to each value of a list and saves
one file per value, design and version; the workbook is recalculated for each value and nothing is saved.
* **Input cell**: typed (`Control!B2`), *Select cell…*, or *Pick a cell* (the one selected on the slide). **Values**:
  typed, pasted or *From a range…*; *Treat as text*; values that show alike get " (2)". Then designs, versions, files
  (PDF, PowerPoint).
* *Run*: progress, *Cancel*, a report per value, *Open folder*; you can keep working. A slide cell Slide Builder
  computes otherwise than Excel stops the run first, unless *Run anyway and mark these cells* (red corner).

**Preview** one value beside *Preview*: a banner names it ("Previewing: Bank C – a scenario, not saved"), and slides,
charts, formula bar and side panel show its values until *Clear*. Edits meanwhile are ordinary edits (one of a cell the
scenario changed shows after *Clear*, and Slide Builder says so); an ordinary export uses the workbook's own values.

**Italian Excel and names.** `TESTO(…;"mmmm aaaa")` and the like are formatted as Italian Excel does, so titles follow a
scenario. Named ranges are recalculated; the Formulas line lists any it cannot ("names not recalculated: …"). Measured:
one value in about half a second from the click, 20 values in about 3.2 s.


---

## 8. How it works underneath

*For the owner and the maintainer.*

### The pieces
* **The shared folder** holds the workbooks, `export\`, the program (`app\<version>\`) and all saved state
  (`backend\data\`). It is the only connection between PCs.
* **The helper** is a small Python program that runs on each PC while Slide Builder is open (the console window). It
  only moves files: it hands the workbook's bytes to the page, appends changes to journal files, keeps snapshots,
  saves exports and fonts. It understands none of the slides. It listens only on the PC itself (127.0.0.1).
* **The page in Edge** does all the work: it reads the workbook, lays out the tables, draws the slides and writes the
  PDF and PowerPoint files.
* **The worker** is a background part of the page that owns the open workbook and the deck, so the window never
  freezes while a big workbook is read. Up to three export workers write PDFs and pictures in parallel.

### Saving: journals and snapshots
1. You make a change; the page shows it at once.
2. 300 ms later it is written as one line (a *record*) at the end of **your window's own journal file** on the share
   (`backend\data\v4\decks\<deck>\j\`). As soon as the share confirms, the status bar says "✓ Saved".
3. Every 1.5 seconds each page reads the new lines of everybody's journals and folds them into its deck.
4. Now and then a page writes a **snapshot**: the whole deck in one file, after which old journal lines are no
   longer needed. The deck's health line counts this: "Deck: snapshot 6 · 3 changes since in 2 journals" means
   snapshot number 6, plus 3 changes in 2 journals not yet in a snapshot.

Because each person writes only to their own file, nobody waits for a lock. The order of changes comes from a
counter inside each record, not from who reached the share first, so every PC builds the same deck. If a line in a
journal is ever found damaged, the helper writes an *incident* file in the deck's folder and the deck becomes
read-only until the maintainer looks at it: nothing is guessed, nothing is lost.

### Drawing: one picture for everything
Each slide is described once as a *display list* – a list of shapes, texts and pictures. The same list draws the
slide on screen, the thumbnails, the PNG pictures and the PDF, so what you see is what you export. Text is measured
from the font files themselves, so line breaks are the same on every PC that has the same fonts; the side panel
names a font that is another version on another PC ("Calibri on this PC is another version than on PC-B"). Once the
fonts' licence owner agrees (`slide_builder.py --allow-font-copy "<who, when>"`), the helper copies the Windows fonts a
deck uses into the shared library, and every PC lays it out with the same files. A key press reaches the screen in
25–42 ms (for 95 % of key presses).

### The formula engine
The formulas are read from the workbook file itself and recomputed inside the page by an embedded engine, IronCalc
(open source, MIT / Apache-2.0), started on first use; Excel is not needed. It serves the self-check of the Formulas
line and the scenarios. Otherwise the slides show Excel's saved values.

### The 4.6 mark
A deck that holds objects older versions do not know carries a mark file, `incident-format-5.json`, in its folder
(`backend\data\v4\decks\<deck>\`). It is written once, before the first such object is saved – the "Saving…" of about
25 seconds (a 23-second wait, then a new snapshot). A version before 4.6 then opens the deck read-only instead of dropping what it does
not know. Never delete this file.

### What is never done
* The workbook is never written. Slide Builder only reads it.
* Decks and workbooks go nowhere but the shared folder: the helper answers only on the PC itself. What reaches
  the internet: `Update Slide Builder.bat` downloads a new release from GitHub, and the helper fetches a Google
  font being added or a font preview not yet in the shared cache (`backend\data\fonts\cache\`, at most 200 MB) – from
  Google's font collection on GitHub, else jsDelivr, Google Fonts last. A proxy goes in this PC's
  `%LOCALAPPDATA%\SlideBuilder\proxy.txt` or the shared `backend\data\proxy.txt`. The page itself asks Google for a font only when the helper cannot reach it, or when opened from disk.
* Hidden sheets are never shown.

---

## 9. When something looks wrong

### The Issues panel
| Line | What it means / what to do |
|---|---|
| Cover slide · … / Index slide · lists N content slide(s) · Custom table layout saved | for information: nothing to do |
| Preset: N tables · M slides · K tables not on any slide | the deck's setup; a table on no slide can be put back with *Add table ▾* |
| Error values: D11 | the cell shows an Excel error (#N/A, #DIV/0!…); fix it in the workbook |
| Small text (≈8.6px at 100%) | the table is shrunk a lot: enlarge it or move it to its own slide |
| N table(s) of this slide could not be found | a sheet was renamed or deleted: open the wizard |
| No tables on this slide | add tables in wizard step 3 |
| Chart on … not reproduced | an Excel chart inside the sheet is not drawn; paste it as a picture into the table area in Excel, or make a chart with *Insert chart ▾* |
| Chart 1: source Summary!C5:C9 not found | a sheet was renamed or removed: *Change the cells…*; meanwhile a dashed placeholder, left out of exports |
| Chart 1: no numbers in Summary!C5:C9 | the chosen cells hold no numbers |
| Callout 1: Nowhere!B2 not found (shown as #REF) | the quoted cell's sheet is gone: quote the cell again |
| N objects of a newer Slide Builder … | this window is an older version: close the black window and start Slide Builder again |
| Picture(s) … that could not be read / conditional formats not reproduced | that element is left out |
| N edited cells · M text edits paused | Excel's value changed under your text (new figures or rows inserted); check and retype |
| Logo "logo.png" not found in the folder | choose the logo again in ⚙ Options |
| Linked workbook "…" not found in the folder | put the file back in the folder |
| Fonts: … on this PC is another version than on … | slides may wrap a little differently on that PC |

### Common messages
* **"… is protected (password or sensitivity label with encryption)"** – remove the protection or save an
  unprotected `.xlsx` copy.
* **An old `.xls`** opens after a short "Converting … with Excel…"; this needs Excel on the PC.
* **"Opened directly from disk: work is kept in this browser only and exports are downloaded"** – an emergency mode
  without the helper: no folder list, no uploads, decks, preferences and Google fonts kept in this browser only. Start
  `Start Slide Builder.bat`.
* **"Helper not running" / "Helper stopped"** – the console window was closed: start Slide Builder again.
* **"⚠ This deck is read-only"** – call the maintainer.
* **"A journal of this deck is damaged – tell the maintainer"** in an older version, on a deck that holds 4.6 objects:
  that version is too old – close its black window and start Slide Builder again (it starts the new version).
* **Adding a Google font fails** – the message says why and what to do; *Upload font files* always works.

### For the maintainer
* **Logs.** The helper writes its log to its console window (with the time of each line); there is no log file.
  Problem reports from users are in `export\feedback\`. A damaged journal leaves an `incident-….json` in
  `backend\data\v4\decks\<deck>\`.
* **Saved setups.** *⚙ Options › Administration › Saved setups…* lists every workbook's setup (slides, tables, last
  change) with *Delete…*, and the deleted ones with *Restore…* (each kept as a backup on the shared folder). A setup
  open in a window is not deleted – the message says who has it open.
* **Backups.** `backend\data\backups\`: the last 30 snapshots of each deck (`v4\<deck>\`), files before a format
  upgrade (`upgrades\`), and the saved setups before each update (`before-update-<time>\`, last 5).
* **Updating and rolling back.** Run `Update Slide Builder.bat`: it installs the newest release beside the current one
  in `app\<version>\`, runs its self-test, and only then makes it current (it needs Python 3.8 or newer); everybody then restarts Slide Builder and
  reloads the page. Decks, settings, workbooks and exports are never changed by an update; with nothing newer it says
  so and changes nothing, and a used-up GitHub limit is one sentence with the time to try again. An update never
  replaces `Update Slide Builder.bat` on a share that has one, and the 4.0.0 updater cannot reach later releases: both
  by hand (`docs/next/release-checklist.md` §6). `--use <version>` goes back
  to an installed version; below 4.6 it first names the decks with 4.6 objects (they open read-only there) – never
  delete their `incident-format-5.json`. The other options (`--release`, `--zip`, `--yes`) and the update-day steps:
  README §2.3–§2.4.
* **Slide Builder 3 and older settings.** While `Start Slide Builder (v3).bat` exists it starts the newest 3.x on the
  same data. A deck moves to 4.x on its first open there; its 3.x file is backed up and frozen. Giving a deck back:
  *⚙ Options › Administration › Prepare rollback*, everybody closes it, then `--rollback "<workbook>"`
  (`docs/next/cutover.md` §3). A v2 `backend\slide_builder_settings.txt` is imported once by the first helper and
  renamed `….v2-backup.txt`.
* **Licences.** *⚙ Options › About › Licences…* shows the licences of the third-party software (React, zustand, fflate,
  IronCalc, harfbuzzjs / HarfBuzz); the same text is `THIRD-PARTY-NOTICES.txt` in `app\<version>\`.

---

## 10. Glossary

| Word | Meaning |
|---|---|
| deck | the slides of one workbook, with everything people changed; stored beside the workbook |
| preset | the deck's setup from the wizard: sheets, tables, slides, versions |
| version | the same deck with some cells removed, for another audience (e.g. Chief, All) |
| design | how tables are drawn: Glass (Liquid Glass), Excel, Refined (Excel Refined), Navy (Consulting Navy), Red (Consulting Red) |
| look | in Navy and Red, how tables and the headline are drawn (exhibit, cards, ruled; KPI line, panel…), per slide or the deck's |
| chart | a pie or donut drawn from cells of the workbook; it follows the workbook |
| shape | a rectangle, pill, arrow, bubble… or an icon with text, which can quote a cell as `{Sheet!C7}` (a callout) |
| free layout | a slide whose tables, boxes, charts and shapes stay where you dragged them, in one design |
| hidden slide | a slide left out of a design's exports, page numbers and index, still in the list (grayed) |
| role | how Glass treats a cell: header, total, body, note (Auto = detected) |
| highlight | a capsule behind a value in Glass |
| journal | the file of changes one open window makes to a deck, appended to line by line |
| snapshot | the whole deck in one file; journals hold the changes since |
| display list | the description of a slide that draws the screen, the pictures and the PDF alike |
| linked workbook | another workbook of the folder whose sheets a deck uses; its sheets are named `[File.xlsx]Sheet` |
| scenario | the deck recalculated for one value of an input cell: previewed on the slides, or one file per value (Run for each value) |
| 4.6 mark | the file `incident-format-5.json` in a deck's folder: versions before 4.6 open that deck read-only |
| self-check | the Formulas line's comparison of every recomputed formula with Excel's saved value |
| helper | the small program in the console window that moves files between the page and the share |
