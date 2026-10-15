# Slide Builder helper – v3.8.0

Python standard library only, Python 3.8+. Windows is the target (app folder on an SMB share);
everything except the Excel/GDI+ converters also runs on Linux/macOS. The binding contract is
`docs/ARCHITECTURE.md`; the reasons are in `docs/REVIEW.md`.

```
python slide_builder.py [--port 8765] [--no-browser]    # what "Start Slide Builder.bat" runs
python slide_builder.py --install                        # what "Install Slide Builder.bat" (root) runs
python slide_builder.py --allow-font-copy "J. Doe, 2026-10-20"   # the licence owner said yes (R7): copy mode; "off" goes back
python slide_builder.py --selftest                       # can this version use the shared folder? (read-only; tools/update.py)
python slide_builder.py --pilot [--refresh]              # what "Start Slide Builder (v4 pilot).bat" runs: a copy of the data (pilot.py)
```

The page renders PDFs and PNGs itself (the native export) and posts the bytes to `/api/export-file`;
the helper only saves them in `export\`. It renders nothing itself, downloads nothing and needs no Python
package (there is no `requirements.txt`).

`--install` is the first-time set-up (`slidebuilder/firstrun.py`), five steps: (1) Python check (3.8+),
(2) shared-folder check (lock file in `data\locks`, `export\` write, file-server round trip), (3) journal
probe (a file in `data\locks` appended to twice, each record flushed with `os.fsync`, read back and removed –
the shared-storage journal needs append + flush), (4) a desktop shortcut (`.lnk` via PowerShell, `.bat`
fallback) and (5) a self-test (`/api/ping` on a free port). Steps 1, 2, 3 and 5 are required. Exit code 0/1;
idempotent.

## Module map (`slidebuilder/`)

| Module | Concern |
|---|---|
| `__init__` | `APP_NAME`, `VERSION = "3.8.0"` |
| `paths` | folder layout (ROOT, HELPER, DATA, export); `HOME_BACKEND` / `INSTALL_HOME`: the program is in `helper\` (until 3.8 `backend\`), the data, logo and v2 settings stay in the main folder's `backend\`; a version in `app\<ver>\helper` uses the main folder's data and files; `configure()` / env overrides |
| `selftest` | `--selftest`: reads every saved setup without writing, probes create/rename/delete in `data/locks` |
| `util` | logging, identity (user/host), name safety, `doc_key()`, `safe_path()`, atomic writes |
| `fsclock` | the file server's clock (`fs_now(dir)`): ages of shared files never compare a server mtime with this PC's clock |
| `locks` | `Lock(name)` – O_EXCL lock files in `data/locks`, 10 s wait, 15 s stale, owner token, keepalive |
| `store` | `config.json` (compare-and-set of its defaults on `rev` under lock `config`, shared with v3 helpers: the page computes them), `users/<user>.json`, and v3's workbook documents read only (the migration, the self-test); retried reads, `StoreUnreadable`; format upgrades on read (`StoreTooNew` → 409). Applies no operation |
| `upgrade` | saved-format versions (`SCHEMA`) and the upgrade steps n → n+1 (ARCHITECTURE §3.3) |
| `decks` | Slide Builder 4's decks (docs/next/04 §2): `data/v4/decks/<key>/` snapshot + per-writer journals of framed records (`<len>:<crc32>:<json>\n`), append (one handle per writer session, `os.fsync`, `at` on the file server's clock), tail (≤ 8 parallel reads, listing cached 3 s, complete frames only), snapshot (retried; 503, never empty), compact (CAS on `gen` under the deck lock; covered journals idle 24 h dropped; backup to `backups/v4/<key>/` after the lock), rotate, presence v2 (empty files, scandir mtimes), incidents (a corrupt journal makes the deck read-only); `SLIDEBUILDER_STORAGE=lean-lock` (or `data/v4/storage.json`): one shared journal under the deck lock. **Never parses or applies operations** |
| `workbooks` | listing of workbooks, path-safe lookup, stable read (`X-SB-Mtime` / `X-SB-Size`) |
| `migrate` | one-time import of `slide_builder_settings.txt` (v2) under lock `migrate`: each workbook a new deck whose first record holds the import as operations (folded by the core) |
| `migrate_v3` | a deck moves from Slide Builder 3 on its first v4 open (under `wb-<key>`: backup, the v3 file frozen first, then the snapshot), `--migrate-all`, rollback (`--rollback`, `--use <3.x>`), `pinned-v3.json` |
| `exports` | `/api/export-file` (the page's PDF or PNG: temporary file, then atomic rename into `export\`, ` (2)` when locked) and `/api/export-feedback` (`export\feedback\*.json`) |
| `fonts` | shared font library `data/fonts/` (fonts.json + files; signature-checked uploads, lock `fonts`) |
| `sysfonts` | this PC's Windows fonts for the core (`GET /sysfonts`, names read with `struct`), and `POST /api/fonts/capture`: fingerprint mode (G0 R7), `data/fonts/system/fingerprints.json` under lock `fonts`; copy mode (W13: the family into the shared library, all faces or none) once `--allow-font-copy "<who confirmed>"` has recorded the licence owner's yes in `data/fonts/system/licence.json` |
| `convert` | EMF/WMF/TIFF → PNG (GDI+, PowerShell) and .xlsb/.xls → .xlsx (Excel COM) – Windows only (ported) |
| `firstrun` | `--install`: first-time set-up on a PC (5 steps, OK/WARN/FAIL, summary, exit code) |
| `simfs` | **load tests only**: adds simulated SMB latency to data-folder file calls when `SLIDEBUILDER_SIM_FS_MS` is set; never imported otherwise |
| `server` | HTTP API, security checks (Host, token, Origin, body limits), upload store |
| `main` | command line, "already running" probe (`/api/ping`), migration, start-up |

## Environment variables

| Variable | Effect |
|---|---|
| `SLIDEBUILDER_ROOT` | root folder (workbooks, `export\`) – default: parent of `helper\` |
| `SLIDEBUILDER_DATA` | data folder – default `backend\data` |
| `SLIDEBUILDER_STORAGE` | `lean-lock`: decks append to one shared journal under the deck lock (ADR-006's fallback; default `journal`, or `data/v4/storage.json`) |
| `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` | identity instead of the Windows login / computer name |
| `SLIDEBUILDER_APP_WINDOW` | `0`: open the app in a normal browser tab instead of an Edge app window |
| `SLIDEBUILDER_APP_FILE` | serve this page instead of `slide_builder.html` (testing aid) |
| `SLIDEBUILDER_SIM_FS_MS` | **simulation for load tests**: +N ms (±25 %) per data-folder file operation that would be an SMB round trip (open, stat/exists/getmtime, replace/rename, remove, listdir, makedirs, fsync); `0` only counts them. Never set it for real use. |

## Tests

```
cd helper
python3 -m unittest discover -s tests -v
```

* `test_locks` – 6 processes × 40 increments under the lock, stale-lock recovery, foreign-lock release, keepalive
* `test_store` – v3 documents read only; config compare-and-set (6 processes × 20 changes, nothing lost); prefs
* `test_decks` – the deck storage (05 §3.6 tests 1–6): 20 processes × 500 records, a writer killed mid-append, duplicates,
  CRC corruption → read-only, compaction races, clock skew; journal names never reused; prepare; presence v2; lean-lock
* `test_migrate_v3` – 05 §3.6 tests 7–9 with the REAL v3 helper (a git worktree of v3.8.0): migration and freeze, a
  racing v3 save, rollback and re-migration, half-done steps finished, config.json edited by v3 and v4 at once
* `test_migrate` – realistic v2 file (cover/index presets, cell edits, `pn`, legacy `pageStart`); second run is a no-op
* `test_http` – real server on a free port: Host/token/Origin/body limits, token injection, config compare-and-set, deck routes, v3's routes gone (404),
  presence, `/files` stable read headers, uploads, `/api/export-file` and `/api/export-feedback` (the removed
  print routes answer 404), 501 converters off Windows
* `test_fsclock` – clock skew between PCs (±60 s … ±10 min): fresh locks survive, stale ones are broken, config timestamps on the server's clock (deck presence: test_decks)
* `test_exports`, `test_workbooks`, `test_main` – export naming/atomicity, stable reads, entry point
* `test_firstrun` – `--install`: the five steps, shortcut fallback `.bat` on a temp desktop (and `.lnk` replacing it),
  shared-folder and journal probes (append twice + fsync, a lost append or a failed flush is a FAIL), exit codes,
  two runs in a row, real self-test
* `test_fonts` – font library and logo upload/lookup;
  `test_upgrade` – saved-format examples and upgrades; `test_update` – the GitHub updater and side-by-side releases
* `test_release` – release ZIP and its manifest check;
  `test_sharetest` – the field-test protocols with local processes; `test_anonymise` – the corpus anonymiser
* `test_simfs` – latency simulation only touches data-folder calls, can be removed again; the decks' round trips as 04 §2.2 counts them

## Load test

`tools/loadtest4.py` (standard library only) starts one v4 helper per simulated user on a shared temp
folder (or `--real-folder T:\…`) and measures saving, visibility of other people's edits, compaction and
correctness against 05 §3.5 (`--ci`: the CI job). Method and results: [`docs/LOADTEST.md`](../docs/LOADTEST.md).

Multi-process tests use the `spawn` start method (same as Windows).
