# M4 walk: 05 §4 rows 4.3, 4.4, 4.5, 4.6, 4.7 and 4.11

Milestone M4 (S4.1–S4.6, branch `v4/M4-stage`, HEAD a402c96), walked at the end of the milestone (Prompt 6) on
2026-10-14 by the independent milestone reviewer. Everything below ran on the clean clone of a402c96
(`%TEMP%\verify-S4.6`, fresh `npm ci` + build, the committed page byte-identical).

How each row was checked:
* **covered**: an automated test exercises it and passed on the clean clone. `E` = `app/e2e/app.spec.ts` test
  (short names below), `F` = `app/e2e/file.spec.ts`, `O` = `app/e2e/open.spec.ts`, `U` = Vitest
  (`core/tests`, `app/tests`), `parity` = `npm run parity` (the stage captured from the M4 page against v3's
  goldens: GT, GG, GP; plus SP, screen = PDF, `tools/stage-capture.mjs`), `dlparity` = `npm run dlparity`.
* **verified**: driven by hand-written Playwright scripts against a helper started from the clean clone
  (`python backend/slide_builder.py --no-browser` on a temp `SLIDEBUILDER_ROOT` / `SLIDEBUILDER_DATA` seeded
  with the corpus decks `report`, `missing-table` through the helper's ops API, as `tools/capture-v3.mjs` does),
  reading the DOM, the stage's layers and the document the helper saved. Scripts and their JSON results are in the
  reviewer's scratch folder (`%TEMP%\m4-review\M4\walk1.mjs` … `walk3.mjs`, `probe*.mjs`, `walk*.json`).
* **unaffected**: M4 does not touch the code behind it (named), so its earlier coverage stands.
* **MISSING** / **BROKEN**: as named.

Runs on the clean clone during the walk: `npm run check` 394 + 24 passed; helper 174 OK (1 platform skip);
`npm run test:e2e` three times: 22 passed twice, once 2 failed (`net::ERR_CONNECTION_TIMED_OUT` on
`GET /api/workbooks/report.xlsx/doc` right after the export test, and `open.spec` could not open the workbook in the
same run – the loopback drop the export's retry already mentions, not reproduced in the next two runs); `npm run parity`: 22,306 differences, **0 not accepted** (full comparison); SP 135 slides, 0 with text
differences, 2 beyond 1 % of the pixels (the two signed hairline slides, worst 1.18 %).

e2e short names (app.spec.ts, in order): **E1** wizard · **Eth** thumbnails are pictures · **E2** anna and bob
merged · **E3** export PDF · **Epng** PNG / clipboard · **E4** table tools · **Edr** drags (corner, grip, border
double-click) · **E5** wizard picker · **E6** header colour, merge, painter, footer · **E7** painter CF, gridlines,
border drag, bubble, contents, themes · **E8** typing never overwritten · **E9** text toolbar, text styles, fonts ·
**E10** automated comments, stretch and snap · **E11** + button, move, attach · **E12** notes section, raw Excel ·
**E13** versions, superscripts · **E14** wizard large sheet · **E15** no console errors.

## 4.3 Designs, looks, themes

| Row | State | How |
|---|---|---|
| DS-01 | covered | E2 (bob switches, anna's stage follows: `.slide.excel`), E7 (clean / excel / glass); parity GG + GP, all three designs. Verified too: `[data-design]` → slide class, `style.design` saved, tables re-laid per design, the thumbnails drawn again (1–2 pictures per switch) |
| DS-02 | covered | E12 (raw Excel: no `.tnote`, no `.addnote`, Comment… disabled); U `design.test` "Excel is raw"; parity |
| DS-03 | covered | E7 (Excel Refined's table markup equals Excel's); U `design.test`; parity |
| DS-04 | covered | parity GG + GP (signed entries in `tests/parity/accepted.json`: G1, S4.1, S4.4) and SP (135 slides); U `glass-dl.test` |
| DS-05 | covered | parity (subtle / medium / strong in the corpus). Verified: Options › Strong redraws the table layer |
| DS-06 | covered | U `host.test` (coalescing, 1.5 s); verified: four slider moves → one undo step restores the colour amount |
| DS-07 | covered | U `text.test` "table sizing per design", `tables.test`; GG; `layout.ts` moved verbatim (S4.2) |
| DS-08 | covered | E7 (look scope design / all); U `design.test` "each design can have its own colours…" |
| DS-09 | covered | Edr (per-design sizing after each drag); GG. Verified: a column width set in Liquid Glass is in `sizes.glass` only, Excel keeps its own |
| TH-01 | covered | E7 (`#themeBtn`, Colours tab) |
| TH-02 | covered | E7 (`#lookScope` design / all) |
| TH-03 | verified | E7 + parity cover Aurora, Intesa Sanpaolo, Custom. **Ocean, Forest, Sunset, Graphite** (the M3a gap): each clicked in the Design… dialog on the M4 build – `--a1` set (#0077B6, #2D9D5B, #F2545B, #33415C) and the table layer redrawn each time. Drawn, not pixel-compared (still no golden for them) |
| TH-04 | covered | E7 (custom theme, `c1` picker) |
| TH-05 | covered | E7 (no `head` colour in Excel Refined) |
| TH-06/07/08 | covered | E7 (`#colorsReset` in both scopes); U `design.test` |
| TH-09 | covered | U `design.test` "accent, green/red and background overrides reach every design"; GG + GP |
| TH-10 | covered | E4 (corners 0 saved); parity (report-looks) |
| TH-11 | covered | E4 (contrast 80 saved); parity |
| TH-12 | unaffected | `#styleDefault` / config.json: Topbar.tsx changed only by the engine pill and the soft-shadows box; still no e2e (05's "E (new)", pre-existing gap) |
| TH-13 | covered | parity GP; export-check (2 wallpaper images per glass PDF); S4.5 draws the default wallpaper in the worker at init (bench) |

## 4.4 Text toolbar, text styles, fonts

| Row | State | How |
|---|---|---|
| TX-01 | covered | E9 ("No text selected", "Title", "Cell …"). Verified: Cell C6 / Cells C6:C11 / Title / Text box |
| TX-02 | covered | E9 (`#boldBtn` disabled). Verified |
| TX-03 | covered | E9 (Georgia on the title, Verdana on a cell) |
| TX-04 | verified | A+ / A− on a 36 pt title: 38, then 36 (2 pt steps above 12). No automated test (05: "U + E (new)") |
| TX-05 | covered | E9 (40 pt). Verified: "30,5" accepted (title 40.7 px) |
| TX-06/07 | covered | E2 (Ctrl+B, `#boldBtn.on`). Verified: Ctrl+B / Ctrl+I on a cell – saved, buttons on, the stage's `<text>` drawn at weight 720 (Segoe UI Bold, S4.4) and italic; B / I on the title |
| TX-08 | verified | a colour swatch on the title saved (`fmt.title.color`). No e2e (05: "E (new)") |
| TX-09 | covered | E9 (centre), E7; GG |
| TX-10 | covered | E11 (`lh` 1.5); GG |
| TX-11 | covered | E11 (`pgap` 1); GG |
| TX-12 | covered | E7 (valign middle); GG |
| TX-13 | covered | E9 (`#clearFmt`). Verified on the title |
| TX-14 | verified | E9 covers click-to-select only. Verified: double-click opens the editor over the title, Enter commits ("Walk title" saved and drawn), Esc cancels, Enter on a selected title opens it |
| TX-15 | covered | U `text.test` "a slide's own formatting…"; GG |
| TX-16–TX-18 | covered | E9 (Text styles dialog, note row font, Reset); GG |
| TX-19 | covered | U `text.test` |
| TX-20 | covered | U `text.test`; GG |
| TX-21 | covered | U `text.test`; GG |
| TX-22 | covered | U `text.test`; GG |
| TX-23 | covered | E9 (`.tsdlg [data-a=close]`); Esc not asserted |
| FT-01 | covered | E9 (font menu: Georgia, Verdana, Trebuchet MS); search / Google section not asserted |
| FT-02/03 | unaffected | FontPicker.tsx not changed by M4; still no e2e (network-mocked test, pre-existing gap) |
| FT-04 | unaffected | as FT-02 |
| FT-05 | covered | E9 (upload .ttf; variable font stored static) |
| FT-06–FT-09 | covered | E9 (library list, remove with confirm) |
| FT-10 | covered | E9 (bob sees anna's upload) |
| FT-11 | unaffected | offline Google memory / upload disabled: not asserted by F1–F3; the offline backend changed only by removing engine calls |
| FT-12/13 | covered | U `text.test` (family / weight from the file, safe names, latin subsets) |
| FT-14 | covered | E3 (no Type 3, `/ToUnicode`), export-check |
| FT-15 | **MISSING** | needs W13 (two PCs with different fonts → identical layouts). S4.4's "Done when" lists W13; PROGRESS does not say it was run – it is a field test (G0, people). M4 measures text from this PC's font files (`/sysfonts`), so a PC with another Calibri measures differently unless the faces come from the library |

## 4.5 Cell editing

| Row | State | How |
|---|---|---|
| CE-01 | covered | E4 (Shift+arrows), E6 (drag). Verified: click → `SLIDE_1!C6` + `.actbox`; Shift+click → `C6:C8` + `.selbox`; drag → `C6:C8` |
| CE-02 | verified | hover over "Beta": exactly one `.hov` box, on Beta's row (TableHits throttles to one per 16 ms) |
| CE-03 | covered | E2 (typing "Alfa"). Verified: "Q" opens the editor holding "Q"; Enter saves `{text:"Quux", orig:"Alpha"}` and moves to C7 |
| CE-04 | verified | F2: the editor holds "Beta" with 0–4 selected; double-click opens it too. No e2e (05: "E (new)") |
| CE-05 | covered | E2 (Enter). Verified: Tab → D7, Shift+Tab → C7, Shift+Enter → C6 (each commits), Esc writes nothing, blur commits |
| CE-06 | verified | formula bar: Esc restores and writes nothing, Enter saves "ZetaY" and the stage draws it |
| CE-07 | verified | ↺ Excel value removes the text edit; the stage draws "Zeta" again |
| CE-08 | verified | Del stores `{text:""}`; undo |
| CE-09 | unaffected | `core/src/render/edits.ts` not changed by M4; no unit test of the pause found (pre-existing gap of 05's "U + E (new)") |
| CE-10 | covered | E6 (`bg` #FF3B30 on the header). Verified: Excel draws `rgb(255,59,48)`, Liquid Glass a block gradient |
| CE-11 | covered | parity GG + GP (weekly-options has a highlight) |
| CE-12 | covered | U `tables.test` "becomes the block colour"; verified (glass gradient) |
| CE-13 | covered | parity GG (weekly-looks has a role) |
| CE-14 | covered | E6 (merge / unmerge); U `tables.test` |
| CE-15 | covered | E6 (painter single). Verified: Esc stops it (`body.painting` removed) |
| CE-16 | covered | E7 (CF travels); U `tables.test` |
| CE-17 | unaffected | the Format button is disabled without a cell selection (as in 3.7; Ribbon.tsx not changed by M4) – 05 says "toast" |
| CE-18 | covered | E6 / E7 paint by dragging over cells, through the stage's new hit areas (`cellFromPoint`) in Liquid Glass |
| CE-19 | verified | a click on the empty slide clears the selection (no `.actbox`, name box "—") |
| CE-20 | verified | status bar "3 cells selected" |
| CE-21 | covered | E8 (inline editor keeps "Lamb" across bob's change); U `stage.test` "E8: nothing is redrawn under an open editor". Verified: a remote op during typing – the editor keeps "Typing" |

## 4.6 Tables

| Row | State | How |
|---|---|---|
| TA-01 | covered | E4 (W 150 for two columns). Verified: one column → its width; C5:D5 with different widths → empty box with "…" |
| TA-02 | **BROKEN** (pre-existing, not M4) | *Excel size* (`#sizeReset`, `app/src/ui/TableTools.tsx:94`) sends `table.patch {cols: {3: null}}` – the shared sizing – while every width the W box or a drag sets is per design (`sizes.<design>.cols`, `editor/tables.ts` `sizePatch`). After W = 130 on C5, *Excel size* leaves `{"glass":{"cols":{"3":130}}}`: nothing changes. Reproduced the same on v3.7.0's page (worktree `%TEMP%\m4\wt-v370`). The double-click on a border (TA-04) does reset. No test |
| TA-03 | verified | column border: `col-resize` cursor within 4 px, `.sizeguide` and the "115 px" tip during the drag, width saved on drop, one undo step |
| TA-04 | covered | Edr (double-click on a column border → that column back to Excel, the other stays) |
| TA-05 | covered | E7 (right edge −150 px → 7 columns sized). Verified: tip "81 %", one undo step |
| TA-06 | covered | Edr (corner smaller, one undo). Verified: during the drag the `.tw` is moved by `translate3d(…) scale(0.808)` and the document is unchanged; one change on drop; undo restores width and sizing |
| TA-07 | covered | Edr (grip above the first table: bands `[[1],[0]]`, `.dropmark`, one undo) |
| TA-08 | covered | E4 (`#sameSize`); verified |
| TA-09 | covered | E4 (left: x = 50 px), E7 (top, per design); U `tables.test`; verified |
| TA-10 | covered | E7 (gridH off, gridV on); U `tables.test`; GG + GP |
| TA-11 | covered | E4 (scale on I5:K13, `.cap.scale` drawn); U `tables.test` |
| TA-12 | unaffected | ScaleMenu not changed by M4; still no e2e (pre-existing gap) |
| TA-13 | verified | *Reset layout* clears the slide's sizing for the design |
| TA-14–TA-18 | unaffected | TablesDialog.tsx changed only by an import path; still no e2e (pre-existing gap) |
| TA-19 | covered | U `tables.test` / `text.test` (computeLayout moved verbatim to `core/src/render/layout.ts`, S4.2); GG |
| TA-20 | covered | Edr / E11 (`.hbox` grip, `.size`, `.addnote`). Verified: grip "⠿ Loans vs deposits by region · C4:E10", corner, 4 edges, 4 + buttons |

## 4.7 Text boxes and notes section

| Row | State | How |
|---|---|---|
| NB-01 | covered | E4 (bob: ↑ beside the selected table, typed, Ctrl+Enter). Verified: drawn as its own SVG layer |
| NB-02 | covered | E11 (+ below the second table, typed at once) |
| NB-03 | verified | "This table already has a text box there – double-click it to edit." on a second ↑; on a two-table slide without a selection the ribbon buttons are disabled (the "Click a cell…" toast is for one-table slides) |
| NB-04 | covered | E4 / E11 (Ctrl+Enter); verified Esc and blur |
| NB-05 | verified | an empty new box is removed on Ctrl+Enter and on blur; Esc keeps it with its "Double-click to write" hint – as in 3.7 (`git show main:app/src/editor/stage.ts`: Esc does not commit) |
| NB-06 | verified | click selects (`.sel`, target "Text box"), Enter and F2 open the editor, Esc closes, Ctrl+B saves `b:true`, Del deletes |
| NB-07 | covered | E11 (dragged free), E12 (snaps to the page number). Verified: the layer moves by a CSS translate during the drag, `.moving`, `x`/`y` saved on drop |
| NB-08 | covered | E10 (bottom edge snaps to the table, `.snapline.h`). Verified: a free box's right edge 682 → 774 px, live text during the stretch |
| NB-09 | covered | E11 (⤺ Attach); verified |
| NB-10 | covered | E7 (`.notebub`); verified |
| NB-11 | verified | 🗑 deletes; one undo brings it back |
| NB-12 | covered | E12 (notes section at the bottom, moved, raw Excel hides it); verified |
| NB-13 | covered | U `comment.test`; GT (parity compares comments.json) |
| NB-14 | covered | U `slide-dl.test` "fitted size", `measure.test` (HarfBuzz, B7). Verified: a long right-hand box drawn at 15 px (start 18) |
| NB-15 | covered | U `tables.test` "left/right boxes are as high as the table"; GG |
| NB-16 | covered | U `text.test` "a spanning box…"; GG |
| NB-17 | covered | U `text.test` "a moved box keeps its place…"; GG |
| NB-18 | covered | E12. Verified: the ribbon arrows disabled in Excel with the tooltip "Excel shows the workbook as it is – …" |

## 4.11 Collaboration, undo, keyboard, side panel, status

| Row | State | How |
|---|---|---|
| CO-01 | covered | E2; U `ops.test` (OV), `docsync.test` |
| CO-02 | covered | E2 (bob sees "Alfa"). Verified: another client's `cell.patch` drawn on the stage after 2.4 s |
| CO-03 | covered | E2 (`#sbRemote` names anna / bob); U `docsync.test` |
| CO-04 | covered | E2 (`#presence`) |
| CO-05 | covered | helper `test_http` (presence); unchanged by M4 |
| CO-06 | covered | E8; U `stage.test` (E8). Verified for a text box editor: a remote title change leaves the stage's layers as they were while the editor is open (text "Draft" kept) and is drawn when it closes |
| CO-07 | unaffected | config re-read in `state/app.ts` poll, not changed by M4; no e2e (pre-existing gap) |
| CO-08 | verified | another client's preset change (`slide.patch` on slide 1) while slide 2 is shown: slide 2 stays current. No e2e |
| UN-01 | verified | `#undoBtn` / `#redoBtn` revert and re-apply a cell edit, the stage follows |
| UN-02 | covered | E2 (anna undoes her rename, bob's bold stays); U `ops.test`, `host.test`. Verified with a remote edit in between |
| UN-03 | verified | toast "Undo: Edit text" |
| UN-04 | covered | U `host.test` (radius coalesced); verified on the colour slider |
| UN-05 | covered | U `robustness.test` "keeps the last 200 steps, and a new change clears redo" |
| KB-01–KB-25 | verified | by hand on the M4 stage: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+S, PgDn / PgUp, Alt+↓ / Alt+↑, Esc (painter), Ctrl+B / Ctrl+I (cell and text box), Enter / F2 / Esc / Del on slide text and text boxes, Ctrl+A, arrows and Shift+arrows, Tab / Shift+Tab, Enter / Shift+Enter, F2, Del, a printable key, the inline editors, fx bar, W / H boxes. 05's "one table-driven e2e test per shortcut" still does not exist (pre-existing gap, not added by M4) |
| SP-01–SP-15 | covered | Eth (pictures 222 × dpr px, cover / index tags, an edit redraws its own slide only), E4 (logo not found); parity GT (issues.json per corpus slide, exact). Verified on missing-table: 2 canvases, badges, the issues text |
| SB-01–SB-13 | covered | every e2e waits on `#sbSave`; U `docsync.test` (retries, 409); E / O `openApp` (`#srv` absent while the helper runs, B1). Verified: "Saving…" → "✓ Saved", zoom + / − / Fit (1600 → 2000 → 1280 → fit), "100%" |
| OF-01–OF-06 | covered | F1–F3 (localStorage deck across a reload, undo / redo from the worker, exports as downloads, pictures without font access) |

## Summary

| Group | rows | covered | verified | unaffected | MISSING | BROKEN |
|---|---|---|---|---|---|---|
| 4.3 Designs, looks, themes | 20 | 18 | 1 | 1 | 0 | 0 |
| 4.4 Text toolbar, text styles, fonts | 30 | 23 | 3 | 3 | 1 (FT-15 / W13) | 0 |
| 4.5 Cell editing | 21 | 12 | 7 | 2 | 0 | 0 |
| 4.6 Tables | 16 | 11 | 2 | 2 | 0 | 1 (TA-02, pre-existing) |
| 4.7 Text boxes and notes section | 18 | 14 | 4 | 0 | 0 | 0 |
| 4.11 Collaboration, undo, keyboard, side panel, status | 17 | 12 | 4 | 1 | 0 | 0 |
| **All** | **122** | **90** | **21** | **9** | **1** | **1** |

Gaps carried (none introduced by M4): TA-02 *Excel size* does nothing for per-design widths (since 3.7 at least);
W13 / FT-15 needs two real PCs (G0); no e2e yet for TX-04, TX-08, CE-04, CE-06–CE-08, CE-19, TA-03, TA-12–TA-18,
NB-03, NB-05, NB-06, NB-11, CO-07, CO-08, UN-01, UN-03 and the per-shortcut KB table – all checked by hand above;
the four themes without goldens (TH-03) are drawn but not pixel-compared.
