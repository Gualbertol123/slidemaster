# 09 · More charts, lines and annotations, snapping, icons, hidden rows, delete-versions, painter, Excel conditional formats, new slides (Slide Builder 4.6+)

**Status: approved by the product owner on 2026-10-20** ("approved"; Q1 / Q17 yes, Q2 the legend, Q18 same width,
the other questions as proposed or asked again at their step – PROGRESS Decisions; B30–B42 in PLAN Part B §8). Written against `main` 36b75a7 (4.5.0 with AUDIT-2 and its three fixes merged, PR #22;
the code is that of af0a729, so the path:line citations below hold for both). The rules of `PLAN.md`
Part A hold for every milestone below: one milestone = one branch = one pull request, one commit per step, `PROGRESS.md`
ticked with measured numbers, the double-check protocol of `PROMPTS.md` (its standing block, with B-numbers from B30),
the `AUDIT.md` §0 protocol twice on clean clones at the end of each milestone, plus AUDIT-2 §6's compatibility
experiment with the old pages repeated for the new objects.

The product owner asked (2026-10-20; their words condensed in PROGRESS "Waiting for"):

| # | Feature | Section |
|---|---|---|
| **F7** | more chart types (line, bar, column clustered / stacked / 100 %, area, combined bar + line, scatter, waterfall); series from different tables, sheets and linked workbooks in one chart; a second value axis; **the reference chart** "Loans Volume – Weekly Evolution" | §2.2, §3.1–§3.3, §4.2 |
| **F8** | snapping for every object: slide edges and centre, other objects' edges and centres, equal spacing, visible guides; Alt off; positions kept exactly as dropped | §2.6, §5 |
| **F9** | lines and annotations: straight and elbow lines, arrows, limiters / brackets / range markers, dividers, callout lines; end points and a middle handle; styled; attachable to an object | §2.3, §3.4, §4.3 |
| **F10** | the Tabler icon library (MIT), every icon with name, tags and category, searchable; on slides as icon items; in the app's interface (where: §3.5); vendored, no network; page cost measured, budget proposed | §2.4, §3.5, ADR-020 |
| **F11** | hide rows and columns of a table **on a slide**; sizing, gridlines / borders, charts, automated comments and KPIs recompute from what is shown | §2.5, §3.6 |
| **F12** | a more complete format painter: everything a cell can carry, across slides, several targets | §2.7, §3.8 |
| **F13** | everything above saved in the deck, merged, undoable, reopened on another PC, in every export and scenario run | §6 (the persistence audit) |
| **F14** | a new kind of version: the same table with rows / columns deleted (the table closes up) or cells emptied, for that version only; everything that depends on the data recomputes for it | §2.5, §3.7 |
| **F15** | (asked in the same message) "for all graphs … remove single index items, whole index, and propose multiple positions" – read here as **the legend**: hide single legend entries, hide the legend, more legend positions (Q2 checks the reading) | §2.2, §3.1 |
| **F16** | (same message) an Excel-style **New slide** button that adds a blank slide after the selected one, and **Add table**, which lists the deck's mapped tables | §2.8, §3.9 |
| **F17** | (same message) import more of Excel's **conditional formatting**: icon sets with their colours, data bars, colour scales, top / bottom, above average, duplicates, text, dates, blanks and errors | §2.9, §3.10 |

Pictures for the owner's review (§0.1) are in `review/P09/index.html` (built by `tools/p09-package.mjs` from the
prototype renderers in `spikes/charts/`; nothing in `core/` or `app/` changes in Phase 0).

---

## 0. What exists today (read before designing; path:line at af0a729)

| Area | Today | Consequence for this design |
|---|---|---|
| Charts | `ChartItem` (`core/src/model/types.ts:45-50`) has `type: "pie" \| "donut" \| "bar" \| "column" \| "line"`, one `values: DataRef`, `labels`, `series` (a **name**, a string), `legend: "right" \| "bottom" \| "none"`, `show`, `colors` (slice → hex), `startAngle`, `fmt`, `box`, `attach`. **Only pie and donut are drawn** (`core/src/render/chart-dl.ts:281`: any other type draws as a pie; `chartSem` maps it to "pie", `:350`) | the key `series` is taken (a name): the new series map gets another key (`sers`, §2.2). Old charts keep every key and their meaning |
| Data | `refTarget` / `chartData` / `resolve` (`chart-dl.ts:37-115`): one rectangle, reading order, hidden rows / columns skipped, a version's removed cells skipped, `MAX_CELLS` 2000, labels by `labels` or the nearest text | the resolver becomes per series (§2.2); hidden / removed / F11 / F14 rules stay in one place |
| Item op | `item.patch` (`core/src/model/ops.ts:59-79`): plain `ITEM_KEYS` (18) set / deleted, `ITEM_MAPS` (`colors`, `fmt`) merged per entry, **keys not in the lists are ignored silently**, an unknown `kind` skips the op; inverse per key (`:157-162`) | every new chart / line / icon key must join `ITEM_KEYS` / `ITEM_MAPS`, or this version itself drops it; an older page drops it (DATA-7, §1) |
| Shapes, icons | `ShapeItem` (`types.ts:52-56`): rect, round, circle, pill, arrow (a **block** arrow), bubble (with `tail`), icon; **17 built-in icons** as filled point / cubic lists on a 24 grid (`core/src/render/icons.ts:22-42`), drawn as one even-odd `path` (`shape-dl.ts:120-126`); unknown name → "info" | Tabler icons are **stroked** outlines: they need a round line join in the display list (§3.5, ADR-004 amendment) |
| Lines | none. No line item, no connector; `line` DL nodes become an open `custGeom` `p:sp` in PowerPoint (`core/src/pptx/scene.ts:188-192`); `p:cxnSp` is refused by `tools/pptxcheck.py:280` | F9 lines are a new item kind drawn with `line` / `path` nodes and written as plain shapes |
| Snapping | `snapTargets` (`app/src/stage/drags.ts:150-159`, `SNAP` = 8 px): x 50 / 1550, y 822, in free layout also 800 / 450 and the content top, **edges only** (no centres, no equal spacing); one vertical and one horizontal guide, a DOM overlay (`Stage.tsx:274-286`); Alt honoured inconsistently (always for tables / items, only in free layout for text boxes); `freeOp` saves unrounded floats, non-free drags round with `Math.round` after a float preview (`drags.ts:162-169`, `:294`, `:357`) | F8 generalises the target set and makes "as dropped = as saved" exact (§5) |
| Attach | `attach: {table, side}` on charts / callouts: laid out beside a table in automatic layout (`render/layout.ts:143-162, 295-301`); a move clears it (`drags.ts:294`) | F9's end-point attachment is a different, per-end anchor (§2.3) |
| Versions | `DeckVersion {id, name, hide: Record<sheet, A1 ranges[]>}` (`types.ts:79`), only through the wizard's `preset.set` (`Wizard.tsx:140-144, 208-248`); a removed cell is **blanked in place** (`render/edits.ts:128-141`, `removedCell`): no value, no colour, borders kept, geometry unchanged; comments (`render/comment.ts:18`), exhibits, charts (`chart-dl.ts:59,102`) and callouts (`shape-dl.ts:34`) already treat it as empty | F14 = a second field of the same version, sharing F11's closing-up path (§2.5) |
| Hidden rows | Excel's hidden rows / columns are **already closed up** by `buildLayout` (`core/src/xlsx/layout.ts:52-141`, `rowHidden` / `colHidden`, drawings collapse with them) and skipped by charts (`chart-dl.ts:61-63`); there is no slide-level hide | F11 and F14 feed **the same** hidden set into `buildLayout` (§2.5): no second layout path |
| Comments, KPIs | `gridOf(L, ctx)` (`render/comment.ts:12-26`) builds the analysis grid from the laid-out table (`L.rows × L.cols`); the KPI line / panel come from `exhibitOf` on the slide's first table (`render/exhibit.ts:56-106`, `render/layout.ts:43-52`) | rows closed up in `L` disappear from comments and KPIs by construction (§3.6) |
| Painter | `Fmt` (`app/src/editor/painter.ts:18-21`): size, B, I, colour, highlight, cell colour, align, role, `cf`, colour scale, cell gridlines, borders; not copied: font family, vertical alignment, number display; click = one paste, double-click = sticky; **already stays armed across slides** (`goTo` keeps `selection.painter`, `state/app.ts:599`); Esc stops (`keys.ts:22`) | F12 adds the missing properties and the objects' painter (§2.7) |
| Cell edits | `CellEdit` per **sheet cell** (`types.ts:105-106`, `edits[sheet][A1]`): text / orig, font, sz, b, i, color, fill, bg, cf, align, role; **no number format** | a cell's format is shared by every slide that shows the cell (as today); "number display" needs a new key (§2.7, Q9) |
| Conditional formats | every rule is **listed** with its type, operator, dxf and formulas (`core/src/xlsx/workbook.ts:415-429`, `.xlsb` `xlsb/sheet.ts:18-38`) – the `cfvo` / `color` / `iconSet` children and the 2010 `x14:conditionalFormatting` extension (whose `xm:sqref` leaves `ranges` empty) are not parsed – and **only `cellIs` and simple `expression`** are evaluated (`xlsx/layout.ts:178-200`); dxf keeps fill, font colour, bold, italic; colour scales, data bars, icon sets, top 10, above average, duplicates, text, dates, blanks / errors are listed as "not reproduced" (`app/src/editor/issues.ts:40`) | F17 evaluates them in the core (§2.9) |
| Slides, tables | **no slide or table op**: slides and tables are added only by the wizard through one `preset.set` (`state/app.ts:581-593`); no *New slide* in the editor; no table can be added to a slide from the editor; `computeLayout` returns no boxes for a slide without tables (`layout.ts:242`) | F16 needs small ops (`slide.add`, `table.add`, §2.8) – a whole `preset.set` from two editors at once loses one of them |
| Sync safety | `knownOp` (af0a729, `ops.ts:88-104`) stops a **4.5+** page from compacting records it does not know whole; 4.0–4.4 pages compact them away (AUDIT-2 DATA-7); the helper refuses to read a snapshot with a newer `format` (`helper/slidebuilder/decks.py:265-267`) and accepts only its own in a compaction (`:795-799`) – **but its `tail` swallows that error** (`_snapshot_gen` returns no gen, `:681-684`) and **`append` never reads the snapshot** (`:560-587`), so an old page keeps reading and writing a newer deck; an `incident-*.json` file in the deck folder makes every 4.x helper answer 423 to appends and "read-only" to tails (`:444-451`, the same in 4.0.0) | §1: a per-deck format guard with a marker every old helper honours |
| Build, size | single page `helper/slide_builder.html` **3,916,092 bytes**; WASM inlined as zlib + base64 in the worker bundle, decoded on first use (`core/src/calc/engine.ts:29-35`); no page-size budget; **no licence notice ships** (`legalComments: "none"`, `app/vite.config.ts:21`; AUDIT-2 LIC-1) | ADR-020: the icon set the same way, a size budget, the notices file |
| UI icons | about 25 hand-written 16 × 16 SVGs in the TSX and many Unicode glyphs (↻ ✦ ⚙ ▾ ⤺ 🗑) | §3.5 proposes Tabler for them (B35, optional) |
| Review packaging | `tools/m9-package.mjs`, `m7b-package.mjs`: Playwright + the committed page + the helper, the display list drawn to a 1600 × 900 canvas per slide × design | Phase 0 has no new code in the page, so `tools/p09-package.mjs` takes each slide's display list from the committed 4.5 page, adds the **prototype** nodes of `spikes/charts/` and draws it with the page's own canvas backend (`drawDl`) |

### 0.1 Pictures for the review

`review/P09/index.html` (not committed, like `review/S9.2`; the package script and the spike are) shows, in **Liquid
Glass, Excel, Excel Refined, Consulting Navy and Consulting Red** (and two per-slide looks of 08 §2.8: Navy with the
*Panel* headline, Red with the *White* background):

1. **The reference chart**, rebuilt from the data of F7 (§3.3) – the owner compares it with their Excel chart;
2. the chart types of §3.1 (column clustered / stacked / 100 %, bar, line with markers, smoothed line, area, combined
   column + line on two axes, scatter, waterfall) with legends at the new positions and one hidden entry;
3. lines and annotations (§3.4): straight, elbow, arrows at either end, bracket, range marker, limiter, divider,
   callout line attached to a callout, with their end-point and middle handles;
4. snapping guides (§5): edge, centre, and equal-spacing guides during a drag (the stage overlay, drawn over the slide);
5. Tabler icons on a slide (outline and filled, coloured, sized) and the icon picker (search "target", a category);
6. a table with three rows hidden on the slide and the same table in a delete-version (three rows and two columns
   closed up, six cells emptied), with its automated comment and the KPI line / panel recomputed;
7. Excel conditional formats imported (icon sets with colours, data bars, a 3-colour scale) in every design.

---

## 1. Older pages must not destroy the new objects (AUDIT-2 DATA-7, REL-1)

**The problem.** A page compacts the journal into a snapshot by folding the records it has read; an op, a key or an
item kind it does not know is skipped and is then gone for everybody (DATA-7). af0a729's `knownOp` makes **4.5+** pages
leave such records alone. **4.0–4.4 cannot be changed**, and the share runs 4.0.0 (REL-1). Everything in this design is
new to every released page: new item kinds (`line`), new keys on items (`sers`, `axes`, `marks` …), new table / slide
keys (`hidden`), new ops (`slide.add`, `table.add`, `version.patch`). A 4.0–4.4 page left open, or a rollback to 4.5 (whose
`knownOp` protects but whose helper would still read the deck), must not be able to fold them away.

**Options** (REL-1 lists (a)–(c)):

| | How | Old pages | Cost | Verdict |
|---|---|---|---|---|
| (a) **per-deck format guard** ("ratchet") + a **marker every old helper honours** | the first time a deck is about to receive an object 4.0 does not know, the 4.6 page's helper (1) writes `incident-format-5.json` into the deck folder and (2) the page writes the deck's **current snapshot again, unchanged, with `format: 5` and gen + 1** (a compare-and-set compaction that folds nothing), and only then appends the record. Every 4.0–4.5 helper treats any `incident-*.json` as "read-only" (`decks.py:444-451`): appends get 423, tails report `readonly`, compactions are refused – that stops old pages that **already have the deck open** (the format alone does not: their tail swallows the read error and their append never reads the snapshot, §0). 4.0–4.5 helpers also refuse to read the format-5 snapshot on open and refuse a compaction over it (the format read under the lock fails first, `:827`) | an open old page turns read-only at its next tail (its queued edits stay queued, never written); a newly opened one is refused. Decks **without** such objects stay `format: 4` and keep working in 4.0–4.5 | small: one marker file and one CAS write per deck, once; helper changes (below) | **recommended** |
| (b) global format raise (`workbook: 4` in `FORMATS`) | every 4.0–4.5 page gets 409 "Slide Builder was updated" on its first write after the update | all decks, even untouched ones, stop working in old pages at once | an upgrade step for every deck folder (README §4.4), a rollback below 4.6 impossible without it | too wide: a PC not yet restarted cannot even edit an old deck |
| (c) a release rule only | close every window before the update; `update.py --use` refuses a version below 4.6 once a 4.6 op was written | nothing technical stops a forgotten window | none | not enough alone; kept **in addition** to (a) |

**Design of (a) (ADR-019):**
* `needsV5(op)` in `ops.ts` (beside `knownOp`): true for an op, key, kind or value that **4.0.0** (the share's
  version) does not apply whole – every addition of 4.2–4.5 (`item.patch`; `slide.patch` `free`, `looks`; `table.patch`
  `cellGrid`, `borders`) **and** every addition of this design (§2.10). Taking 4.0 as the reference, not 4.5, closes
  REL-1 for the objects already released too: a 4.6 deck with a chart is as safe as one with a line, and a 4.0 page
  can never compact either. (`preset.set`'s `links` needs nothing: 4.0 keeps the preset whole – AUDIT-2 §6.)
  `docNeedsV5(doc)` is the same predicate on a document: any item, `free`, `looks`, table `cellGrid` / `borders`,
  slide `hidden`, version `drop`, cell `valign` / `num`. When a 4.6 page opens a deck whose snapshot is `format: 4`
  but whose snapshot (`docNeedsV5`) **or journal** (`needsV5` on any record) already holds such content – a deck a
  4.3–4.5 page edited – it bumps at once (below), before anything else.
* **The bump** (`upgrade()` in DocSync, before it **appends** a record holding such an op to a deck whose snapshot is
  `format: 4`): `POST /api/decks/<key>/format5` – the 4.6 helper writes `incident-format-5.json` (content: "this deck
  uses Slide Builder 4.6 objects; it opens in 4.6 or later", the writer and the time; O_EXCL, an existing one is
  fine) – then `api.compact(key, snap.gen, {...snap, gen: snap.gen + 1, format: 5})`. On 409 it reloads and retries (the
  snapshot moved; still format 4 → bump again; already 5 → done). The record waits in the pending queue meanwhile (as
  it does today when the share is slow), so the user sees nothing; the "✓ Saved" comes after the writes.
* Every later snapshot of that deck is written with `format: 5` (`nextSnapshot`, today a `format: 4` literal in
  `fold.ts:104-107`, takes `max(snap.format, docNeedsV5(doc) ? 5 : 4)`); the format never goes back down (deleting every
  such object leaves the deck at 5 – simpler and safe; Q14 asks whether a "make this deck readable by 4.5" command is
  wanted).
* **Helper 4.6** (`decks.py`): `CREATE_FORMAT = 4` for new and migrated snapshots (`first_snapshot` `:766`, the v3
  migration – so new decks stay readable by 4.0 until they get such an object), `READ_FORMATS = {4, 5}`;
  `_validate_snapshot` (`:795-799`) accepts 4 or 5 and **refuses a compaction that lowers 5 to 4** (400: "this deck uses
  Slide Builder 4.6 objects"); `incident-format-5.json` is **not** an incident for it (the read-only check skips that
  name; a real `incident-<journal>-<offset>.json` keeps its meaning); on a format-5 deck it answers 409 "Slide Builder
  was updated – reload the page" to an append, tail or compaction that does not carry the new page's header
  `X-SB-Deck-Formats: 4,5` (an old page still open after its PC's helper was restarted on 4.6: `formats_match` alone
  accepts it, `server.py:43-52`, because `SCHEMA` does not change). The self-test (`--selftest`) reads format-5 fixtures;
  `helper/tests/fixtures/saved/snapshot.v5.json`, `journal.v5.log` and the marker are **added**.
* **What an old page does**, verified in M13 by the AUDIT-2 §6 experiment grown to the real **4.0.0**, 4.1, 4.4 and 4.5
  helpers and pages (CP-01): opens the deck → refused ("read-only – a journal of this deck is damaged … tell the
  maintainer" is what 4.0–4.5 say for any `incident-*.json`: the wrong reason, the right effect; README and the
  CHANGELOG tell users that it means "update Slide Builder"); a page that had it open → read-only at its next tail, its
  pending ops stay queued and are never written (no whole-value op of an old page – a wizard `preset.set` built without
  the new slides, items or versions – can reach the deck: CP-01 tries exactly that); no compaction by it succeeds (it
  retries on every poll, taking the deck lock each time – CP-01's log checks that this costs nothing visible); the
  deck's new objects are all there afterwards. The old helpers' journal clean-up (`rotate`, the 24 h idle delete) reads
  the snapshot first and deletes nothing it cannot read (proven by the same experiment: a 4.6 user's journal survives
  an old helper's idle pass).
* **What remains open** (said, not hidden): a format-4 deck whose journal holds 4.3–4.5 records and that **no 4.6 page
  has opened yet** can still be compacted by a 4.0–4.4 page (DATA-7 as today). The guard closes it from the bump on;
  before that only the rollout closes it – the share going from 4.0 straight to 4.6 with every window closed (rule (c),
  Q17), so that no 4.3–4.5 record exists on the share at all.
* *Prepare rollback* (`compactAll`) names the decks at format 5 ("these N decks use 4.6 objects and will not open in
  4.5") before it rolls back; `update.py --use 4.x` (x < 6) warns with the same list (rule (c)).
* The 4.5 `knownOp` stays: it still protects a 4.5 page from a 4.7 object in a deck that a 4.6 page left at format 5
  (impossible by (a), kept as a second wall). Each later release that adds ops either reuses format 5 (4.5 pages are
  already locked out of such decks) **and** extends `knownOp`, or bumps to 6 the same way.

User-visible: B41 (a deck that uses charts, callouts, free layout, looks, cell gridlines / borders or any 4.6 object
opens only in 4.6 and later; older windows show it read-only). Decks with none of them – everything the share's 4.0 has
made – stay `format: 4` and keep opening in 4.0 during the rollout.

---

## 2. Data model

### 2.1 Principles kept (07 §2.1) and what changes
* Everything saved is in `core/src/model/types.ts`; semantics only in `core/src/model/ops.ts`; every new key or op has
  `shared/ops-vectors.json` cases (create, patch, delete, two writers, inverse round trip, fold in any order, unknown
  value skipped) and an inverse. From S14.P on, M14's cases go in `shared/ops-vectors.d/m14.json` and M15's in
  `m15.json` (the two branches never append to one array; `docs/next/M14-M15-split.md`).
* All new fields optional; `workbook: 3` unchanged; a deck's snapshot `format` becomes 5 only through §1.
* Cell references stay **A1 text in a sheet id** (`Sheet`, `[File.xlsx]Sheet`), as tables, charts and versions store
  them; sheet renames and inserted rows are not tracked (Issues line, 07 §2.1).
* `item.patch` keeps field-level merge. **New map keys merge per entry** (a series, a group, an axis, a mark); an
  entry is replaced whole, like `free` entries – two users editing two series both win, the same series → Lamport.

### 2.2 Charts (F7, F15)

```ts
// core/src/model/types.ts – additions (every field optional; old charts unchanged)
export type ChartType = "pie" | "donut" | "bar" | "column" | "line" | "area" | "scatter" | "waterfall" | "combo";
export type SeriesType = "column" | "bar" | "line" | "area" | "scatter";
export interface LineStyle { color?: string; w?: number; dash?: "solid" | "dashed" | "dotted" | "dashdot" }
export interface ChartSeries {
  n: number;                                   // order (ties: id); series are drawn and listed by n
  name?: string | DataRef;                     // text, or a cell (follows the workbook)
  vals: DataRef[];                             // one or more rectangles, concatenated (values from different places)
  xs?: DataRef[];                              // scatter: the x values
  target?: DataRef[];                          // "actual inside target": the target per point (outlined bar of that height)
  group?: string;                              // the category group the values stand on (default: the first)
  type?: SeriesType;                           // combo: this series' type (else the chart's)
  axis?: "y" | "y2";                           // the value axis (y2 = right)
  stack?: string;                              // series with the same stack key stack (column / bar / area)
  color?: string; line?: LineStyle; fill?: "solid" | "none";
  smooth?: boolean;                            // line / scatter: smoothed (Catmull–Rom, §3.2)
  marker?: { shape?: "circle" | "square" | "diamond" | "triangle" | "none"; size?: number; color?: string };
  labels?: { show: ("value" | "name" | "category" | "percent" | "ofTarget")[];
             pos?: "above" | "below" | "left" | "right" | "center" | "inEnd" | "inBase" | "outEnd";
             fmt?: TextFmt; num?: string /* number format code; else the cells' */ };
  points?: Record<string /* index */, { color?: string; marker?: string /* hex */; label?: string | null /* null = none */ }>;
  hide?: boolean;                              // kept, not drawn
}
export interface ChartGroup { n: number; cats: DataRef | string[]; divider?: LineOrNone | null; label?: string }
export interface ChartAxis { show?: boolean; min?: number; max?: number; step?: number; num?: string; title?: string;
  grid?: boolean; fmt?: TextFmt; line?: LineOrNone | null }
export type MarkAt = { s: string; i: number }                 // a series' point
                   | { g: string; edge: "start" | "end" }    // a category group's edge
                   | { x: number | string; y: number; axis?: "y" | "y2" };   // data coordinates (category name or index)
export interface ChartMark { kind: "arrow" | "line" | "band" | "icon" | "text";
  a: MarkAt; b?: MarkAt | "floor" | "ceiling";                // e.g. the reference chart's arrow: a = Q3's point, b = "floor"
  style?: LineStyle & { heads?: Heads }; icon?: string; size?: number; text?: string; fmt?: TextFmt; dy?: number }
// ChartItem += sers?: Record<string, ChartSeries>; groups?: Record<string, ChartGroup>;
//              axes?: Partial<Record<"x" | "y" | "y2", ChartAxis>>; marks?: Record<string, ChartMark>;
//              stack?: "none" | "stacked" | "percent"; gap?: number /* % of a bar */; overlap?: number;
//              legendAt?: "right" | "left" | "top" | "bottom" | "top-right" | "inside-tl" | "inside-tr" | "none";
//              legendHide?: Record<string /* series id, or point index for pie */, true>;
//              frame?: LineOrNone; titleRule?: LineOrNone; plot?: Box /* plot area inside the box, optional */
//              /* LineOrNone = LineStyle | "none": unset = the design's, "none" = no line (S14.P review: item.patch's null
//                 deletes a plain key, so null cannot mean "none"; inside a group / axis entry a null survives, read as "none") */
//              titleFmt?: TextFmt   /* the title's own format; today the title takes the deck's "note" style and `fmt` is the labels' */
```

* **Old charts** (no `sers`): exactly as today – `values` / `labels` / `series` / `legend` / `colors` keep their meaning;
  a pie stays a pie. A chart switched to a series chart in the panel gets `sers: {s1: {n: 1, vals: [values]}}`, and
  `values` is kept (so the item stays valid for the code that requires it). `legend` keeps its three values;
  `legendAt` (new key) wins when set.
* **Different sources in one chart** (the owner's "series from different tables, sheets or linked workbooks"): every
  `DataRef` (each `vals` entry, `target`, `xs`, a group's `cats`, a series `name`) names its own sheet id or table. A
  series may join several rectangles (`vals: [Weekly!C5:F5]`, or `[Targets!B3, [Budget.xlsx]Plan!D9]`). Category
  groups (`groups`) put different category lists side by side on one axis, separated by an optional divider: the
  reference chart's weekly part and target part are two groups. Lengths: a series has one value per category of its
  group; extra values are ignored, missing ones are gaps, both named in the Issues panel ("Chart 2: 'Budget' has 3
  values for 2 categories").
* **Second value axis**: `axis: "y2"` on a series; `axes.y2` its scale; the right axis is drawn only when a visible
  series uses it.
* **What a combo may combine**: column, line and area series on one category axis (each on `y` or `y2`) – Excel's own
  combo set. `bar` (horizontal) and `scatter` (numeric x axis) need axes of their own and are charts of their own type,
  not combo members; the panel offers only the allowed types in a combo.
* **Per-point**: colour, marker colour, label text (`points[i].label`, `null` hides one label) – the reference chart's
  grey first marker.
* **"Actual inside target"**: a column series with `target` draws, per point, the target as an outlined bar and the
  value as a filled bar inside it; label `ofTarget` = value / target as a percentage, computed (§3.2).
* **Annotations** (`marks`) are in **data coordinates**, so they follow the data and a scenario value: an arrow from
  the axis floor to a point, a line between two points, a band, an icon or a text above a column (the reference
  chart's target icon), a divider (also `groups[g].divider`).
* **Legend (F15)**: `legendAt` (8 positions incl. none), `legendHide` (one series – or one slice of a pie – out of the
  legend while still drawn). A hidden series (`sers[s].hide`) is not drawn and not listed.
* **Ops**: `item.patch` with `ITEM_KEYS += stack, gap, overlap, legendAt, frame, titleRule, plot` (and new values of
  `type`) and `ITEM_MAPS += sers, groups, axes, marks, legendHide, titleFmt`. Merge: per entry (a whole series / group /
  axis / mark); inverse: per entry, as `colors`. A series' `points` live inside the series, so two people editing points
  of **one** series at once: the last one wins (as two people editing one `free` entry today; Q13).

### 2.3 Lines and annotations on the slide (F9)

```ts
export type Head = "none" | "arrow" | "triangle" | "stealth" | "oval" | "diamond" | "bar";   // "bar" = a limiter tick
export interface Heads { a?: Head; b?: Head; size?: "s" | "m" | "l" }
export interface Anchor { to: string /* "t:<table>" | "i:<item>" | "n:<noteKey>" */;
  at: "l" | "r" | "t" | "b" | "c" | "tl" | "tr" | "bl" | "br"; dx?: number; dy?: number }   // the end follows that point of the object
export interface LineItem { kind: "line";
  route: "straight" | "elbow" | "curve" | "bracket" | "range";
  a: { x: number; y: number }; b: { x: number; y: number };   // slide px; the ends when not attached
  mid?: number;                                // elbow: where the bend sits (0–1 along the run); bracket: depth px; curve: bulge
  bend?: "hv" | "vh";                          // elbow: horizontal first or vertical first
  ends?: { a?: Anchor; b?: Anchor };           // attachment per end
  style?: LineStyle & { heads?: Heads };       // colour, weight 0.5–8 px, dash, heads
  text?: string; fmt?: TextFmt;                // an optional label at the middle (may quote cells, {Sheet!C7})
  box: Box }                                   // the bounds of a–b padded to ≥ 1 px each side (item.patch needs w, h > 0: a divider is 0 px high)
```
* `box` is only for the code that requires one (create, `isBox`, `ops.ts:65-66, 106`); everything that uses a line's
  geometry – drawing, hits, snapping's "others", exports – takes it from the **resolved ends** (attached ends follow
  their object; `box` would be stale). The ops vectors get "a horizontal line" and "a vertical line" cases.
* **Free layout**: like every item, a line has a per-design place when free layout is on for that design –
  `free[design].items["i:<id>"]` = its bounds plus `a` / `b` (`FreeLayout` entries become `Box & {scale?, a?, b?}`;
  an entry is replaced whole, as today); in automatic layout its `a` / `b` apply in every design, as a callout's `box`
  does. So a line drawn beside a table in Liquid Glass's free layout does not land in the wrong place in Excel's.

* Kinds the owner listed map to presets of one item: **straight line, arrow** (heads), **elbow** (`route: "elbow"`),
  **limiter** (`heads: {a: "bar", b: "bar"}`), **bracket** (`route: "bracket"`, a square or curly bracket between a and
  b, `mid` its depth), **range marker** (`route: "range"`: a line with bar heads and a centred label), **divider**
  (straight, dashed, no heads), **callout line** (a line whose end a is attached to a callout, end b free or attached to
  a table cell's side).
* **Attachment** is per end (`ends.a`, `ends.b`): the end follows the anchor point of the object **in the design being
  drawn**, in automatic and free layout alike (the object's box comes from `computeLayout` / `itemBoxOf`). If the object
  is removed, the end stays at its last saved point (`a` / `b`, written on every move) and the Issues panel says
  "Line 3: its end lost its object". (A line's free-layout place: above; an attached end moves with its object in
  every design.)
* `ItemKind += "line"`; `ITEM_KEYS += route, a, b, mid, bend, ends, style` (whole values; `ends` and `style` are small
  and set together by the panel, so they are plain keys replaced whole – Q13 if the owner expects two people to restyle
  one line at once). `ITEM_KINDS += "line"` (§1 makes the deck format 5 at the first line).

### 2.4 Icons (F10)

* `ShapeItem.icon` accepts `"tabler:<name>"` (outline) and `"tabler-filled:<name>"` besides the 17 built-in names;
  `stroke?: number` (outline width, 1–3 px at 24, default 2) joins `ITEM_KEYS`. An icon item is a `shape: "icon"`
  item, so it moves, snaps, attaches, is coloured (`fill` = its ink) and sized like today's icons.
* The set lives in `core/src/icons/` (ADR-020): names, categories and tags in an index, the path data of 5,184 outline
  and 1,054 filled icons, vendored at **@tabler/icons 3.49.0** by `tools/vendor-tabler.mjs`, inflated on first use.
* Chart marks (`kind: "icon"`) and Excel icon sets (§2.9) use the same lookup.

### 2.5 Hidden rows and columns (F11) and delete-versions (F14): one mechanism

```ts
// SlideDef += hidden?: Record<string /* "<tableId>:r<sheetRow>" | "<tableId>:c<COL>" */, true>
// DeckVersion += drop?: Record<string /* sheet id */, string[] /* "5:7" rows | "C:D" columns */>;   hide (cells emptied) unchanged
// Op += { op: "version.patch"; id: string; patch: { name?: string | null; hide?: Record<string, string[] | null> | null;
//                                                     drop?: Record<string, string[] | null> | null } | null }
```

* **F11 is per slide** (the same table can be on two slides; the owner asked "on a slide", not in the workbook):
  `slide.patch {hidden: {"t3:r12": true, "t3:cE": null}}`, `SLIDE_MAPS += hidden`, merged per row / column, inverse
  per entry. Two users hiding two rows both win.
* **F14 extends `DeckVersion`** (Q6): a version has `hide` (cells **emptied in place**, today's behaviour, kept) and
  `drop` (whole rows / columns **deleted**: the table closes up). The wizard's step 4 and a ribbon flow edit both
  (§3.7). It is not a second kind of version: one version can do both, and every export path that knows versions
  (Export ▾ › Versions, "every version × design", scenario runs × versions, the version picker) already carries it.
* **One mechanism.** `buildLayout(S, g, {cols, rows, merges, hide})` (`xlsx/layout.ts:52`) gets a `hide` set of sheet
  rows and columns, unioned with the workbook's own hidden rows / columns – the path that already closes up Excel's
  hidden rows, their drawings and merges. The set = slide `hidden` (F11) ∪ the version's `drop` (F14). Its key joins
  `resolveTable`'s cache key (`preset.ts:72`) and `tableKey` (`render/context.ts:36`), so every cache (layout, items,
  comments, exhibits, charts) misses exactly where the hidden set changed.
* **Versions get an op**: today a version is edited only by the wizard's whole `preset.set`; with a ribbon flow two
  people may edit two versions at once (and the wizard is no longer the only writer), so `version.patch {id, patch}`:
  a patch with `name` on a missing id **creates** the version, appended after the others, with `hide: {}` (the field
  is required and read unguarded: `chart-dl.ts:59`, `shape-dl.ts:34`, `context.ts:36`); `patch: null` deletes it;
  `hide` / `drop` are merged per sheet (each sheet's list replaced whole, `null` removes that sheet's entry), and
  `hide: null` clears to `{}`, never deletes the field; no preset → skipped. Inverse as `item.patch` (create ↔
  delete, per sheet entry). Vectors: create, rename, a sheet's list set / cleared, `hide: null`, two writers on two
  sheets, delete. The wizard keeps writing `preset.set` (a whole new deck arrangement), unchanged.

### 2.6 Snapping and positions (F8)
No new state: snapping changes where an object is dropped; the drop writes the existing ops (`item.patch` box,
`slide.patch` free / notes, `table.patch` / `slide.patch` sizes). **"Kept exactly as dropped"**: every position and
size a drag writes is rounded to **1/4 px** (exact in binary floating point and in PowerPoint's EMU: 1/4 px =
1,905 EMU, so JSON, the PDF and PowerPoint show the same number on every PC), and the drag preview draws the
**same rounded** value – today non-free drags preview floats and save `Math.round` (a ≤ 0.5 px jump on drop), free
drags save floats (`drags.ts:162-169`). One function `snapRound` in `core/src/render/layout.ts`, used by the preview and
the op builder.

### 2.7 Format painter (F12)
* **Cells** – what is copied (CE-16 grows): font family (`font`, new), size, bold, italic, colour, highlight (`fill`),
  cell colour (`bg`), horizontal **and vertical** alignment (`valign`, new `CellEdit` key – today vertical alignment is
  per slide only; Q9), text style (`role`), conditional colours (`cf`, now covering the F17 rules: icon sets, bars,
  scales), the slide's colour scale (`scales`), cell gridlines (`cellGrid`), cell borders (`borders`), and – if Q9 says
  yes – number display (`num`, a new `CellEdit` key: an Excel number format code chosen in the ribbon, *Decimals −/+*,
  *%*, *Thousands*). Not copied: text, merges, hidden rows (a structure, not a format).
* **Objects** (new): with a chart, callout, icon or line selected, the painter copies its look (chart: palette,
  per-series styles by position, legend, axes' formats, frame; callout / icon: fill, border, text format, stroke; line:
  style and heads) and pastes it on objects of the same kind – one `item.patch` per target.
* **Several targets and other slides**: one click arms it for one paste; double-click keeps it armed (today) across
  slide changes (today) and object / cell targets alike; Esc or the button ends it. Each paste is one undo step.
* No new op: cells → `cell.patch` / `table.patch` as today; objects → `item.patch`. New keys: `CellEdit.valign`,
  `CellEdit.num` (`CELL_KEYS`; `needsV5`).

### 2.8 New slide, Add table (F16)

```ts
// Op += { op: "slide.add"; slide: SlideDef; after: string | null }      // inserted after that slide id (null = first)
//    | { op: "slide.remove"; id: string }                              // the inverse of slide.add (and the undo of New slide)
//    | { op: "table.add"; table: TableDef; slide: string; at?: number } // the def joins preset.tables if its id is new; its id joins slide.tables
//    | { op: "table.remove"; id: string; slide: string }                // the inverse of table.add (the def stays in preset.tables)
```
* Merge: two `slide.add` after the same slide both land; the fold applies them in Lamport order, so the **later** one
  ends up directly after that slide and the earlier one after it (deterministic on every page); `after` naming a
  missing slide (removed meanwhile) inserts at the end; `slide.add` with an id that exists is skipped; `slide.remove`
  of a missing id is skipped; an `item.patch` or `slide.patch` on a slide another user removed meanwhile is skipped –
  that edit is lost, as any edit of a deleted object (said in the user guide). Inverses: `slide.add` ↔ `slide.remove`
  (the removed slide's def and its previous neighbour kept in the inverse). `table.add` / `table.remove` likewise;
  `table.add` on a slide whose free layout is on in a design places the table at the first empty spot of that design's
  content area at its automatic scale and writes no free entry (the next free move writes it, as items added after the
  switch-on are handled today, 07 §5.1). As built in S13.4 (`layout.ts` freeLayout, emptySpot): only a table with **no**
  entry (an unusable entry keeps the automatic place, as before); the first spot top to bottom, then left to right, GX /
  GY away from the placed tables, their text boxes and the items, for the table **with the text boxes and attached
  items that go beside it** (those without a place of their own: their bounding box is fitted, so a comment below the
  new table never lands on another table – S13.4 review); no spot that large → the first at ¾, ½, ⅓ or ¼ of that
  scale; none either → the automatic layout's place. Known and accepted (S13.4 review, for the 4.6.0 CHANGELOG at
  S13.5): the spot is computed, not saved, so (a) in a format-4 deck that 4.5 pages still open (a table put on a
  free-layout slide by the wizard, with no entry) a 4.5 page draws it at the automatic place and a 4.6 page at the empty
  spot – their exports differ until someone moves it (`table.add` itself raises the deck to format 5, so 4.5 pages
  never see a table added that way) – and (b) it can move when another box of the slide moves, until its first free
  move writes its entry.
* Undo of *Delete slide* restores the slide **as this page had it** when the remove was applied: the inverse is taken
  from the page's view then (`DocSync.apply`, `ops.ts` inverseOf). An edit of that slide by another user with a lower
  Lamport time that reaches this page only after the delete is folded before the remove – and is lost when the undo
  adds back the older copy, although it was correctly ordered. *Delete* of a chart or shape (`item.patch` with
  `patch: null`) behaves the same. This is the behaviour in 4.6 (pinned by `core/tests/ops.test.ts`, "undo of Delete
  slide puts back the slide as this page had it"); S13.4 may recompute the inverse against the server copy when Undo
  runs. Ids of added slides and tables must be unique per writer (writer id + seq, or random; S13.4): a `slide.add` with
  an id that exists is skipped, so two pages making the same id would merge two users' slides. S13.4 makes them random:
  "s" / "t" + 10 base-36 characters, made again while the deck has that id (`app/src/editor/slides.ts` newId).
* `table.add` needs a whole definition with what its kind needs (a range's `range`, markers' `anchor` and `index`), and
  `slide.add` a slide whose `tables` holds each id once; otherwise the op is skipped. A `table.remove` of an id on the
  slide whose definition is missing from `preset.tables` applies but has no inverse (nothing visible is lost).
* A blank slide (`type: "content"`, `tables: []`, title "New slide") must lay out: `computeLayout` with no tables
  returns the title area and the items' boxes (today it returns no boxes, `layout.ts:242`; fixed in S13.3). The title
  area is the band above the content area, or Consulting Red's message panel (x 0–500) when the slide has the panel.

### 2.8b Hidden slides (B47, S13.6; product owner 2026-10-21)

```ts
// SlideDef += hide?: Partial<Record<Design, true>>      // hidden in these designs; slide.patch {hide: {glass: true}}
```
* One key, `hide` (not `hidden`: §2.5's slide `hidden` is F11's hidden rows / columns, `"t3:r12": true`). `SLIDE_MAPS
  += hide`: merged per design (two users hiding the slide in two designs both land; `{glass: null}` shows it there
  again, `hide: null` in every design, an empty map is removed). Inverse as every map merge (the previous entry of each
  design named). `knownOp` knows it (a 4.6 page compacts it); `needsV5` by itself (not a 4.0.0 key) and `docNeedsV5`
  for a non-empty map (`V5_SLIDE`). Vectors: one design kept beside another, null per design / whole, a removed slide,
  two writers in two designs (fold).
* **Exports** (`worker/host.ts` slideLists): a list asked for an export without naming slides (`forExport`, no
  `slides`) leaves out the slides hidden in its design – PDF and PowerPoint of the deck, every version × design, Run for
  each value; PNG of every slide names the shown slides (`editor/export.ts`). Slides named are drawn: the current slide
  (PDF / PNG / PowerPoint / clipboard) exports even when it is hidden – it was asked for. The Run for each value gate
  (RC-06) skips the cells of hidden slides. Every slide hidden: the deck export is refused with a note; every version ×
  design and Run for each value skip a design whose every slide is hidden (a note names it) and are refused, before any
  job starts, when that is every chosen design (`editor/export.ts` shownDesigns; the export worker would otherwise stop
  part-way with "nothing to export") – owner to confirm skip-with-note over refusing the whole export. One slide shown:
  the PDF / PowerPoint file is named after that slide, as a one-slide deck always was (the name follows the pages the
  file holds) – intended.
* **Numbers and contents** (`render/pagenumbers.ts`): `pageNumber(i)` = start + the slides before i not hidden in the
  design; `N` = the shown slides; a hidden slide draws no page number; the contents slide (`slide-dl.ts` indexNodes /
  consultIndex) lists only shown content slides, with their exported numbers. The same rule on the stage and the
  thumbnails (they draw from the same ctx), so the numbers on screen are the exported ones; the slide list's own
  numbers (1 … n) stay positions in the list, struck through on a hidden slide.
* **UI**: the slide list's right-click menu (`Chrome.tsx`, beside S13.4's *New slide*): *Hide slide* / *Show slide* (the
  current design), *Hide in every design* / *Show in every design* (all five; "show" when hidden in all). One op each,
  one undo step. A hidden slide's thumbnail is grayed with a *hidden* tag and its number struck; the stage draws it
  (it can be edited) with a mark "Hidden in <design> – not exported" (DOM, never in the display list). The menu keeps
  the slide by id (another writer's slide.add / slide.remove while it is open moves the positions). The plan's "and the
  slide menu": the app has no slide menu besides this one (the menu bar has Open and Export only), so the items live
  there; a toolbar entry waits for the owner.

### 2.9 Excel conditional formats (F17)
No deck state: the rules come from the workbook (read-only). The core evaluates more rule types per cell and the
result joins the laid-out cell (`Item.cf` grows from a dxf to `{dxf?, scale?: RGB, bar?: {from, to, fill, border,
neg, axis}, icon?: {set, i, colour}, hideValue?}`). The painter's `cf` reference ("the rules of `Sheet!A1`") carries
them all. Parsed: `colorScale` (2, 3 stops: min / max / num / percent / percentile / formula), `dataBar` (incl. the
2010 `x14:dataBar` extension: solid / gradient, border, negative colour, axis position, direction), `iconSet` (the 20
built-in sets incl. `x14` sets and custom per-threshold icons, `reverse`, `showValue="0"`), `top10` (top / bottom, n or
%), `aboveAverage` (above / below / equal, std dev), `duplicateValues` / `uniqueValues`, `containsText` / `notContains`
/ `beginsWith` / `endsWith`, `containsBlanks` / `notContainsBlanks` / `containsErrors` / `notContainsErrors`,
`timePeriod` (today … next month, the PC's date like Excel), and `expression` with **any formula** – evaluated by the
formula engine (lazily, only when a slide's table has such a rule; the self-check classes apply). The dxf gains number
format, border, underline and strike.

### 2.10 Keys, kinds and ops this design adds (with 4.2–4.5's additions, the `needsV5` list of §1)

| Where | Added |
|---|---|
| `item.patch` | (every `item.patch` already needs format 5, 4.0 knowing no items; for `knownOp` of 4.6:) kind `line`; keys `stack, gap, overlap, legendAt, frame, titleRule, plot, route, a, b, mid, bend, ends, style, stroke`; maps `sers, groups, axes, marks, legendHide, titleFmt`; new values of `type` and `icon` need no list (values are not checked) |
| `slide.patch` `free` | entries may carry a line's `a` / `b` (§2.3) – inside a known map, nothing to add |
| `slide.patch` | map `hidden` (F11); map `hide` (B47, §2.8b – in 4.6.0) |
| `cell.patch` | keys `valign`, `num` |
| new ops | `version.patch`, `slide.add`, `slide.remove`, `table.add`, `table.remove` |

`knownOp` learns all of them in the same commit (a 4.6 page compacts its own records).

---

## 3. Rendering – display-list nodes only

ADR-004 holds: **no new node type**. One **attribute** is added to `Stroke`: `join?: "miter" | "round" | "bevel"`
(default `miter`, today's behaviour) – needed for Tabler's outline icons and for round-cornered polylines (smoothed
lines with markers, elbows). Every backend has it: SVG `stroke-linejoin`, canvas `lineJoin`, PDF `j`, PowerPoint
`a:round` / `a:bevel` / `a:miter`. The amendment is part of ADR-020; `tools/dlcheck.mjs` gains a join case; `validate`
checks the value.

### 3.1 Chart types and their nodes

| Element | Nodes | Notes |
|---|---|---|
| Column / bar (clustered, stacked, 100 %) | `rect` per value (`r` 0, or the design's bar radius on the outer end: Liquid Glass 4 px, others 0), `fill` solid or the design's gradient; negative values below the axis | gap / overlap as Excel (`gap` default 150 %, overlap 0; stacked 100) |
| Line, smoothed line | one `path` per series (`L` segments, or `C` from Catmull–Rom with tension ½, which is what Excel's "smoothed line" draws within 1 px), stroke `cap: round`, `join: round`; gaps break the path | markers: `path` (circle as 4 cubics, square, diamond, triangle), fill + 1.5 px stroke in the background colour |
| Area (stacked, 100 %) | `path` closed to the baseline (or the series below), fill with alpha .85 | |
| Scatter | markers as above; optional smoothed `path` | x axis numeric |
| Waterfall | `rect` per step floating between the running totals, up / down / total colours (design `pos` / `neg` / ink), thin `line` connectors between steps | no Office 2016 chartex in PowerPoint (§4.2) |
| Combo | the series' own types in one plot, drawn in the order area → column / bar → line → scatter → marks | |
| Axes | `line` (axis line), `text` tick labels (the axis `num` format or the first cell's format, the workbook's locale: Italian `11.576` with a dot), optional gridlines (`line`, the design's rule colour) | the right axis only when a visible series uses `y2` |
| Category groups, dividers | tick labels per group; divider `line` between groups (dash as styled) | |
| Data labels | `text`; positions above / below / left / right / center / inside end / inside base / outside end; collision: a label that would overlap another of the same series moves to the other side, else hides (Issues: none – it is cosmetic) | `ofTarget`: value ÷ target, "97 %" (the workbook's percentage style, Italian space before % as the owner's chart) |
| Target bars | the filled `rect` (the value) and over it the outlined `rect` of the target's height (stroke 1.5 px in the series colour, no fill), **the same width** – what PowerPoint can draw too (§4.2); the label inside the fill (white bold when the fill is dark, luminance < .6). Decided 2026-10-20 (Q18): the same width everywhere (the review picture still showed the inset look) | |
| Marks | arrow: `line` + `path` head; line / band: `line` / `rect` with alpha; icon: the icon's `path`s; text: `text` | data coordinates → plot px each build |
| Legend | `rect` swatch (or a `line` + marker for line series) + `text` per entry, at `legendAt`; hidden entries skipped; "inside" positions draw a card behind it in the design's material | |
| Title, frame | `text`; `titleRule` = a `line` under the title (the reference chart's rule); `frame` = a `rect` stroke round the chart | |
| Selection | `hit {kind: "item"}`; `hit {kind: "point", id: "<item>:<series>:<i>"}` per value (the panel's per-point colour / label); `hit {kind: "mark", id: "<item>:<mark>"}` | the stage's existing item hits |

**Per design** (as pies today, `chartLook` `chart-dl.ts:128-144`): Liquid Glass – the glass palette, gradient bars,
capsule legend, the glass card; Excel – Office palette, flat, no card; Excel Refined – Office palette, plain rounded card;
Consulting Navy / Red – `specOf(ctx).chart` palette (navy / electric blue; red / greys), hairline axes, no gridlines by
default, labels in the design's label family; **the per-slide looks** (08 §2.8): the *Panel* headline turns charts in
the panel area white-on-colour as callouts are today (`slide-dl.ts:141`), *Tint* / *White* backgrounds change the card
fill; no look part changes the chart's data.

### 3.2 Computations (all in `core/src/render/chart-*.ts`, pure, cached by `chartKey` – which today exists but is not
used: S14.2 wires it into `slide-dl.ts:184-210`)
* **Scale**: an axis without `min` / `max` gets Excel's automatic bounds (min 0 when all values ≥ 0 and the spread is
  large, else a "nice" step below the minimum; `step` from 1-2-5 × 10ⁿ for 4–8 ticks) – tested against Excel's own
  axes on the chart corpus (§7.1 CT-02).
* **Stacks**: per stack key and category, positives up, negatives down; 100 % divides by the category's absolute sum.
* **Smoothing**: Catmull–Rom → cubic Bézier, control points p1 + (p2 − p0)/6 and p2 − (p3 − p1)/6, ends duplicated.
* **ofTarget**: `round(value / target × 100)` with the label's number format; target 0 or missing → no label.
* **Waterfall**: running total; a point marked `total` in `points[i]` (label `null` keeps hidden) restarts from 0.
* **Budgets** (§7.4): column chart 12 categories × 4 series ≤ 5 ms; the reference chart ≤ 5 ms; line 12 series × 52
  points ≤ 10 ms – gates in `npm run bench` (core) beside the pie gate S9.2 added (`core/bench/chart.bench.test.ts:21,51`,
  12 slices ≤ 5 ms).

### 3.3 The reference chart, rebuilt (the first worked example)

The owner's Excel chart "Loans Volume – Weekly Evolution", as a `ChartItem` (sheet names are examples; in the review
deck `spikes/charts/decks/p09-charts.json` with `spikes/charts/books/loans-weekly.xlsx` the weekly values are on
`Weekly`, the targets on `Targets`, a second workbook in
the variant):

```jsonc
{ "kind": "chart", "type": "combo", "title": "Loans Volume - Weekly Evolution",
  "values": { "sheet": "Weekly", "range": "C5:F5" },                // kept for the code that needs it (§2.2); the series below draw
  "titleFmt": { "b": true, "color": "#1F3864" }, "titleRule": { "color": "#1F3864", "w": 1.5 }, "frame": { "color": "#D9D9D9", "w": 1 },
  "legendAt": "none",
  "groups": { "wk":  { "n": 1, "cats": { "sheet": "Weekly",  "range": "C4:F4" } },              // Q3, Week37, Week38, Week39
              "tgt": { "n": 2, "cats": { "sheet": "Targets", "range": "B2:C2" },               // Eom Budget, EoM Ambition
                       "divider": { "color": "#7F7F7F", "w": 1, "dash": "dashed" } } },
  "axes": { "y":  { "min": 11000, "max": 11700, "step": 100, "num": "#,##0", "grid": false },
            "y2": { "min": 0, "max": 14000, "step": 2000, "num": "#,##0", "grid": false },
            "x":  { "fmt": { "b": true, "color": "#1F3864" } } },
  "sers": {
    "vol": { "n": 1, "group": "wk", "type": "line", "axis": "y", "smooth": true, "color": "#1F3864",
             "vals": [{ "sheet": "Weekly", "range": "C5:F5" }],                                  // 11.576, 11.258, 11.258, 11.324
             "marker": { "shape": "circle", "size": 9 }, "points": { "0": { "marker": "#A6A6A6" } },
             "labels": { "show": ["value"], "pos": "above", "fmt": { "b": true, "color": "#1F3864" } } },
    "act": { "n": 2, "group": "tgt", "type": "column", "axis": "y2",
             "vals": [{ "sheet": "Weekly", "range": "F5" }, { "sheet": "Weekly", "range": "F5" }],  // the latest week against both targets
             "target": [{ "sheet": "Targets", "range": "B3:C3" }],                               // 11.624, 12.000
             "points": { "0": { "color": "#1F3864" }, "1": { "color": "#A6A6A6" } },
             "labels": { "show": ["ofTarget"], "pos": "inEnd", "fmt": { "b": true, "color": "#FFFFFF" } } } },
  "marks": {
    "start": { "kind": "arrow", "a": { "s": "vol", "i": 0 }, "b": "floor", "style": { "color": "#1F3864", "w": 1.5, "heads": { "a": "triangle" } } },
    "ib": { "kind": "icon", "icon": "tabler:target", "a": { "s": "act", "i": 0 }, "dy": -46, "size": 26 },
    "ia": { "kind": "icon", "icon": "tabler:target", "a": { "s": "act", "i": 1 }, "dy": -46, "size": 26 },
    "tb": { "kind": "text", "text": "{Targets!B3}", "a": { "s": "act", "i": 0 }, "dy": -14, "fmt": { "b": true, "size": 22 } },
    "ta": { "kind": "text", "text": "{Targets!C3}", "a": { "s": "act", "i": 1 }, "dy": -14, "fmt": { "b": true, "size": 22 } } },
  "box": { "x": 120, "y": 180, "w": 1360, "h": 620 } }
```

(`a: {s, i}` of a target series point means the top of the **target** bar; text marks quote cells with the callouts'
`{Sheet!C7}` syntax, so "11.624" follows the workbook.) The picture of this chart in the five designs is the first row
of `review/P09`. In Excel the owner's dark blue is kept as drawn (explicit colours win over the design's palette, as
per-slice colours do today); in Liquid Glass and the consulting designs the same item uses the explicit colours too –
§9 Q3 asks whether explicit colours should yield to each design's palette instead.

### 3.4 Lines and annotations (F9)
* Straight: one `line` node (stroke colour / weight / dash, `cap: butt` with heads, `round` without). Elbow: a `path` of
  three segments (`join: miter`), the bend at `mid`. Curve: one cubic. Bracket: a `path` (square: three segments;
  curly: four cubics). Range: a `line` with bar heads and the label centred above it.
* Heads: a filled `path` at each end, sized from the weight (s / m / l = 2 / 3 / 4.5 × w), the line shortened under a
  filled head so the tip is exact; `bar` = a perpendicular `line` (the limiter).
* Label: `text` at the middle, the text-box renderer's wrapping, the background colour behind it (a `rect`) so it
  reads across the line.
* Designs: the line takes its explicit colour; unset → the design's ink (Liquid Glass: the theme's text colour; Excel:
  `#404040`; Navy: navy; Red: dark grey); dividers default to the design's rule colour. No glass material on lines.
* Hits: `hit {kind: "line", id}` along the line (a 12 px wide band, as boxes per segment) and handle positions for the
  stage: end a, end b, middle (§5.3).

### 3.5 Icons (F10)
* **On slides:** the outline icon as `path` nodes with `stroke {w: stroke × size / 24, cap: round, join: round}` (size =
  the icon's box in slide px), no fill;
  a filled icon as `path` with `fill`. Every Tabler outline SVG starts with an invisible `<path stroke="none"
  d="M0 0h24v24H0z" fill="none"/>`: the vendor step drops `stroke="none"` paths (or every icon would get a square).
  Names change between Tabler versions: the vendor step keeps an alias table (old name → new), and an icon name the set
  does not have shows the built-in "info" **and an Issues line** ("Icon 'x' is not in the icon set") instead of today's
  silent fallback (`shape-dl.ts:122`). Tabler's SVG uses arcs (`a`) and relative commands: `tools/vendor-tabler.mjs`
  converts every path to the display list's absolute `M L C Z` at vendor time (arcs to cubics, ≤ 90° each), so the
  renderer only scales. *(amended: ADR-020 2026-10-21 – as built, the vendor step makes every command absolute and keeps
  arcs (and quadratics) in the packed data, lossless and 17 % smaller; `core/src/icons/index.ts` converts them to cubics
  of ≤ 90° when an icon is first drawn, so the display list still gets only `M L C Z`.)* Colour = the item's `fill` (its ink), else the design's ink as built-in icons today.
* **The picker** (`app/src/ui/IconPicker.tsx`, opened from *Insert shape ▾ › More icons…* and from a chart mark): a
  search box (name and tags, prefix and substring; Italian search words added by Q11's decision, `core/src/icons/search-it.ts`), a category list (41), a grid
  of results drawn as inline SVG from the same path data, outline / filled switch, colour and size of the inserted
  icon. Virtualised: only the visible tiles (≈ 120) are drawn. The search runs in the core worker over the index (§7.4
  budget), so the page holds no copy of the set.
* **In the app's interface (B35, optional, Q10):** replace the ≈ 25 hand-drawn toolbar icons and the Unicode glyphs
  (↻ ✦ ⚙ 🗑 ⤺ ↔ …) with Tabler icons for one consistent look. These ≈ 40 icons are compiled into the page at build time
  as a small module (≈ 12 KB), independent of the lazy set. It changes what users see in every toolbar, so it is its
  own B-item; without approval the UI keeps its icons and only the picker shows Tabler.

### 3.6 Hidden rows and columns (F11)
* `buildLayout` closes the rows / columns up (as Excel's hidden ones): the table's height / width shrinks, its sizing
  (`sizes`, scale, free-layout box) follows the same rules as a table whose workbook range shrank; merges crossing a
  hidden row lose that row (Excel's behaviour); a cell border on the edge of a hidden row is dropped with the row, the
  neighbours keep their own; cell gridlines' outlines (`o`) are drawn round the visible cells.
* Charts reading the table follow: a chart whose `DataRef` is `{table}`, **or** a sheet range inside the range of a
  table on the same slide, skips the hidden rows / columns (the resolver's existing hidden-row path). A chart on another
  slide reading the same sheet cells by sheet range is not affected (the rows are hidden on this slide only) – Q7.
* Automated comments, KPI line and panel: they read the laid-out grid (`gridOf`, `exhibitOf`), so they recompute from
  what is shown (e.g. "Total up 3 %" without the hidden row's contribution only if the total is a cell the workbook
  computes – a hidden row does **not** change Excel's totals; the comment quotes the shown cells). §9 Q8 makes this
  explicit for the owner.
* UI: with cells selected, ribbon 2 › Cells › **Hide ▾** (*Hide rows · Hide columns · Unhide all on this table*); on the
  stage a thin double mark (DOM overlay, not exported) where rows are hidden, a click unhides them. Undo: one step.

### 3.7 Delete-versions (F14)
* Effect for the version: `drop` rows / columns close up exactly as F11 (the hidden set includes them), `hide` cells
  are emptied in place (as today). Everything that depends on the data recomputes **for that version only**: table
  sizing, gridlines / borders, charts, comments, KPI line and panel, callout tokens (a dropped cell quoted by a callout
  shows empty, as a removed one does today). The full deck and other versions are untouched (the version's `hide` and
  `drop` lists join `tableKey` per sheet, as `hide` does today, `render/context.ts:36`, and the layout key – so they are part of
  every cache key, as `hide` is today).
* **Wizard step 4** (versions): beside *Remove cells* (`#wCut`), **Delete rows** (`#wDropRows`) and **Delete columns**
  (`#wDropCols`) act on the dragged selection's rows / columns; the grid shows deleted rows / columns struck and
  narrowed, removed cells hatched (today); each entry in the list has ✕ to restore.
* **Ribbon flow** (without the wizard): choose the version in `#versionSel` (the stage shows it), select cells, ribbon 2
  › Cells › **For this version ▾**: *Delete rows · Delete columns · Empty cells · Restore selection · Restore all*. Each
  is one `version.patch` and one undo step. With *Full deck* shown the menu is disabled with a tooltip ("Choose a
  version first").
* Exports: Export ▾ › Versions, "every version × design" (PDF / PowerPoint / both), scenario runs × versions all draw
  the version's lists – no change in the export paths, only in what the lists hold.

```
Wizard › 4 Versions                                        Ribbon 2 › Cells (version "Chief" chosen in the top bar)
┌──────────────────────────────────────────────────────┐  ┌───────────────────────────────────────────┐
│ Versions: [Chief ▾] [+ Add]  [Rename] [Delete]       │  │ For this version ▾                         │
│ SLIDE_1 ──────────────────────────────────────────── │  │   Delete rows          (3 rows selected)   │
│      C        D        E       F        G   ▒I▒ ▒J▒  │  │   Delete columns       (1 column selected) │
│  6 Alpha  1.234.568  2,5  1.975.309  ░░░  ▒  ▒  ▒   │  │   Empty cells                              │
│ ≡10 Epsilon ─────────── deleted ───────────── ✕     │  │   ─────────────                            │
│ [Remove cells] [Delete rows] [Delete columns]        │  │   Restore selection                        │
│ Chief: rows 10–12 deleted ✕ · columns I:J deleted ✕  │  │   Restore all of "Chief"                   │
│        cells F6:G8 emptied ✕                         │  └───────────────────────────────────────────┘
└──────────────────────────────────────────────────────┘  disabled with "Full deck" shown ("Choose a version first")
░ emptied (hatched today) · ▒ deleted column · ≡ deleted rows struck through and narrowed on the grid
```

### 3.8 Painter (F12)
Cells: as today plus font, valign, number display (if Q9), the F17 rules through `cf`. Objects: the painter button is
enabled when one object is selected; its look is stored in the selection state (`selection.painter.kind = "object"`);
a click on another object of the same kind pastes. The stage shows the painter cursor over valid targets only.

### 3.9 New slide, Add table (F16)
* **New slide**: a button **+ New slide** in the slide list's header (`#newSlide`, beside "SLIDES") and in the stage's
  context of the slide list (right-click › *New slide*, *Delete slide* – Q12), Ctrl+M (PowerPoint's shortcut). It adds
  a blank content slide after the selected one (`slide.add`), selects it, and puts the title in edit mode.
* **Add table** (`#addTable`, ribbon 2 › Insert): a menu of the deck's mapped tables (`preset.tables`): the ones on no
  slide first, then the others with the slides they are on; each row shows the name, the sheet and range, and a small
  thumbnail; a click adds the table to the current slide (`table.add`), automatic layout makes room. *New table from
  cells…* opens the existing range picker (`PickCells`) and makes a range table.

### 3.10 Excel conditional formats (F17)
* Colour scales → the cell's fill (as Excel). Data bars → a `rect` inside the cell, from the axis to the value's length
  (gradient = a linear paint to 10 % alpha, as Excel 2010), border, negative bars in their colour, the value drawn over
  it (or hidden with `showValue="0"`). Icon sets → a `path` icon left of the text in the cell, Excel's icons redrawn as
  vectors in `core/src/render/cf-icons.ts` (arrows 3 / 4 / 5 coloured and grey, traffic lights rimmed / unrimmed, signs,
  symbols circled / uncircled, flags, stars, ratings, quarters, boxes, triangles): the same shapes and colours as Excel's
  (green `#00B050`-family, amber `#FFC000`, red `#C00000`; each set's exact colours taken from Excel 16 on this PC in
  S16.4 and recorded).
* Per design: Excel and Excel Refined draw them as Excel; Liquid Glass draws bars as capsules (r = h/2) and icons in
  the text colour's family (the glass palette's pos / neg / amber); consulting designs draw icons and bars in the
  design's pos / neg colours, thin (exhibit style: bars as hairline-height bars under the value) – the owner judges at
  the review (§0.1 row 7, Q15).
* The "not reproduced" Issues line now lists only what is still not: rules referring to other sheets in Excel 2007
  files, and `expression` formulas the engine marks `different`.

---

## 4. PDF and PowerPoint

### 4.1 PDF, PNG, thumbnails, clipboard
Nothing new: they draw the display list. The `join` attribute is written as `j` (PDF), `lineJoin` (canvas). Icons are
paths (no font, no picture). `pdfcheck.py` and the GF facts are unchanged.

### 4.2 Native charts in PowerPoint (the owner's rule: native objects, no pictures, no links)

| Our chart | PowerPoint (ECMA-376 1st ed. + the 2010 features PowerPoint 2016 reads; no `c14`/`c15`/chartex) |
|---|---|
| column / bar clustered, stacked, 100 % | `c:barChart` `barDir` col / bar, `grouping` clustered / stacked / percentStacked, `gapWidth`, `overlap` |
| line, smoothed, markers | `c:lineChart`, `c:smooth val=1` per series, `c:marker` (symbol, size, `spPr`) |
| area | `c:areaChart` (standard / stacked / percentStacked) |
| scatter | `c:scatterChart` `scatterStyle` lineMarker / smoothMarker |
| combo, second axis | several chart groups in one `c:plotArea`; the secondary group on its own `c:valAx` (`crosses max`, right) and a hidden second `c:catAx` (`delete 1`), as Excel writes combos |
| category groups | one `c:catAx` with all categories (both groups' names); each series cached with blanks (`c:ptCount` full, points only where it has values) – the same as Excel's combo of the owner's chart; the divider is a line shape over the chart (below) |
| waterfall | `c:barChart` stacked with an invisible base series (`noFill`), up / down / total series coloured – the classic Excel 2013 construction (chartex `cx:waterfall` is a 2016 part PowerPoint 2016 reads, but python-pptx and older viewers do not; Q4) |
| per-point colour, marker, label | `c:dPt` (`spPr`, `c:marker`), `c:dLbl` per point; a custom label text (`ofTarget`, a hidden one) as a rich-text `c:dLbl/c:tx/c:rich` – static text written from our value, refreshed at every export |
| "actual inside target" | two bar series on the same axis with `overlap 100` (`gapWidth` / `overlap` belong to the `c:barChart`, so both bars have one width): the **actual** series first (filled), the **target** series after it (`noFill` + outline, drawn on top so its outline shows); the percentage as the actual's rich-text label `inEnd` |
| axes | `c:valAx` `min` / `max` / `majorUnit`, `numFmt formatCode` (the cells' code; PowerPoint shows it with the viewer's separators, as Excel would), `majorGridlines` only when `grid`, `c:txPr` bold / colour for the category labels |
| legend | `c:legend` `legendPos` r / l / t / b / tr; inside = `c:layout` manual; a hidden entry = `c:legendEntry/c:delete 1`; none = no `c:legend` |
| title, rule, frame | `c:title` rich text; the chart space `spPr` outline = the frame; the title rule = a line shape |
| marks (arrows, lines, bands, icons, texts) and dividers | **plain shapes over the chart in the chart's group** (`p:sp` lines with `a:headEnd` / `a:tailEnd`, icons as `custGeom`, texts as text boxes). To land on the data, the writer fixes the plot area (`c:plotArea/c:layout/c:manualLayout` `layoutTarget inner`; x / y / w / h are fractions of the **chart space**, i.e. our plot rectangle divided by the chart's box) and every axis's min / max / unit, and puts line points at category centres (`c:crossBetween between`, as the display list does; `dispBlanksAs gap` as `pptx/chart.ts:56` writes today), so PowerPoint's plot is our plot: a point is where we drew it. pptxcheck verifies it on Windows by exporting each chart slide from PowerPoint (COM `Slide.Export` PNG) and comparing the mark anchors with the drawn points (≤ 2 px at 1600) |
| data | the embedded workbook (`embeddings/…xlsx`) gets every series' cached values in columns (categories in A, one column per series, blanks where a series has none, targets as their own columns), so **Edit Data** shows them; `--sources` in pptxcheck checks the caches against the workbook cells (each series against its own sheet / linked workbook). **No external links**: every `c:f` points into the embedded workbook (`Sheet1!$B$2:$B$7`), never at `[Budget.xlsx]Plan!D9` – a series from a linked workbook is a column of the embedded one; pptxcheck asserts that no `c:f` names a file and that no relationship is `TargetMode="External"` |

### 4.3 Lines, icons, conditional formats in PowerPoint
* **Lines** (F9): `p:sp` with `a:prstGeom prst="line"` for straight ones (flipH / flipV for direction) and an open
  `custGeom` for elbow / curve / bracket; style on `a:ln` (`w`, `a:custDash`, `a:solidFill`, `a:round` / `a:miter`)
  and **native arrowheads** `a:headEnd` / `a:tailEnd` (`triangle`, `arrow`, `stealth`, `oval`, `diamond`; the limiter's
  `bar` as a short perpendicular segment in the same `custGeom`, or – beside a dashed route or a native end – a solid
  round-capped shape of its own grouped with it). Dashes are written as `a:custDash` (S15.5, owner's open question 1):
  the presets cannot give our dotted (1:2) and dash-dot (4:2:1:2) patterns (`sysDot` is 1:1, `dot` 1:3, `dashDot`
  4:3:1:3), and one writer (`pptx/drawingml.ts` `ln`, shared by every shape) keeps every dash exact; dashed (4:3) is the
  `dash` preset's pattern, so it looks the same. A custom path never starts or ends on a segment of no length (an elbow
  bent at an end, a bracket of depth 0): PowerPoint aims a native end along that segment. **Never `p:cxnSp`**: an attached line is a plain
  shape at the place it was exported (PowerPoint does not keep it attached – the owner's rule, stated in the report).
  The label is a text box grouped with the line.
* **Icons**: `custGeom` from the same path data; outline icons as stroked open paths (`a:ln` width, `cap="rnd"`,
  `a:round`), `noFill`; filled ones as `solidFill`.
* **Tables with hidden / dropped rows**: the real table is written from the laid-out cells, so the rows are simply not
  there (nothing hidden inside PowerPoint).
* **Excel conditional formats**: colour scales as cell fills; data bars as `rect` shapes **under** the table in its
  group, with the cell's fill dropped to none where a bar is drawn (the text stays in the table cell); icon sets as
  `custGeom` shapes over the cell in the table's group. Editable as shapes; PowerPoint has no conditional formats.

---

## 5. Snapping (F8)

### 5.1 Targets
For the object being dragged (moved or resized; tables in free layout, text boxes, notes section, charts, callouts,
icons, lines' ends and the line as a whole), the targets on the **current slide in the current design**:
* the slide: left / right edges (0, 1600), top / bottom (0, 900), the centre lines (800, 450), the content margins
  (50, 1550; the content area's top; the footer line 822);
* every other object's box: left, centre, right; top, middle, bottom (tables: the drawn card's box, in free and
  automatic layout); lines contribute their ends and their middle;
* **equal spacing**: for the moving box, the gaps between neighbours on the same row (overlapping vertically) and
  column: when the box's gap to its left neighbour comes within `SNAP` of the gap between that neighbour and the next
  one (or of the gap on its other side), the box snaps to make the gaps equal; the same for widths ("same size as") on a
  resize.
* `SNAP` = 8 slide px **on screen**, scaled by zoom (`8 / scale`, so a zoomed-in drag snaps finer); Alt disables
  snapping **for every object in every layout** (today text boxes ignore Alt outside free layout – unified).

### 5.2 Algorithm and guides
* Targets are collected once at pointer-down into two sorted arrays (x and y, each entry with its kind and source) –
  ≤ 6 per object, ≈ 60 objects on a busy slide → ≤ 400 entries; per frame a binary search per moving edge / centre
  (3 + 3) finds the nearest within `SNAP`; equal spacing scans the neighbours of the row / column (sorted once).
  Cost: ≪ 1 ms per frame (budget §7.4: the snapping part ≤ 1 ms, the frame ≤ 16 ms as today).
* Guides (stage overlay, DOM, never exported – as today): every matched line drawn (not only one per axis), centre
  matches dashed, equal-spacing matches as two short dimension markers with the gap in px; colour `#FF2D92` (today's).
* The dropped position = the previewed position = `snapRound` (1/4 px, §2.6) of the snapped value.

### 5.3 Lines' handles
End a, end b and the middle: dragging an end moves that end (snaps to targets and, with **Ctrl**, to the nearest
object's anchor points: attaching it – the anchor is shown as a dot; dropping away from any anchor detaches it);
dragging the middle of a straight line moves the whole line (both ends detach), of an elbow moves the bend (`mid`), of
a bracket / curve changes its depth / bulge. Shift keeps a straight line at 0 / 45 / 90° (as PowerPoint).

---

## 6. Persistence audit (F13)

Every new piece of state: where it is saved, how two users' edits merge, how it is undone, that folding gives the same
document in any order, that it reaches every export and comes back on reopen on another PC. "OV" = an ops-vectors case,
"FX" = a saved fixture read by a test (added, never edited), "E" = Playwright, "PF" = export-check / pptxcheck.

| # | State | Saved as (op) | Merge with another user | Undo (inverse) | Fold in any order | Exports (PDF · PNG · PowerPoint · scenario) | Reopen / other PC | Guard |
|---|---|---|---|---|---|---|---|---|
| 1 | chart series (`sers`) | `item.patch` map | per series; same series → Lamport | per entry | OV "sers two writers both win" + reversed fold | DL · DL · `c:ser` + caches · overlay drawn | FX `charts-4.7.json` | U chart-dl CT-01…; PF caches; E CT-05 |
| 2 | groups, axes, marks, legendHide | `item.patch` maps | per entry | per entry | OV per map | as 1; marks as shapes over the chart (PowerPoint) | FX | U; PF mark positions (Windows) |
| 3 | chart plain keys (stack, gap, overlap, legendAt, frame, titleRule, plot, type values) | `item.patch` keys | per key (Lamport) | per key | OV | as 1 | FX | U; OV |
| 4 | line items (route, a, b, mid, bend, ends, style, text) | `item.patch` kind `line` | per key; `ends`, `style` whole | per key; create ↔ delete | OV create / move / attach / delete | `line` / `path` · DL · `p:sp` line / custGeom with heads, no `cxnSp` · drawn | FX `lines-4.8.json` | U line-dl; E LN-01…; PF no `cxnSp` (exists) |
| 5 | icon items (`icon: tabler:*`, `stroke`) | `item.patch` | per key | per key | OV | stroked `path` · DL · custGeom | FX; the set is in the page (no network) | U icons (every name resolves; `vendor-tabler` hash test); E IC-01 |
| 6 | slide `hidden` rows / columns | `slide.patch` map | per row / column | per entry | OV | closed up in every export; PowerPoint table without the rows | FX `hidden-4.6.json` | U layout / comment / chart; E HR-01 |
| 7 | version `drop` (and `hide` via the new op) | `version.patch` | per version, per sheet list | per entry; create ↔ delete | OV | each version's lists; every version × design; scenario × versions | FX `versions-4.6.json` | U; E VD-01…03; PF versions × designs (AUDIT §0 step 16) |
| 8 | `CellEdit.valign`, `CellEdit.num` | `cell.patch` | per key (exists) | per key (exists) | OV | DL; PowerPoint cell `anchor` / text | FX | U; E PT-01 |
| 9 | painter results | existing ops (`cell.patch`, `table.patch`, `item.patch`) | as those ops | one step per paste | (as those ops) | as those ops | – | E PT-01…03 |
| 10 | new slides | `slide.add` / `slide.remove` | both inserts land, Lamport order | add ↔ remove | OV "two adds after one slide" + reversed fold | every export | FX | OV; E NS-01 |
| 11 | tables added to a slide | `table.add` / `table.remove` | per slide list, Lamport order | add ↔ remove | OV | every export | FX | OV; E NS-02 |
| 12 | positions after snapping | existing box / free / notes ops, values on 1/4 px | (as those) | (as those) | (as those) | the drawn = saved number | FX positions read back exactly | E SN-03: drop → saved JSON → reopen → PDF / PowerPoint coordinates equal (EMU ±0) |
| 13 | deck format 5 (§1) | the snapshot | the first CAS wins, others see 5 | – (never lowered) | – | – | 4.6 reads 4 and 5; 4.0–4.5 refuse 5 | helper test; docsync test; **CP-01 experiment** with real 4.1 / 4.4 / 4.5 helpers |
| 14 | Excel CF results | none (from the workbook) | – | – | – | DL · DL · fills / shapes | the workbook | U per rule type on `tests/corpus/workbooks/cf/` (made in Excel, cached); GT |
| 15 | icon picker's search state | UI only (store) | – | – | – | – | – | – |
| 16 | the vendored icon data | the page (worker bundle) | – | – | – | – | same bytes everywhere | U: the inlined data's sha256 equals the vendored file's (ARCH-4's lesson) |
| 17 | icon names across Tabler updates | the item's `icon` | (as 5) | (as 5) | (as 5) | an alias resolves a renamed icon; an unknown one draws "info" and names itself in Issues | a deck saved with an older set opens with the same pictures | U: every alias resolves; the Issues line |
| 18 | chart `titleFmt`, line `fmt`, per-series `points` | `item.patch` (`titleFmt` map; `fmt` map; `points` inside a series entry) | per entry; `points`: with their series (last writer wins for one series) | per entry | OV | as 1 / 4 | FX | U; OV "two writers, one series" |
| 19 | the deck's marker `incident-format-5.json` | a file in the deck folder (helper) | O_EXCL, the first one stays | – (never removed) | – | – | 4.6 ignores it; 4.0–4.5 go read-only | helper test; CP-01 |

**Scenario runs**: charts, lines' labels, marks' texts, CF rules and KPIs read cells through the overlay facade
(`ctx.sheet`), so a run's value changes them; their cache keys include the overlay hash (as `tableKey` does). Guard:
an e2e scenario run on the reference deck checks the line's last label and the ofTarget percentage per value (CT-09).

---

## 7. Rows, B-items, budgets

### 7.1 New rows (05 §1 codes)

| ID | Behaviour | Verified by |
|---|---|---|
| CT-01 | column / bar clustered, stacked, 100 %; line, smoothed; area; scatter; waterfall – in all five designs | U (DL snapshots per design) + GP review (G9) |
| CT-02 | automatic axis bounds and steps like Excel's on the chart corpus | U against Excel's own chart axes (corpus `charts-2`) |
| CT-03 | series from two sheets and a linked workbook in one chart; a group from another table | U + E |
| CT-04 | second value axis; combo column + line | U + E |
| CT-05 | per-point colours, markers, labels; label positions; ofTarget labels | U + E |
| CT-06 | marks in data coordinates follow a reload and a scenario value | U + E |
| CT-07 | the reference chart equals the owner's (their sign-off of the picture) | GP (G9) |
| CT-08 | chart panel: add / remove / reorder series, pick each series' cells, type and axis per series | E |
| CT-09 | scenario run: chart labels follow each value | E |
| LG-01 | legend positions, hide one entry, hide all | U + E |
| PX-05 | native PowerPoint bar / line / area / scatter / combo / waterfall charts, caches = the cells, Edit Data | PF (python-pptx `chart_type`, caches) + PowerPoint opens it (Windows, gated – VER-3's lesson) |
| PX-06 | marks land on the data in PowerPoint (≤ 2 px) | PF (COM `Slide.Export` on Windows) |
| LN-01 | draw straight / elbow / bracket / range / divider; heads; style | U + E |
| LN-02 | end handles, middle handle, Shift 45°, attach with Ctrl, follows its object in auto and free layout, per design | E |
| LN-03 | PowerPoint: plain shapes with native heads; no `cxnSp` | PF |
| IC-01 | icon picker: search by name and tag, category, insert, colour, size | E + ⏱ |
| IC-02 | every Tabler icon resolves and draws in every backend; the data's hash | U |
| SN-01 | snap to slide edges / centre / margins, others' edges and centres | E |
| SN-02 | equal spacing and equal size guides | E |
| SN-03 | Alt off for every object; dropped = saved = exported (1/4 px; PowerPoint EMU equal) | E + PF |
| SN-04 | snapping frame budget with 60 objects | ⏱ |
| HR-01 | hide / unhide rows and columns on one slide; other slides unchanged | E |
| HR-02 | sizing, borders, gridlines, charts, comments, KPIs recompute | U + E |
| VD-01 | delete rows / columns in a version (wizard and ribbon); empty cells (today) | E |
| VD-02 | only that version changes: table, charts, comments, KPIs, callouts | U + E |
| VD-03 | every export of that version (PDF, PowerPoint, every version × design, scenario × version) | E + PF |
| PT-01 | painter copies font, valign, number display, CF incl. icon sets | U + E |
| PT-02 | painter armed across slides, several targets, Esc | E |
| PT-03 | object painter (chart, callout, icon, line) | E |
| XC-01 | colour scales, data bars, icon sets equal Excel on the CF corpus | U (cell results) + GP review |
| XC-02 | top / bottom, above average, duplicates, text, dates, blanks / errors, formula rules | U |
| NS-01 | New slide after the selected one; title editable; undo | E |
| NS-02 | Add table lists mapped tables (unused first) and adds one; New table from cells | E |
| HS-01 | Hide slide / Show slide (current design), Hide / Show in every design from the slide list's menu; grayed and marked in the list, marked on the stage; another design shows it; one undo step each | U (`app/tests/hide.test.tsx`) + E |
| HS-02 | the design's exports (PDF, PNG all, PowerPoint, versions × designs, Run for each value) leave hidden slides out; page numbers and the contents count the shown slides; the current slide still exports | U (`core/tests/hide.test.ts`) + E |
| HS-03 | an older page cannot drop `hide`: the key raises the deck to format 5 (`needsV5` / `docNeedsV5`), a 4.6 page compacts it (`knownOp`) | U + E (format 5) + CP-01 |
| CP-01 | a 4.6 deck with every new object: the real **4.0.0** (the share's), 4.1, 4.4 and 4.5 helpers + pages – one that opens it, one that had it open before the bump (it edits, runs the wizard's `preset.set`, stays alone so it would compact), one whose PC helper is restarted on 4.6 – cannot remove or overwrite anything; journals survive the old helpers' idle clean-up (AUDIT-2 §6 repeated) | experiment script in every milestone close, its log in PROGRESS |
| CP-02 | decks without new objects stay `format: 4` and open in 4.5 | helper test + E |
| LI-01 | the release and the page carry the third-party notices (LIC-1) | U (`make_release` test: a runtime dependency without a notice fails) |

Rows that change: CE-16 (+ font, valign, number display, F17 rules), TA-10 (+ hidden rows), VR-02 (+ deleted rows /
columns), CH-01 (+ types), CL-01 (+ Tabler icons), FL-02 (+ snapping targets), EX-* (+ versions with `drop`), DS-02
(lines and icons are user objects: drawn in raw Excel, B19's rule), SP-* (+ "line lost its object", "series length").

### 7.2 Guards that AUDIT-2 found missing and this work must not repeat
* PowerPoint "opened" and "has a real table / chart" are **gated** in export-check when PowerPoint is present (VER-3,
  PX-02 / PX-03): M14 adds the gate before it adds chart types.
* Every vendored binary's **inlined bytes** are hashed in a test (ARCH-4): the icon data too.
* The licence notices ship (LIC-1): M13 makes `THIRD-PARTY-NOTICES.txt` (§7.5).
* An old page cannot compact a new deck (DATA-7): CP-01 runs in every milestone close, not only once.
* Export names (SEC-6 / SEC-7): versions with deleted rows add no new naming – every name still goes through
  `core/src/export/names.ts` (device names, the 240-character path) and the helper's same rules.

### 7.3 New B-items (PLAN Part B §8; approval needed before any step ships)

| # | Change | Step |
|---|---|---|
| B30 | **More charts** (F7): column, bar (clustered / stacked / 100 %), line (straight / smoothed, markers), area, scatter, waterfall, combined charts with a second value axis, category groups with dividers, per-point colours and labels, "actual inside target" bars with their percentage, and annotations on the chart (arrows, lines, bands, icons, texts) in data coordinates; series and values from different tables, sheets and linked workbooks; native charts in PowerPoint | M14 |
| B31 | **Legend control** (F15): positions right / left / top / bottom / top-right / inside / none; hide single entries | M14 |
| B32 | **Snapping for every object** (F8): slide edges, centre and margins, other objects' edges and centres, equal spacing and size, several guides at once; Alt disables it everywhere; positions saved on a 1/4 px grid exactly as previewed | M15 |
| B33 | **Lines and annotations** (F9): straight, elbow, curved lines, arrows, brackets, range markers, limiters, dividers, callout lines; end and middle handles; attach an end to an object; plain line shapes in PowerPoint | M15 |
| B34 | **Icon library** (F10): the Tabler set (≈ 5,200 icons, MIT) searchable by name, tag and category, on slides as coloured, sized icons; the page grows by ≈ 0.6 MB, unpacked on first use | M15 |
| B35 | *(optional, Q10)* the app's own toolbar icons become Tabler icons | M15 |
| B36 | **Hide rows and columns on a slide** (F11); the table, its charts, comments and KPIs recompute; unhide restores | M16 |
| B37 | **Versions that delete rows / columns** (F14), in the wizard and the ribbon (*For this version ▾*); emptied cells as today; everything recomputes for that version and all its exports | M16 |
| B38 | **A fuller format painter** (F12): + font, vertical alignment, number display, the new conditional formats; an object painter for charts, callouts, icons, lines | M16 |
| B39 | **More of Excel's conditional formats** (F17): colour scales, data bars, icon sets with their colours, top / bottom, above average, duplicates, text, dates, blanks / errors, any formula | M16 |
| B40 | **New slide** (button, Ctrl+M) after the selected slide, and **Add table** listing the deck's tables (F16) | M13 |
| B41 | A deck that uses an object newer than 4.0 (charts, callouts, free layout, looks, cell gridlines / borders, or any 4.6 object) opens only in 4.6 or later; an older window asks for a restart (§1, REL-1); decks without them are unchanged | M13 |
| B42 | **Third-party notices**: `THIRD-PARTY-NOTICES.txt` in every release and an *About › Licences* view in ⚙ Options (LIC-1) | M13 |
| B47 | **Hide slides** per design (§2.8b; product owner 2026-10-21): grayed in the slide list, left out of the design's exports; page numbers and the contents count the shown slides | M13 |

### 7.4 Part F additions (enforced by `npm run bench` from the step that introduces them)

| Budget | From step | Limit |
|---|---|---|
| Chart DL build: column 12 × 4 · reference chart · line 12 × 52 (beside S9.2's pie gate, 5 ms) | S14.2–S14.3 | 5 ms · 5 ms · 10 ms |
| Chart semantics + XML for PowerPoint, reference chart | S14.6 | 10 ms |
| Line DL build (20 lines with heads and labels) | S15.3 | 3 ms |
| Snapping per drag frame, 60 objects (core part) · the drag frame | S15.4 | 1 ms · 16 ms (unchanged) |
| Icon set first use (inflate + parse the index, in the worker, cold) | S15.2 | 150 ms |
| Icon picker: keystroke → results drawn, p95 | S15.2 | 50 ms (the keypress budget) |
| Page size `helper/slide_builder.html` (new, from M13; today 3,916,092 bytes) | S13.1 · S14.7 · S15.1 | M13: today + 60,000 bytes · M14: set from M13's measurement + the chart code measured in S14.6 (expected ≈ +100,000) · M15: that + the icon set measured in S15.1 (≈ +600,000; expected total ≤ 4,700,000 bytes); a test fails above the current limit, each change of it recorded in PROGRESS |
| Table with 10 hidden rows: layout rebuild | S16.1 | ≤ the table's own build + 10 % |
| CF evaluation, 10,000 cells with 5 rule types | S16.4 | 30 ms |
| Open deck20 (unchanged) · PowerPoint deck20 with 6 combo charts | – · S14.6 | 400 ms · 3 s |

### 7.5 ADRs
* **ADR-019** · per-deck format guard (§1).
* **ADR-020** · the Tabler icon set vendored, lazily unpacked; `Stroke.join` (ADR-004 amendment); the notices file
  (LIC-1 fixed for every runtime dependency, not only the icons).
* **ADR-015** gets an amendment (series, groups, axes, marks; PowerPoint mapping §4.2) when M14 starts; ADR-017 one
  for snapping and the 1/4 px rule (M15).
No other dependency is added: the charts, lines, snapping, CF and painter are our code; `@tabler/icons` is a
**dev-dependency** read by the vendor script (the page carries the converted data, not the package). *(amended: ADR-020 2026-10-21 – as built, `@tabler/icons` is no dependency at all, not even a dev-dependency:
`tools/vendor-tabler.mjs` and `tools/vendor-ui-icons.mjs` fetch the 3.49.0 release tarball and check it against the
registry's integrity; nothing is installed.)*

---

## 8. Milestones and steps (PLAN Part C format; ⏱ benchmark, 🚦 product-owner gate, ⇢ ships)

Branches `v4/M13-guard-slides`, `v4/M14-charts`, `v4/M15-lines-icons-snapping`, `v4/M16-tables-versions-cf`,
`v4/M17-audit`. Each ends with the AUDIT §0 protocol twice on clean clones (incl. export-check's PDF and PowerPoint
passes) **and CP-01** (the 4.1 / 4.4 / 4.5 experiment with the new objects).

### M13 · Format guard, notices, New slide / Add table, hide slides, font cache (B40–B47; ships 4.6.0) ⇢
**S13.1 · Format guard** ⏱ — *Read:* `docsync.ts`, `fold.ts`, `decks.py` read / compact, README §4.4. *Do:* `needsV5`,
`docNeedsV5`, `upgrade()`, the marker route, helper `CREATE_FORMAT` 4 / `READ_FORMATS` {4, 5} / no lowering / the
`X-SB-Deck-Formats` check, fixtures v5, *Prepare rollback* and `update.py --use` lists; page-size test. *Done when:*
docsync / helper tests; CP-01 with a `slide.add` against the real 4.0.0, 4.1, 4.4 and 4.5 helpers and pages.
**S13.2 · Notices** — `tools/notices.mjs` writes `THIRD-PARTY-NOTICES.txt` from `node_modules` licences of the page's
runtime dependencies + the vendored LICENSE files + HarfBuzz COPYING; `make_release.py` ROOT_FILES and REQUIRED;
*About › Licences* in Options. *Done when:* LI-01. **S13.3 · Slide and table ops** — `slide.add/remove`,
`table.add/remove`, vectors, inverses; `computeLayout` for a slide without tables. **S13.4 · New slide, Add table UI**
— *Done when:* NS-01, NS-02. **S13.5 · Close** — AUDIT §0 ×2, CP-01, CHANGELOG 4.6.0; 🚦 **G9a** the owner adds slides and
tables on a real deck and confirms an old window restarts.

### M14 · Charts (F7, F15; B30, B31; ships 4.7.0) ⇢
**S14.0 · Gates first** — export-check gates PowerPoint "opened" and `has_chart` / `has_table` when PowerPoint is
present (VER-3). **S14.1 · Model** — types, `item.patch` keys and maps, ≥ 30 vectors, `knownOp`, `needsV5`, FX
fixture. **S14.2 · Columns and bars** ⏱ — `chart-axes.ts`, `chart-bars.ts`, stacks, 100 %, labels, legend positions,
`chartKey` wired; DL snapshots per design. **S14.3 · Lines, areas, combo, second axis, groups, targets, marks** ⏱ — the
reference chart. *Done when:* CT-01…CT-06 (U), the reference chart's DL in five designs; 🚦 **G9** pixel review of the
chart corpus + the reference chart (package `tools/m14-package.mjs`). **S14.4 · Scatter, waterfall**. **S14.5 · Chart
panel** — series list (add from cells / range / another workbook, reorder, type, axis, colour), groups, axes, labels,
marks (arrow from the floor, icon above a column), legend; CT-08. **S14.6 · PowerPoint** ⏱ — §4.2; PX-05, PX-06.
**S14.7 · Close** — AUDIT §0 ×2, CP-01, CHANGELOG 4.7.0.

### M15 · Lines, icons, snapping (F8, F9, F10; B32–B35; ships 4.8.0) ⇢
**S15.1 · Join and icon data** — `Stroke.join` in every backend and `dlcheck`; `tools/vendor-tabler.mjs`
(@tabler/icons 3.49.0, arcs → cubics, deflate + base64, hash test), notices entry. **S15.2 · Icon items and picker** ⏱
— IC-01, IC-02. **S15.3 · Line items** ⏱ — model, DL, handles, attach; LN-01, LN-02. **S15.4 · Snapping** ⏱ — targets,
equal spacing, guides, Alt everywhere, `snapRound`; SN-01…SN-04. **S15.5 · PowerPoint lines and icons** — LN-03.
**S15.6 · UI icons** (only if B35 is approved). **S15.7 · Close** — AUDIT §0 ×2, CP-01, CHANGELOG 4.8.0; 🚦 **G10**
handles, guides, icons, lines in five designs.

### M16 · Tables: hidden rows, delete-versions, painter, Excel CF (F11, F12, F14, F17; B36–B39; ships 4.9.0) ⇢
**S16.1 · Hidden set in `buildLayout`** ⏱ — slide `hidden`, cache keys, borders / gridlines / merges, charts, comments,
KPIs; HR-01, HR-02. **S16.2 · Delete-versions** — `version.patch`, `drop`, wizard step 4, ribbon *For this version ▾*,
exports; VD-01…03. **S16.3 · Painter** — `valign`, `num` (if Q9), objects; PT-01…03. **S16.4 · Excel CF** ⏱ — the CF
corpus made in Excel 16 (`tools/make-cf-corpus.ps1`, dev tool), every rule type, icons per design, PowerPoint;
XC-01, XC-02. **S16.5 · Close** — AUDIT §0 ×2, CP-01, CHANGELOG 4.9.0; 🚦 **G11**.

### M17 · Independent persistence and compatibility audit → `docs/next/AUDIT-3.md` (in the shape of AUDIT-2; §6's
table checked line by line, CP-01 repeated by the auditor with real helpers, F13 proven per export kind).

Effort (one engineer, the rhythm of M7–M11): M13 2 weeks, M14 5, M15 4, M16 4, M17 2 = **17 weeks** (+20 %).

---

## 9. Questions for the product owner (answers go under PROGRESS "Decisions"; nothing of §8 starts before 1–6)

*Answered 2026-10-20 (PROGRESS Decisions): 1 and 17 yes; 2 the legend; 18 same width; 4–8, 10, 13–16 as proposed;
3, 9, 11, 12, 19 asked again at S14.2, S16.3, S15.2, S13.4, S16.3.*

1. **Format guard (B41).** A deck that gets a chart, callout, free layout, look, cell gridline / border or any 4.6
   object can no longer be edited by 4.0–4.5 (they show it read-only, with their existing "damaged – tell the
   maintainer" wording, which the CHANGELOG explains); decks without such objects stay as they are. From the moment a
   4.6 page first touches a deck, DATA-7 cannot happen to it – for the old objects and the new alike; before that, only
   the rollout rule protects (Q17). Agree? (The alternative "every deck at once" locks out un-restarted PCs from every
   deck.)
2. **"Index" = legend?** We read "remove single index items, whole index, multiple positions" as the **legend**:
   hide single entries, hide it, place it right / left / top / bottom / top-right / inside. If you meant the
   **categories** (e.g. drop one week from the axis), say so – that is a per-chart category filter, also possible.
3. **Explicit colours across designs.** The reference chart sets its own dark blue and grey. Should such colours stay
   in every design (as per-slice colours do today), or should each design re-colour charts with its palette unless you
   tick "keep my colours"?
4. **Chart order and waterfall.** Proposed order: (1) column / bar clustered, stacked, 100 % → (2) line, smoothed,
   markers → (3) combined + second axis + groups + targets + marks (your reference chart) → (4) area → (5) scatter →
   (6) waterfall (in PowerPoint as the classic stacked-bar construction, editable in PowerPoint 2016 and later). Others
   worth having later: bullet chart (target band + bar), stacked waterfall, sparklines inside table cells. OK?
5. **Lines in PowerPoint** are plain shapes: an arrow attached to a table in Slide Builder does not stay attached when
   you move the table **in PowerPoint** (your rule: no connector shapes). OK?
6. **Delete-versions**: one version can both delete rows / columns and empty cells (F14 extends today's versions, no
   second kind). OK? And the ribbon flow *For this version ▾* with the version chosen in the top bar – or only in the
   wizard?
7. **Hidden rows and charts on other slides.** Rows hidden on slide 3 are hidden for charts on slide 3 that read the
   table; a chart on slide 5 that reads the same cells keeps them. OK?
8. **Totals with hidden rows.** A hidden row does not change Excel's totals (the workbook is read-only); the table shows
   Excel's total, and the automated comment quotes the shown cells. Should Slide Builder instead recompute totals
   without the hidden rows (with the formula engine, for SUM rows only)? Proposed: no – show a small "Σ incl. hidden
   rows" note on the slide instead (not exported), or nothing.
9. **Painter and number display.** A cell's own number display (decimals, %, thousands) does not exist on slides today.
   Add it (ribbon *Decimals −/+ · % · Thousands*, copied by the painter), and vertical alignment per cell?
10. **Tabler in the app's toolbars (B35)**: replace today's toolbar icons and symbols with Tabler icons? Proposed: yes,
    in M15, as one consistent look (you judge it at G10).
11. **Icon search language**: Tabler's names and tags are English. Enough, or should Italian search words be added
    (≈ 300 common ones, maintained by us)? *(decided 2026-10-21: add them – S15.2, `core/src/icons/search-it.ts`,
    ADR-020 amendment.)*
12. **Slide list**: with *New slide*, also *Delete slide* and *Duplicate slide* in the slide list's right-click menu?
13. **Two people restyling one line at once**: the whole style is one value (the last one wins). Fine for lines?
14. **Format 5 forever?** Deleting every 4.6 object leaves the deck at format 5. Want a command "make readable by
    4.5" (only when no 4.6 object is left)?
15. **Excel's icon sets in Liquid Glass and the consulting designs**: drawn in each design's colours (proposed) or
    always in Excel's own colours?
16. **Releases**: four (4.6 guard + slides, 4.7 charts, 4.8 lines / icons / snapping, 4.9 tables / versions / CF), or
    fewer bigger ones? The guard (M13) must ship first in any order.
17. **The rollout** (AUDIT-2 REL-1, still open): since 4.6's guard covers every object 4.0 does not know, the safe path
    is for the share to go **from 4.0 straight to 4.6** (M13 ships first) rather than to 4.5, with every window closed
    on update day – then no 4.3–4.5 record ever exists unguarded on the share. Agree?
18. **"Actual inside target" look**: the owner's chart shows the fill a little inside the outline (the picture). PowerPoint
    can draw only the same width for both (outline over the fill). Keep the inset on screen / PDF and accept the small
    difference in PowerPoint, or use the same-width look everywhere?
19. **Painter, several targets**: today double-click keeps it armed for several pastes (also across slides). Did you also
    mean pasting **once onto a multi-selection** (Ctrl+click several cell ranges or objects, then one paste)?
