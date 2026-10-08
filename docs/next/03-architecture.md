# 03 · Target architecture (Slide Builder 4)

**One sentence.** The deployment stays the same: a browser page served on `127.0.0.1` by a Python
standard-library helper, with the share as the only channel between PCs. Everything else changes:
* one TypeScript **core** runs in Web Workers;
* it reads workbooks into a compact columnar model, cached on the share;
* it draws every slide into a **display list**;
* the display list is rendered on screen as SVG, to PNG with a canvas, and to PDF by **our own PDF
  writer**;
* documents are stored as a **snapshot plus one append-only journal per writer**, so saving needs no lock.

There is no headless browser, no new executable, and no second implementation of anything.

Decisions are argued in `02-options.md` and recorded one by one in `adr/`. This document specifies the
result: sections §1–§6 match points 1–6 of the brief. Storage details are in `04-data-and-migration.md`.

---

## 1. Processes, languages, libraries, packaging, distribution

### 1.1 What runs where

```
 PC of a user (no admin, nothing installed beyond Python 3.8+ and Edge)
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Edge (app window: msedge --app=http://127.0.0.1:<port>/ ; falls back to the default browser)          │
│ ┌─ UI thread ──────────────────────────────┐  ┌─ core worker (×1) ────────────────────────────────┐  │
│ │ React 19 app (top bar, ribbons, dialogs, │  │ xlsx reader → SheetStore (columnar)               │  │
│ │  wizard) · Stage: SVG from display lists │◄─┤ preset → TableLayout → effItems → design → Scene  │  │
│ │  + DOM overlays (selection, handles,     │  │ → DisplayList (per table, cached)                 │  │
│ │  inline editors) · DocSync (ops, undo)   │─►│ text: HarfBuzz hb.wasm shaping + font metrics     │  │
│ └──────────────┬───────────────────────────┘  │ comments, versions, layout (computeLayout)        │  │
│                │                              └───────────────────────────────────────────────────┘  │
│                │                              ┌─ export worker(s) (×1–3, on demand) ──────────────┐  │
│                │                              │ DisplayList → PDF writer (hb-subset.wasm fonts)    │  │
│                │                              │ DisplayList → OffscreenCanvas → PNG                │  │
│                │                              └───────────────────────────────────────────────────┘  │
│                │ HTTP 127.0.0.1 + token (same security model as v3)                                   │
│ ┌──────────────┴──────────────────────────────────────────────────────────────────────────────────┐ │
│ │ helper: python app\<ver>\helper\slide_builder.py   (standard library only, ~2 500 lines)          │ │
│ │ static files · storage primitives (journal append/read-from, snapshot CAS, locks, presence)       │ │
│ │ workbook stable read + (M6) parsed-sheet cache · font library (+ system font capture) ·          │ │
│ │ export file save (atomic, " (2)") · Excel COM / GDI+ conversion · update / self-test              │ │
│ └──────────────┬──────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────┼─────────────────────────────────────────────────────────────────────────────────────┘
                 │ SMB (the only channel between PCs)
┌────────────────┴─────────────────────────────────────────────────────────────────────────────────────┐
│ T:\Slide Builder\   *.xlsx (never written) · export\ · app\<version>\ (program) · app\current.json        │
│ backend\data\  (v3 files, kept and still valid)  ·  backend\data\v4\decks\<key>\{snapshot, j\, presence\} │
│                 · backend\data\v4\cache\<sheet-part-crc>.sbc · fonts\ (shared with v3)                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Process | Language | Responsibility | Never does |
|---|---|---|---|
| UI thread | TypeScript + React 19 + Zustand | input, selection, overlays, chrome, drag previews (pure layout functions), mounting SVG produced from display lists; holds a read-only mirror of the document view | parse, measure text, write PDF, own the document |
| core worker | TypeScript (+ `hb.wasm`) | **own the document** (DocSync, undo stack) and the workbook; read workbooks, keep the SheetStore, resolve presets, lay out tables and slides, measure and shape text, build scenes and display lists, write automated comments | touch the DOM or the network except via the helper API |
| export worker | TypeScript (+ `hb-subset.wasm`) | PDF and PNG from display lists | anything stateful |
| helper | Python ≥ 3.8 stdlib | files on the share, locks, presence, conversions, update | apply or interpret operations (the TypeScript core is the only implementation) |

### 1.2 Runtime dependencies (all bundled into the page; nothing is installed on the PC)

| Dependency | Version (pin) | Licence | Size in bundle | Why |
|---|---|---|---|---|
| react, react-dom | 19.x | MIT | ≈ 60 KB gzipped | the UI (ADR-012); replaces Preact 10.29 |
| zustand | 5.x | MIT | ≈ 1 KB | UI store with selectors; replaces the global `S` + `emit()` |
| fflate | 0.8.2 | MIT | 9 KB (inflate + deflate) | synchronous zip read in workers (replaces JSZip, which is MIT-or-GPL and async-only); deflate for PDF streams and cache files |
| harfbuzzjs: `hb.wasm`, `hb-subset.wasm` | 0.4.12 (HarfBuzz 11.x) | MIT (HarfBuzz: "Old MIT") | 371 KB + 608 KB | identical text shaping for layout, screen and PDF; font subsetting for TrueType **and** CFF; instancing of variable fonts to static ones (§2.5) |
| *(dev only)* vite, vite-plugin-singlefile, typescript, vitest, @playwright/test | as today | MIT / Apache-2.0 | – | build and tests; never on users' PCs |

Removed dependencies:
* **from the page:** JSZip;
* **from the helper:** Playwright (optional pip), the Chrome for Testing download, `engines.py`, `cdp.py`,
  `pdf.py`, `installer.py`'s engine part;
* **from the share:** the `engine\` folder.

The helper keeps **zero** third-party Python packages.

### 1.3 Packaging

* **The page** is still one self-contained HTML file. The workers are inlined as Blob-URL scripts and the
  WASM as base64. This keeps the emergency `file://` mode working: Chromium refuses to start workers or
  fetch WASM from `file://` URLs, but accepts Blob URLs. Expected size is about 1.9 MB (about 0.6 MB
  gzipped on the wire, which is irrelevant on localhost).
* **The build is no longer committed.** CI (GitHub Actions) builds on every tag:
  * it runs all unit, parity and e2e tests;
  * it produces `slidebuilder-<version>.zip` = `{page/slide_builder.html, helper/**.py, tools/update.py,
    *.bat, MANIFEST.json (sha256 of every file)}`.

  The repository holds only sources (fixes pain point P8).
* **Signing.** There is no native code, so there is nothing for Authenticode, AppLocker, WDAC or antivirus
  executable heuristics to judge.
  * Integrity is checked by the updater: it compares the downloaded ZIP's SHA-256 with the `digest` that
    the GitHub Releases API returns for the asset, over TLS with the Windows trust store. It then checks
    every file against `MANIFEST.json`.
  * If the organisation later wants signed releases, a detached signature can be added. Python's stdlib
    has no Ed25519, so this would need a vendored pure-Python verifier (about 200 lines, public domain
    reference code); it is not needed for the first release.

### 1.4 Distribution and updates (no admin rights, same friction as today)

```
T:\Slide Builder\
├─ Start Slide Builder.bat        reads app\current.json → python app\<ver>\helper\slide_builder.py
├─ Update Slide Builder.bat       python app\<current>\tools\update.py  (or tools\update.py of v3 the first time)
├─ app\
│  ├─ current.json                {"version": "4.0.3", "previous": "4.0.2"}   (atomic replace)
│  ├─ 4.0.2\  4.0.3\              complete, immutable program folders (last 3 kept)
└─ backend\                       v3 program + data (kept; v3 stays startable during coexistence)
```

`tools/update.py` (rewritten, stdlib) works like this:
1. It takes the `update` lock (as today).
2. It finds the release: the latest by default, or `--version` / `--channel beta`.
3. It downloads with `urllib` and the system trust store, so the corporate root CA works. TLS verification
   is never disabled.
4. It verifies the SHA-256 and the manifest.
5. It unpacks to `app\<ver>.part\`, then renames that to `app\<ver>\`.
6. It runs `python app\<ver>\helper\slide_builder.py --selftest`. The self-test:
   * imports the helper;
   * reads every saved deck **read-only** through the new code;
   * parses every `backend/tests`-style fixture shipped in the ZIP;
   * checks that the share accepts an append and a rename.
7. It writes `app\current.json` atomically, keeping the previous version.
8. It tells everybody, through a one-line `app\notice.json` that running pages show, to restart and reload.

Rollback is `Update Slide Builder.bat --use 4.0.2`, which flips the pointer and needs no download. If
GitHub is unreachable, an admin-free manual path exists: copy a release ZIP to the share and run
`Update Slide Builder.bat --zip file.zip`. The ZIP mode already exists today (`tools/update.py:286`).

### 1.5 Start-up

`Start Slide Builder.bat` → helper:
1. It finds a free port from 8765 (as today). If a v4 helper already answers, it opens the browser and
   exits.
2. It opens the page:
   * **preferred:** Edge as an app window, `msedge.exe --app=http://127.0.0.1:<port>/?t=…`. This starts a
     normal Edge (no DevTools, no headless, no extra policy surface). It looks like an application, and
     the token stays out of the visible URL bar;
   * **fallback:** `webbrowser.open`.
3. There is no export-engine warm-up, so it is ready in under 1 s (§6.3).

The helper's HTTP security model is unchanged: Host/Origin checks, the token, body limits, and serving only
known paths (`server.py`, README §13).

---

## 2. Core data model

### 2.1 One canonical definition

* **`core/model/types.ts`** is the single source of truth. It holds the v3 types moved unchanged
  (`frontend/src/model/types.ts`), extended only by optional fields. **`core/model/ops.ts`** keeps the v3
  semantics (`ops.ts:20-115`) with no change of meaning, and is the **only** implementation.
* The helper no longer applies operations. It stores records, and the core folds them (§3 and 04 §2).
  That deletes `backend/slidebuilder/ops.py` and the duplicated key lists. `shared/ops-vectors.json` stays
  as the regression suite for the TypeScript implementation.
* `tools/gen-schema.ts` generates a JSON Schema from the types, used for three things:
  1. validation of every document read (an invalid field is dropped and reported, never fatal);
  2. the documentation tables in ARCHITECTURE;
  3. a Python-side **shape** check in the migration/self-test. This check reads only; it never merges.

**The document shape is unchanged.** A v4 snapshot's `doc` is byte-compatible with a v3 workbook document:
the same `preset`, `style` and `edits`. This is what makes migration and rollback lossless (04 §4).

### 2.2 Operations and merge semantics (unchanged meaning, new transport)

| Item | v3 | v4 |
|---|---|---|
| Op types | `preset.set`, `slide.patch`, `table.patch`, `cell.patch`, `style.patch` | same, same keys, same map-merge rules |
| Who applies | page (optimistically) **and** helper under the lock | page only (core worker and UI thread share `ops.ts`) |
| Order of concurrent ops | arrival order at the lock | **Lamport order** `(lamport, writer, seq)`: deterministic on every PC, no clocks needed |
| Same field at the same time | later write wins (arrival) | later write wins (Lamport order) |
| Undo | inverse ops of my own changes | same (`inverseOf`), applied as new ops |
| `rev` | +1 per applied batch | `rev` = number of folded records (snapshot rev + journal records): still monotonic and still shown |
| `updated` / `updatedBy` / `log` | written by the helper | carried in each record (`by`, `at` = file-server clock from the helper) and derived on fold |

A **record** is the unit a writer appends:

```jsonc
{"l": 812, "w": "anna@PC123#k3f9", "s": 57, "by": "anna", "at": 1791214363000, "ops": [ … ]}
```

* `l` is the Lamport counter: `max(all l seen) + 1`.
* `w` is the writer id: user, host and a random id per page session.
* `s` is the writer's sequence number.
* `at` is the file-server time; the helper stamps it, using the mtime probe of `fsclock.py`.

### 2.3 Workbook model in the core (SheetStore)

v3 creates one JS object and one string key per cell (`workbook.ts:296`). That costs 242 MB for 1.56 M cells
(01 §3.1). v4 keeps a sheet as **columns of typed arrays**:

| Column | Type | Content |
|---|---|---|
| `row`, `col` | `Int32Array`, `Int16Array` | sorted by row, then column; row index = an offset table, so `cellAt` is O(log n) |
| `kind` | `Uint8Array` | blank, number, shared-string, inline-string, bool, error, date |
| `num` | `Float64Array` | numbers and dates (serials) |
| `str` | `Int32Array` | index into the workbook string table (shared strings + inline strings) |
| `xf` | `Uint16Array` | style index (styles stay objects: there are few) |
| `runs` | sparse `Map<cellIndex, Script[]>` | rich-text superscripts/subscripts only |

Row and column info, merges, CF rules and drawings stay as small object arrays, exactly as v3 reads them.
v3's `Sheet` interface (`xlsx/types.ts:36-63`: `cellAt`, `colPx`, `rowPx`, `xfAt`, …) is kept as an
**accessor facade** over the columns. `buildLayout`, `findRegions`, `evalCF`, `formatValue`, the wizard
detector and the comment analysis therefore run **unchanged**. They are moved, not rewritten.

Measured in `spikes/parser` on one 75.7 MB sheet: a single byte-level pass into these columns takes
**303 ms**, versus 3 148 ms for the v3 regex loop, and uses 26.5 MB versus 242 MB.

### 2.4 Scene model and display list (shared by screen, PNG and PDF)

The design pipeline:

```
TableLayout + effItems ──► design ──► Scene ──► DisplayList ──┬─► SVG (stage, thumbnails at zoom)
                       (excel | glass)  (glass: containers,     ├─► Canvas2D (thumbnails, PNG, clipboard)
                                         roles, signals…)       └─► PDF writer
```

* **The Scene** for Liquid Glass is today's structural model. `buildScene` and `inferRoles` move unchanged:
  containers with kind/depth/fill class, rules, texts with roles, signals, media. For Excel and Excel Refined
  the scene is simply the item list. **What changes is the last step.** `renderGlass` / `renderExcel`
  (which emit HTML strings + CSS classes) become `glassToDisplayList` / `excelToDisplayList`. These emit
  geometry with resolved paint, **in slide pixels after layout**.
* **The DisplayList** is a flat, serialisable array (transferable between workers), built from 8 node
  types:

| Node | Fields | Used for |
|---|---|---|
| `rect` | x, y, w, h, r (corner radius, or 4 radii), fill: Paint, stroke?: Stroke | cell fills, borders as thin rects, cards, capsules, chips, bands, page-number capsules |
| `path` | d (move/line/cubic/close), fill?, stroke? | shapes from the workbook, rotated text boxes, dotted leaders, slanted borders |
| `line` | x1, y1, x2, y2, stroke (width, dash, cap) | Excel borders (thin/medium/thick/dashed/dotted/double/hair), hairlines, accent rules |
| `image` | id (content hash), x, y, w, h, crop?, rotation?, alpha? | workbook pictures, logo, wallpaper, blurred wallpaper |
| `shadow` | rrect, dx, dy, blur, spread, colour, alpha | soft shadows of cards and capsules (§4.3) |
| `text` | font id, size, glyph run (gid[], x advances), x, y baseline, fill, decoration?, `src` (the Unicode string, for selection/search) | every text: cells, titles, text boxes, comments, page numbers, footer |
| `group` | clip? (rrect/rect), alpha?, transform?, children | glass cards (clip + blurred wallpaper), rotated cells, text overflow clipping, opacity |
| `hit` | kind, id, rect | invisible: table/cell/text-box regions for the editor's hit testing (ignored by PNG/PDF) |

`Paint` takes one of three forms:
* `{solid: rgb, a}`;
* `{linear: [x0, y0, x1, y1] in the unit box, stops: [{o, rgb, a}]}`;
* `{radial: …}`, for the cover's glass shapes.

That is the whole contract. Every backend implements those 8 nodes, and nothing else may reach them, so no
CSS feature can sneak in that the PDF cannot draw. This removes `printcss.ts` and `slide.css` as an export
contract (README §14 gotchas 2 and 3), along with `placeGlass`.

### 2.5 Fonts

Every text is drawn from a **font file** the core knows by content hash. The files come from three sources:
1. **The shared library**, `data/fonts/` as today (`fonts.json` schema 1, unchanged), with uploads and
   Google fonts. **Variable fonts** are instanced on add, one static file per used weight/style, with
   `hb-subset` and all axes pinned. Measured in `spikes/fonts`: the variable tables (`fvar`, `gvar`,
   `HVAR`, `avar`) are removed. So no PDF ever contains a variable font or a Type 3 font.
2. **Windows fonts used by a workbook or a deck**: Calibri, Aptos, Segoe UI, Arial, Century Gothic, … The
   helper reads them from `C:\Windows\Fonts` (`GET /sysfonts/<name>`). The first time a deck uses one,
   **the exact file is copied into the library** as `fonts/system/<family>-<sha1>.ttf` with
   `source:"system"`. Every PC then lays out with the same bytes, even if its Windows has a different
   build of Calibri, or no Aptos.
   * Embedding permission: the `OS/2.fsType` bits are checked; restricted fonts fall back.
   * Copying Microsoft fonts to an internal share for use on licensed Windows PCs needs a one-line
     confirmation from the bank's software-licence owner (risk R7 in `06-plan.md`).
3. **The Liquid Glass UI font**: **Segoe UI (static)**, captured like (2). This is a visible change
   (behaviour change B2): the screen today uses *Segoe UI Variable* on Windows 11 while the PDF already
   falls back to classic Segoe UI (`printcss.ts:50`). Screen and PDF now agree.

### 2.6 Text measurement: identical on screen and in the PDF

1. **The core measures; the browser never does.**
   * The core shapes every string with HarfBuzz (`hb.wasm`). It uses the font file, default features
     `kern` and `liga` (on, as in Excel/Chrome today), and the size in slide px.
   * This yields glyph ids and advances.
   * Line breaking (wrap in cells, text boxes, comments), alignment, overflow, `fitNotes` shrinking and
     Glass column widening are all computed from these advances. The widening becomes a real measurement
     instead of `chars × .56` (`glass.ts:44`).
   * Excel's column width formula keeps the *workbook default font's* max digit width, now taken from that
     font file's `hmtx` instead of a canvas (`workbook.ts:169-176`). It is therefore the same on every PC.
2. **The PDF** draws the glyph ids with the advances from the display list (`TJ` adjustments are emitted
   only where HarfBuzz's advance differs from the font's `hmtx` width, i.e. kerning), with ToUnicode.
   Positions are exactly the core's.
3. **The screen (SVG)** draws `<text x y textLength=W lengthAdjust="spacing">` with the same font loaded
   via `FontFace` from the same bytes.
   * Within a run, Chrome shapes with its own HarfBuzz on the same file with the same features, so glyphs
     coincide.
   * `textLength` pins the run's total width to the core's value, so any sub-pixel difference in Chrome's
     advances (hinting, rounding) cannot move a line end, a right alignment or a wrap.
   * Runs are short (cells), so a residual drift inside a run is below 0.1 px.
   * **Fallback, switchable per font:** draw glyph outlines as cached `Path2D`/`<path>` (`hb_font_draw`).
     It is exact by construction and is used if the parity test (05 §3.4) finds a font where Chrome's
     shaping differs.
4. **Canvas (PNG, thumbnails)** uses the same `FontFace` and draws each run with `fillText` at the
   display-list position, with `letterSpacing` set to the measured difference.

---

## 3. Storage and concurrency on SMB (summary; specification in 04 §2)

Each deck has a folder:

```
data/v4/decks/<key>/            <key> = v3 doc_key(name) (util.doc_key, unchanged)
├─ snapshot.json                {format:4, gen, workbook, lamport, frontier:{<writer>: <bytes>}, rev, doc:<v3 document shape>}
├─ j/<writer>.log               append-only, one writer: records framed "<len>:<crc32>:<json>\n"
├─ presence/<user@host#client>  empty heartbeat file; age = its mtime on the server (no reads)
└─ lock                         O_EXCL lock file, used only for compaction (v3 locks.py protocol)
```

* **Saving (hot path)** appends one record to the writer's own journal, using a handle kept open, plus
  `FlushFileBuffers`. That is **two round trips, no lock, independent of the number of users**.
  Measured: 32 ms at 15 ms per operation, 82 ms at 40 ms, p95 96 ms, with 20 users.
* **Seeing others.** Every 1.5 s the helper reads only the **new bytes** of each other journal: open, seek
  to the remembered offset, read. The reads run in parallel (up to 8). A torn tail (incomplete frame or
  CRC mismatch) is left for the next poll.
* **The view** is computed by the core: fold the snapshot, then the journal records not in its frontier,
  sorted by `(l, w, s)`; then the local inflight and pending ops. This is the v3 rebase
  (`docsync.ts:158`), with a deterministic order instead of the lock's arrival order.
* **Compaction** runs off the editing path and is triggered by whichever page sees more than 2 000
  un-compacted records or journals older than 24 h:
  1. take the deck lock (the v3 `Lock`, unchanged);
  2. re-read everything;
  3. fold, then write `snapshot.json` (temp, fsync, rename) with `gen + 1` and the new frontier;
  4. release the lock.

  A writer whose journal is fully covered by the frontier rotates to a new journal file and deletes the old
  one. Nobody else ever deletes a journal that might still be open.
* **Crash safety.** A record is acknowledged only after the flush. A torn tail is ignored forever, because a
  crashed writer never appends again (a new session means a new file). Snapshots use temp + rename.
  **"Unreadable is never empty"** holds as in v3: a snapshot that cannot be parsed → 503 and retry.
* **Clock skew** cannot reorder edits, because ordering is Lamport. Wall-clock values (`at`, presence
  age, stale locks) use the file-server clock exactly as v3's `fsclock.py`.
* **Worst case**, from the simulation (`spikes/storage/sim-results.json`), with every round trip charged,
  including reads and writes on open handles:

| Users on one deck | fs ms | save p50 / p95 | others see an edit after p50 / p95 | lost | converged | v3 today (01 §3.3) |
|---|---|---|---|---|---|---|
| 10 | 15 | 32 / 37 ms | 1.1 / 1.9 s | 0 | yes | 0.26 / 0.9 s save, 1.4 / 2.8 s visible |
| 10 | 40 | 82 / 95 ms | 1.3 / 2.3 s | 0 | yes | 1.8 / 7.5 s save, 7.0 / 16.1 s visible |
| 20 | 15 | 32 / 37 ms | 1.2 / 2.1 s | 0 | yes | 1.4 / 5.3 s save, 4.5 / 10.1 s visible |
| 20 | 40 | 82 / 96 ms | 1.8 / 3.1 s | 0 | yes | 3.8 / 9.1 s save, **12.0 / 27.9 s visible, 20 × 503** |

* **Polling cost on the server**, at 20 users and 1.5 s: each PC opens 19 journals, about 250 small reads
  per second in total. A Windows file server handles tens of thousands. v3's `/api/files` read every deck
  document every 6 s; v4 replaces it with **one directory listing** of `data/v4/decks/*/snapshot.json`
  mtimes, every 30 s, and only while the Open menu is visible.
* **Change notification.** `ReadDirectoryChangesW` on the deck's `j/` folder is called through `ctypes`
  (stdlib) as a **wake-up hint** that triggers an immediate poll. SMB2 CHANGE_NOTIFY is supported by
  Windows file servers, but it is unreliable on some NAS firmware and through DFS, and events can be
  coalesced. Polling therefore remains the source of truth. The feature ships disabled and is turned on
  after the field test (PLAN S0.6, S6.3).

---

## 4. Rendering pipeline

### 4.1 Stages, caches and incremental updates

| Stage | Input → output | Cache key (invalidated by) | Where |
|---|---|---|---|
| R1 read | `.xlsx` bytes → SheetStore per sheet | zip central directory: **CRC-32 + size of each sheet part** (+ sharedStrings, styles) | core worker. **M6, if field measurements need it** (ADR-008): parsed sheets are written to `data/v4/cache/<crc>-<size>.sbc` (deflated columns, 3.1 MB for the 75 MB sheet, loads in 205 ms); the next user, or the same user tomorrow, skips parsing. Unchanged sheets of an edited workbook keep their cache |
| R2 resolve | preset table def + sheet → `TableLayout` | v3 `LCACHE` key + growing-range end | core |
| R3 effective items | layout + edits/version/scales/merges → items | v3 `tableKey` (`render/context.ts`), extended with the font hashes | core |
| R4 design | items → Scene → table display list (in table px) | `design + glass level + tableKey` (as `tableHtml` today, `slide.ts:175-181`) | core |
| R5 slide | table DLs + `computeLayout` + title/cover/notes/comments/page number/footer/logo → slide DL (slide px) | slide cfg + table keys + layout | core |
| R6 present | slide DL → SVG `<g>` per table and per slide element | identity of the table DL | UI thread: only changed `<g>`s are replaced (as `refreshStage`/`patchTable` today) |

**An edit, end to end.**
1. Keypress, then op, then the UI applies it locally (v3 `DocSync.apply`).
2. The core receives the op (a structured-clone message) and recomputes R3–R5 for the touched table only.
3. The core returns the new table DL (about 20–60 KB for a 2-table slide) and the changed slide-level nodes.
4. The UI swaps one `<g>`.

The target is under 50 ms from keypress to pixels (§6.3), against about 100–300 ms per edit render today
(LOADTEST §3). Comments are recomputed for the slides whose tables changed, as today (`slide.ts:102`).

### 4.2 The three designs, with one set of geometry rules

* **Geometry is design-independent and computed once.** That means `computeLayout`, per-design sizing
  (`sizingOf`), text boxes, the notes section and page numbers. It is the v3 code
  (`render/slide.ts:21-173`), moved as is.
* **Excel and Excel Refined** map each item to nodes:
  * a fill → `rect`;
  * each border side → `line`, with Excel's styles mapped to width and dash (`hair` 0.5 px, `thin` 1 px,
    `medium` 2 px, `thick` 3 px, `dashed` [3,1], `dotted` [1,1], `double` = two lines, …);
  * text → `text`, in a `group` clip when the text overflows into empty neighbours;
  * rotation → `group` transform.
* **Liquid Glass** uses the v3 Scene, with the material decisions of `renderGlass` (`glass.ts:386-431`)
  kept as they are. What changes is how each material is expressed: instead of a CSS class, each one
  becomes a fixed recipe of nodes (§4.3).

### 4.3 Liquid Glass in vector PDF without rasterisation

| Glass element (v3 CSS) | Display list recipe | In the PDF |
|---|---|---|
| Wallpaper (`--wall`, a canvas JPEG today) | `image wall` full slide | **one** JPEG XObject per document (≈ 176 KB at q .94), referenced by every page. It is a picture by nature: blurred ribbons and grain have no vector form |
| Frosted glass (`--wallblur` positioned per element by `placeGlass`) | `group{clip: rrect}` → `image wallblur` at the lens transform (`LENS = 1 + .06·gi`, the v3 formula) | **one** 800 × 450 JPEG XObject (≈ 12 KB) drawn under each card's clip: a vector clip of a shared image. Not a raster per card |
| Tint and veil (`linear-gradient` with alpha, `--tint`, `--gfade`) | `rect` fill `linear` with alpha stops | axial **shading** with a luminosity **soft mask**, both defined in the unit box and **shared by every shape with the same gradient style** (spike: 2 shading/mask pairs serve 6 000 capsules) |
| Rim (gradient ring cut with `mask-composite`) | `rect` stroke 1.25 px, per-side colours approximated by a 2-stop gradient stroke | stroked path with a shading pattern (or 4 straight segments). Same as `PRINT_CSS` today, but on screen too |
| Soft shadow (`box-shadow 0 22px 48px -24px`) | `shadow` | **6 sharp rounded rectangles** of 1/6 alpha each, growing over 60 % of the blur (v3's `vectorShadow`, `printcss.ts:22-48`, with STEPS = 6). **The screen draws the same 6 layers**, so screen and PDF agree. Option: SVG `feGaussianBlur` on screen only, if users prefer the softer look (behaviour change B3) |
| Capsules (signals, colour scales) | `rect` r = h/2, linear alpha fill; `shadow` when solid | shared shading + mask; one shadow ExtGState |
| Hairlines and accent rules (`.hsep`, `.vsep`, `.rule.accent`) | `rect` 1 px with a 4-stop horizontal gradient (fade at the ends) | shared shading |
| Tinted blocks (`tintGrad`) and deep ink (`deepInk`) | colours computed exactly as v3 (`glass.ts:371-374`) | solid or shared shading |
| Text with `text-shadow` (strong capsules) | `text` twice (offset 1 px, alpha .2), then the text | two text runs |
| Icons (round badges), keyed white-background pictures | `group{clip: circle}` + `image`; keyed copy = image with alpha | image XObject + SMask, once per picture |
| Cover glass shapes, logo bubble, index chips | `rect`/`path` with `radial`/`linear` fills | radial/axial shadings |

Measured in `spikes/pdfwriter` on the 20-slide deck, with every one of these elements on every slide:

| | Time to build the display lists and write the PDF | Size | Per page | Viewer cost (PDFium, per page) |
|---|---|---|---|---|
| Glass, native writer | 96–139 ms | 597 KB | 29 KB | 108 ms |
| Glass, v3 via Chrome | 9.4–10.7 s | 24.7 MB | 1 204 KB | 766 ms |
| Excel, native writer | 37–82 ms | 142 KB | 6.9 KB | 7 ms |
| Excel, v3 via Chrome | 2.2–2.5 s | 2.7 MB | 134 KB | 15 ms |

The spike's slides are not pixel copies of v3's: they approximate the layout by hand. They contain the same
number and kinds of primitives, so size and time are representative. Fidelity is the job of the parity
harness (05).

---

## 5. Export engine

### 5.1 Flow (all in the page; the helper only saves bytes)

1. The user picks *Export ▾ › …*, as today (EX-01…EX-11 in 05).
2. The UI flushes pending ops (as today) and sends `{designs, versions, slides, mode}` to an export worker.
   Up to 3 workers run in parallel for "every version × every design".
3. Each worker asks the core for the slide DLs of `(design, version)`. They are cached when they match the
   screen; otherwise they are built with that design's sizing (`slidesFor(design)` today).
4. The worker writes the PDF:
   * images are de-duplicated by content hash;
   * fonts are subset per document (`hb-subset`, TrueType or CFF kept as is, `FontFile2`/`FontFile3`,
     Identity-H + ToUnicode);
   * streams use Flate (fflate);
   * the page is `MediaBox [0 0 1200 675]` with `cm 0.75 0 0 -0.75 0 675`, so the slide fills the page by
     construction. There is no marker, no fitting and no geometry check.
5. `POST /api/export-file?name=<file>` with the bytes. The helper writes them with the v3 `save_export`
   (temp, lock `export-<name>`, rename, ` (2)` when the target is open; `exports.py:40-58`).
6. PNG and clipboard: the worker renders the DL on an `OffscreenCanvas` at the chosen scale and returns PNG
   bytes. The clipboard uses `navigator.clipboard.write` with a `ClipboardItem`.
7. **"PDF as pictures"** becomes PNG pages at 2× (3 200 × 1 800), Flate-compressed in the PDF, with the
   file name "(images)" as today. It takes about 4 s for 20 slides instead of 90 s, and ≈ 15 MB instead
   of 125 MB. The fidelity reason for this mode, Chrome vector artefacts, disappears, so it is kept only
   for compatibility.

### 5.2 Budgets

| Budget | Target | Spike evidence |
|---|---|---|
| 20-slide deck, one design, click → file saved | **< 2 s** (target 1 s) | writer 0.1 s; DL build is part of the 0.1 s; save 20 MB/s on SMB ≈ 0.05 s |
| "Every version × 3 designs", 2 versions × 20 slides | < 4 s | 6 PDFs × ~0.2 s, parallel |
| Excel slide | **< 40 KB** (hard limit 150 KB) | 6.9 KB |
| Liquid Glass slide | **< 80 KB** + 190 KB once per document for the wallpaper pair (hard limit 400 KB) | 29 KB + 188 KB |
| Pictures in a PDF | only workbook pictures, the logo and the two wallpapers | 2 images in the Glass spike, 0 in Excel |
| Fonts | TrueType/CFF subsets, **never Type 3, never variable** | Type0/CIDFontType2 in the spike |
| Viewer | < 150 ms per Glass page in PDFium | 108 ms |

### 5.3 Verifying screen = PDF

Details are in 05 §3.4. In short:
* The display list **is** the comparison point: screen and PDF are two renderings of one DL.
* The harness renders the PDF page with PDFium and the SVG stage with Chromium at the same scale, and
  compares them with a perceptual diff. Tolerance is ΔE < 2 on 99.5 % of pixels; anti-aliasing differences
  are masked by a 1 px dilation.
* Text positions are compared as data: every PDF `TJ` run's origin, read back with `pypdf`, must match the
  DL text node to within 0.05 pt.
* It runs in CI for every fixture × design × version. Acrobat is checked manually once per release on
  Windows (PLAN S3.8, W14).

---

## 6. Editor UX

### 6.1 What stays

The whole interaction model stays:
* the 4-step wizard;
* the unified text toolbar, with its principle of **one toolbar, any text target, the same apply/clear
  interface** (`editor/textfmt.ts`);
* Excel-like selection and keys (KB-01…KB-25);
* table handles, text-box snapping, Design… and Text styles, the comment dialog, versions, the export menu,
  presence, own-changes-only undo.

The components in `ui/` and `wizard/` are ported to React 19 (same JSX and hooks), with a selector-based store; only their state access and their calls into the renderer change (ADR-012, PLAN M1).
This is a rebuild of the engine, not a redesign of the product.

### 6.2 What changes for users (every behaviour change, numbered as in 04 §6 and 06)

| # | Change | Why |
|---|---|---|
| B1 | Export no longer needs an "export engine". The status pill "Export: …", the Install engine dialog and the in-window fallback disappear. Exports also work in the `file://` emergency mode (as a download) | no headless browser |
| B2 | Liquid Glass text uses classic Segoe UI on screen, as it already does in the PDF. Windows 11 users stop seeing Segoe UI Variable | screen = PDF |
| B3 | Soft shadows are drawn as 6 sharp layers on screen too (as in today's PDFs). A setting can bring back true blur on screen only | screen = PDF |
| B4 | Concurrent edits to the **same field** are resolved by Lamport order instead of save arrival order. It is still last-writer-wins, and both users still converge | lock-free saving |
| B5 | Others' edits appear after ≈ 1–2 s instead of ≈ 1.5–3 s (up to 28 s on slow shares) | journals + 1.5 s poll |
| B6 | "✓ Saved" appears when the record is flushed (≈ 30–90 ms), not on the next tick (01 P10) | bug fix |
| B7 | Text wrapping, overflow and fitting are computed from font files. A few cells may wrap or shrink differently from v3 (listed by the parity harness, accepted per case) | same layout on every PC |
| B8 | Opening a large workbook never freezes the window; a second user opening the same workbook skips parsing | worker + shared cache |
| B9 | "PDF as pictures" is 2× resolution (was 4×) | 125 MB → ≈ 15 MB |
| B10 | `.xlsb` is read natively (M6), with no Excel COM. `.xls` and IRM-protected files still use Excel | Constrained Language Mode blocks PowerShell COM |
| B11 | Version export names become `<workbook> - <version> - <design>.pdf` as documented (today `… - slides.pdf` is appended) | matches the README |
| B12 | The program starts in an Edge app window rather than a browser tab (a browser tab is still possible) | looks like an app; less tab confusion |

### 6.3 Performance targets (measured today → v4 target)

| Action | v3 measured | v4 target |
|---|---|---|
| Helper start → page ready | engine warm-up in background, ≈ 1 s | < 1 s |
| Open the 20-slide deck (first time on a PC) → first slide | 316 + 268 ms | < 400 ms |
| Open a 30 MB workbook, slide sheets only → first slide | n/a (lazy) | < 1.5 s (download over SMB dominates: 30 MB at 1 Gbit/s ≈ 0.3 s) |
| Read one 130k-row sheet (wizard preview) | 6.1 s, UI frozen up to 561 ms | **< 1 s, UI never blocked > 50 ms**; < 0.3 s from the shared cache |
| Keypress → pixels (one cell edit) | ≈ 100–300 ms (LOADTEST §3) | **< 50 ms** p95 |
| Edit → saved on the share | 300 ms debounce + 0.3–7.5 s (lock) | 300 ms debounce + **< 100 ms** p95 at 40 ms per operation |
| Others see an edit (20 users, 40 ms share) | 12 s p50 / 28 s p95 | **< 2 s p50 / < 4 s p95** |
| Export 20 slides, Liquid Glass | 10 s, 24.7 MB | **< 2 s, < 2 MB** |
| Export 20 slides, Excel | 2.3 s, 2.7 MB | **< 1 s, < 0.8 MB** |
| Open the Glass PDF in a viewer (render per page) | 766 ms | < 150 ms |
| Memory, 30 MB workbook with one data sheet read | 336 MB JS heap | < 150 MB |
