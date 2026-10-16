# ADR-014: Linked workbooks by sheet id; scenario state as an overlay that lives only in the core worker

* **Status:** accepted (approved 2026-10-16 with 07 §8; built in M7 S7.3–S7.4)
* **Deciders:** product owner, maintainers
* **Related:** 07 §2.3–§2.5, ADR-013, ADR-006 (journals), PLAN Part B §2 (one owner per state)

## Context
The product owner's workbooks reference each other (external links) and a deck may need tables from several files;
a change of one cell must update both. A scenario run must never change the saved deck or the workbook file.

## Decision
1. **Sheet ids.** A sheet of the deck's workbook is named `Sheet`; a sheet of a linked file `[File.xlsx]Sheet`. The id
   is used wherever a sheet name is stored today (`TableDef.sheet`, `edits`, `cf`, `versions.hide`, the new `DataRef`),
   so no type, op or format changes. `preset.links` (optional) lists the linked files; the deck key, journal and
   presence stay those of the main workbook.
2. **Recalculation across files.** The sheets of every linked file that is available (in `preset.links` or in the same
   folder) are added to the one engine model under internal names; `[n]` references are rewritten to them. Unavailable
   files contribute the link's cached values as constants, classed `external` by the self-check.
3. **Scenario overlay.** A run or a preview sets the input cell in the engine, evaluates, and keeps the changed cells
   in a `ScenarioOverlay` inside the core worker. Rendering reads cells through an `OverlaySheet` facade (`cellAt`
   answers from the overlay first). Table cache keys include the overlay's hash. **No op is generated, nothing is
   appended to a journal, the workbook bytes are never written.** The overlay is dropped when the run or preview ends.
4. Files of a run are named `<value> - [<version> - ]<design>.<ext>`, made Windows-safe, de-duplicated inside the run
   with ` (2)` before the helper's own ` (2)` rule (07 §2.5).

## Consequences
+ One owner per state holds: the core worker owns the workbook(s), the engine model and the overlay; the page sees
  progress events and a preview banner only.
+ Readable by 4.0/4.1 (optional fields; ids are strings); no format bump.
− A sheet id with `[` cannot be a real Excel sheet name (Excel forbids `[]`), so it is unambiguous, but tools that
  split on `!` must handle the bracket prefix (one helper `sheetId.ts`).
− Edits during a preview apply to the document as usual; the preview changes only what the cells say (documented).
− The page's mirror is not overlaid: during a preview the ribbon, painter, comment dialog and Issues lines computed
  on the page show the real workbook's values while the stage shows the scenario's (07 §2.4; S8.4 decides mirroring).
− Links are followed from file to file at most five deep (A → B → C …) and only for files of the same folder.

## Evidence and alternatives
Spike pair `Banks.xlsx` ↔ `Peers.xlsx` (07 §1.2): with both files in one model every cross-file cell equals Excel for
all 10 scenario values. Alternatives: a new `book` field on tables and edits (more types and ops for the same
information); applying scenario values as `cell.patch` ops (would write the deck and the journal: rejected by the
requirement); a separate scenario worker (a second owner of the workbook: rejected by Part B §2).
