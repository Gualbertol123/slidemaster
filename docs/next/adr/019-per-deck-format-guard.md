# ADR-019: A deck that holds objects 4.0 does not know is marked for 4.6+ and raised to format 5 before they are written

* **Status:** accepted 2026-10-20 (product owner; Phase 0 design `09-charts-annotations-icons.md` §1, 2026-10-20; answered: §9 Q1, Q14, Q17)
* **Deciders:** product owner, maintainers
* **Related:** AUDIT-2 DATA-7 and REL-1; ADR-002 (ops), ADR-006 (journal storage); README §4.4; `knownOp` (af0a729)

## Context
Pages compact a deck's journal into a snapshot by folding the records they have read; an op, key or item kind a page
does not know is skipped and is then lost for everybody (DATA-7, reproduced with the real 4.1 helper and page: 27
items, free layout, looks, gridlines and borders gone). af0a729's `knownOp` stops a 4.5+ page from compacting such
records, but 4.0–4.4 cannot be changed and the share runs 4.0.0; a window left open on update day, or a rollback, is
enough (REL-1). What old helpers do with a newer deck (read at af0a729 and v4.0.0):
* they refuse to read a snapshot whose `format` is newer than theirs (`decks.py:265-267`) and accept only their own
  format in a compaction (`:795-799`; the format read under the lock fails first, `:827`);
* but their `tail` swallows that error (`_snapshot_gen` returns no gen, `:681-684`) and `append` never reads the
  snapshot (`:560-587`) – **a page that already has the deck open keeps reading and writing it**, blind to the newer
  records, and a whole-value op of it (a wizard `preset.set`) would overwrite them;
* any `incident-*.json` in the deck folder makes them answer 423 to appends and "read-only" to tails (`:444-451`).

## Decision
* `needsV5(op)` / `docNeedsV5(doc)` in `core/src/model/ops.ts`: true for every op, key, item kind (and document
  content) that 4.0.0 does not apply whole – 4.2–4.5's `item.patch`, `free`, `looks`, `cellGrid`, `borders`, and every
  addition of 09 §2.10.
* **The bump**, before DocSync appends a record holding such an op to a deck whose snapshot is `format: 4` – or as soon
  as a 4.6 page opens a format-4 deck whose snapshot or journal already holds such content:
  1. the 4.6 helper writes `incident-format-5.json` into the deck folder (O_EXCL; it says "this deck uses Slide Builder
     4.6 objects"): every 4.0–4.5 helper now treats the deck as read-only, including for pages that have it open;
  2. the page writes the **current snapshot again, unchanged, with gen + 1 and `format: 5`** through the existing
     compare-and-set compaction (on 409: reload, retry);
  3. only then the record is appended (it waits in the pending queue meanwhile).
* Snapshots of a format-5 deck are always written with format 5 (never lowered). The 4.6 helper creates and migrates
  at format 4, reads 4 and 5, accepts compactions at 4 or 5, refuses one that lowers 5 to 4, does not treat
  `incident-format-5.json` as an incident, and answers 409 "reload" to appends / tails / compactions of a format-5 deck
  from a page without the header `X-SB-Deck-Formats: 4,5` (an old page left open while its PC's helper was restarted).
* `knownOp` stays as a second wall; each later release that adds ops extends both lists, or bumps to 6 the same way.
* *Prepare rollback* and `update.py --use` below 4.6 name the format-5 decks (they will be read-only there).

## Consequences
+ From the bump on, no 4.0–4.5 page can fold or overwrite a record it does not know: it cannot append, compact or open
  the deck; its queued edits stay queued, never written.
+ Decks the share's 4.0 made (no newer objects) stay format 4 and keep working on un-restarted PCs during the rollout.
+ One marker file and one extra write per deck, once.
− Old pages show the existing "a journal of this deck is damaged – tell the maintainer" text for the marker: the wrong
  reason, the right effect; the CHANGELOG and README say it means "update Slide Builder".
− A format-4 deck with 4.3–4.5 records that no 4.6 page has opened yet is still exposed to a 4.0–4.4 compaction:
  closed only by the rollout (4.0 → 4.6 directly, windows closed; 09 §9 Q17).
− A deck that once held such an object stays closed to 4.0–4.5 (09 §9 Q14 asks whether a "make readable by 4.5"
  command is wanted); a rollback below 4.6 leaves those decks read-only until the next update.

## Evidence and alternatives
AUDIT-2 §6 (`compat41.mjs`) is the reproduction; CP-01 repeats it with the real 4.0.0, 4.1, 4.4 and 4.5 helpers and
pages – opening, already open (editing, the wizard, compacting), and the restarted-helper case – in every milestone
close. Alternatives: the format bump alone (old open pages keep writing: refused); raise `FORMATS.workbook` for all
decks (every un-restarted PC locked out of every deck; an upgrade step for every deck folder); a release rule alone
(nothing technical stops a forgotten window; kept in addition).
