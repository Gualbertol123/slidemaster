# Load test: shared-folder storage with 10 users

Question: **is the network (the shared folder) the bottleneck, and what else could be considered?**

Short answer: the network itself is not the problem. The cost is the number of **sequential file
round trips per save**, and on the same workbook those saves happen **one at a time under a lock**.
With 10 people on one workbook that is fine up to about 5 ms per file operation, gets tight around
15 ms, and stops working at 40 ms. A cheap backend fix (fewer round trips per save, mostly the
backup check) roughly doubles to quadruples the headroom. Beyond that, the next step is a small
central server, not another file format.

**Update – the biggest part of option A is now implemented** (see §2b): the document records when its
last backup was taken (`backupAt`), so a normal save no longer lists or stats the backup folder under
the lock. With 30 existing backups, 10 users on one workbook at 15 ms went from p50/p95 2460/9679 ms
to **285/870 ms**, and edits became visible to others after 1.4 s instead of 11 s.

## 1. Method

`tools/loadtest.py` (Python standard library only) tests the real helper over HTTP:

* It starts **one helper process per simulated user** (`SLIDEBUILDER_USER=userK`,
  `SLIDEBUILDER_HOST=pcK`). All of them share one ROOT and data folder, like 10 PCs running the app
  from the same share. Each helper's token is read from `<meta name="sb-token">` in `GET /`.
* Each simulated user behaves like the app (`app/src/sync/docsync.ts`, `state/app.ts`):
  * one edit every 1–3 s with random jitter: 85 % `cell.patch`, 10 % `slide.patch`, 5 % `style.patch`;
  * edits are sent the way DocSync sends them: 300 ms debounce, one request in flight, and edits
    queued in the meantime go in the next batch. Failures are retried after 2–32 s;
  * `GET …/doc?since=<rev>` every 3 s (skipped while a save is in flight), and `POST /api/presence` every 10 s.
* **Simulated share latency** (`--fs-ms`). The helpers run with `SLIDEBUILDER_SIM_FS_MS=N`
  (`backend/slidebuilder/simfs.py`), and every data-folder file operation that would be an SMB round
  trip sleeps N ms ±25 % first. That covers open/create, stat/exists/getmtime, replace/rename,
  remove, listdir, makedirs and fsync. **This is a simulation and a lower bound.** Real SMB often
  needs 2–3 round trips for open+read+close, and antivirus on the file server adds time to every
  create. Without the environment variable the module is never loaded.
* `X-SB-Timing` (sent only when `SLIDEBUILDER_TIMING`/`SLIDEBUILDER_SIM_FS_MS` is set) splits every
  save into **lock wait**, **write** and **SMB ops**:
  * lock wait = time to acquire the workbook lock, including waiting for other people's saves;
  * write = time under the lock: read the doc, write the temp file, fsync, replace, backup check, release;
  * SMB ops = the number of file operations that save made.
* **Time to visible**: from the moment user A makes an edit until user B's view first contains it,
  either through B's poll or through B's own save response (both update the app's view).
* **Correctness**: at the end, every acknowledged `cell.patch` must be in the final document.
  Each user writes its own cells, so the check is simply counting cells.
* Scenarios: `same` (10 users on one workbook), `different` (one workbook each), `mixed` (5 on one + 5 alone).
* `--backups 30` seeds 30 old backups per workbook. That is the **steady state** after about 2.5 hours
  of use, because the helper keeps the last 30 backups and writes at most one per 5 minutes.
* Runs here: 10 users, 30 s of editing per run, then up to 30 s to drain queued edits and one more
  poll round. Machine: Linux container, 4 vCPU, local disk (the 0 ms row is CPU-bound: 10 helpers
  plus the driver on 4 cores).

Reproduce:

```
python tools/loadtest.py --users 10 --scenario same different --duration 30 --fs-ms 0 5 15 40 --json out.json
python tools/loadtest.py --scenario same different --duration 30 --fs-ms 15 --backups 30
python tools/loadtest.py --real-folder "T:\Slide Builder" --scenario same --duration 120   # your real share
```

`--real-folder` works in a temporary sub-folder of the share, which is deleted afterwards, and adds
no simulated latency (it still counts the file operations). **Mapping to your share:** step 5 of
`Install Slide Builder.bat` prints the median of a create+stat+replace+delete cycle. That cycle is
4 of the simulated operations, so the **cycle time ÷ 4 ≈ the `fs ms` column** below, as a lower bound.

## 2. Results

Offered load is identical in every run (seeded): 10 users × one edit per 2 s on average = 5 edits/s
(123 cell edits plus slide/style edits per run). Times are in ms. "lost" = acknowledged cell edits
missing from the final document.

| scenario | fs ms | backups | saves/s | ops/save | POST p50 | p95 | p99 | max | lock wait p50 / p95 | write p50 / p95 | SMB ops/save (p50) | visible p50 / p95 | errors | lost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| same      | 0  | 0  | 5.00 | 1.00 | 5    | 15   | 95    | 143   | 1 / 2         | 2 / 4     | 12 | 1 026 / 2 303   | 0 | 0/123 |
| different | 0  | 0  | 5.00 | 1.00 | 4    | 6    | 7     | 10    | 1 / 1         | 2 / 3     | 12 | –               | 0 | 0/123 |
| same      | 5  | 0  | 5.00 | 1.00 | 69   | 270  | 412   | 505   | 17 / 184      | 49 / 102  | 12 | 1 110 / 2 422   | 0 | 0/123 |
| different | 5  | 0  | 5.00 | 1.00 | 67   | 117  | 126   | 127   | 17 / 43       | 49 / 97   | 12 | –               | 0 | 0/123 |
| same      | 15 | 0  | 4.97 | 1.01 | 560  | 2 269 | 2 554 | 3 161 | 416 / 2 129  | 140 / 286 | 18 | 2 035 / 4 404   | 0 | 0/123 |
| different | 15 | 0  | 5.00 | 1.00 | 188  | 335  | 353   | 354   | 46 / 118      | 139 / 280 | 12 | –               | 0 | 0/123 |
| mixed     | 15 | 0  | 5.00 | 1.00 | 190  | 430  | 867   | 964   | 48 / 264      | 139 / 292 | 12 | 1 288 / 2 576   | 0 | 0/123 |
| same      | 40 | 0  | 2.50 | 2.00 | 2 663 | 8 898 | 10 036 | 10 206 | 2 278 / 8 533 | 368 / 774 | 34 | 9 373 / 17 371 | 2 × 503 | 0/123 |
| different | 40 | 0  | 5.00 | 1.00 | 493  | 870  | 930   | 935   | 124 / 309     | 368 / 722 | 12 | –               | 0 | 0/123 |
| **same**      | **15** | **30** | 1.97 | 2.54 | **2 460** | **9 679** | 10 272 | 10 338 | 1 866 / 9 100 | **597** / 758 | **42–67** | **11 367 / 24 064** | **7 × 503** | 0/123 |
| **different** | **15** | **30** | 5.00 | 1.00 | 646  | 787  | 814   | 815   | 47 / 119      | **594** / 724 | **42** | –               | 0 | 0/123 |
| different, stress (edit every 0.3–0.9 s) | 15 | 0 | 14.83 | 1.09 | 187 | 209 | 342 | 358 | 46 / 54 | 139 / 152 | 12 | – | 0 | 0/412 |

No acknowledged edit was lost in any run, including the overloaded ones. Each 503 was a lock wait
longer than 10 s, and the client kept the batch queued and saved it later. Under overload the client
batches automatically (ops/save rose to 2.0–2.5), which keeps the system from collapsing completely.

### Where the round trips go

One save, traced with the counting wrapper (warm file-server clock cache, 1 backup):

| # | operation | under the lock? |
|---|---|---|
| 1–3 | `makedirs(locks)`, `os.open(O_EXCL)` the lock file, `fsync` it | acquiring |
| 4 | open + read the workbook doc | yes |
| 5–8 | `makedirs(workbooks)`, create `<doc>.<uuid>.tmp`, `fsync`, `os.replace` | yes |
| 9–10 | backups: `listdir`, then **`getmtime` of every backup** (1 here, **30 in steady state**) | yes |
| 11–12 | release: read the lock file (token check), delete it | yes |

So a save costs **~12 operations on a fresh folder and ~42 once 30 backups exist**, of which 9 (or 39)
happen while holding the workbook lock. Every 30 s the file-server clock offset is measured again
for each of 3 directories (5 operations each), which explains the p95 of 22. Under contention a waiter
adds 2 operations per retry (create attempt + stale check), and it retries every 50–200 ms.

A poll is 1 operation (open + read of a 2–8 KB document). A presence heartbeat is about 5 operations
plus 1 read per other user, so roughly 15 with 10 users.

## 2b. After the backup fix

Same machine and method, 10 users, 30 s, 5 edits/s offered, **30 existing backups** (steady state):

| scenario | fs ms | POST p50 / p95 | lock wait p50 / p95 | write p50 | file ops/save | visible p50 / p95 | errors | lost |
|---|---|---|---|---|---|---|---|---|
| same | 15 | **285 / 870** (was 2460 / 9679) | 172 / 768 | 110 | **12** (was 42–67) | **1412 / 2761** (was 11367 / 24064) | 0 (was 7× 503) | 0/123 |
| different | 15 | **159 / 237** (was 646 / 787) | 47 / 119 | 109 | **10** (was 42) | – | 0 | 0/123 |
| same | 40 | 2404 / 6619 | 2113 / 6186 | 286 | 30 | 7034 / 13478 | 1× 503 (retried, nothing lost) | 0/123 |

A shared workbook on a 15 ms share is now comfortable; at 40 ms it is still overloaded for 10
simultaneous editors (the rest of option A, then B or D, would be needed there).

## 3. Analysis

### Is the shared folder the bottleneck?

**On one workbook, yes, but through serialisation, not bandwidth.** All saves of one workbook pass
through one lock. The lock is held for about 9 sequential round trips (39 in steady state), so:

* The time under the lock (the "write" column) is round trips × latency: 49 ms at 5 ms, 140 ms at 15 ms,
  368 ms at 40 ms, and **597 ms at 15 ms once 30 backups exist**.
* Lock handover is slow too. Acquiring costs about 3 round trips, and a waiter checks the lock only
  every 50–200 ms, so the lock often sits free while others are asleep.
* With 5 saves/s offered, the lock is busy roughly (acquire + hold) × 5/s:
  * 5 ms: 0.07 s × 5 ≈ **33 %**, p95 270 ms. Nobody notices, because the app applies edits locally
    at once and saves in the background.
  * 15 ms: 0.19 s × 5 ≈ **95 %**, on the edge, p95 2.3 s.
  * 40 ms: 0.5 s × 5 ≈ **250 %**, overloaded.
  * 15 ms + 30 backups: 0.65 s × 5 ≈ **> 300 %**, overloaded.

  Once overloaded, queues build up, waits reach the 10 s limit, 503s follow, and other people see
  changes 10–25 s late.

**On different workbooks, no.** Each workbook has its own lock, so the share scales: 10 users at
15 ms each saving three times as often (stress row) gave 14.8 saves/s with p95 209 ms. Latency per
save is simply its own round trips × RTT.

Bandwidth is irrelevant here. Documents are 2–8 KB, and polling 10 users × 1 GET / 3 s is about
3 small reads per second, which is negligible for a file server and never takes the lock.

### How it compares with the other costs a user feels

| cost | size | notes |
|---|---|---|
| Save at ≤ 5 ms, own workbook or light sharing | 50–270 ms, in the background | invisible: edits apply locally first |
| Rendering one edit in the browser (parse/layout/paint of the slide) | ~100–300 ms per edit render | per user, in parallel, not affected by the share |
| Seeing other people's edits | ~1–2.5 s at ≤ 15 ms (dominated by the 3 s poll) | at 40 ms on a shared workbook: 9–17 s |
| Opening a workbook: download of the `.xlsx` over SMB + parsing | ~0.5–2 s for 10–20 MB on a LAN, several seconds over VPN | once per open; bandwidth-bound, independent of the lock |
| Polling load: 10 users × 1 GET / 3 s | ~3 file reads/s | negligible |
| Presence: 10 users / 10 s × ~15 ops | ~15 file ops/s | no lock; could be lighter (see below) |

At LAN latencies, then, the browser's rendering and the 3 s poll interval matter more than the
share. The share becomes what users notice only when **many people edit the same workbook from a
slow link (≥ 15 ms per file operation, e.g. another site or VPN)**, or, on any link, once the
backup check grows to 30 files.

## 4. Options

| option | what it changes | pros | cons | effort |
|---|---|---|---|---|
| **A. Fewer round trips per save** | Track the last backup time in memory (or in the doc) instead of `listdir` + 30× `getmtime`. Write the backup **after** releasing the lock. Create folders once at start-up instead of `makedirs` on every write. Drop the `fsync` of the 100-byte lock file. Measure the file-server clock once per data folder (not per sub-folder) and cache it for 5 min. Retry the lock first at 10–30 ms, then back off. | Under-lock work goes from 9 (39) to ~5 round trips: **2× fresh, ~7× steady state**. No protocol or front-end change; the tests stay valid. | Backup spacing becomes per-helper, which is acceptable (it is a safety net). | **1–2 days** |
| B. Longer / adaptive client batching | Debounce 300 ms → 1–2 s, or longer when the last save was slow | Fewer saves under load (already happens: 2–2.5 ops/save at 40 ms) | Edits reach others ~1 s later; front-end change | 0.5 day (front end) |
| C. Append-only per-user operation journals | Each helper appends its ops to `journal/<wb>/<user@host>.jsonl` (single writer, **no lock**). Readers merge the journals in a deterministic order (server time, user). Occasional compaction into the doc under the lock. | No serialisation at all: a save is ~3 round trips regardless of the number of users | Readers must open N journals per poll. Deterministic ordering for same-field edits, compaction and crash cases are new, subtle code that needs heavy testing on SMB (caching, partial appends). | 1–2 weeks |
| **D. Small central server** | One process on a server (Python stdlib, or Node/Next.js) that implements the same HTTP API (ARCHITECTURE §5). It keeps docs in memory, writes them to local disk, pushes changes over WebSocket/SSE, and runs one shared export engine. | Saves in a few ms, no SMB locks. **Edits visible in < 100 ms** instead of a 3 s poll. One place for exports and logs. Removes the per-PC helper install. | Needs a server host, a service account, firewall rules and authentication (Windows SSO / reverse proxy). Single point of failure, so it needs backups and monitoring. IT approval is the long pole. | 2–4 weeks + IT lead time |
| SQLite on the share | – | – | **Not recommended.** SQLite's own documentation warns that file locking on network filesystems is unreliable and can corrupt the database, and WAL mode does not work over a network share at all. It would trade a slow but correct protocol for a fast but unsafe one. | – |
| SharePoint / OneDrive sync | Keep `data\` in a synced library | No file server needed | Sync is eventual (seconds to minutes) and produces conflict copies instead of merges. Lock files do not work across sync clients, so this **breaks the locking protocol**. A Graph-API backend would need an app registration and consent (IT) and is effectively option D with Microsoft as the server. | – / large |
| Database server (SQL Server / PostgreSQL) | Docs as rows, updates in transactions | Real transactions, row-level locking, mature backups | Python has no stdlib driver (needs `pyodbc` etc. on every PC) and DB credentials on every PC. Still polling unless combined with D. Best as D's storage, not as a direct client store. | 1–2 weeks + DBA |

Also worth doing while touching the code: presence costs about 15 operations per heartbeat because
every helper lists and reads every heartbeat file. One shared presence file per workbook, or reading
presence only every 30 s, would cut that. It does not affect saving, since presence takes no lock.

## 5. Recommendation

1. **Measure your share first.** Run step 5 of `Install Slide Builder.bat` on a few PCs (cycle ÷ 4 ≈
   `fs ms`), or `tools/loadtest.py --real-folder T:\… --scenario same`.
2. **Do option A now, regardless.** *(The backup part is done – §2b.)* The steady-state backup check alone turns a 15 ms share from
   "slightly slow" (p95 2.3 s) into "broken" (p95 9.7 s, 503s, 11 s to see changes). Removing it,
   moving the backup out of the lock and trimming the lock round trips takes the time under the
   lock from ~600 ms to ~75 ms at 15 ms. That is about 8× headroom for 10 users on one workbook.
   The cost is 1–2 days, with no change to the contract.
3. After A, the shared folder is good enough when the measured `fs ms` is up to about **15 ms** with
   10 people on one workbook, and for any number of people on different workbooks. Add B if the
   status bar shows "Saving…" for long.
4. If teams on other sites or VPN (≥ 20–40 ms per file operation) routinely co-edit the same deck,
   or near-instant visibility of other people's edits is wanted, go to **option D, a central server
   implementing the existing API**, with WebSocket push. Do not move to SQLite on the share or to a
   synced OneDrive folder. Option C (journals) is the fallback when no server can be approved: it
   removes the lock but adds the most new complexity.
