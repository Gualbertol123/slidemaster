# ADR-010: Migrate per deck on first open and freeze the v3 file with schema 4; v3 and v4 coexist on different decks

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
Old and new versions must be able to coexist for a while, and the switch must be safe. v3 already refuses
files with a newer `schema` (409 "restart Slide Builder") and turns open pages "outdated"
(`upgrade.py:54-59`, `docsync.ts:100`).

## Decision
* Under the v3 lock `wb-<key>`:
  1. back up the v3 file;
  2. write the v4 snapshot (document unchanged);
  3. rewrite the v3 file with `schema: 4` and `movedTo: "v4"`.
* config, prefs, fonts and assets keep their v3 formats and locks and are shared.
* Rollback writes the compacted snapshot back as a v3 document, after checking that no record lies past
  the frontier.
* The pilot runs on a copy of the data folder.

## Consequences
+ No v3 code change is needed to stop v3 users on a migrated deck; nothing is lost; the rollback is
  lossless for v3 fields.
− A v3 page's unsent ops at the moment of migration are lost on reload (as in any v3 update today).
  Cut-over is on a Monday morning.

## Evidence and alternatives
04 §4; tests 05 §3.6 (7–9) run the real v3 helper.
