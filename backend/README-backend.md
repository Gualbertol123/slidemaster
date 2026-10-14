# Slide Builder helper (backend) – v3.7.0

Python standard library only, Python 3.8+. Windows is the target (app folder on an SMB share);
everything except the Excel/GDI+ converters also runs on Linux/macOS. The binding contract is
`docs/ARCHITECTURE.md`; the reasons are in `docs/REVIEW.md`.

```
python slide_builder.py [--port 8765] [--no-browser]    # what "Start Slide Builder.bat" runs
python slide_builder.py --install                        # what "Install Slide Builder.bat" (root) runs
python slide_builder.py --selftest                       # can this version use the shared folder? (read-only; tools/update.py)
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
| `__init__` | `APP_NAME`, `VERSION = "3.7.0"` |
| `paths` | folder layout (ROOT, BACKEND, DATA, export); `HOME_BACKEND` / `INSTALL_HOME`: a version in `app\<ver>\backend` uses the main folder's data and files; `configure()` / env overrides |
| `selftest` | `--selftest`: reads every saved setup without writing, probes create/rename/delete in `data/locks` |
| `util` | logging, identity (user/host), name safety, `doc_key()`, `safe_path()`, atomic writes |
| `fsclock` | the file server's clock (`fs_now(dir)`): ages of shared files never compare a server mtime with this PC's clock |
| `locks` | `Lock(name)` – O_EXCL lock files in `data/locks`, 10 s wait, 15 s stale, owner token, keepalive |
| `ops` | `apply_ops(doc, ops, user, now_ms, kind)` – §3.2 semantics (shared with the front end) |
| `store` | workbook docs, `config.json`, `users/<user>.json`, backups; retried reads, `StoreUnreadable`; format upgrades on read (`StoreTooNew` → 409) |
| `upgrade` | saved-format versions (`SCHEMA`) and the upgrade steps n → n+1 (ARCHITECTURE §3.3) |
| `presence` | heartbeat files `data/presence/hb~<user>~<host>~<client>~<workbook>.json`; others from one directory listing (old `<user>@<host>.json` still read) |
| `workbooks` | listing of workbooks, path-safe lookup, stable read (`X-SB-Mtime` / `X-SB-Size`) |
| `migrate` | one-time import of `slide_builder_settings.txt` (v2) under lock `migrate` |
| `exports` | `/api/export-file` (the page's PDF or PNG: temporary file, then atomic rename into `export\`, ` (2)` when locked) and `/api/export-feedback` (`export\feedback\*.json`) |
| `fonts` | shared font library `data/fonts/` (fonts.json + files; signature-checked uploads, lock `fonts`) |
| `sysfonts` | this PC's Windows fonts for the core (`GET /sysfonts`, names read with `struct`), and `POST /api/fonts/capture`: fingerprint mode (G0 R7), `data/fonts/system/fingerprints.json` under lock `fonts` |
| `convert` | EMF/WMF/TIFF → PNG (GDI+, PowerShell) and .xlsb/.xls → .xlsx (Excel COM) – Windows only (ported) |
| `firstrun` | `--install`: first-time set-up on a PC (5 steps, OK/WARN/FAIL, summary, exit code) |
| `simfs` | **load tests only**: adds simulated SMB latency to data-folder file calls when `SLIDEBUILDER_SIM_FS_MS` is set; never imported otherwise |
| `server` | HTTP API, security checks (Host, token, Origin, body limits), upload store |
| `main` | command line, "already running" probe (`/api/ping`), migration, start-up |

## Environment variables

| Variable | Effect |
|---|---|
| `SLIDEBUILDER_ROOT` | root folder (workbooks, `export\`) – default: parent of `backend\` |
| `SLIDEBUILDER_DATA` | data folder – default `backend\data` |
| `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` | identity instead of the Windows login / computer name |
| `SLIDEBUILDER_APP_WINDOW` | `0`: open the app in a normal browser tab instead of an Edge app window |
| `SLIDEBUILDER_APP_FILE` | serve this page instead of `slide_builder.html` (testing aid) |
| `SLIDEBUILDER_SIM_FS_MS` | **simulation for load tests**: +N ms (±25 %) per data-folder file operation that would be an SMB round trip (open, stat/exists/getmtime, replace/rename, remove, listdir, makedirs, fsync); `0` only counts them. Implies `SLIDEBUILDER_TIMING`. Never set it for real use. |
| `SLIDEBUILDER_TIMING` | add `X-SB-Timing: lock_wait_ms=…;write_ms=…[;fs_ops=…]` to `POST /api/workbooks/<name>/ops` responses (lock acquisition incl. waiting for others / work under the lock / file operations of that save). Clients may ignore it. |

## Tests

```
cd backend
python3 -m unittest discover -s tests -v
```

* `test_ops` – every case of `shared/ops-vectors.json` plus validation details
* `test_locks` – 6 processes × 40 increments under the lock, stale-lock recovery, foreign-lock release, keepalive
* `test_store` – 6 processes × 30 `update_workbook` calls → 180 cells, rev 180; unreadable doc stays untouched; backups
* `test_migrate` – realistic v2 file (cover/index presets, cell edits, `pn`, legacy `pageStart`); second run is a no-op
* `test_http` – real server on a free port: Host/token/Origin/body limits, token injection, ops + `?since` 204,
  presence, `/files` stable read headers, uploads, `/api/export-file` and `/api/export-feedback` (the removed
  print routes answer 404), 501 converters off Windows
* `test_fsclock` – clock skew between PCs (±60 s … ±10 min): fresh locks survive, stale ones are broken, presence/backups share one timeline
* `test_exports`, `test_workbooks`, `test_main` – export naming/atomicity, stable reads, entry point
* `test_firstrun` – `--install`: the five steps, shortcut fallback `.bat` on a temp desktop (and `.lnk` replacing it),
  shared-folder and journal probes (append twice + fsync, a lost append or a failed flush is a FAIL), exit codes,
  two runs in a row, real self-test
* `test_fonts` – font library and logo upload/lookup;
  `test_upgrade` – saved-format examples and upgrades; `test_update` – the GitHub updater and side-by-side releases
* `test_presence` – presence from file names and listing times; `test_release` – release ZIP and its manifest check;
  `test_sharetest` – the field-test protocols with local processes; `test_anonymise` – the corpus anonymiser
* `test_simfs` – latency simulation only touches data-folder calls, can be removed again; `X-SB-Timing` only when enabled

## Load test

`tools/loadtest.py` (standard library only) starts one helper per simulated user on a shared temp
folder (or `--real-folder T:\…`) and measures saving, lock waits, visibility of other people's edits
and correctness. Method and results: [`docs/LOADTEST.md`](../docs/LOADTEST.md).

Multi-process tests use the `spawn` start method (same as Windows).
