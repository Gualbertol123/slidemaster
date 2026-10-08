# 04 · Data, storage on SMB, compatibility, cut-over and rollback

## 1. Data model (what is stored)

| Data | v3 file | v4 | Format change? |
|---|---|---|---|
| Workbook deck | `data/workbooks/<key>.json` (schema 3) | `data/v4/decks/<key>/snapshot.json` + `j/*.log` | the **document inside** (`preset`, `style`, `edits`) is unchanged. Only the container changes |
| Shared defaults | `data/config.json` (schema 3) | **the same file**, same lock `config`, same `style.patch`-only rule | none: v3 and v4 share it safely |
| Personal prefs | `data/users/<user>.json` (schema 1) | the same file. v4 adds optional keys (`window`, `zoomByDeck`), which v3 ignores | none |
| Font library | `data/fonts/fonts.json` (schema 1) + files | the same. New optional `source: "system"`, and instanced files of variable fonts with optional `instanceOf`. v3 treats unknown sources as uploads | none |
| Logos | `data/assets/` | the same | none |
| Backups | `backups/<key>/<rev>.json`, `backups/upgrades/…`, `before-update-*` | v3 folders kept read-only; v4 adds `backups/v4/<key>/<gen>.json` (each compaction's snapshot, last 30) | – |
| Presence | `presence/<user>@<host>.json` (rewritten and read) | `v4/decks/<key>/presence/<user@host#client>`: empty file, touched every 10 s, age = mtime on the server, listed with one `scandir` | new; v3 presence is not read by v4, and the reverse |
| Parsed sheets | – | `v4/cache/<crc32>-<size>.sbc` (deflated columns), LRU up to 2 GB, sweep by atime | new |

`<key>` is v3's `util.doc_key` (file name made safe + `sha1(lower(name))[:10]`), so a deck keeps its identity.

## 2. Storage protocol on SMB (specification)

### 2.1 Files of one deck

```
data/v4/decks/<key>/
├─ snapshot.json   {"format":4,"gen":12,"workbook":"IBD weekly.xlsx","lamport":8120,"rev":512,
│                   "frontier":{"anna@PC1#k3f9":40960,"bob@PC7#77aa":1024},"by":"anna","at":…,
│                   "doc":{"schema":3,"workbook":…,"preset":…,"style":…,"edits":…}}
├─ j/anna@PC1#k3f9.log     records, append-only, single writer (framing below)
├─ j/bob@PC7#77aa.log
├─ presence/anna@PC1#k3f9  (empty; mtime = last heartbeat)
├─ lock                    compaction / migration lock (v3 Lock protocol: O_EXCL, token, stale 15 s on server clock)
└─ moved-from-v3.json      written once at migration (what, when, by whom, sha1 of the v3 file)
```

**Record framing:** `<decimal length>:<crc32 hex 8>:<json>\n`. A reader accepts a record only if the
length, the CRC and the trailing newline are all present (`spikes/storage/journal_sim.py: frame/unframe`).
A torn or partial tail is left in place and re-read at the next poll.

### 2.2 Operations of the helper (HTTP; the page never touches files)

| Endpoint | What the helper does on the share | Round trips |
|---|---|---|
| `POST /api/decks/<key>/append {record}` | stamps `at` (file-server clock), appends the frame to `j/<writer>.log` through a handle kept open per writer session, `FlushFileBuffers`; returns `{offset}` | 2 (write + flush) |
| `GET /api/decks/<key>/tail?since=<json offsets>` | for each journal (listed once per 10 s): open, seek, read new bytes, close (parallel ≤ 8); returns the complete records and new offsets; also `snapshot.gen` if it changed (1 stat) | 2 per journal that exists (open+read; close compounded) |
| `GET /api/decks/<key>/snapshot` | read `snapshot.json` (retry 5×; unreadable → 503, never empty) | 2 |
| `POST /api/decks/<key>/compact {baseGen, snapshot}` | takes `lock`, checks `gen == baseGen` (else 409), writes temp + fsync + rename, copies to `backups/v4/<key>/<gen>.json` **after** releasing the lock, unlocks | ≈ 8 under the lock |
| `POST /api/decks/<key>/rotate {writer}` | closes the writer's handle, opens `j/<writer'>.log`; deletes the old journal only if the current snapshot's frontier covers its full size | 3 |
| `POST /api/presence {deck, client}` | touches its own presence file (1 write); `scandir` of `presence/` (1) → others with mtime age < 25 s | 2 |

The core in the page does the folding. It reads the snapshot and the tails, keeps the per-writer offsets,
folds records in `(l, w, s)` order, and rebases the local pending ops on top. It decides when to compact
(more than 2 000 records past the snapshot, or a writer idle for over 24 h) and when to rotate its own
journal.

### 2.3 Invariants (each has a test in 05 §3.6)

1. A record is acknowledged to the UI only after `FlushFileBuffers` returned. An acknowledged record is
   never lost: no writer ever truncates or rewrites a journal, and only the owner deletes it after the
   frontier covers it.
2. Every PC that has read the same set of records computes the same document: the fold is deterministic
   and the ops are pure functions.
3. The snapshot only ever moves forward. `compact` is a compare-and-set on `gen`, done under the lock and
   re-checked after taking it.
4. A record already in the snapshot is never applied twice. The frontier holds byte offsets per journal;
   the fold skips bytes below them.
5. Unreadable is never treated as empty:
   * an unreadable snapshot → 503 and retry;
   * an unreadable journal tail → skipped this round and retried;
   * a CRC failure in the middle of a journal (corruption, not a torn tail) → the deck becomes read-only
     with a banner, and an incident file is written. This must never happen; it is monitored.
6. Lamport counters never go back. A writer's first record has `l` greater than the snapshot's `lamport`
   and greater than every record it has seen.

### 2.4 Behaviour under faults

| Fault | Effect | Handling |
|---|---|---|
| PC crashes while appending | torn last frame in its journal | ignored forever (the frame is incomplete); the next session uses a new journal file; compaction drops the file once covered |
| Network drops during append | the UI keeps the ops pending, as v3 | retry with backoff 2–32 s (v3 `DocSync`); the same record (same `w`, `s`) may be appended twice → the fold de-duplicates by `(w, s)` |
| Two compactions at once | one wins the lock; the other gets `gen` mismatch → 409 | the loser drops its work; a compaction is never required for correctness, only for size |
| Compaction crashes after the rename, before the backup | the snapshot is already valid | the backup is best-effort (as v3 `_backup`) |
| Antivirus holds a file | Windows sharing violation | v3 `replace_retry` (20× over 2 s) and read retries, kept |
| SMB client caches a stale directory listing (`DirectoryCacheLifetime`, 10 s by default) | a new writer's journal is seen up to 10 s late | acceptable: it only delays the first records of a newcomer. Journal **content** is read by opening the file, which is coherent (leases are broken by the writer's flush) |
| Clock skew between PCs | none on ordering (Lamport) | `at`, presence age and stale locks use the file-server clock (v3 `fsclock.py`) |
| A user edits offline (`file://` mode) | as v3: localStorage only | unchanged; no merge into the share |
| Journal growth | ≈ 300 bytes per record | compaction at 2 000 records keeps a deck folder under 1 MB |

### 2.5 Worst case with 10–20 concurrent editors (simulated, `spikes/storage/sim-results.json`)

**Model.**
* Each operation sleeps the stated latency ±25 %.
* Charged: open, stat, rename, remove, listdir, fsync, **and every read or write on an open handle**. That
  is stricter than v3's `simfs.py`.
* Each user edits every 1–3 s (20 % of edits hit cells somebody else also edits), with a 300 ms debounce
  and a 1.5 s poll.

| Protocol | Users | fs ms | Save p50 / p95 | Visible p50 / p95 | Lost | Converged |
|---|---|---|---|---|---|---|
| **journal (v4)** | 10 | 15 | 32 / 37 ms | 1.1 / 1.9 s | 0 | yes |
| **journal (v4)** | 10 | 40 | 82 / 95 ms | 1.3 / 2.3 s | 0 | yes |
| **journal (v4)** | 20 | 15 | 32 / 37 ms | 1.2 / 2.1 s | 0 | yes |
| **journal (v4)** | 20 | 40 | 82 / 96 ms | 1.8 / 3.1 s | 0 | yes |
| lean lock (v3 minus backups/clock probes) | 10 | 15 | 155 / 392 ms | 1.0 / 2.4 s | 0 | yes |
| lean lock | 10 | 40 | 1 689 / 5 457 ms | 4.0 / 9.3 s | 0 | yes |
| lean lock | 20 | 15 | 762 / 3 181 ms | 2.2 / 5.6 s | 0 | yes |
| lean lock | 20 | 40 | 2 638 / 8 764 ms | 7.9 / 19.7 s | (queues not drained) | no, at run end |
| v3 as shipped (`tools/loadtest.py`, 30 backups) | 20 | 40 | 3 786 / 9 128 ms | 12.0 / 27.9 s | 0 | yes, with 20 × 503 |

The lean-lock row at 20 users / 40 ms is overloaded: about 2.6 s of lock time per save, against 10 saves/s
offered. Its queues were still full when the run's 8 s drain window closed, so the final views differed at
that moment. That is the overload showing, not a correctness bug; v3's real protocol under the same load
eventually saves everything (bottom row). The point stands: **trimming round trips is not enough at 40 ms.
Only removing the lock from the edit path scales.**

The **compaction cost** is estimated from the same model. One compaction of 20 journals at 40 ms is about
1 + 1 + 20 × 2 + 4 + 1 ≈ 47 round trips, so about 1.9 s under the deck lock. It happens about once every
2 000 records (≈ 3–4 minutes of 10 busy users) and blocks nobody's editing.

## 3. Reading every existing saved format

| Source | Example in the repo | v4 reader |
|---|---|---|
| v3 workbook doc, schema 3 (incl. legacy fields `preset.version`, `slide.layout/scale/align/valign` shared sizing, `table.cols/rows`, `notes.auto` without `mode`) | `backend/tests/fixtures/saved/workbook.v3.json` | `migrateV3Doc(doc)`: **identity** on `preset/style/edits`; `rev`, `updated`, `updatedBy`, `log` are copied into the snapshot header; `backupAt` is dropped |
| v3 workbook doc without `schema` | (format 3 by `upgrade.FIRST`) | same |
| config schema 3 / unnumbered | `config.v3.json` | read in place (unchanged format) |
| prefs, unnumbered or schema 1 | `prefs.unnumbered.json` | read in place |
| fonts.json schema 1 | (created by tests) | read in place |
| v2 `slide_builder_settings.txt` | `backend/tests/test_migrate.py` cases | v4 runs v3's `migrate.py` logic (ported to the v4 helper, unchanged) into v3-shaped docs, then migrates them as above |
| a v3 doc with `schema > 3` | – | refused as "too new", as v3 does |

**Rule kept from v3:** optional new fields need no format change. Readers ignore unknown keys; a missing key
means the default.

A v4 snapshot carries `format: 4`. A future format 5 follows the v3 discipline:
* a step function;
* a byte copy of the old file to `backups/upgrades/`, upgraded once under the deck lock;
* a "too new" refusal by older programs.

New example files are **added** to `backend/tests/fixtures/saved/` (`snapshot.v4.json`,
`journal.v4.log`); old ones are never edited.

## 4. Coexistence, cut-over and rollback

### 4.1 Can v3 and v4 run on the same share at the same time?

**Yes, on different decks. Never on the same deck.** That is enforced by data, not by discipline.

* v3 and v4 program files live side by side: v3 in `backend/`, v4 in `app/<ver>/`. Their helpers can run on
  different PCs at the same time, or on the same PC on different ports: v4 starts at 8765 too, and the
  "already running?" probe checks the `app` field of `/api/ping`, so a v3 helper is not mistaken for v4.
* `config.json`, `users/*.json`, `fonts/` and `assets/` keep their v3 format and the v3 lock names. Both
  versions read and write them safely.
* A **deck** is owned by exactly one version. Ownership moves to v4 the first time a v4 user opens that deck.

### 4.2 Per-deck migration (automatic, on first open in v4)

1. Take the v3 lock `wb-<key>` (`data/locks/`, v3 protocol). No v3 helper can be in the middle of a save.
2. Read the v3 document. If it is unreadable → 503, retry; nothing is written.
3. Copy the v3 file byte for byte to `backups/upgrades/workbook/<file>.v3.<time>.json` (as v3 upgrades do).
4. Write `data/v4/decks/<key>/snapshot.json` with `gen 1` and `doc` = the v3 document. Write
   `moved-from-v3.json` with the sha1 of the v3 bytes.
5. **Freeze the v3 document.** Rewrite `data/workbooks/<key>.json` with `"schema": 4`,
   `"movedTo": "v4"`, and all original content kept. Release the lock.

From then on, v3's own guards stop every v3 user on that deck. No v3 code changes are needed:
* v3 helpers refuse to read or write it: `upgrade.needs_upgrade` raises `TooNew` → `StoreTooNew` → HTTP 409
  (`upgrade.py:54-59`, `store.py:93-94`);
* open v3 pages turn "outdated" and stop sending, keeping their pending ops in memory: on poll,
  `docsync.ts:100` (schema > FORMATS.workbook); on save, the 409. The page shows *"Slide Builder was updated
  – reload the page (F5)"*.

Edits a v3 user made in the seconds before the freeze are in the v3 file at step 2, so nothing acknowledged
is lost. Ops a v3 page had not yet sent are lost when that user reloads, exactly as for any v3 update today.
The release note asks people to update at the start of the week's work.

### 4.3 Global cut-over (the normal path)

1. **D-7:** Phase-3 pilot users run v4 on copies of decks (04 §4.5).
2. **D0 (Monday morning):** the maintainer runs `Update Slide Builder.bat`, which installs `app\4.0.x\` and
   switches `Start Slide Builder.bat` to v4. v3 stays as `Start Slide Builder (v3).bat`.
3. Each deck migrates when first opened in v4. `Update Slide Builder.bat --migrate-all` can migrate every
   deck at once, under each deck's lock; decks open in v3 at that moment are skipped and retried later.
4. **D+28:** after four weekly cycles with no rollback, the v3 start file is removed. `backend/` stays as
   history; nothing is deleted.

### 4.4 Rollback (per deck or everything, lossless for v3 fields)

The helper cannot fold journals: only the TypeScript core knows the op semantics, and it is deliberately the
single implementation. Rollback therefore works from **compacted** snapshots:
* a v4 page compacts a deck when it is the last one present and closes it (`pagehide`), so decks at rest
  have no records past the frontier;
* *Options › Administration › Prepare rollback* in the page compacts every deck explicitly.

`Update Slide Builder.bat --rollback [<deck>|--all]` (helper, stdlib) then:
1. Takes the deck lock and the v3 lock `wb-<key>`.
2. Checks that no journal has bytes past the snapshot's frontier. If one has, it refuses that deck and says
   "open it once in Slide Builder 4, or use Prepare rollback". This is never a guess, and never a partial
   document.
3. Writes `snapshot.doc` as a **v3 document**: `schema 3`, with `rev`, `updated`, `updatedBy` and `log` from
   the snapshot header. It copies the frozen v3 file to backups first.
4. Marks the v4 deck folder `rolled-back.json`. A v4 helper then treats the deck as v3-owned again and will
   re-migrate on the next v4 open, unless the deck is listed in `data/v4/pinned-v3.json`.

Fields only v4 knows (optional new keys) are carried in the v3 document. v3 ignores unknown keys and keeps
them when it patches other fields, because `ops.py` only touches the keys it knows. A later re-migration
therefore recovers them. Global rollback is `--use 3`: the start file points back to `backend\` and every
deck is rolled back.

### 4.5 Pilot without risk

For the pilot, `Start Slide Builder (v4 pilot).bat` runs v4 with `SLIDEBUILDER_DATA=backend\data\v4-pilot`.
That is a **copy** of the data folder, so v4 never writes the production data. Exports go to
`export\v4-pilot\`.

## 5. Format details for implementers

* **Writer id:** `<user>@<host>#<8 random base32>`, new per page session. File-name safe: v3
  `safe_component`.
* **Lamport counter:** an integer, persisted only inside records and the snapshot.
* **`rev` shown to users:** `snapshot.rev + number of folded records after the frontier`. It increases by 1
  per record, like v3 per batch.
* **`log` (who changed what, last 20):** derived from the last 20 folded records `{rev, by, at}`.
* **Undo:** unchanged. Inverse ops are computed by the UI against its current view (`ops.ts inverseOf`) and
  appended as new records.
* **Presence:** `{user, host, client, deck}` is encoded in the file name. "Others" are files whose server
  mtime is less than 25 s old; files older than 24 h are deleted by any client.
* **Export folder:** unchanged (`export\`), with v3's atomic save, naming and ` (2)` rule.

## 6. Behaviour changes caused by the data layer

These match B4–B6 in 03 §6.2:
* Lamport order for simultaneous same-field edits;
* faster visibility;
* "✓ Saved" when flushed.

Also:
* **History** (`GET …/history`, used by the side panel) lists compaction backups (`backups/v4/<key>/`)
  instead of 5-minute rolling backups. The journal itself is a complete edit history since the last
  compaction, so restoring "as of 10:42" becomes possible: fold records with `at ≤ t` (Phase 4, optional).
