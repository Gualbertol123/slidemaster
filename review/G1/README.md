# G1 · pixel review of the display list

Gate G1 (PLAN S3.6): before export (S3.7) and later the screen (M4) draw slides from the **display list**, the
pilot users and the product owner look at it next to what the app shows today, and approve each design or list
the problems.

## What is here

| | |
|---|---|
| `index.html` | every corpus slide in every design and version: **today** (the app's HTML, which `npm run parity` holds to v3) · **display list** · the **heat map** of their difference. Filters by design, deck and result; the accepted differences; Liquid Glass per look. |
| `pdf/` | 3 sample PDFs per design written from the display list (`tools/export-dl.mjs`; in the zip, not in git – they embed parts of Windows fonts, and the font licence answer is pending, G0 R7): `weekly-options` (cover, contents, text boxes, notes section), `report-looks` (a custom theme, page numbers, footer), `deck20` (a large table; the same in both Excel designs, which differ only by text boxes and comments). `pdfs.json`: size, write time, fonts, the checks. |
| `slides.json` | the figures behind `index.html`. |

The pictures (`img/`, about 160 MB) are not in git: the engineering team runs `npm run g1` (a few minutes) and
sends `review/G1` as a zip; unzip it and open `index.html` (the page says so when the pictures are missing). The
PDFs are made by `npm run export-dl`.

## What to look at

1. **Liquid Glass – the glass itself (B3).** The display list draws each glass surface with the recipe of
   03-architecture §4.3: five sharp shadow layers instead of the screen's blurred shadow, the blurred wallpaper
   as a picture, the tint, the rim and the sheens. Edges of cards and shadows look a little different; colours
   and shapes should be the same. *Is the glass acceptable for export and the screen?*
2. **Liquid Glass – which slides are accepted.** `tests/parity/accepted.json` lists the 7 glass slides that have a
   golden screenshot (those are what the parity tools compare); the other glass slides beyond 1 % are shown,
   labelled "not in accepted.json", for you to judge the same way.
3. **Liquid Glass – numbers.** Glass number cells use tabular figures. The PDF has them exactly; the canvas used
   for these pictures cannot, so each digit is centred in its place (a fraction of a pixel). *Only the PDFs show the
   final look.*
4. **Liquid Glass – italics.** The glass font (Segoe UI Variable) has no italic face: the screen slants its letters
   (synthetic italic), and the PDFs slant them the same way.
5. **Excel and Excel Refined borders** drawn as Excel defines them, not as v3 drew them: "hair" is a 0.5 px solid line
   (v3: 1 px dotted) and dash-dot borders have dash-dot patterns (v3: dashed). *Keep, or v3's look?*
6. **Text** – positions, line breaks, ellipses, fitted text boxes – should match today's exactly (the parity tools
   check every text's position within 1 px). The heat map shows text edges: the screen and the canvas anti-alias
   text a fraction of a pixel apart.
7. **Not drawn yet** (no corpus deck has them): the drop shadow of keyed pictures in Liquid Glass and icons that are
   not square. They come with S3.7.
8. **The contents slide's dotted leaders** are drawn as short dashes (CSS draws 2 px dots).
9. **Exports will follow the screen, not v3's exports.** v3 exported its PNGs and PDFs from slide.css alone; the
   display list follows what the app shows (the slides inherit the page's line height 1.4), so titles and text
   boxes in the new exports match the screen, and can sit a few pixels from where v3's exports put them.
10. **How these pictures are drawn.** The display-list column is drawn as the page paints: the slide opaque, each
    table on a layer of its own (its text anti-aliased in grey, as the browser does for a scaled table). The screen
    (M4) and the PNG export will draw it the same way.
11. **The PDFs**: text selectable and searchable, fonts embedded (no Type 3, no variable fonts), pictures only for
    pictures and wallpapers. Open them in Acrobat and in the browser.

## How to answer

Write under **"Decisions"** in `PROGRESS.md` (people only – the agents never write there), one line per design:

- `G1 · Liquid Glass: approved` – or `G1 · Liquid Glass: problems – <slide, what is wrong, what it should be>`
- `G1 · Excel: …`
- `G1 · Excel Refined: …`

and for point 5: `G1 · Excel borders: keep Excel's` or `… v3's`. Problems are fixed in commits "S3.6-fix · …", the
package is made again, and G1 is asked again.
