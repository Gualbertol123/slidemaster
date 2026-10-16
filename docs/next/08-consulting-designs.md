# 08 · Two consulting designs: "McKinsey" and "Bain" (M7b, Phase 0)

Status: **Phase 0 — research and specs, waiting for the product owner's approval** (PROGRESS "Waiting for").
No product code is written before §2 and §6 are answered.

The two designs are *in the style of* the slides of the two firms. They are not copies: no logo, wordmark,
trademark, firm name on the slides, or proprietary typeface (Bower, Theinhardt / "McKinsey Sans", Graphik,
Tiempos, Reckless Neue). They are designs of their own, beside Liquid Glass, Excel and Excel Refined, with one set
of geometry rules (`computeLayout` unchanged) and the display list as the only drawing contract (ADR-004).

Units: slide px on the 1600 × 900 slide. The references are mostly 13.33 × 7.5 in decks (960 × 540 pt), so
**1 pt of a reference = 1.667 px** here; every converted value below says so ("25 pt → 42 px").

---

## 1. References

How they were collected (2026-10-16): web search and fetch of public pages and PDFs only. No logins, no
scraping. Primary decks and reports were downloaded to the session's scratch folder and measured with PyMuPDF
(font names, sizes in pt, fill/stroke colours, positions); **[P]** = measured there, **[S]** = stated by the
source, **[I]** = our inference. No third-party image is committed: the list keeps links only.
mckinsey.com timed out on every fetch, so McKinsey's own web exhibits could not be read. Their evidence comes
from McKinsey decks and reports published on third-party sites.

### 1.1 McKinsey (19 references)

| # | URL | What it shows | What we take from it |
|---|---|---|---|
| M1 | https://wolffolins.com/work/mckinsey | 2019 identity case study | [S] custom serif "Bower" for headlines; "deep blue" on clean white; a data-visualisation system |
| M2 | https://www.red-dot.org/project/mckinsey-company-40709 | Red Dot award entry | [S] characterful serif (Bower) + clean sans (Theinhardt); "high contrast" |
| M3 | https://www.consultancy.uk/news/20522/mckinsey-company-launches-new-visual-identity | 2019 launch coverage | [S] deeper blue on white; new fonts; revamped data visualisation |
| M4 | https://brandfetch.com/mckinsey.com | brand colour listing | [S] #2251FF (electric blue), #051C2C (deep navy), #FFFFFF |
| M5 | https://www.logo.dev/search/brands/mckinsey.com | second colour listing | [S, weak] #061E38, #0D2E78, #1267D5; RGB 5,28,44 = #051C2C, 34,81,255 = #2251FF |
| M6 | https://www.mckinsey.com/redesign/resources/css/styles-553625.css (search-index snippets) | the site's stylesheet | [S] `@font-face` "Bower" (500/700) and "McKinsey Sans"; **Arial fallback** |
| M7 | https://seekingalpha.com/uploads/2016/4/12/4872773/Southeast_Asia_at_the_crossroads_Three_paths_to_prosperity_Full_report.pdf | MGI report, 2014 | [P] "Exhibit" grammar: label 9.5 pt gray, title sans bold navy, descriptor + unit lines, NOTE / SOURCE 6.4 pt; highlighted table rows = solid blue, white bold text |
| M8 | https://www.piie.com/sites/default/files/documents/madgavkar20181017ppt.pdf | MGI talk deck, 2018 | [P] chart header bold + unit gray; small caps tag top-left (6.4 pt); footer 8 pt #808080; "+42" deltas in accent bold |
| M9 | https://www.un.org/esa/ffd/wp-content/uploads/2014/11/gc-Presentation_Manyika_10Nov14.pdf | MGI keynote deck, 2014 | [P] older navy #002960; cover; confidentiality line |
| M10 | https://www.federalcitycouncil.org/wp-content/uploads/2020/12/McKinsey_Transportation.pdf | 40-slide client deck, 2020 | [P] **Georgia Bold titles, Arial body**; title/unit block at the top-left; margin 43 pt; 0.48 pt black rules under the title block (y ≈ 93 pt) and above the footer (y ≈ 508 pt) on 28 of 40 slides; "Source:" 8 pt at the bottom left; stickers Arial Bold 9 pt top right; tables: horizontal rules only, 0.96 pt under the header, 0.48 pt #7F7F7F between rows, no banding; contents slide dark |
| M11 | https://iacpm.org/wp-content/uploads/2025/03/IACPM-McKinsey-Gen-AI-Webinar-2025.pdf | 17-slide deck, 2025 | [P] title Georgia Bold 25 pt (20 pt when two lines); unit line 14–18 pt; 1 pt #7F7F7F rule under chart headers; ▪ bullets; navy totals #061F79; tints #99E6FF #CAEFFF #00A9F4; red #FF0000 for flags only |
| M12 | https://worldmaterialsforum.com/files/Presentations2022/WMF2022-PS1-Frank-Bekaert-McKinsey.pdf | conference deck, 2022 | [P] same template; #051C2C, #00A9F4, gray #9BA4AB; dark full-bleed cover, Georgia title |
| M13 | https://slidespeak.co/slide-design-prompts/prompts/mckinsey-style | unofficial "McKinsey style" spec | [S, third party] 1 px rule under title; takeaway box #F0F4F8 with a 3 px blue left border; footer 8 px "Source:"; no gridlines, direct labels |
| M14 | https://deckary.com/blog/consulting-slide-standards | consulting slide standards | [S] titles ≤ 15 words, ≤ 2 lines; **Georgia titles + Arial body** as the shareable pairing; "Source: …; McKinsey analysis" format; always a page number |
| M15 | https://deckary.com/blog/mckinsey-slides-download | analysis of public decks | [S] a footnoted source on every data chart (~7 pt); no shadows or gradients; direct labels |
| M16 | https://www.theanalystacademy.com/mckinsey-report-breakdown/ | chart-by-chart teardown of an MGI report | [S] takeaway titles; colour only on the bars that matter, the rest gray/black; circled callout echoing the title's number; small multiples |
| M17 | https://consultantsmind.substack.com/p/review-mckinsey-39pg-ppt-deck | teardown of a 39-page deck | [S] tracker / contents pages repeated per section; "kicker boxes" with the takeaway; footnotes on most pages |
| M18 | https://slideworks.io/resources/47-real-mckinsey-presentations | corpus of real decks | [S] every slide has an action title; executive summary; divider slides; cover titles ≲ 8 words |
| M19 | https://slidemodel.com/mckinsey-presentation-structure/ | structure guide | [S] footer band for sources; restrained palette, accent for callouts only |

### 1.2 Bain (15 references)

| # | URL | What it shows | What we take from it |
|---|---|---|---|
| B1 | https://psik.org.pl/images/Dane-i-raporty/Publikacje-czlonkow/Global_Private_Equity_Report_2025___Bain__Company.pdf | Global Private Equity Report 2025 | [P] swatch "Bain Red (RGB)" = 204,0,0 = **#CC0000** in the PDF's own metadata; "Figure 1a:" Semibold 10 pt #CC0000; notes/sources 7 pt #666666; red triangle bullets; tints #F16666, dark reds #981A1E #630B0C; grays #D2D2D1 #A4A4A3 #777776 #333332 |
| B2 | https://www.bain.com/globalassets/noindex/2024/bain_report_technology_report_2024.pdf | Technology Report 2024 | [P] "Notes:" then "Sources: S&P Capital IQ; Bain analysis", 6.5 pt; stacked bars in graded grays with one solid red series; no gridlines, baseline only |
| B3 | https://www.bain.com/globalassets/noindex/2025/bain_report_global_m_and_a_report_2025.pdf | M&A Report 2025 | [P] cover = picture above a solid red band with a white bold title; contents with red section names, black entries, dot leaders, right-aligned page numbers |
| B4 | https://media.bain.com/Images/2011%20Bain%20China%20Luxury%20Market%20Study.pdf | Bain deck, 2011 (Verdana) | [P] two-line sentence-case title 24–26 pt over a red bar fading to the right; "Note:" then "Source:" 10 pt bottom left; page number bottom right; highlighted bars #CC0000, others #CCCCCC; red ellipses around key numbers; a red starburst sticker |
| B5 | https://chicago.iabc.com/wp-content/uploads/2019/10/Bain-Presentation-Deck.pdf | Bain deck, 2019, 16:9 (Arial) | [P] **title Arial 24 pt black, top left at x = 29 pt; a thin red rule full width under the title**; source 8 pt at y ≈ 508 pt; page number 9 pt #5C5C5C bottom right; takeaway lines in red at the bottom |
| B6 | https://amcham.dk/wp-content/uploads/2021/04/20200412-Resilience-AmCham-presentation-vSHARED.pdf | Bain deck, 2020–21, 16:9 (Arial) | [P] tracker above the title ("MYTH 5:" red bold letter-spaced caps + gray caps); title 28 pt, key words in Arial Black, **no rule**; table header black with white bold text; gray chart panels #E5E6E5; red numbered circles; **solid red takeaway bar with white bold text**; "ILLUSTRATIVE" sticker top right; cover: white title, short red rule, letter-spaced date |
| B7 | https://slidespeak.co/slide-design-prompts/prompts/bain-style | unofficial "Bain style" spec | [S, third party] red #CC0000 once per slide; titles #191919; 2 px red rule under the title; so-what box #F5F5F5 with a 4 px red left bar; source 10 px #666666; tables: 2 px rule under the header, 1 px #D9D9D9 rows, no banding |
| B8 | https://deckary.com/blog/consulting-slide-standards | consulting slide standards | [S] titles ≤ 15 words, ≤ 2 lines; Bain = red accent, minimal titles; 3–4 colours, gray for secondary |
| B9 | https://slideworks.io/resources/750-real-consulting-presentations-from-mckinsey-deloitte-ey-and-more | library of consulting decks | [S] "Bain works in red and black"; colour highlights the main message |
| B10 | https://1000logos.net/bain-company-logo/amp/ | logo history (used **only** for colour, never copied) | [S] scarlet red on white; one signal colour |
| B11 | https://www.designweek.co.uk/issues/17-april-2003/wally-olins-and-circle-give-bain-serious-makeover/ (search snippet; page 403) | 2003 rebrand article | [S, weak] red as a single "signal colour"; black-and-white imagery |
| B12 | https://plusai.com/blog/bain-presentation-examples | catalogue of public Bain decks | [S] key message at the top of every slide; pyramid structure |
| B13 | https://ampler.io/articles/40-free-bain-powerpoint-slide-decks/ | list of public Bain decks (source of B4–B6) | [S] action titles that sum up the takeaway; simple design |
| B14 | https://flevy.com/topic/bain-templates/2 (search summary) | Bain-template listings | [S, weak] headline → visual → closing takeaway line |
| B15 | https://consultport.com/for-consultants/consulting-presentation-checklist-make-sure-to-include-these-7-elements/ (search summary) | consulting slide checklist | [S, weak] page number, source, date, footnotes, action title, stickers |

Neither firm publishes a public slide-style guide, so no row above is an official rule. Where references disagree
(Bain's rule under the title: B4 bar, B5 thin rule, B6 none), §2 picks one, names the reference, and lists the
alternative as a question (§6).

---

## 2. Design specs

### 2.0 What both designs share (one geometry)

`computeLayout`, the band/fit algorithm, per-design sizing (`sizingOf`), text-box placement, the notes section box
(`memoBox`: 56, 832, 900 × 44) and page-number / footer geometry (`pageNoGeom`, `footerGeom`) stay **as they are**.
The two designs change only:

* **the content area's top** (`areaFor`): it is given by the *consulting title band* below, which reserves two
  title lines. This is the only geometry number that differs per design, and it is a constant per design and
  subtitle on/off, as `titleGeom`'s `BASE` already is for glass vs Excel. Existing designs keep 126 / 104.
* the look: fonts, colours, rules, table recipe, furniture, cover, contents slide.

**Consulting title band** (both designs; refs M10, M11, B5, B6, M14/B8 "≤ 2 lines"):

| Element | Value (px) | From |
|---|---|---|
| Side margins | 50 (content x 50–1550, as every design) | the shared `areaFor`. The refs use 72 (M10: 43 pt) and 48 (B5: 29 pt); 50 keeps one geometry |
| Tracker line | top 10, height 16 | M8 (tag top-left), M10 (stickers top right), B6 (tracker above title) |
| Title band | top 30, **two lines** × 1.1 × size, **bottom-anchored**: a one-line title sits on the second line, so the rule and the tables never move with the title's length | M10–M12 (one-line titles sit lower than two-line ones) |
| Title width | 1500 (x 50–1550); minus the page number's width when it is top-left (as today) | – |
| Title overflow | wraps to two lines; a third line is cut with "…" (as `oneLine` does today) | M14, B8 |
| Subtitle = "unit / lead-in line" | top 124, one line, 22–24 px | M10/M11 (unit line under the title), B1/B2/B6 |
| Rule under the title block | y 158 with a subtitle, 126 without | M10, B5 |
| **Content area** | **x 50, y 170, w 1500, h 652** with a subtitle; **y 138, h 684** without (today 126/696 and 104/718: −44 / −34 px for two-line titles) | – |
| Larger title text style | pushes the area down by (size − base) × 2.2 (two lines), capped at 200 as today | `titleGeom` rule |
| Footnotes ("Note:" / "Source:") | the slide's **notes section** (existing box 56, 832, 900 × 44) drawn in the footnote style; "Note:" lines first, then "Source:" (the user's text; nothing is generated) | M7, M10, B1, B2, B4, B5 |
| Page number, footer | existing positions and formats (Style.pn / Style.footer, shared by all designs), drawn plain (never a capsule), in the design's "Page numbers & footer" text style | M10, B5 |
| Logo | where Excel / Excel Refined put it (bottom right, `1600 − 340`); the user's own logo only | M10 (no firm logo on content slides) |

The **tracker** has no source in the deck today (no section field). M7b reserves its line and draws nothing. A
new field would be a new op and a new B-item (§6 Q5).

### 2.1 McKinsey

**Grid** (in addition to 2.0)

| Element | Value | From |
|---|---|---|
| Rule under the title block | **0.8 px #000000**, x 50–1550 | M10 (0.48 pt black → 0.8 px); M13 (1 px) |
| Rule above the footer | 0.8 px #000000, x 50–1550, y 828 | M10 (mirrored rule at y ≈ 508 pt) |
| Tracker (when one exists, later) | right-aligned at x 1550, Arial Bold 15 px #000000 | M10 stickers (9 pt) |

**Colours** (Colours tab mapping in the last column)

| Role | Hex | From | `COLOR_KEYS` |
|---|---|---|---|
| Background | #FFFFFF | M1–M4, M10 | `bg` |
| Title ink | #051C2C (deep navy) | M4, M5, M12 | – (the Titles text style's colour overrides it) |
| Body / table ink | #000000 | M10 (text measured pure black) | `ink` |
| Accent | **#2251FF** (electric blue) | M4, M10, M11 | `accent` |
| Accent tints (highlights, chart order) | #00A9F4, #99E6FF, #CAEFFF | M10–M12 | derived from `accent` when overridden: mix with white .45 / .72 / .85 |
| Deep accents (totals, chart) | #061F79, #034B6F | M11 | – |
| Rules | #000000 (title, header, table edges), #7F7F7F (row hairlines) | M10, M11 | `rule` (not overridable today) |
| Grays (de-emphasis) | #B3B3B3, #D0D0D0, #E6E6E6 | M10, M11 | – |
| Positive / negative | #1E8E3E / #D93025 (**the app's defaults**: no reference shows a green/red convention; M10/M11 use red #FF0000 for flags only) | – | `pos` / `neg` |
| Card fill (so-what box) | #F0F4F8 | M13 | – |

**Typography** (Georgia and Arial: §2.3)

| Role (text style) | Font | Size px | Weight | Colour | Line height | From |
|---|---|---|---|---|---|---|
| Titles | Georgia | 40 | 700 | #051C2C | 1.1 | M10, M11 (25 pt → 42; 20 pt → 33 for two lines) |
| Subtitles (unit line) | Arial | 24 | 400 | #000000 | 1.1 | M10, M11 (14–18 pt → 23–30) |
| Tables | Arial | the workbook's size (geometry) | header 700, body 400, total 700 | #000000 | Excel's 1.15 | M10 |
| Text boxes, comments | Arial | 18 | 400 | #000000 | 1.25 | M10/M11 body 11–14 pt |
| — `# heading` / `## heading` | Georgia / Arial | 22 / 18 | 700 / 700 | #051C2C / accent | – | M7 (exhibit titles), M11 |
| Footnotes (notes section) | Arial | 13 | 400 | #000000 | 1.2 | M10 (8 pt) |
| Page numbers & footer | Arial | 15 | 400 | #000000 | – | M10 (9 pt; plain digit) |
| Contents | Arial (entries), Georgia (heading) | 28 / 40 | 400 / 700 | white on navy | 2.0 | M10 |
| Letter spacing | 0 everywhere | | | | | M10 |

**Tables** (recipe in `consult-dl.ts`, from the Excel item list)

* Edges: **horizontal rules only, no verticals**. Top rule 0.8 px #000000, rule under the last header row
  **1.6 px #000000**, a 0.8 px **#7F7F7F** hairline under every body row, bottom rule 0.8 px #000000 (M10).
* Header rows (role Header): no fill, Arial Bold, ink #000000, bottom-aligned. The workbook's wrapping is kept.
* Total rows (role Total): Arial Bold, a 0.8 px #000000 rule above, no fill (M10, M11).
* Spacer rows: empty, no rule.
* Numbers keep the workbook's alignment and number format, including format colours (`[Red]`).
* No zebra banding (M10).
* The workbook's fills, borders and font families are replaced by the recipe, as Liquid Glass does. Kept from the
  workbook: bold, italic, sizes, alignment, wrapping, merges, superscripts, pictures, shapes, text boxes.
* Kept from the user's edits: their own colours (CellEdit `bg`, `color`).
* Highlights: CE-11 fill = **#CAEFFF** under the cell (accent tint), ink unchanged. A "strong" highlight (role
  Total plus highlight, M7's highlighted row) = solid accent #2251FF with white bold text. Colour scales use
  `pos`/`neg` tints, as in Excel Refined.
* Arrows, Harvey balls: not drawn by the design (none found in the references). Cells that contain ▲▼ or ◔◑◕●
  characters draw them in the accent colour.

**Text boxes, comments, notes section**

* A text box without a card: plain text, no frame.
* A **card** (`bubble`) is the **so-what box**: fill #F0F4F8, a 4 px #2251FF bar on the left, square corners
  (corners slider ignored), padding 14 / 16 (M13, M17).
* A `left`/`right` box with `span` is the **so-what side column** of M17/M19: the same card at full slide height.
* Bullets: paragraphs starting with "- " or "• " draw a **▪** in the accent colour, with a 0.9 em hanging indent
  (M11).
* Automated comments: the same text-box recipe; `[[+…]]` / `[[−…]]` in `pos` / `neg`.
* Notes section: footnote style (above). With its card on, it becomes the **kicker bar**: fill #051C2C, Arial
  Bold 18 px white (M17).

**Charts and callouts hooks** (used by M9, 07 §3; nothing is drawn in M7b)

* Series / slice palette order: #051C2C, #2251FF, #00A9F4, #99E6FF, then #B3B3B3 for "other" (M10–M12).
* Highlight mode: one slice in the accent colour, the rest #B3B3B3 (M16).
* Labels are direct: Arial 14 px #000000, white inside dark slices. Legend only when needed: square 10 px
  swatches at the top right (M11, M16).
* Slice separator: 1.5 px white.
* Callouts:
  * circle: 2 px #2251FF outline, no fill (M16);
  * arrow: accent fill;
  * delta text: Arial Bold accent (M8);
  * card: the so-what card;
  * no shadows (M15).

**Cover, contents, versions, page numbers, footer**

* Cover:
  * full-bleed **#051C2C** (M10–M12);
  * a 72 × 6 accent bar at x 96, y 280;
  * title Georgia Bold 64 px white, x 96, top 300, w 1100, up to three lines (M10: 36–44 pt → 60–73);
  * subtitle Arial 32 px white 85 % (M10: 20 pt);
  * date Arial 18 px #99E6FF at y 780;
  * cover note Arial 16 px white 70 %;
  * the user's logo where Excel puts it.
* Contents slide:
  * full-bleed #051C2C;
  * "Contents" Georgia Bold 40 px white at 96, 70;
  * entries Arial 28 px white, numbers in #00A9F4, page numbers right-aligned in #99E6FF, line pitch 56 (M10).
* Versions: nothing changes (cells are cut as in every design).
* Page numbers: the user's format and position, plain, Arial 15 px #000000 (M10: a plain digit bottom right with
  the footer to its left).
* Footer: the user's footer text, same style; M10's "firm name" slot is the user's footer, never a firm name.

### 2.2 Bain

**Grid** (in addition to 2.0)

| Element | Value | From |
|---|---|---|
| Rule under the title block | **2 px #CC0000**, x 50–1550 | B5 (thin red rule, full width), B7 (2 px). Alternative "none" (B6): §6 Q6 |
| Rule above the footer | none | B5, B6 |
| Tracker (when one exists, later) | above the title at x 50, Arial Bold 12 px, letter-spacing 1.5 px, capitals, #CC0000 (second part #666666) | B6 |

**Colours**

| Role | Hex | From | `COLOR_KEYS` |
|---|---|---|---|
| Background | #FFFFFF | B1, B5, B6 | `bg` |
| Ink (titles, body, tables) | #000000 | B1, B2, B5 | `ink` |
| Accent | **#CC0000** | B1 (swatch in the PDF), B2, B6, B7 | `accent` |
| Accent tints / shades | #F16666 (light), #981A1E, #630B0C (dark); highlight tint #F5CCCC (= mix with white .80) | B1, B2 | derived from `accent` when overridden |
| Secondary text | #666666 (subtitle, footnotes), #5C5C5C (page numbers) | B1, B5, B7 | – |
| Grays | #333332, #777776, #A4A4A3, #D6D6D6; panel #E5E6E5 | B1, B6 | – |
| Rules | #000000 (header, total), #D6D6D6 (row hairlines) | B1, B7 | `rule` |
| Positive / negative | #1E8E3E / #D93025 (**the app's defaults**; Bain shows signed numbers in red, B1) | – | `pos` / `neg` |
| Card fill (takeaway box) | #F5F5F5 | B7 | – |

**Typography**

| Role | Font | Size px | Weight | Colour | Line height | From |
|---|---|---|---|---|---|---|
| Titles | Arial | 40 | 400 (B toggle available) | #000000 | 1.1 | B5 (Arial 24 pt → 40), B6 (28 pt, regular with bold words) |
| Subtitles (unit line) | Arial | 22 | 400 | #666666 | 1.1 | B1, B2 (unit line), B7 |
| Tables | Arial | the workbook's size | header 700, body 400, total 700 | #000000 (header white) | 1.15 | B5, B6 |
| Text boxes, comments | Arial | 18 | 400 | #000000 | 1.25 | B5, B6 |
| — `# heading` / `## heading` | Arial / Arial | 22 / 14 | 700 / 700, capitals, letter-spacing 1.2 | #000000 / accent | – | B6 (tracker style) |
| Footnotes | Arial | 13 | 400 | #666666 | 1.2 | B5 (8 pt), B1 (#666666) |
| Page numbers & footer | Arial | 15 | 400 | #5C5C5C | – | B5 (9 pt) |
| Contents | Arial | 26 | 400; numbers 700 | #000000; numbers white in red circles | 2.0 | B3, B6 |

**Tables**

* **Header** rows: fill **#000000**, Arial Bold **white**, 0.8 px #FFFFFF vertical separators between header
  cells (B6). Alternative, rules only (B7): §6 Q7.
* Body: a 0.8 px **#D6D6D6** hairline under every row; no verticals; **no banding** (B1, B7).
* Total rows: Arial Bold, **1.6 px #000000** rule above (B7: 2 px under the header in its rule-only variant).
* Bottom edge: 0.8 px #000000.
* Highlights: CE-11 fill = **#F5CCCC**. A strong highlight (role Total plus highlight) = solid #CC0000 with white
  bold text: "red once per slide" (B7, B4).
* Everything else as McKinsey: the workbook's fills, borders and font families are replaced; bold, italic, sizes,
  alignment, number formats and the user's own colours are kept.

**Text boxes, comments, notes section**

* A card (`bubble`) is the **takeaway box**: fill #F5F5F5, a 4 px #CC0000 bar on the left, square corners (B7).
* Bullets: "- " / "• " paragraphs draw a **▸** (small triangle) in #CC0000 (B1).
* Notes section: footnote style (#666666, 13 px). With its card on, it becomes the **takeaway bar**: solid
  #CC0000, Arial Bold 18 px white (B6).
* Automated comments: the text-box recipe.

**Charts and callouts hooks** (M9)

* Palette order: #CC0000, #333332, #777776, #A4A4A3, #D6D6D6. Highlight mode: one series red, the rest #A4A4A3
  (B1, B2, B4, B5).
* Labels are direct, Arial 14 px #000000. Legend only for overlays: 16 × 2 px line keys at the top right (B1, B4).
* Callouts:
  * ellipse: 2.5 px #CC0000 outline, no fill (B4);
  * numbered circle: #CC0000 with a white bold number (B6);
  * bracket + arrow with a bold red delta (B1);
  * starburst sticker as a `path` (B4);
  * no shadows.

**Cover, contents, versions, page numbers, footer**

* Cover:
  * a solid **#CC0000 band** x 0–1600, y 0–520 (B3: a red band holding a white title);
  * white below it;
  * a short white rule 72 × 4 at x 96, y 250 (B6);
  * title Arial Bold 60 px white, x 96, top 270, w 1200, up to three lines;
  * subtitle Arial 28 px white;
  * date Arial Bold 16 px capitals, letter-spacing 2, #666666 at x 96, y 580 on white (B6);
  * cover note Arial 16 px #666666;
  * the user's logo bottom right, on white.
* Contents slide:
  * white;
  * "Contents" Arial 40 px over the 2 px red rule;
  * entries: a #CC0000 circle of 36 px with a white bold number, the title in black Arial 26 px, dot leaders
    #A4A4A3, the page number right-aligned in black (B3, B6).
* Versions: nothing changes.
* Page numbers: plain, Arial 15 px #5C5C5C, the user's position.
* Footer: the user's footer, the same style.

### 2.3 Fonts (proprietary firm fonts excluded)

| Use | Choice | Why | Licence / embedding |
|---|---|---|---|
| McKinsey titles, headings, cover | **Georgia** (Bold) | McKinsey's own shared decks substitute Georgia for Bower (M10–M12, M14) | Windows core font; OS/2 fsType 0x8 (editable embedding: subsets may be embedded in PDFs), measured on this PC |
| Everything else in both designs | **Arial** (Regular, Bold) | McKinsey's shared decks (M10–M12) and Bain's decks (B5, B6) use Arial; M6's fallback is Arial | Windows core font; fsType 0x8 |

* Both fonts are on every Windows PC, so nothing is added to the library and no new dependency or licence ADR is
  needed. They are measured from their files (ADR-005) like every Windows font.
* **W13** (copy mode) captures them into the shared library like any other Windows family, once the licence
  owner's "yes" is recorded. Without it, fingerprint mode keeps every PC's file hashes and reports a difference.
* Stand-ins when a PC lacks them (`resolve.ts STAND_IN`):
  * Arial: Liberation Sans / Arimo, as today;
  * Georgia: **Gelasio** (SIL OFL 1.1, metric-compatible with Georgia), new entry. It is used only when it is in
    the library (FT-02, a Google font); no file ships.
* Considered and not chosen:
  * Source Serif 4 (OFL): not metric-compatible with Georgia, and the decks themselves use Georgia;
  * Inter (OFL), closer to Bain's report sans (Graphik): its reports use Graphik, its decks Arial, and Arial needs
    no download (§6 Q2).

### 2.4 Sketches

Both sketches are rendered from the numbers above and live in the repository:

* `docs/next/designs/mckinsey-sketch.svg`
* `docs/next/designs/bain-sketch.svg`

Each shows a content slide at 1:1 slide px with every element labelled, a cover and a contents thumbnail, the
palette and the type roles. They contain no firm name, logo or real data.

---

## 3. Implementation plan

**Principle.** One geometry (`computeLayout` and `layout.ts` unchanged but for the area-top constants of the new
designs), **one renderer for both designs** (`consult-dl.ts`) parameterised by a `DesignSpec` object, and two
spec objects. Tables are built from the **Excel item list (`effItems`)** like `excel-dl.ts`, never from the glass
scene.

| Where | Change |
|---|---|
| `core/src/model/types.ts` | `Design = "glass" \| "excel" \| "clean" \| "mckinsey" \| "bain"`. New `CONSULT = ["mckinsey","bain"] as const` and `isConsult(d)`. No new op, no new document field: `design` is a style field, and `sizes[d]` / `designs[d]` are already records keyed by design |
| `core/src/model/style.ts` | Normalisation accepts the five (unknown → glass, as today). **Per-design defaults layer** `DESIGN_LOOK[d] = {theme, text}` for the consulting designs, applied under the user's layers, so the Text styles "Reset" (`text[role] = null`) and the colours "Theme" button return to the spec. The shared deck theme is not applied in a consulting design (its palette is its identity, §6 Q4): the order is built-in → `DESIGN_LOOK[d]` → the shared layers' text and colours → `designs[d]` (which may set a theme). `COLOR_KEYS[].designs` gains the new designs: accent, bg, ink, pos, neg all apply |
| `core/src/render/consult-spec.ts` (new) | `DesignSpec`: fonts by role, colours, rule widths and colours, table recipe flags (header fill or rules, row hairlines, total rule, verticals), card recipe, bullet glyph, band numbers, cover and contents recipes, **chart hooks** (palette, highlight mode, label style, legend swatch, callout defaults) for M9. `MCKINSEY` and `BAIN`: plain data, unit-tested against §2 |
| `core/src/render/consult-dl.ts` (new) | `consultToDisplayList(L, ctx, m, spec, opts)` and its async wrapper `consultTableDL`, beside `excelToDisplayList`. It covers: effItems; roles (`roles.ts`); the measured text path (`Typesetter` / `breakRuns`); sup/sub; rotation; merges; pictures, shapes and text boxes of the workbook; colour scales; highlights; the rule recipe. Shared helpers move out of `excel-dl.ts` into `excel-common.ts` **without changing any output** (dlparity on Excel / Excel Refined must stay at 0 differences, and that is the proof). Nodes: only the eight types |
| `core/src/render/layout.ts` | `DESIGNS` gains the two (`sizingPatch` copies the shared sizing to them as to the others). `areaFor` reads the band constants per design: unchanged for the old three. `tableW`: L.W for the new ones. `fixedScale` stays Excel-only. `notesOf`: the new designs draw text boxes |
| `core/src/render/text.ts` | `BASE` gains `consult: {title: 40, sub: 22/24, subTop: 124, lines: 2}`. `titleGeom` uses the two-line push for them |
| `core/src/render/slide-dl.ts` | `SLIDE_FONT.mckinsey` = `Georgia,Gelasio,"Times New Roman",serif`; `SLIDE_FONT.bain` and the body = `Arial,"Liberation Sans",Arimo,sans-serif`. A `consult` branch draws: the background; title (two-line `block`, bottom-anchored, ellipsis on a third line); subtitle; rules; the tracker slot (empty); the notes section as footnotes or kicker / takeaway bar; cards and bullets for text boxes and comments (`noteNodes`); cover (`coverNodes`) and contents (`indexNodes`) per spec; page number and footer plain. The glass / Excel branches are untouched |
| `core/src/render/slide.ts` | `tableDrawKey` already starts with the design (a new design never reuses another's drawing). `slideFrame` class `slide consult <d>`. `memoPart` and `noteParts`: the new designs as Excel Refined |
| `core/src/render/pagenumbers.ts` | none (`glassy = false`) |
| `core/src/worker/host.ts` | dispatch `glass ? glassTableDL : isConsult(d) ? consultTableDL : excelTableDL` (stage, slide lists, exports, thumbnails). Wallpaper and glass fonts stay glass-only. The faces to preload for the new designs: Georgia, Arial |
| `core/src/text/resolve.ts` | `STAND_IN.Georgia = ["Gelasio"]` |
| `app/src/ui/Topbar.tsx` | two more buttons in the design switch: `data-design="mckinsey"` "McKinsey" and `data-design="bain"` "Bain" (labels: §6 Q1). The existing ids and `data-*` are unchanged. `#glassSeg`, `#colorCtl` and contrast stay glass-only |
| `app/src/ui/TextStylesDialog.tsx` | `DESIGN_NAME` and the greyed-key texts from a shared label table (no hard-coded "Refined") |
| `app/src/editor/export.ts` | `DESIGN_LABEL.mckinsey = "McKinsey"`, `.bain = "Bain"`. B11 names: `<workbook> - <version> - McKinsey.pdf` |
| Export menu | `versions-3` ("every version × all three designs": Liquid Glass, Excel, Excel Refined) **unchanged**. A new item `versions-5`, "every version × all five designs" (§6 Q8) |
| `app/src/ui/TableTools.tsx`, `Ribbon.tsx`, `Stage.tsx`, `CommentDialog.tsx`, `app/src/styles/app.css`, `app/src/editor/tables.ts`, `app/src/stage/hit.ts` | the new designs behave as Excel Refined (text boxes allowed, design fonts, no glass geometry). CSS: `.slide.consult` like `.slide.clean` for overlays |
| Thumbnails, PNG, clipboard, "as pictures" | nothing: they draw the display list |
| Helper (Python) | nothing: `style` is stored as a dict, the design is not validated, and `config.json` keeps the default design verbatim (TH-12) |

**Saved format and old pages (optional-field semantics).** A deck saved with `design: "mckinsey"`, `sizes.mckinsey`
and `designs.bain` and opened by a 4.0 / 4.1 page:

1. `resolveStyle` turns the unknown design into Liquid Glass (`style.ts:25`), so the deck opens in Liquid Glass.
2. `ops.ts` stores `style.design` as given and keeps the unknown keys of `sizes` / `designs`, and the helper keeps
   the dict. Nothing is lost unless the user switches design on the old page, which is a normal edit.
3. Edits made there go to glass's own sizes and looks, as they would for any glass deck.
4. v3 (frozen, ADR-010) never opens a v4-format deck.

Tests:

* `core/tests/design-fallback.test.ts`:
  * the 4.1 resolution rules (a frozen copy of `resolveStyle`'s normalisation at the `v4.1` tag, as a fixture)
    give glass;
  * applying a glass `style.patch` / `slide.patch` with 4.1's ops keeps every `mckinsey` / `bain` key;
  * the current code reads it back as McKinsey with its sizes and looks.
* `helper/tests/test_decks.py`: a round trip of the unknown keys through `store.py`.
* A new saved fixture `helper/tests/fixtures/saved/consult-4.2.json`, added, not edited.

**Parity and goldens (ADR-011).**

* The three existing designs: every golden untouched, `npm run parity` and `npm run dlparity` 0 unaccepted
  differences after every step.
* The new designs have no v3 source. Their goldens are **captured from our own first render after the pixel
  sign-off** (S7b.3) into `golden/<deck>/mckinsey|bain/<version>/`, in the same file formats, by a new
  `tools/capture-v4.mjs`: the v4 page through the `__sbTest` hook, `slide-<n>.json`, the pixel PNGs of
  `tests/corpus/pixels.json`, `pdf.json`.
* The capture writes its own `golden/MANIFEST-v4.json` (git, page sha, fonts, clock, designs), so the existing
  `golden/MANIFEST.json` is not edited.
* `parity.mjs`, `dlparity.mjs`, `export-check.mjs`, `g1-package.mjs` and `bench.mjs` learn the two designs.
  Before the capture, parity reports them as "design not in the goldens" (`new`, as today), never as passing.

---

## 4. Rows, B-items, budgets, ADR

### 4.1 New 05 §4.3 rows

| ID | Behaviour | v3 test | v4 verification |
|---|---|---|---|
| DS-10 | Switch to McKinsey / Bain, saved and shared; a 4.0 / 4.1 page opens such a deck in Liquid Glass without losing its McKinsey / Bain settings | – | E + U (fallback) + S (saved fixture) |
| DS-11 | McKinsey furniture: two-line bottom-anchored title band, unit line, rules, footnotes, page number, footer, empty tracker slot | – | U (DL snapshot) + GG (own goldens) + **GP (human sign-off)** + SP |
| DS-12 | Bain furniture (as DS-11, red rule, no bottom rule) | – | U + GG + **GP (sign-off)** + SP |
| DS-13 | Consulting tables: roles, rule recipe, header and total rows, highlights, colour scales, merges, sup/sub, wrapping, rotation, pictures / shapes / text boxes of the workbook, the user's cell colours | – | U + GG + GP |
| DS-14 | Text boxes, cards (so-what / takeaway), span columns, bullets, automated comments, notes section as footnotes or kicker / takeaway bar | – | U + GG + GP |
| DS-15 | Cover and contents slides of both designs | – | GG + GP |
| DS-16 | Per-design sizing, looks and text styles for the new designs (DS-07, DS-08, TH-02); Reset returns to the spec | – | U + E |
| DS-17 | Export: native PDF facts (fonts subset TrueType, never Type 3; no image but the user's), budgets; B11 names with "McKinsey" / "Bain"; "every version × all five designs" | – | GF + E |
| DS-18 | The three existing designs: 0 unaccepted parity / dlparity differences; the new designs' goldens are their signed-off first render | – | GG + GP |
| TH-14 | Colours tab in the new designs: accent, background, text, positive, negative; the shared theme ignored, a per-design theme applied | – | E + U |
| FT-16 | Georgia / Arial measured from their files; Gelasio stand-in for Georgia when it is in the library | – | U + GF |

### 4.2 B-items (PLAN Part B §8, after approval)

| # | Change | Step |
|---|---|---|
| B25 | **McKinsey design** beside Liquid Glass, Excel and Excel Refined: navy / electric-blue palette, Georgia titles and Arial text, two-line action titles, hairline rules, footnote-style notes section, so-what cards; exports, thumbnails and "every version × all five designs" | M7b |
| B26 | **Bain design**: red #CC0000 palette, Arial, two-line action titles, red rule, black table headers, takeaway cards and bar | M7b |

Existing behaviour: **no change**. The design switch only grows. The "all three designs" export item stays as it
is (the five-design export is a new item). Old pages open new decks as Liquid Glass without data loss (DS-10). If
Q8 is answered "replace the item", that becomes **B27**, a change to existing behaviour, listed here before it
ships.

### 4.3 Part F additions (enforced by `npm run bench` / `tools/export-check.mjs` from S7b.4)

| Budget | From step | Limit |
|---|---|---|
| Export 20 slides (deck20), McKinsey / Bain | S7b.4 | 1.5 s each |
| PDF size per slide, McKinsey / Bain | S7b.4 | 40 KB (as Excel) + 150 KB per document (Georgia Bold + Arial Regular / Bold subsets; to be confirmed by measurement and written here in S7b.4) |
| Keypress → pixels, cell edit, in McKinsey | S7b.4 | 50 ms p95 (unchanged budget, new design measured) |
| Drag frame in McKinsey | S7b.4 | 16 ms (unchanged) |
| Open deck20 → first slide in McKinsey | S7b.4 | 400 ms (unchanged) |
| New main-thread work | – | none: the renderer runs in the core and export workers, like `excel-dl.ts` |

### 4.4 ADR-018

`docs/next/adr/018-consulting-designs-as-parameterised-excel-item-renderers.md` (status: proposed).

---

## 5. Steps (PLAN Part C format; ⏱ benchmark, 🚦 product-owner gate)

### S7b.1 · Design type and plumbing

* **Read:** §3; `types.ts`, `style.ts`, `layout.ts`, `text.ts`, `host.ts`, `Topbar.tsx`, `TextStylesDialog.tsx`,
  `export.ts`, tools.
* **Do:**
  * extend `Design` and give every switch / record / if-chain its case (the survey list of §3);
  * `DESIGN_LOOK` defaults and Reset;
  * `COLOR_KEYS`;
  * the area constants;
  * the switch buttons and labels;
  * the fallback test and the saved fixture.
  * Until S7b.2, the new designs draw tables with `excelTableDL` and Excel Refined's furniture.
* **Done when:** check, helper, e2e green; parity and dlparity 0 unaccepted for the three designs; the fallback
  tests pass; a new e2e switches to McKinsey and back (one undo step each).

### S7b.2 · The consulting renderer

* **Read:** `excel-dl.ts`, `slide-dl.ts`, `roles.ts`, `scales.ts`, `edits.ts`.
* **Do:**
  * `consult-spec.ts` and `consult-dl.ts`;
  * the `excel-common.ts` extraction (no output change);
  * the furniture, cover, contents, notes section, cards and bullets in `slide-dl.ts`;
  * `STAND_IN.Georgia`.
* **Done when:**
  * DL snapshots of every corpus slide × version in both designs (`core/tests/consult-dl.test.ts`);
  * the DL validators pass, and no node lies outside the eight types;
  * the spec unit tests match §2's numbers;
  * dlparity for the old three is unchanged (0 unaccepted).

### S7b.3 · Pixel review 🚦

* **Do:**
  * render every corpus slide in both designs into a `tools/g1-package.mjs`-style report (`review/S7b.3/`);
  * the product owner signs off per design;
  * fix and re-review;
  * then capture the goldens (`tools/capture-v4.mjs`, `golden/MANIFEST-v4.json`).
* **Done when:** both designs are signed off in PROGRESS Decisions; parity on the five designs reports 0
  unaccepted differences; the goldens are committed.

### S7b.4 · Export and budgets ⏱

* **Do:**
  * PDF of deck20 in each design, checked by `export-check`: GF facts, fonts subset, no Type 3, size and time
    within §4.3;
  * PNG, clipboard, thumbnails;
  * the "all five designs" item, the B11 names;
  * e2e for the switch and the export;
  * the bench in McKinsey (keypress, drag, open).
* **Done when:** every §4.3 budget is within its limit twice, in the working copy and in a clean clone.

### S7b.5 · Close 🚦

* **Do:** AUDIT.md §0 twice on clean clones; CHANGELOG (B25, B26); PROGRESS; final sign-off.
* **Done when:** both audit runs are clean, or their findings are fixed, and the product owner signs off.

Each step: one commit "S7b.n · <title>", PROGRESS ticked with measured numbers, and the double-check protocol
(full test run; the same from a clean clone; an independent review by a fresh sub-agent against the PROMPTS.md
Appendix; numbers measured twice).

---

## 6. Questions for the product owner (answers go under PROGRESS "Decisions")

1. **Names on the buttons and in file names.** "McKinsey" and "Bain" (as the prompt names them), or neutral names
   (e.g. "Consulting Navy" / "Consulting Red")? The slides themselves never show either firm's name or logo; only
   the button label and the export file name `… - McKinsey.pdf` would. *Recommendation: neutral names in the UI and
   file names; "McKinsey" / "Bain" stay internal (code ids `mckinsey` / `bain`).*
2. **Fonts.** Georgia Bold + Arial (McKinsey) and Arial only (Bain), as their own shared decks do. *Recommended.*
   Alternative: Inter (OFL, closer to Bain's report sans) added to the library.
3. **Two-line title band.** Reserve two title lines in both designs (the tables start 44 px lower with a subtitle,
   34 px without), so action titles of up to ~20 words fit. *Recommended: this is the style's defining feature.*
   Alternative: one line with "…" as in the other designs.
4. **Theme.** In the two designs the deck's shared colour theme (Aurora, Ocean, Intesa…) is **not** applied: the
   design's palette is its look. A theme picked with "This design only", and every colour override, still apply.
   *Recommended.* Alternative: the shared theme replaces the accent (an Intesa-green "McKinsey").
5. **Tracker / sticker.** No data for it exists, so M7b only reserves its line. A per-slide "section" text later
   would be a new field, op and B-item. *Recommended: reserve now, decide later.*
6. **Bain's rule under the title**: 2 px red rule (B5, B7). *Recommended.* Alternative: none (B6, newer decks).
7. **Bain's table header**: black fill with white bold text (B6). *Recommended.* Alternative: bold text over a
   2 px black rule (B7).
8. **Export menu**: keep "every version × all three designs" as it is and add "… × all five designs". *Recommended:
   no change to existing behaviour.* Alternative: the existing item exports five designs (B27).
9. **Workbook formatting in tables**: the two designs replace the workbook's fills, borders and font families with
   their own recipe (as Liquid Glass does) and keep bold / italic / sizes / alignment / number formats and the
   user's own cell colours. *Recommended.* Alternative: keep the workbook's fills, as Excel Refined does.
10. **Positive / negative colours**: the app's defaults (#1E8E3E / #D93025) in both designs, since no reference
    shows a convention. *Recommended.* Alternative: McKinsey blue / red, Bain black / red.
