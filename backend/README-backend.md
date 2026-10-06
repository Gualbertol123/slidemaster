# Slide Builder helper (backend) – v3.0

Python standard library only, Python 3.8+. Windows is the target (app folder on an SMB share);
everything except the Excel/GDI+ converters also runs on Linux/macOS. The binding contract is
`docs/ARCHITECTURE.md`; the reasons are in `docs/REVIEW.md`.

```
python slide_builder.py [--port 8765] [--no-browser]    # what "Start Slide Builder.bat" runs
python slide_builder.py --setup                          # what "Install export engine.bat" runs
```

## Module map (`slidebuilder/`)

| Module | Concern |
|---|---|
| `__init__` | `APP_NAME`, `VERSION = "3.0"` |
| `paths` | folder layout (ROOT, BACKEND, DATA, export, engine); `configure()` / env overrides |
| `util` | logging, identity (user/host), name safety, `doc_key()`, `safe_path()`, atomic writes |
| `fsclock` | the file server's clock (`fs_now(dir)`): ages of shared files never compare a server mtime with this PC's clock |
| `locks` | `Lock(name)` – O_EXCL lock files in `data/locks`, 10 s wait, 15 s stale, owner token, keepalive |
| `ops` | `apply_ops(doc, ops, user, now_ms, kind)` – §3.2 semantics (shared with the front end) |
| `store` | workbook docs, `config.json`, `users/<user>.json`, backups; retried reads, `StoreUnreadable` |
| `presence` | heartbeat files `data/presence/<user>@<host>.json` |
| `workbooks` | listing of workbooks, path-safe lookup, stable read (`X-SB-Mtime` / `X-SB-Size`) |
| `migrate` | one-time import of `slide_builder_settings.txt` (v2) under lock `migrate` |
| `pdf` | PDF writer for JPEG/PNG pages, PNG helpers (ported from v2.3) |
| `cdp` | minimal websocket + DevTools client (ported) |
| `engines` | browser discovery, Playwright / DevTools / command-line engines, `Exporter`, engine mirror (ported; mirror under a lock on this PC) |
| `exports` | `/api/export` + `/api/assemble`: render, then atomic rename into `export\` (` (2)` when locked) |
| `convert` | EMF/WMF/TIFF → PNG (GDI+, PowerShell) and .xlsb/.xls → .xlsx (Excel COM) – Windows only (ported) |
| `installer` | `--setup` (Chrome for Testing download, Playwright) under install locks; background runner for the app |
| `server` | HTTP API, security checks (Host, token, Origin, body limits), upload store |
| `main` | command line, "already running" probe (`/api/ping`), migration, start-up |

## Environment variables

| Variable | Effect |
|---|---|
| `SLIDEBUILDER_ROOT` | root folder (workbooks, `export\`, `engine\`) – default: parent of `backend\` |
| `SLIDEBUILDER_DATA` | data folder – default `backend\data` |
| `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` | identity instead of the Windows login / computer name |
| `SLIDEBUILDER_BROWSER` | force a browser executable |
| `SLIDEBUILDER_ENGINES` | `playwright,devtools,cli` subset, or `none` |
| `SLIDEBUILDER_FORCE_NETWORK` | treat ROOT as a network drive (testing the engine mirror) |

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
  presence, `/files` stable read headers, uploads, exports, 501 converters off Windows
* `test_fsclock` – clock skew between PCs (±60 s … ±10 min): fresh locks survive, stale ones are broken, presence/backups share one timeline
* `test_exports`, `test_workbooks`, `test_installer`, `test_main` – export naming/atomicity with a fake engine,
  stable reads, C9 locks, entry point
* `test_engine_cli` – renders a real slide when a Chromium is found in `/opt/pw-browsers` (skipped otherwise)

Multi-process tests use the `spawn` start method (same as Windows).
