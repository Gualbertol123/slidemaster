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

## Amendment 2026-10-21 (S13.1): the gap after the marker, and the wait
*Status: accepted (orchestrator default for M13, reported to the product owner at G9a).*

**The gap.** Step 1 does not stop an old page at once. A 4.0–4.5 helper looks at the folder of a deck it has an
append handle on every `REFRESH_S` = 4 s (`decks.py:66`, the same in 4.0.0, `_refresh_loop`); an append on an open
handle checks nothing else (`_check_writable` → `_look(key)`, once per helper, no TTL). So for about 4 s after the
marker an old page that has the deck open can still append – any record, a wizard `preset.set` built without the new
objects included. (A helper without a handle on the deck looks again when it opens a journal: it refuses at once.)
A record appended in that gap is never lost (the 4.6 pages fold it), but folded *after* the 4.6 record it would
overwrite it if its Lamport time were higher.

**The bump, as built** (`DocSync.upgrade`, `core/src/sync/docsync.ts`):
1. `POST /api/decks/<key>/format5`: the marker (`decks.mark_format5`; it answers when the marker was written, `at`,
   and the file server's `now`);
2. **wait `REFRESH_S` + 1 s = 5 s from `at`** (`BUMP_WAIT_MS`; a marker written long ago is not waited for again):
   every old helper has then seen the marker, and its pages' appends get 423;
3. **tail once more**: the gap's records are read, so the record about to be appended gets a Lamport time above
   every one of them (an old page's `preset.set` folds *before* it);
4. compare-and-set: the snapshot unchanged, `gen + 1`, `format: 5` (on 409 reload and again; found at 5: done);
5. append the record.

The same sequence runs before a compaction whose snapshot would go from 4 to 5, and when a 4.6 page opens a format-4
deck whose snapshot or journal already holds 4.6 content. The pagehide snapshot (a keepalive request) never raises a
deck. As a second wall, the 4.6 helper writes the marker itself before it accepts a format-5 snapshot over a
format-4 one.

**Cost.** Once per deck: about 5 s of "Saving…" on the first edit that needs format 5 (the record waits in the pending
queue; more edits join it). Accepted (M13 decision).

**Not closed by it.** A record an old page appended *before* the marker is folded as before (it was already there);
a format-4 deck holding 4.3–4.5 records that no 4.6 page has opened stays exposed to a 4.0–4.4 compaction until the
rollout (unchanged, see Consequences).

**Restarted helper.** The helper's token is random per process (`server.py` `App`), so an old page whose PC's helper
was restarted on 4.6 already gets 403 "forbidden (token)"; `X-SB-Deck-Formats` (409) is the second wall behind it,
tested with a valid token (`helper/tests/test_http.py` `DeckFormatHttpTests`).
