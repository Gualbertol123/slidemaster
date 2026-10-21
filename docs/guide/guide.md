# Slide Builder 4 – the guide

For the team: the people who make the decks, the product owner and the maintainer.
Program version 4.0.0 (`helper/slidebuilder/__init__.py`), with the 4.1 and 4.2 changes built so far (not yet
released). Written on 16 October 2026. Every picture is a screenshot of the program, taken on test workbooks.

---

## 1. What Slide Builder is

Slide Builder turns tables in an Excel workbook into a deck of 16:9 slides. The workbook stays on the shared
folder; Slide Builder reads it and draws the slides from its numbers. When the workbook changes, the slides change
with it.

**Three designs.** *Glass* (Liquid Glass) redraws each table as translucent glass cards, capsules and fine lines
over a coloured background. *Excel* draws the table exactly as the workbook formats it. *Refined* (Excel Refined)
draws it like Excel and also shows text boxes, automated comments and the notes section. You switch with one click;
each design keeps its own table sizes.

**Many people at once.** Everybody opens the same workbook from the shared folder and edits the same deck. Other
people's changes appear on your screen within 1–2 seconds. Nothing has to be "checked out" or locked.

**Never touches the workbook.** Everything you change (a bold cell, a text box, a colour) is stored beside the
workbook, in the folder `backend\data\`. The `.xlsx` file itself is never written.

**Exports.** PDF with real text and lines, PDF made of pictures, PNG pictures of slides, and a copy of the slide
for pasting into PowerPoint. Several versions and designs can be exported in one go.

*Picture: the window, with its parts numbered.*
1 Open ▾ – the workbooks of the folder. 2 ↻ – read the workbook again. 3 ✦ Wizard – sheets, tables, slides,
versions. 4 the workbook's name and number of slides; Version – which version you are looking at. 5 who else is
in this workbook. 6 Glass · Excel · Refined – the design. 7 Design… – colours, text styles, fonts. 8 Subtle · Medium
· Strong and Colour – the glass strength and how colourful the background is (Glass only). 9 ⚙ Options – page
numbers, footer, logo, look. 10 Export PDF ▾. 11 the text toolbar. 12 the layout toolbar (cells, tables, text
boxes). 13 the formula bar. 14 the slide list. 15 notes about the current slide (the Issues panel). 16 the Formulas
line. 17 the deck's health line. 18 the slide. 19 zoom. 20 the status bar: what is selected, who changed what,
whether your changes are saved.

---

## 2. Getting started

### The shared folder
All workbooks live in one shared folder, for example `T:\Slide Builder\`. Its main parts:

| In the folder | What it is |
|---|---|
| `Start Slide Builder.bat` | starts Slide Builder on your PC (use the desktop shortcut it made) |
| `Install Slide Builder.bat` | the first-time set-up on a PC: checks Python and the folder, makes the shortcut |
| `Update Slide Builder.bat` | for the maintainer: installs a new version for everybody |
| your `.xlsx`, `.xlsm`, `.xlsb` workbooks | read, never changed |
| `export\` | where PDFs and pictures are saved |
| `app\<version>\` | the program, one folder per installed version |
| `backend\data\` | everything people changed: the decks, settings, fonts, logos, backups |

### Starting
Double-click the desktop shortcut (or `Start Slide Builder.bat`). A black console window opens – keep it open, it
is the small program that reads and saves files for you (the *helper*). Slide Builder then opens in its own Edge
window, without tabs or address bar. It reopens the last workbook you used.

### Opening a workbook
*Open* lists the workbooks of the folder, newest first, with the time they were saved and "slides by <name>" – the
last person who changed that workbook's slides. *Browse for a workbook…* picks a file elsewhere; you can also drop a
file anywhere on the window. *Reload "…" from disk* (and the ↻ button) reads the workbook again after it was saved in
Excel.

`.xlsx`, `.xlsm` and `.xlsb` are read directly. An old `.xls`, or a file protected in a way the page cannot read, is
converted by the PC's Excel first ("…was converted by Excel for reading – the original file is unchanged"). A file
encrypted with a password or a sensitivity label cannot be read; Slide Builder says so.

The first time a workbook is opened, the wizard starts. If the workbook has sheets whose name contains "slide" with
"x" tables on them, the deck is made directly at start-up and you can open the wizard later.

### The wizard (✦ Wizard)
Four steps; the step buttons at the top go back and forth; ✕ or Esc asks before closing.

1. **Sheets.** Tick the sheets to use. Sheets whose name contains "slide" are ticked for you. Each line shows the
   sheet's size, its title and how many tables were found. *Only "slide" sheets*, *All*, *None*. Hidden sheets are
   never listed. In a large workbook only the ticked sheets are read ("not read yet").
2. **Tables.** The sheet is shown like Excel. Drag across the cells of a table (or Shift+click, Shift+arrows) and
   press Enter or *Add table*; or type a range such as `C4:T56`. *grows when rows are added below* keeps a range
   table following new rows. *Use "x" tables* takes the tables marked with "x"; *Add detected tables* takes the dashed
   suggestions. The list on the right names each table and warns about very large ones.
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

The slide works like a sheet in Excel: click a cell, Shift+click or drag to select more, type to replace the text,
F2 or a double-click to edit it, Enter / Tab to move on, Del to clear. Everything you change is stored as a change
to the deck, keyed by sheet and cell; the workbook is not touched.

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
* **Format painter** (*Format*): click it, then click or drag over cells to copy size, bold, italic, colours,
  highlight, alignment, role, conditional formats and colour scales. Double-click keeps it on; Esc stops.
* **Formula bar.** The name box shows the cell; type there and press Enter. *↺ Excel value* goes back to the
  workbook's own text. A text you typed applies only while Excel's value stays the same; if the figure changes in
  the workbook, your text pauses and the Issues panel says so.

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
* **Gridlines** per table: horizontal and vertical, each *As in Excel*, *All* or *None*.
* **Colour scale**: deeper green or red the bigger the number – across each row, down each column or over the whole
  selection; green for positive / red for negative, or low red → high green; on the cell colour or the number colour;
  reverse; with a preview. Scales are listed and can be removed with ✕.

Table sizes belong to the design they were made in: a table can be wide in Glass and narrow in Excel.

### Text boxes and the notes section
* **Text box ↑ ↓ ← →** adds a box above, below, left or right of the selected table and opens it for writing. On the
  slide, the small + buttons around a table do the same.
* Write plain text; `# Title`, `## Heading`, `**bold**` and `[[+12,3]]` (green or red by its sign) format it.
  Ctrl+Enter or a click elsewhere closes the box; Esc cancels. An empty box you never wrote in disappears.
* Select a box to drag it anywhere (guides snap it to the tables and the slide), stretch it by its edges, give it
  a bubble (◯), put it back next to its table (⤺ *Attach*) or delete it (🗑 or Del). The text shrinks to fit.
* **✎ Notes** adds the notes section: a text box of the slide itself, where the footer goes (sources, remarks).
* Text boxes, comments and notes appear in Glass and Refined; Excel shows none (their buttons are greyed there).

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
  result. *Insert comment*, later *Update*; *Remove comment*.
* If you edit a comment's text by hand it becomes ordinary fixed text.

### Design… – designs, themes, colours, text styles, fonts
* **Apply to:** *This design only* or *All designs*: each design can have its own look.
* **Colours.** A theme – Aurora, Ocean, Forest, Sunset, Graphite, Intesa Sanpaolo or Custom (four background and two
  accent colours of your own) – gives the background of Glass and the accent of titles, cover, index and page
  numbers. *Your colours* override single colours: accent, table text, negative, positive, slide background (Excel
  and Refined). *Reset all to the theme*.
* **Text styles.** Font, size, bold, italic, colour and alignment of every slide title, subtitle, table, text box,
  contents list and page number / footer of the deck. A format you give a single cell or box stays on top.
* **Fonts.** The shared font library: add a Google font (downloaded once into the folder, then available to
  everybody) or upload your own font files (.ttf, .otf, .woff, .woff2); see who added each and remove it.
* *Use as default for new decks* makes this look the starting point of every new deck.
* In the top bar: the glass strength *Subtle / Medium / Strong* and *Colour* 0–100 % (how colourful the background
  is) apply to Glass.

### Cover, index, page numbers, footer, logo (⚙ Options)
* **Cover and index** are made in the wizard (step 3). Double-click the cover's title, subtitle, note or date to
  edit it on the slide. The index lists the content slides with their page numbers; *Subtitles* (on the index
  slide's toolbar) shows or hides their subtitles.
* **Page numbers**: on / off, start at, six positions, size, format (3 · 3 / 12 · Page 3 · p. 3), glass capsule or
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
  warnings and errors the Issues panel has for that slide.
* **The Issues panel** (under the list) describes the current slide: its tables (sheet, range, size), error values,
  small text, charts or pictures that cannot be shown, edited cells and paused edits, a missing logo or table. See
  part 9.
* **The status bar** describes the selection and the keys, shows "Updated by <name> just now" and the save state.

| Keys | What they do |
|---|---|
| Arrows, Shift+arrows, Ctrl+A | move, extend, select the table |
| a letter, F2, double-click | edit the cell (Enter / Tab moves on, Esc cancels) |
| Del | clear the cell, or delete the selected text box |
| Ctrl+B, Ctrl+I | bold, italic |
| Ctrl+Z, Ctrl+Y | undo, redo (your own changes) |
| Ctrl+S | save now |
| PgUp, PgDn | previous / next slide |
| Esc | stop the format painter, close a menu or dialog |

---

## 4. Working together

* **Others' edits appear within about 1–2 seconds**, with their name in the status bar: "Updated by bob just now".
* **"✓ Saved"** appears as soon as your change is on the shared folder. Before that you see "Unsaved changes…" or
  "Saving…". If the folder does not answer, "⚠ Not saved yet – retrying"; your change is kept and sent again.
* **Presence.** The round initials next to the version list show who else has this workbook open ("anna is also
  here"; "(another window)" when it is you in a second window).
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
* Somebody installed a version that changed the saved formats while you were working: the status bar asks you to
  reload the page (F5), and Slide Builder stops saving until you do.

---

## 5. Export

*Export PDF* exports the whole deck in the mode you chose last (the first time: text & tables). The ▾ next to it
opens the menu:

| Menu item | What you get |
|---|---|
| PDF · text & tables | one page per slide, real text and lines, sharp at any zoom (the default) |
| PDF · as pictures | each slide as a 192 dpi picture |
| PDF · current slide only | the slide on screen |
| Copy current slide | a 4800 × 2700 picture on the clipboard, to paste into PowerPoint |
| PNG · current slide / every slide | 4800 × 2700 pictures |
| PDF · every version | one PDF per version, in this design |
| PDF · every version × Liquid Glass + Excel | two PDFs per version |
| PDF · every version × all three designs | three PDFs per version |
| Report a problem with this export… | writes a short report to `export\feedback\` for the maintainer |

**File names.** `<workbook> - slides.pdf`; one slide: `<workbook> - <slide>.pdf`; pictures:
`<workbook> - <slide>.png`; versions: `<workbook> - <version> - <design>.pdf`; pictures in a PDF add " (images)".
If a file of that name is open in a viewer, the new one is saved as "… (2)". Files go to the `export\` folder; a
toast says "Saved … in the export folder" with *Open* and *Show folder*.

**What to expect.** Slide Builder writes the files itself, in the background; you can keep working. On the 20-slide
test deck: a Glass PDF in about 1.4 s and 1.3 MB, an Excel PDF in about 0.4 s and 0.3 MB. "As pictures" is much
bigger (11.6 MB for Excel, 69 MB for Glass on the same deck). Unsaved changes are saved first, so the export always
shows them.

**Fonts in the PDF.** The fonts used are embedded, so the PDF looks the same everywhere. A font nobody has is
replaced by a default one, and the toast names it.

---

## 6. New in 4.2 (built, not yet released)

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
then reads, for example, "Formulas: 205 of 208 recompute like Excel · 3 locale-dependent (TEXT)":
* **recompute like Excel** – the result is Excel's own.
* **volatile (TODAY, NOW, RAND)** – the value changes every time by nature.
* **locale-dependent (TEXT)** – a TEXT format code written by an Excel in another language.
* **read a hidden sheet**, **read a workbook not in the folder**, **could not be read** – the check could not judge
  these cells.
* **different from Excel** – shown as a warning. The slides still show Excel's saved values; tell the maintainer
  which workbook it was.

The page is about 2 MB bigger for this: it carries a formula engine that starts only when *Check* is pressed, so
opening Slide Builder and a deck is as fast as before.

---

## 7. How it works underneath

*For the owner and the maintainer.*

### The pieces
* **The shared folder** holds the workbooks, `export\`, the program (`app\<version>\`) and all saved state
  (`backend\data\`). It is the only connection between PCs.
* **The helper** is a small Python program that runs on each PC while Slide Builder is open (the console window). It
  only moves files: it hands the workbook's bytes to the page, appends changes to journal files, keeps snapshots,
  saves exports and fonts. It understands none of the slides. It listens only on the PC itself (127.0.0.1).
* **The page in Edge** does all the work: it reads the workbook, lays out the tables, draws the slides and writes the
  PDF.
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
names a font that is another version on another PC ("Calibri on this PC is another version than on PC-B").

### The formula engine (4.2)
The formulas are read from the workbook file and recomputed inside the page by an embedded engine (IronCalc). Excel
is not used. Today the engine is used for the self-check of the Formulas line: every formula cell against the value
Excel saved.

### What is never done
* The workbook is never written. Slide Builder only reads it.
* Decks and workbooks go nowhere but the shared folder: the helper answers only on the PC itself. Only two things
  reach the internet: the font menu loads previews of Google font names (and adding one downloads it), and
  `Update Slide Builder.bat` downloads a new release from GitHub.
* Hidden sheets are never shown.

---

## 8. When something looks wrong

### The Issues panel
| Line | What it means / what to do |
|---|---|
| Error values: D11 | the cell shows an Excel error (#N/A, #DIV/0!…); fix it in the workbook |
| Small text (≈8.6px at 100%) | the table is shrunk a lot: enlarge it or move it to its own slide |
| N table(s) of this slide could not be found | a sheet was renamed or deleted: open the wizard |
| No tables on this slide | add tables in wizard step 3 |
| Chart on … not reproduced | charts are not drawn; paste the chart as a picture into the table area in Excel |
| Picture(s) … that could not be read / conditional formats not reproduced | that element is left out |
| N edited cells · M text edits paused | Excel's value changed under your text (new figures or rows inserted); check and retype |
| Logo "logo.png" not found in the folder | choose the logo again in ⚙ Options |
| Linked workbook "…" not found in the folder | put the file back in the folder |
| Fonts: … on this PC is another version than on … | slides may wrap a little differently on that PC |

### Common messages
* **"… is protected (password or sensitivity label with encryption)"** – remove the protection or save an
  unprotected `.xlsx` copy.
* **An old `.xls`** opens after a short "Converting … with Excel…"; this needs Excel on the PC.
* **"Helper not running" / "Helper stopped"** – the console window was closed: start Slide Builder again.
* **"⚠ Not saved yet – retrying"** – the share is slow or unreachable; leave the window open, the change is kept.
* **"Slide Builder was updated – reload the page (F5)"** – press F5.
* **"⚠ This deck is read-only"** – call the maintainer.

### For the maintainer
* **Logs.** The helper writes its log to its console window (with the time of each line); there is no log file.
  Problem reports from users are in `export\feedback\`. A damaged journal leaves an `incident-….json` in
  `backend\data\v4\decks\<deck>\`.
* **Backups.** `backend\data\backups\`: the last 30 snapshots of each deck (`v4\<deck>\`), files before a format
  upgrade (`upgrades\`), and the saved setups before each update (`before-update-<time>\`, last 5).
* **Updating.** Run `Update Slide Builder.bat`. It downloads the newest release, checks it, installs it beside the
  current one in `app\<version>\`, runs its self-test, and only then makes it current. Everybody then closes Slide
  Builder, starts it again and reloads the page. Saved decks, settings, workbooks and exports are never changed by
  an update.
  When there is no newer release it says so (the version in use and GitHub's newest) and changes nothing. If GitHub
  answers that its limit is used up (60 questions an hour for the whole office), the message says at what time to
  try again; `--zip "%USERPROFILE%\Downloads\slidebuilder-<version>.zip"` (the full path to the ZIP: the update
  runs in the Slide Builder folder) installs a ZIP downloaded with the browser instead.
* **Rolling back the program.** `Update Slide Builder.bat --use 4.0.0` (or another installed version) makes that
  version current again; a plain update then refuses to undo this until you choose a version on purpose.
* **Giving a deck back to Slide Builder 3** (until its start file is removed): *⚙ Options › Administration ›
  Prepare rollback*, everybody closes the deck, then `Update Slide Builder.bat --rollback "<workbook>"`, and the people
  on that deck use `Start Slide Builder (v3).bat`. Details: `docs/next/cutover.md` §3.

---

## 9. Glossary

| Word | Meaning |
|---|---|
| deck | the slides of one workbook, with everything people changed; stored beside the workbook |
| preset | the deck's setup from the wizard: sheets, tables, slides, versions |
| version | the same deck with some cells removed, for another audience (e.g. Chief, All) |
| design | how tables are drawn: Glass (Liquid Glass), Excel, Refined (Excel Refined) |
| role | how Glass treats a cell: header, total, body, note (Auto = detected) |
| highlight | a capsule behind a value in Glass |
| journal | the file of changes one open window makes to a deck, appended to line by line |
| snapshot | the whole deck in one file; journals hold the changes since |
| display list | the description of a slide that draws the screen, the pictures and the PDF alike |
| linked workbook | another workbook of the folder whose sheets a deck uses; its sheets are named `[File.xlsx]Sheet` |
| scenario | a run of the deck for several values of one input cell – planned, not yet in the program |
| self-check | the Formulas line's comparison of every recomputed formula with Excel's saved value |
| helper | the small program in the console window that moves files between the page and the share |
