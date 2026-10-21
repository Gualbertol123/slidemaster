# M14 and M15 in parallel: the shared preparation (S14.P) and who owns what

The product owner's decision of 2026-10-21 (PROGRESS, Decisions): M14 (charts, 4.7.0) and M15 (lines, icons,
snapping, 4.8.0) are built at the same time on separate branches, `v4/M14-charts` and `v4/M15-lines-icons-snapping`.
Both start from one shared preparation, S14.P (branch `v4/M14-M15-prep`; plan-M14 "S14.P", plan-M15 "P0"). S14.P
holds everything both milestones would otherwise edit in the same lines. After it, each file below has one owner, and
every place both must touch is split into per-kind parts with a separator line between them. Git merges two edits
only when an unchanged line stands between them, so these splits keep the two merges free of conflicts.

## 1. Merge order and the committed page

1. **S14.P merges to `main` first**, with no version bump. Both milestone branches start from that merge commit, not
   from the prep branch.
2. **The prep merge rebuilds the committed page.** S14.P changes app sources (`InsertSlots`, `ItemPanel`,
   `TableTools`, `item-text`, …). Its branch does not commit `helper/slide_builder.html`, so
   `app/tests/build.test.ts` ("up to date") fails on the branch until the merge. The merge to `main` therefore:
   runs `npm run build`, commits `helper/slide_builder.html`, then runs `app/tests/build.test.ts` again, both the
   "up to date" test and the page budget (base.json 3,976,092 + m14.json + m15.json). It records the page's size in
   PROGRESS (Measurements). This is the only S14.P step allowed to commit the page. The prep branch itself never
   commits it.
3. **M14 (4.7.0) merges before M15 (4.8.0).** If M15 is ready first, the owner either holds it or renumbers it. The
   committed page, `THIRD-PARTY-NOTICES.txt` and `app/src/ui/notices-data.ts` are generated files, never merged by
   hand. The branch that merges second rebases, rebuilds them (`npm run build`, `node tools/notices.mjs`), and reruns
   `build.test`, AUDIT §0 ×2 and CP-01 on the merged tree. Its gate (G9 or G10) holds only for that merged build.

## 2. Who owns what after S14.P

| Place | Owner | The other milestone |
|---|---|---|
| `core/src/model/types.ts` (09 §2.2, §2.3), the lists in `ops.ts` | S14.P | read-only. A new key needs a decision, plus a vector in its own `ops-vectors.d` file |
| `shared/ops-vectors.json` | S14.P (closed after it) | – |
| `shared/ops-vectors.d/m14.json` · `m15.json` | M14 · M15 | never edits the other's file |
| `core/tests/fixtures/saved/charts-4.7.json` · `lines-4.8.json` | S14.P (added, never edited) | a later fixture is a new file |
| `dl/*` `join`, `render/heads.ts`, `drawingml.ts` `ln` / `lineEnd` | S14.P | read-only; `drawingml.ts` gets only new functions appended |
| `render/slide-dl.ts` item dispatch | S14.P | M14 edits `chartItem` only; M15 edits `shapeItem` and `lineItem` |
| `model/preset.ts` `itemSheets` | S14.P | M14 edits `chartSheets` only (sers / groups / marks sheets); M15 edits `shapeSheets` / `lineSheets` (label tokens) |
| `pptx/scene.ts` | M15 (line, icon `ItemSem`) | M14 works in `pptx/chart-sem.ts` and `chart.ts` |
| `chart-*.ts`, `pptx/chart.ts`, `ChartPanel.tsx`, `InsertChart.tsx` | M14 | – |
| `render/icons.ts`, `shape-dl.ts`, `line-dl.ts`, `core/src/icons/`, `ShapeTools.tsx`, `IconPicker.tsx`, `LineTools.tsx`, `LinePanel.tsx`, `stage/drags.ts`, `Stage.tsx`, `render/layout.ts` (`snapRound`, `freeBoxes`), the `VENDORED` list in `tools/notices.mjs`, the `package.json` dev-dependency | M15 | M14 calls `resolveIcon` only; M14 adds no dependency (09 §7.5) |
| `stage/items.tsx`, `stage/hit.ts` | M14 (point / mark hits) | M15 adds line handles in a new `stage/lines.tsx` |
| **What the page calls an item** (`app/src/editor/item-text.ts`): the status line (`Ribbon.tsx` `selStatus`), the stage's tooltip (`stage/items.tsx`), the undo step of Del (`editor/charts.ts` `deleteItem`), the Issues lines (`editor/issues.ts`) | S14.P registry | M14 edits `chart-text.ts`; M15 edits `shape-text.ts` and `line-text.ts` |
| Side panel (`ItemPanel.tsx`), Insert ▾ (`InsertSlots.tsx`) | S14.P slots | each adds its line on its own side of the separator |
| `tools/export-check.mjs`, `tools/pptxcheck.py`, `tools/real-objects.mjs` | S14.P gate, then M14 | M15 adds its LN-03 / icon block as a separate function |
| `tools/bench.mjs` 09 §7.4 entries | S14.P (skipped until introduced) | each milestone fills in its own side of the separator |
| `core/bench/charts-m14.bench.test.ts` · `lines-m15.bench.test.ts` | M14 · M15 | – |
| `app/tests/page-budget/m14.json` · `m15.json` | M14 · M15 | – |
| CHANGELOG (`## 4.8.0` / `## 4.7.0` stubs), PROGRESS (M14 / M15 steps and their Measurements tables) | per-milestone blocks | – |
| `helper/slide_builder.html`, notices files | generated | see §1 |

## 3. Settled in S14.P (review of S14.P)

* **"No line" for a chart's frame, title rule, group divider and axis line** is the string `"none"`
  (`LineOrNone = LineStyle | "none"`). Unset means the design's line. It is not `null`, because `item.patch`'s null
  deletes a plain key, so a stored null could never exist for `frame` or `titleRule`. Inside a map entry
  (`groups[g].divider`, `axes[a].line`) the whole entry is cloned, so a null survives there, and a reader takes it as
  "none". The page writes "none". There is an ops vector for each case.
* **Vectors per milestone:** `core/tests/vectors.ts` reads the main file, then `shared/ops-vectors.d/*.json` in name
  order, and fails on a name used twice. `helper/tests/test_migrate.py` checks each file's shape. The helper applies
  no operation, so it runs no vector.
* **A kind this page does not know** (a newer page's item, in a snapshot a newer page compacted) draws nothing,
  has no item info, is never on the stage and is never exported (`slide-dl.ts`, pinned by `item-kinds.test.ts`).
  The Issues panel says so in one line ("N objects of a newer Slide Builder … kept in the deck"; `item-text.ts`
  `laterKindsIssue`). That satisfies both plans: plan-M14 relies on the skip, and plan-M15 P0.5 asks for an Issues line
  instead of silence. A 4.6.0 page cannot get that line, so it still skips silently; G10 must state this.
* **The saved fixtures are named by the version that writes their records:** `charts-4.7.json` and `lines-4.8.json`
  (as `slides-4.6.json`).
* **Joins:** an unset `join` is miter in SVG, canvas and PDF, but PowerPoint's own default in an `a:ln` without a join
  element. This is kept so that existing exports stay unchanged. Every new stroke whose corners show sets `join`
  (ADR-004 amendment).
* **The PowerPoint gate's expectation** comes from the core's own export (`tools/real-objects.mjs` over `slideLists`
  with `pptx`), not from the deck's JSON. A missing sheet's table, hidden slides and slides or tables added by
  `slide.add` / `table.add` are therefore counted the way the export draws them, and pptxcheck (5) asks for exactly
  those counts.

## 4. Recorded in M15 (S15.2 review)

* **The icon block of the PowerPoint gate is M15's own:** `check_icons()` in `tools/pptxcheck.py` (check (6), between
  separator lines before `main`, one call line in `check()`), `tools/real-icons.mjs` (the core's Tabler icons per slide,
  merged into realObjectsOf's entries as `icons`: one import line and one line after `pageRealObjects` in
  `tools/export-check.mjs`), the corpus deck `tests/corpus/charts/icons.json` (its paragraph above the README's table).
* **`drawingml.ts`:** M15 adds one guard line at the top of `geom()` (`parts` → `partsGeom`, appended at the end of the
  file); the rest of `geom()` is S14.P's.
* **`rpc/messages.ts`:** M15's calls are `M15CoreMethods` in `rpc/messages-m15.ts`; `CoreMethods` extends it (one import
  line, the interface's first line). M14 adds its own methods at the end of `CoreMethods` as before.
* **The icon picker** (`app/src/ui/IconPicker.tsx`) has a mode `{ mode: "pick"; onPick; title? }` for a chart mark's
  icon (09 §3.5): M14 calls `openIconPicker` and makes the change itself, without editing the picker.
* **`recentIcons` and `iconOpts`** are typed in `IconPicker.tsx` (the helper keeps a preference key it does not know):
  a candidate for `Prefs` in `model/types.ts` after both merges.

