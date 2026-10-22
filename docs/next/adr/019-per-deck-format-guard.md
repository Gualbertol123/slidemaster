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

**The gap.** Step 1 does not stop an old page at once. A 4.0–4.5 append checks the deck's folder once per helper
(`_check_writable` → `_look(key)`, no TTL; v4.0.0 `decks.py:389-405`); what looks again depends on the storage mode
(corrected by the review of S13.1, finding 1 – the first version of this amendment counted the refresher only):
* **journal mode** (default): the folder of a deck the helper has an append handle on is listed again every
  `REFRESH_S` = 4 s (`_refresh_loop`); a helper without a handle lists it when it opens a journal (`_open_new` →
  `_look(key, 0)`), and the page's tail every `CHECK_TTL` = 10 s;
* **lean-lock mode** (`SLIDEBUILDER_STORAGE` / `storage.json`, ADR-006's fallback): `_append_shared` has no handle,
  so no refresher runs; only the page's tail (every `TAIL_MS` = 1.5 s) lists the folder again, at most every
  `CHECK_TTL` = 10 s (v4.0.0 `decks.py:677`);
* on the share, `os.listdir` may be answered from the SMB client's directory cache for up to 10 s more (the same
  assumption as `LISTING_TTL` and `COMPACT_MARGIN_MS`).
So an old page that has the deck open can still append for up to 4 + 10 s (journal) or 10 + 1.5 + 10 s (lean-lock)
after the marker – any record, a wizard `preset.set` built without the new objects included. The mode can differ per
PC (the environment variable), so the page cannot know which bound applies. A record appended in that gap is never
lost (the 4.6 pages fold it), but folded *after* the 4.6 record it would overwrite it if its Lamport time were higher.
`helper/tests/test_decks.py` `OldHelperTests` runs v4.0.0's own code: journal mode is refused after its refresher's
look, lean-lock mode only after its page's tail (`test_lean_lock_appends_go_on_until_its_page_tails`).

**The bump, as built** (`DocSync.upgrade`, `core/src/sync/docsync.ts`):
1. `POST /api/decks/<key>/format5`: the marker (`decks.mark_format5`; it answers when the marker was written, `at`,
   and the file server's `now`);
2. **wait 23 s from `at`** (`BUMP_WAIT_MS` = `decks.BUMP_WAIT_S`: the lean-lock bound 10 + 1.5 + 10 s + 1 s, which
   also covers journal mode's 4 + 10 s + 1 s; a marker written long ago is not waited for again): every old helper
   has then seen the marker, and its pages' appends get 423. Then `format5` is asked again: the 4.6 helper drops its
   cached journal listing of the deck (`LISTING_TTL`), and a marker removed meanwhile is written again and waited for;
3. **tail until no journal is skipped** (at most 5 reads, 1 s apart; else the bump fails and is retried as an
   append is): the gap's records are read;
4. compare-and-set: the snapshot unchanged, `gen + 1`, `format: 5` (on 409 reload and from step 1 again; found at 5:
   done). The 4.6 helper refuses this raise with 409 while the marker is younger than `BUMP_WAIT_S` − 1 s (and
   writes the marker first if it is missing), so the wait is a wall of the helper, not only the page's habit;
5. append the record with a Lamport time **2^20 above everything seen** (`BUMP_LAMPORT`). An old page cannot have
   read the 4.6 record, so a record it appended in the gap – past the bound above on a very slow share, or in a
   journal the final tail did not list yet (the SMB cache) – still has a lower Lamport time and folds *before* it.
   Every other 4.6 page takes the same jump: the first time it sees the deck go from 4 to 5, and when it opens a
   format-5 deck whose snapshot was written less than `BUMP_WAIT_MS` + 13 s ago (`BUMP_FRESH_MS`; the snapshot's
   `at` against the open tail's `now`, both the file server's clock; without them, always) – its helper may not
   list a gap journal for 3 s + 10 s yet.

The same sequence runs before a compaction whose snapshot would go from 4 to 5, and when a 4.6 page opens a format-4
deck whose snapshot or journal already holds 4.6 content. The pagehide snapshot (a keepalive request) never raises a
deck. As a second wall, the 4.6 helper writes the marker itself before it accepts a format-5 snapshot over a
format-4 one, and refuses that snapshot (409) until the marker is old enough. A format-5 snapshot read by a 4.6
helper without its marker (removed by hand, a backup put back by hand) gets the marker again (`decks.read_snapshot`):
4.0–4.5 helpers then refuse an open page's appends, not only its reads.

**Cost.** Once per deck: about 23 s of "Saving…" on the first edit that needs format 5 (the record waits in the
pending queue; more edits join it; a window closed meanwhile loses that record, as any unsaved one). The M13 default
was 5 s; the review of S13.1 showed it too short for lean-lock and the SMB cache (finding 1).

**Not closed by it.** A record an old page appended *before* the marker is folded as before (it was already there);
a format-4 deck holding 4.3–4.5 records that no 4.6 page has opened stays exposed to a 4.0–4.4 compaction until the
rollout (unchanged, see Consequences).

**Restarted helper.** The helper's token is random per process (`server.py` `App`), so an old page whose PC's helper
was restarted on 4.6 already gets 403 "forbidden (token)"; `X-SB-Deck-Formats` (409) is the second wall behind it,
tested with a valid token (`helper/tests/test_http.py` `DeckFormatHttpTests`).

**Test setting (2026-10-21).** `SLIDEBUILDER_TEST_BUMP_WAIT_S` shortens the helper's wait (`decks.BUMP_WAIT_S`), and `mark_format5` tells the page its value (`wait`, ms): the page waits the shorter of its own 23 s and the helper's. Only the e2e helpers set it (`app/playwright.config.ts`, 2 s; `tools/compat-old.mjs --bump-wait-s`, the 4.6 helper only); it must never be set on a shared folder in use, as a 4.0–4.5 page could then append after the raise. Since the milestone review (finding 3) the helper honours it only together with `SLIDEBUILDER_NO_NET=1` (which both of those set) and only as a finite number of seconds from 0 to 23 (`decks.read_test_bump_wait`); anything else is ignored with a log line. When it is in effect the helper logs a loud warning at start-up and `/api/health` reports it (`testBumpWaitS`, s). The page in turn ignores a `wait` that is not a finite number ≥ 0 (`DocSync.raise`).

**Amendment 2026-10-22: format 6 for 4.9 objects (AUDIT-3 COMPAT-1).** 4.9 first reused format 5, as §1 of 09 allowed
("reuse format 5 … and extend `knownOp`"). The M17 audit showed that `knownOp` is not enough: a 4.6.0–4.8.0 page reads
a format-5 deck, skips `version.patch` and the slide map `hidden`, and its wizard's Finish writes the whole preset
(`preset.set`, each version rebuilt as `{id, name, hide}`) – the version's deleted rows (`drop`), and before a 4.9
compaction the version itself and the slides' hidden rows, are erased for everybody; its exports show the deleted /
hidden rows. So 4.9 raises a deck to **format 6** exactly the way 4.6 raised to 5, before it writes anything 4.8.0 does
not apply whole (`core/src/model/ops.ts` `needsV6` / `docNeedsV6`, built from 4.8.0's FROZEN lists `V48_*` as
`needsV5` is from 4.0.0's): `version.patch` (any: 4.6–4.8 skip the op, so a version made or renamed by it would be
lost to their wizard too), a slide's `hidden`, a version's `drop`, cell `valign` / `num`, a `slide.add` carrying
`hidden`, a `preset.set` holding them. The sequence is the one above with its own marker **`incident-format-6.json`**
(every 4.0–4.8 helper takes it for an incident – 4.6–4.8's `_is_incident` excepts `incident-format-5.json` only –
and their `READ_FORMATS` (4, 5) refuse the format-6 snapshot: 409 on open / snapshot, 400 on a compaction), the same
`BUMP_WAIT_MS` / `BUMP_WAIT_S` = 23 s wait (the old helpers' listing and refresh intervals are unchanged), the tail,
the CAS to `format: 6` (409 while the marker is younger than the wait), the Lamport jump (`BUMP_LAMPORT`; also when a
page sees the deck go 5 → 6), never lowered (400), the marker written again on a format-6 snapshot read without it.
A format-4 deck that receives a 4.9 object goes to 6 at once (one marker: format 6's also stops 4.0–4.5).
`X-SB-Deck-Formats` is `4,5,6` from 4.9; a page that does not send 6 (a 4.6–4.8 page left open while its helper was
restarted on 4.9) gets 409 on a format-6 deck (`decks.check_page`). `SLIDEBUILDER_TEST_BUMP_WAIT_S` shortens both
raises. The 4.9 wizard copies each version whole (`model/versions.ts` `wizardVersions`), so a later key survives it.
`update.py --use 4.6–4.8` names the format-6 decks (read-only there) and asks; below 4.6 they are named with the
format-5 ones. Checked against the real older pages and helpers with `tools/compat-old.mjs` cases `m15` / `m16`
(VER-4) on 2026-10-22, Linux, old helpers on Python 3.13, the 4.9 helper on Python 3.8, with the shortened wait
`--bump-wait-s 2` (reports `cp01-m16fix.json`, `cp01-m16fix-b.json` in the session scratchpad): `m15` and `m16` PASS
against 4.6p (v4.6.0) and 4.8 (b9edb02); `m16` PASS against 4.0 (v4.0.0), 4.5 (637f7b4) and 4.7 (d327882) – each
old page's open refused with 409 ("saved by a newer Slide Builder (format 6)"), nothing written, `drop` / `hidden`
intact. Not run: `m15` against 4.0–4.7, the real 23 s wait, lean-lock storage mode, a CP-01 case with an old page
holding the deck open *during* the raise to 6 (covered by the DocSync and helper unit tests only), Windows / the
share. Cost: once per deck, the same ≈ 23 s of "Saving…" on the first 4.9 edit.

**Amendment 2026-10-22 (B52): format 7 for 4.10's chart targets.** 4.10 adds three kinds of chart mark – reference
lines from cells, gap arrows, change pills (ADR-015 amendment) – and B52's keys on a mark (`value` … `off`). They fit in
the `marks` map 4.9.0 already stores and merges whole, so nothing would be *lost* by a 4.9 fold; but 4.9 does not *draw*
them (its `markNodes` skips an unknown kind: the lines, arrows and pills vanish from its screen, PDF, PNG and
PowerPoint), it would draw a switched-off (`off`) arrow, and its panel offers to edit marks it cannot show. That is the
"misdraw" this guard exists for, so 4.10 raises a deck to **format 7** exactly the way 4.9 raised to 6
(`core/src/model/ops.ts` `needsV7` / `docNeedsV7`, built from 4.9.0's FROZEN mark kinds and keys `V49_MARK_KINDS` /
`V49_MARK_KEYS`): an `item.patch` whose `marks` hold an entry of a later kind or with a later key (removing one – a null
entry – is not: 4.9 applies that whole), a `slide.add` or `preset.set` carrying such a chart. Its own marker
**`incident-format-7.json`** (an incident to every 4.0–4.9 helper: 4.9's `_is_incident` excepts the format-5 and
format-6 markers only, its `READ_FORMATS` is (4, 5, 6)), the same 23 s wait, the tail, the CAS to `format: 7` (409 while
the marker is younger than the wait), the Lamport jump (also when a page sees the deck go 6 → 7), never lowered (400),
the marker written again on a format-7 snapshot read without it; `POST …/format7`; `X-SB-Deck-Formats` is `4,5,6,7`
from 4.10 and a page that does not send 7 gets 409 on a format-7 deck (`decks.check_page`). DocSync's raise loop checks
the queue again after each raise, so a 4.10 op joining a raise to 6 raises on to 7 before the record is sealed. A
format-4 or -5 deck goes straight to 7 (one marker). `knownOp` also learns the mark kinds and keys (a later page's mark
is not compacted by 4.10). `update.py --use 4.9` names the format-7 decks and asks; 4.6–4.8 and below 4.6 name them
with the older ones. Tests: core `docsync.test.ts` "format 7 for 4.10 chart marks" (raise with a 4.9 page's gap record,
straight from 4, the re-check race, the 6 → 7 Lamport jump on another page, two writers, never lowered),
`chart-targets.test.ts` (vectors `b52.json`, needsV7, knownOp); helper `Format7Tests`, `DeckFormatHttpTests`
(format 7), `test_update` format-7 list. Not run here: `tools/compat-old.mjs` against the real 4.9.0 page and helper (a
case for it is the orchestrator's CP-01 run). Cost: once per deck, the same ≈ 23 s of "Saving…" on the first 4.10 edit.
