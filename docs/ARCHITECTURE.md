# Slide Builder 3 – architecture and API contract

This is the contract between the browser app (`app/`, built into
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
   ├─ slide_builder.html            the app (BUILT from app/)
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
├─ users/<user>.json           personal preferences                   {schema, lastFile, pdfMode, zoom, versions}
├─ presence/hb~<user>~<host>~<client>~<workbook>.json heartbeat     {user, host, client, workbook, at} (parts %-encoded; the name is enough)
├─ backups/<key>/<rev>.json    rolling copies of workbook docs (last 30, at most one per 5 min)
├─ backups/upgrades/<kind>/<file>.v<n>.<time>.json   a file as it was before a format upgrade (§3.3)
├─ backups/before-update-<time>/   saved setups copied by tools/update.py before an update (last 5)
├─ app-version.json            version installed by a ZIP update (tools/update.py)
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
| `slide.patch` | `id`, `patch` | on the slide with that id: keys `title, subtitle, date, note, logo, layout, align, valign, scale, subs`: `null` → delete, else set. Keys `notes`, `fmt` and `sizes` are **map merges** (see below). Other keys ignored. Unknown slide (or no preset) → op **skipped**. |
| `table.patch` | `id`, `patch` | on `doc.preset.tables[id]`: keys `name, gridH, gridV`: `null` → delete, else set; keys `cols`, `rows`, `scales`, `merges`, `sizes` are **map merges**. Other keys ignored. Unknown table (or no preset) → skipped. |
| `cell.patch` | `sheet`, `ref`, `patch` | on `doc.edits[sheet][ref]` (created if missing): for each key in `text, orig, font, sz, b, i, color, fill, bg, cf, align, role`: `null` → delete, else set. Then: if `text` is absent, delete `orig`; if no keys remain, delete the cell; if the sheet has no cells, delete the sheet. |
| `style.patch` | `patch` | on `doc.style`: keys `design, glass, color, logo, radius, contrast, logoBubble`: `null` → delete, else set; keys `pn`, `footer`, `theme`, `text`, `colors` and `designs` are map merges. |

**Map merge** (`pn`, `footer`, `theme`, `text`, `colors`, `designs`, `notes`, `fmt`, `sizes`, `cols`, `rows`, `scales`, `merges`): value `null` → delete the whole map; an object →
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
| `table.gridH` / `table.gridV` | `"on"` = a line at every row (H) / column (V) edge, `"off"` = none; unset = the borders from Excel |
| cell `cf` | conditional formatting copied with the format painter: `"Sheet!C6"` = the rules covering that cell, applied to this cell's value (relative references shifted like Excel); `"none"` = no rules |
| `slide.valign` | `"top"\|"middle"\|"bottom"` – vertical position of the tables in the content area (default: slightly above the middle) |
| `slide.subs` | index slide only: `false` hides the slide subtitles in the contents list |
| `style.theme` | `{id, c1, c2, c3, c4, a1, a2}` – colour theme: `id` names a built-in theme (`aurora`, `ocean`, `forest`, `sunset`, `graphite`, `intesa`) or `custom`, whose colours are c1–c4 (background) and a1/a2 (accents) |
| `slide.scale` | fixed table scale (null = fit to the slide); set by "Make same size" so tables on different slides match |
| `slide.sizes` | `{"glass"\|"excel"\|"clean": {layout?, scale?, align?, valign?}}` – table sizing of one design (map merge); over `slide.layout`/`slide.scale`, which older decks share between designs (raw Excel corrects a shared scale for the room the text boxes took). Moving, resizing, alignment, *Reset layout* and *Make same size* write the current design's entry only |
| `table.sizes` | `{"glass"\|"excel"\|"clean": {cols?, rows?}}` – column widths / row heights of one design (map merge), over `table.cols`/`table.rows` (older decks, shared). An entry, even empty, means the design has its own sizes |
| `slide.notes` | `{"<tableId>:<top\|bottom\|left\|right>": {text, size?, b?, i?, align?, valign?, bubble?, color?, w?, h?}}` – text boxes around a table: top/bottom as wide as the table, left/right as high |
| `style.radius` | corner roundness, % of the default (0–200, default 100) |
| `style.contrast` | contrast between background and glass surfaces (0–100, default 50) |
| `style.logoBubble` | `false` = logo without its glass bubble |
| `style.design` | `"glass"` (Liquid Glass), `"excel"` (pure Excel) or `"clean"` (Excel Refined) |
| `style.colors` | colour overrides over the theme: `{accent, bg, head, headInk, total, totalInk, ink, pos, neg, stripe, rule}` (hex); `palette()` in `model/style.ts` = theme defaults + these |
| `preset.versions` | `[{id, name, hide:{<sheet>: ["H10:I11", …]}}]` – named versions; the cells in `hide` are drawn empty in that version |
| `style.designs` | `{glass?, excel?, clean?: {theme?, colors?, text?}}` – a design's own look over the shared one (map merge per design) |
| `slide.notes["slide:notes"]` | the slide's notes section (a text box of the slide, `x/y/w/h`; default at the footer position) |
| `style.text` | deck text styles, one entry per kind of text: `{"title"\|"subtitle"\|"table"\|"note"\|"index"\|"pageno": {font?, size?, b?, i?, color?, align?}}` (size in slide px; `table` uses only `font`; `pageno` covers page numbers and footer and wins over the older `pn.font`) |
| `slide.fmt` | formatting of one slide's texts over the deck style: `{"title"\|"subtitle"\|"note"\|"date": {font?, size?, b?, i?, color?, align?}}` (`note`/`date` = cover note and date) |
| note `lh`, `pgap` | line spacing (1 = single) and space between paragraphs (in lines); `style.text.note.lh` sets the deck default |
| note `x`, `y` | a text box moved by the user: its top-left corner on the slide (slide px); with `w`/`h` it is drawn there and takes no room from the tables |
| note `span` | left/right box only: a column beside all the tables of the slide, as tall as all of them (tables use the remaining width) |
| note `auto` | automated comment settings `{mode?:"summary"\|"sections" (missing = sections), kinds?[], showTitle?, names?, bullets? (false = off), tables?[] (more table ids of the slide), groups[], title?, top, minAbs?, exclude?[], noun, detail:"full"\|"short", share, breadth, missing}`: the text is written from the table at render time (`model/comment.ts`, `render/comment.ts`); `text` is then empty |
| cell `font` / note `font` | font family chosen for a cell / text box (a library, Windows or Google font name) |

Any other op, or an op with missing/invalid fields, is skipped. If at least one op was applied:
`rev += 1`, `updated = now`, `updatedBy = user`. Field-level merging means two people editing
different cells, slides or style keys never lose each other's work; the same field → last write wins.

`config.json` accepts only `style.patch`, applied to `defaults.style`.

**Undo** on the client is the inverse operation computed from the values before the change, so it
never reverts somebody else's change.

### 3.4 Font library (`data/fonts/`)

Shared by everybody using the folder, independent of workbooks: `data/fonts/fonts.json`
`{schema:1, fonts:[{family, source:"upload"|"google", faces:[{file, weight, style, range?}], by, at}]}` plus the
font files (`<Family>-<weight>[i]-<sha1>.<ext>`). Written under the `fonts` lock; a file is written before the
index refers to it; files no family refers to are deleted. Google fonts are downloaded **by the page**
(latin + latin-ext subsets) and stored like uploads, so slides and exports never need Google later. Exports
embed the fonts a slide uses as data URLs. Code: `backend/slidebuilder/fonts.py`, `app/src/state/fonts.ts`.

### 3.3 Format versions and automatic upgrades

Every saved file has `"schema"`: the format it is written in. Current formats are `SCHEMA` in
`backend/slidebuilder/upgrade.py` (`workbook` 3, `config` 3, `prefs` 1); a file without the field is
the first numbered version of its kind. The helper is the only writer and stamps the current format on
every write.

* **Reading an older file** (`store._load`): take the file's lock (`wb-<key>`, `config`,
  `user-<name>`), re-read, copy the file byte for byte to
  `data/backups/upgrades/<kind>/<file>.v<old>.<YYYYMMDD-HHMMSS>.json` (never overwriting an earlier
  copy), apply the step functions `n → n+1` in order, write atomically, release. Concurrent readers on
  other PCs wait for the lock and then find the converted file, so each file is converted once.
  At start-up `store.upgrade_all()` converts every file; failures are logged and retried on the next read.
* **Reading a newer file** (written by a PC already running a newer version): nothing is written;
  `StoreTooNew` → HTTP 409 with "close Slide Builder and start it again".
* **Pages**: every POST/PUT carries `X-SB-Formats: workbook=3;config=3;prefs=1` (`FORMATS` in
  `app/src/model/types.ts`). If it differs from the helper's `SCHEMA` the request is refused with
  409 and the page shows "Slide Builder was updated – reload the page"; its unsent changes are not
  written in an old format. Requests without the header (pages built before this check) are accepted.
* **A missing step** (format raised without a step) raises an error and leaves the file untouched.

Changing the format: raise `SCHEMA[kind]`, add `@step(kind, n)` (convert the document in place), raise
`FORMATS`, add a test and a new example file in `backend/tests/fixtures/saved/` (old examples are never
edited: `test_upgrade.py` reads every one of them on each run). Adding an optional field does not need
a new format – readers ignore unknown keys and treat missing keys as defaults.

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
| `GET /api/files/<name>/stat` | – | `{name, mtime, size}` of one workbook (one stat; 404 when gone) |
| `GET /api/ping` | – (no token) | `{app, version}` – used by the “already running” probe |
| `GET /files/<name>` | – | workbook bytes (workbook extensions only); headers `X-SB-Mtime`, `X-SB-Size`. Read is stable: retried while size/mtime change or the zip is incomplete; 503 if still changing. |
| `GET /api/workbooks/<name>/doc?since=<rev>` | – | `204` when `doc.rev == since`, else `{doc}` |
| `POST /api/workbooks/<name>/ops` | `{ops, client}` | `{doc, applied, skipped:[index…]}` |
| `GET /api/workbooks/<name>/history` | – | `{backups:[{rev, updated, updatedBy}]}` |
| `POST /api/logo?name=` | picture bytes (≤ 10 MB, PNG/JPG/GIF/WEBP/BMP) | `{name}` – saved in `data/assets`; `/assets/<name>` looks in data/assets, backend, the main folder (any case) |
| `GET /api/fonts` | – | font library `{schema, fonts:[…]}` (§3.4) |
| `POST /api/fonts?family=&weight=&style=&source=&name=&range=` | font file bytes (≤ 15 MB; TTF/OTF/WOFF/WOFF2 checked by signature) | font library |
| `DELETE /api/fonts?family=` | – | font library |
| `GET /fonts/<file>` | – (token header or `?t=`) | a font file |
| `POST /api/presence` | `{client, workbook}` | `{others:[{user, host, client, workbook, at}]}` – others seen in the last 25 s |
| `POST /api/presence/leave` | `{client}` | `{ok}` |
| `GET /fieldcheck` (no token) | – | `tools/fieldcheck.html`: the field-test page of the browser's capabilities, on the app's origin |
| `POST /api/upload?name=` · `GET /api/upload/<id>` | bytes | `{id, name}` · bytes (in memory, max 8 entries, 2 h) |
| `POST /api/convert-workbook?name=` | bytes | `.xlsx` bytes (Excel COM, Windows) or 501 |
| `POST /api/convert?ext=` | bytes | PNG bytes (GDI+, Windows) or 501 |
| `POST /api/export` | `{name, format:"pdf"\|"png", mode:"exact"\|"vector", css, slides[], names[], scale, inline?, all?}` | `{ok, files[], engine, seconds}` or `{ok, images[]}` (inline). 503 when no engine works. Pages are 1600 × 900 CSS px, unscaled (`engines.EXPORT_CSS`); each engine's output passes `engines.check_output` (page count, 16:9 boxes – rounding trimmed by `pdf.pdf_fit_pages` –, picture sizes) and the layout check `GEOMETRY_JS`, else the next engine renders it. |
| `POST /api/assemble` | `{name, images[]}` (JPEG data URLs) | `{ok, files[]}` |
| `POST /api/open` | `{name}` or `{folder:true}` | `{ok}` |
| `POST /api/engine/restart` | – | `{ok}` |
| `POST /api/engine/install` · `GET /api/engine/install` | – | `{running, done, ok, lines[]}` |
| `GET /assets/<name>` | – | image bytes (image extensions only) from `backend/`, then ROOT |

Status codes: 400 bad request · 403 Host/token/Origin or file type · 404 · 409 format mismatch (a file newer than this helper, or a page built for other formats – §3.3) · 411/413 body · 501 converter
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

## 7. Front end modules (`app/src`)

See `README.md` §5 for the module-by-module description (xlsx, model, render, sync, state, editor, ui, wizard, styles).
