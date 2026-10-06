# Slide Builder 3 – architecture and API contract

This is the contract between the browser app (`frontend/`, built into
`backend/slide_builder.html`) and the local helper (`backend/slidebuilder/`). A future central
server (Node/Next.js, Python, …) can replace the helper by implementing the same endpoints.

## 1. Deployment model (unchanged)

* The app folder lives on a shared drive. Each user starts **their own** helper (Python standard
  library only) with `Start Slide Builder.bat`; it serves the app on `http://127.0.0.1:<port>/`.
* All helpers share the folder. Coordination happens **only through files**, so every write follows
  the locking protocol in §4.

```
Slide Builder\                     ROOT
├─ *.xlsx / *.xlsm / *.xlsb / *.xls workbooks (Open menu)
├─ export\                          PDFs / PNGs
├─ engine\                          Chrome for Testing (optional; mirrored to %LOCALAPPDATA% on shares)
└─ backend\
   ├─ slide_builder.py              entry point (thin)
   ├─ slide_builder.html            the app (BUILT from frontend/)
   ├─ slidebuilder\                 helper package
   ├─ logo.png
   └─ data\                         ALL persistent state (see §3)
```

## 2. Identity

`user` = `getpass.getuser()` (Windows login), `host` = `socket.gethostname()`. A browser tab gets
a random `client` id. Presence and `updatedBy` use these.

## 3. Data (`backend/data/`)

```
data/
├─ config.json                 shared defaults for new decks          {schema, rev, updated, updatedBy, defaults:{style}}
├─ workbooks/<key>.json        one document per workbook (below)
├─ users/<user>.json           personal preferences                   {lastFile, pdfMode, zoom}
├─ presence/<user>@<host>.json heartbeat                              {user, host, client, workbook, at}
├─ backups/<key>/<rev>.json    rolling copies of workbook docs (last 30, at most one per 5 min)
├─ locks/<name>.lock           lock files (§4)
└─ migrated.json               marker: v2 settings were imported
```

`<key>` = file name made safe for Windows (`[^A-Za-z0-9._-]` → `_`, max 60 chars) + `-` + first
10 hex chars of `sha1(name.lower())`. Lower-casing matches Windows' case-insensitive names.

### 3.1 Workbook document

```jsonc
{
  "schema": 3,
  "workbook": "IBD weekly.xlsx",
  "rev": 42,                       // +1 for every successful batch of operations
  "updated": 1791214363000,        // ms since epoch
  "updatedBy": "rossim",
  "preset": {                      // null = no preset yet (the wizard creates one)
    "sheets": ["Overview", "Detail"],
    "tables": [
      {"id": "k3j9x0a", "sheet": "SLIDE_1", "kind": "markers", "anchor": "A3", "index": 0},
      {"id": "p0q8z1b", "sheet": "Detail", "kind": "range", "range": "A2:K20", "grow": true, "name": "Products"}
    ],
    "slides": [                    // in deck order; cover and index are ordinary entries
      {"id": "c1", "type": "cover", "title": "IBD Weekly", "subtitle": null, "date": null, "note": "…", "tables": []},
      {"id": "i1", "type": "index", "title": "Contents", "tables": []},
      {"id": "s1", "type": "content", "title": null, "subtitle": null, "tables": ["k3j9x0a"],
       "layout": {"bands": [[0]], "w": [1]}, "logo": false}
    ]
  },
  "style": {                       // partial; missing keys inherit config.defaults.style, then built-ins
    "design": "glass", "glass": "subtle", "color": 35, "logo": "logo.png",
    "pn": {"on": true, "start": 1, "pos": "br", "font": "auto", "size": 16, "format": "n", "style": "capsule", "cover": false}
  },
  "log": [{"rev": 42, "by": "rossim", "at": 1791214363000}],   // last 20 revisions, written by the helper
  "edits": {                       // per sheet, per cell address
    "Overview": {"C7": {"orig": "TOTAL", "text": "Totale", "sz": 14, "b": true, "i": false,
                        "color": "#A8101A", "fill": "#34C759", "align": "center", "role": "header"}}
  }
}
```

A document that does not exist is returned as `{"schema":3,"workbook":<name>,"rev":0,"preset":null,"style":{},"edits":{}}`.

### 3.2 Operations

Clients never send whole documents. They send a list of operations; the helper applies them to the
**latest** document under the lock (§4). Values `null` mean "delete this key". Semantics are
defined once, here, and tested on both sides with `shared/ops-vectors.json`.

| op | fields | effect |
|---|---|---|
| `preset.set` | `preset` (object or null) | replace `doc.preset` (deep copy). Used by the wizard. |
| `slide.patch` | `id`, `patch` | on the slide with that id: keys `title, subtitle, date, note, logo, layout, align, scale`: `null` → delete, else set. Key `notes` is a **map merge** (see below). Other keys ignored. Unknown slide (or no preset) → op **skipped**. |
| `table.patch` | `id`, `patch` | on `doc.preset.tables[id]`: key `name`: `null` → delete, else set; keys `cols`, `rows`, `scales`, `merges` are **map merges**. Other keys ignored. Unknown table (or no preset) → skipped. |
| `cell.patch` | `sheet`, `ref`, `patch` | on `doc.edits[sheet][ref]` (created if missing): for each key in `text, orig, sz, b, i, color, fill, bg, align, role`: `null` → delete, else set. Then: if `text` is absent, delete `orig`; if no keys remain, delete the cell; if the sheet has no cells, delete the sheet. |
| `style.patch` | `patch` | on `doc.style`: keys `design, glass, color, logo, radius, contrast, logoBubble`: `null` → delete, else set; keys `pn` and `footer` are map merges. |

**Map merge** (`pn`, `footer`, `notes`, `cols`, `rows`, `scales`, `merges`): value `null` → delete the whole map; an object →
each entry is set (replacing that entry entirely) or deleted when `null`; a map left empty is deleted.
So two people changing different columns, rules or text boxes never overwrite each other.

| Field | Meaning |
|---|---|
| `table.cols` / `table.rows` | `{"<sheet column/row number>": px}` – width/height override in table pixels (Excel 100 %); fixed: Liquid Glass does not widen these columns |
| `table.scales` | `{"<rule id>": {range:"D6:F18", dir:"row"\|"col"\|"all", mode:"zero"\|"minmax", fill:bool, ink:bool, invert?:bool}}` – colour scales: deeper green/red with the size of the number, per row, per column or over the whole range |
| `table.merges` | `{"C4:D5": "merge" \| "split"}` – merge cells (the top-left value is shown) or split a merge from the workbook (key = its range) |
| cell `bg` | cell colour that **replaces** the Excel colour (`"none"` removes it); in Liquid Glass it recolours the block. `fill` stays a highlight (a capsule in Liquid Glass) |
| `style.footer` | `{on, text, pos, size, style, cover}` – footer on every slide like the page number; `{date}`, `{workbook}`, `{title}` are replaced |
| `slide.align` | `"left"\|"center"\|"right"` – horizontal alignment of the tables (default centre) |
| `slide.scale` | fixed table scale (null = fit to the slide); set by "Make same size" so tables on different slides match |
| `slide.notes` | `{"<tableId>:<top\|bottom\|left\|right>": {text, size?, b?, i?, align?, color?, w?, h?}}` – text boxes around a table: top/bottom as wide as the table, left/right as high |
| `style.radius` | corner roundness, % of the default (0–200, default 100) |
| `style.contrast` | contrast between background and glass surfaces (0–100, default 50) |
| `style.logoBubble` | `false` = logo without its glass bubble |

Any other op, or an op with missing/invalid fields, is skipped. If at least one op was applied:
`rev += 1`, `updated = now`, `updatedBy = user`. Field-level merging means two people editing
different cells, slides or style keys never lose each other's work; the same field → last write wins.

`config.json` accepts only `style.patch`, applied to `defaults.style`.

**Undo** on the client is the inverse operation computed from the values before the change, so it
never reverts somebody else's change.

## 4. Locking protocol (works across PCs on SMB)

* Lock = create `data/locks/<name>.lock` with `os.open(O_CREAT | O_EXCL | O_WRONLY)`, write
  `{user, host, pid, at, token}`, close. Release = delete it, only if the token is still ours.
* Ages of shared files (stale locks, presence, backup spacing, `updated`) are measured on the **file
  server's clock** (`fsclock.py`: mtime of a probe file), never on the PC's clock.
* Long critical sections (installer, migration) refresh their lock every 3 s (keepalive).
* Wait up to 10 s, retrying every 50–200 ms (jittered). A lock file older than 15 s is stale: it is
  deleted and acquisition retried.
* Critical section of a write: read latest doc → apply ops → write `<file>.<uuid>.tmp` → `fsync` →
  `os.replace` (retried 20× over 2 s for Windows sharing violations) → release.
* **Reads never return a made-up empty document for an existing but unreadable file**: parse is
  retried 5× over 0.5 s; then the request fails with 503 and nothing is written.
* Lock names: `wb-<key>`, `config`, `migrate`, `install`, `export-<safe name>`.

## 5. HTTP API

All responses JSON unless stated. Security for every request:

* `Host` must be `127.0.0.1:<port>` or `localhost:<port>` → otherwise 403.
* Every `/api/*`, `/files/*` and `/assets/*` request must carry header `X-SB-Token: <token>`
  (random per helper start). The token is injected into the served page by replacing the
  placeholder `__SB_TOKEN__` in `slide_builder.html`. `/assets/*` may instead pass `?t=<token>`
  (used by `<img>`).
* If an `Origin` header is present it must be `http://127.0.0.1:<port>` / `http://localhost:<port>`.
* Request bodies are limited to 300 MB (uploads/exports) and 2 MB for JSON documents/ops.

| Method & path | Request | Response |
|---|---|---|
| `GET /` | – | the app, token injected |
| `GET /api/health` | – | `{app, version, user, host, folder, export, engine:{state, browser, local, error, engines[]}}` |
| `GET /api/config` | – | config document |
| `POST /api/config/ops` | `{ops}` | `{doc, applied, skipped}` |
| `GET /api/me` | – | `{user, host, prefs:{lastFile, pdfMode, zoom}}` |
| `PUT /api/me` | `{prefs}` | `{ok}` (personal file: whole replace) |
| `GET /api/files` | – | `{workbooks:[{name, mtime, size, rev, updated, updatedBy}], folder}` (doc fields null when no doc) |
| `GET /api/ping` | – (no token) | `{app, version}` – used by the “already running” probe |
| `GET /files/<name>` | – | workbook bytes (workbook extensions only); headers `X-SB-Mtime`, `X-SB-Size`. Read is stable: retried while size/mtime change or the zip is incomplete; 503 if still changing. |
| `GET /api/workbooks/<name>/doc?since=<rev>` | – | `204` when `doc.rev == since`, else `{doc}` |
| `POST /api/workbooks/<name>/ops` | `{ops, client}` | `{doc, applied, skipped:[index…]}` |
| `GET /api/workbooks/<name>/history` | – | `{backups:[{rev, updated, updatedBy}]}` |
| `POST /api/presence` | `{client, workbook}` | `{others:[{user, host, client, workbook, at}]}` – others seen in the last 25 s |
| `POST /api/presence/leave` | `{client}` | `{ok}` |
| `POST /api/upload?name=` · `GET /api/upload/<id>` | bytes | `{id, name}` · bytes (in memory, max 8 entries, 2 h) |
| `POST /api/convert-workbook?name=` | bytes | `.xlsx` bytes (Excel COM, Windows) or 501 |
| `POST /api/convert?ext=` | bytes | PNG bytes (GDI+, Windows) or 501 |
| `POST /api/export` | `{name, format:"pdf"\|"png", mode:"exact"\|"vector", css, slides[], names[], scale, inline?, all?}` | `{ok, files[], engine, seconds}` or `{ok, images[]}` (inline). 503 when no engine works. |
| `POST /api/assemble` | `{name, images[]}` (JPEG data URLs) | `{ok, files[]}` |
| `POST /api/open` | `{name}` or `{folder:true}` | `{ok}` |
| `POST /api/engine/restart` | – | `{ok}` |
| `POST /api/engine/install` · `GET /api/engine/install` | – | `{running, done, ok, lines[]}` |
| `GET /assets/<name>` | – | image bytes (image extensions only) from `backend/`, then ROOT |

Status codes: 400 bad request · 403 Host/token/Origin or file type · 404 · 411/413 body · 501 converter
not available · 503 document unreadable, lock busy, workbook still being saved, or no export engine
(clients keep their pending operations and retry). `/api/me` preferences contain `null` for unset keys.

Export files are written to a unique temporary name in `export\` and renamed into place; when the
target is locked (open in a viewer) the next free ` (2)`, ` (3)`… name is used.

## 6. Migration from v2

At start-up, under lock `migrate`, if `backend/slide_builder_settings.txt` exists and
`data/migrated.json` does not:

* `app.design, glass, color, logo, pn` → `config.defaults.style`
* each `presets[wb]` → `workbooks/<key>.json` `preset` (cover/index slides keep their position)
* each `files[wb][sheet].cells` → `edits[sheet]`
* `app.lastFile, pdfMode` → `users/<current user>.json`
* documents that already exist are not overwritten; the old file is kept, renamed
  `slide_builder_settings.v2-backup.txt`; `migrated.json` records what was imported.

## 7. Front end modules (`frontend/src`)

| Folder | Content |
|---|---|
| `xlsx/` | workbook index + lazy sheet parser, styles/theme, number formats, conditional formats, drawings, table regions and layout (`buildLayout`) |
| `render/` | Excel design, scene model + Liquid Glass, wallpaper, slide composition, cover/index, page numbers, slide layout (bands) |
| `model/` | types, document operations (same semantics as §3.2), presets → runtime slides |
| `sync/` | API client (token), document sync (pending ops, polling, presence), offline store for `file://` |
| `editor/` | stage (imperative DOM, hit testing, selection, inline edit, table move/resize), keyboard |
| `ui/` | Preact components: top bar, ribbon, formula bar, thumbnails, issues, menus, dialogs, toasts |
| `wizard/` | 3-step wizard (sheets, tables, slides) and table detection |
