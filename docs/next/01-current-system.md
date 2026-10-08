# 01 · The current system (v3) and its measured baseline

This is how Slide Builder v3 works, as read from the code at commit `b27624e`, and what it costs. Where the
README or the other documents disagree with the code, the code wins; the differences are listed in §6.
Every number comes from a run in this repository (`spikes/baseline`, `spikes/storage`, `tools/loadtest.py`).
How to reproduce them is in `spikes/README.md`.

**Test status at the start of this work.** All existing tests pass:
* `npm test`: 114 Vitest tests;
* `python -m unittest`: 131 helper tests;
* `npm run test:e2e`: 15 Playwright scenarios with two real helpers on one folder, 3.7 min.

---

## 1. Shape of the system

```
 PC (one per user)                                                         SMB share  T:\Slide Builder\
┌──────────────────────────────────────────────────────────────────┐      ┌─────────────────────────────────┐
│ Edge/Chrome tab  ── backend/slide_builder.html (464 KB, Preact+TS)│      │ *.xlsx  (never written)         │
│   xlsx/ parse (UI thread) → model/ → render/ HTML strings → DOM   │      │ backend/data/workbooks/*.json   │
│   sync/DocSync: optimistic ops, 300 ms batches, poll 3 s          │ SMB  │ backend/data/{config,users,     │
│        │ HTTP 127.0.0.1 (token)                                   │◄────►│   fonts,presence,locks,backups} │
│ python slide_builder.py (stdlib): store/ops/locks/fsclock/presence│      │ export/   engine/ (optional)    │
│   exports: Playwright → DevTools → CLI headless Chrome/Edge       │      └─────────────────────────────────┘
│   convert: Excel COM via PowerShell, GDI+ via ctypes              │
└──────────────────────────────────────────────────────────────────┘
```

* **One helper per PC, nothing between PCs except files.** The helper serves the page with a per-start token
  (`backend/slidebuilder/server.py`, `ThreadingHTTPServer` at `server.py:497`) and moves bytes.
* **All parsing, layout and rendering happen in the page.** Exports print the same DOM that `buildSlide`
  produces.
* **Documents change only through operations.** There are five op types (`frontend/src/model/ops.ts:20-61`),
  implemented a second time in `backend/slidebuilder/ops.py`. Both are kept identical by
  `shared/ops-vectors.json` (1 816 lines of cases).
* **The data model** is one JSON document per workbook: `{schema, workbook, rev, updated, updatedBy, log,
  backupAt, preset, style, edits}`. Besides it there are `config.json` (shared defaults), `users/<user>.json`
  and the font library. The authoritative field list is `docs/ARCHITECTURE.md` §3.
* **Format versioning** is already built in (`backend/slidebuilder/upgrade.py:33`, `SCHEMA = {workbook: 3,
  config: 3, prefs: 1}`):
  * a file newer than the program is refused with HTTP 409 (`upgrade.py:54-59`);
  * an older file is upgraded once under its lock, after a byte copy to `backups/upgrades/`
    (`store.py:75-109`).
  * No upgrade step exists yet.

## 2. The pipelines in detail

### 2.1 Opening a workbook (page, UI thread)

1. `openFromFolder` (`state/app.ts:86`) reads the whole file over HTTP. The helper's stable read is in
   `workbooks.py:69`.
2. `indexWorkbook` (`xlsx/workbook.ts:48-87`) runs JSZip over the whole buffer, and DOMParser for the rels,
   workbook, styles, theme and drawings.
3. Workbooks with more than 12 MB of sheet XML plus shared strings, or files over 6 MB, are "big" and parsed
   lazily (`workbook.ts:46,78,82`).
4. `readSheet` (`workbook.ts:248-323`) inflates one sheet into a **single JS string** and runs regexes over it.
   * It creates one object plus one `"r,c"` string key per cell, in a `Map` (`workbook.ts:296`).
   * It yields with `setTimeout(0)` every 4 000 rows (`workbook.ts:299`, `xlsx/util.ts:71`).
   * There is no Worker anywhere in `frontend/src`.
5. Nothing is cached between sessions or shared between users. Every person who opens a workbook downloads
   and parses it again. The only caches are in memory: `wb.shared`, `LCACHE`, `L._cache`, `IMGMETA` and the
   picture-conversion cache.
6. **Text metrics** come from the browser in exactly two places:
   * the max digit width (`workbook.ts:169-176`, canvas `measureText`), which drives every column width;
   * `fitNotes` (`render/slide.ts:311-332`, off-screen DOM `scrollHeight`, shrinking 1 px at a time).

   The Liquid Glass column widening (`render/glass.ts:44`) and title geometry (`render/text.ts:42-47`) are
   character-count estimates, not measurements.

### 2.2 Rendering

* The chain is `RenderCtx` (`render/context.ts`) → `effItems` → `renderExcel` (`render/excel.ts`) or
  `renderGlass` (`render/glass.ts:376-515`). Each produces an **HTML string** of absolutely positioned divs
  with inline styles.
* Results are cached per table under `tableKey` (`render/slide.ts:175-181`). The slide is composed by
  `buildSlide`/`computeLayout` (`render/slide.ts:112-173`).
* **Liquid Glass** builds a structural scene from the cells: surfaces by union-find, frames, grids, rules,
  texts, signals and media (`glass.ts:89`); roles come from `inferRoles` (`glass.ts:287`). It then maps
  containers to CSS "materials" in `styles/slide.css`, which are built from:
  * up to 4-layer `linear-gradient`s with `calc()` alpha;
  * blurred `box-shadow`s;
  * a `mask-composite` rim;
  * a per-element blurred wallpaper background positioned by `placeGlass` (`slide.ts:182-188`).
* **The wallpaper is a raster.** `makeWall` (`render/wallpaper.ts:17-59`) paints a gradient, blobs, blurred
  ribbons and grain on a 1600 × 900 canvas. It exports a JPEG (q .94) and a half-size blurred JPEG (q .92).
* **Size of the result.** The 20-slide spike deck gives a 1.47 MB page DOM. The stage holds about 700 nodes
  for one 2-table slide (`spikes/baseline/baseline.json`).

### 2.3 Editing, saving, seeing others

The client loop:
* `DocSync` (`sync/docsync.ts`) keeps `view = server + inflight + pending`. It debounces 300 ms, keeps one
  request in flight, and retries after 2–32 s.
* `tick` (`state/app.ts:47-66`) runs every 3 s:
  * a `?since=rev` poll every 3 s;
  * `/api/health` and `/api/files` every 6 s;
  * fonts and config every 30 s.
* Presence runs every 10 s (`app.ts:48`).

A save on the helper (`store.update_workbook`, `store.py:184-221`), all on the share:
1. lock `wb-<key>`: an `O_EXCL` lock file plus `fsync` (`locks.py:69-92`);
2. read the latest document;
3. `ops.apply_ops`;
4. write a temp file, `fsync`, then `os.replace`;
5. a rolling backup at most every 5 min (tracked in `backupAt`);
6. read the lock file again (token check) and delete it.

Other costs on the share:
* **Clocks.** Ages are measured on the file server's clock, from a probe file's mtime cached for 30 s
  (`fsclock.py`).
* **Presence** (`presence.py:22-62`) rewrites the user's own heartbeat atomically, lists the folder and
  **reads every other heartbeat file** on each beat.
* **`/api/files` is a hidden cost not covered by the load test.** Every 6 s, for every user, the helper:
  * lists ROOT and `backend/`;
  * stats every workbook;
  * checks whether each workbook has a document;
  * **reads every workbook's document** (`workbooks.py:21-45`, called from `app.ts:59`).

  With 30 workbooks that is about 90 SMB operations per user every 6 s. `tools/loadtest.py` does not
  simulate it.

### 2.4 Export

The page side:
* `doExport` (`editor/export.ts:63`) flushes, then `exportPayload` (`export.ts:22-32`) rebuilds every slide
  as HTML;
* it runs `printReady` and `PRINT_CSS` (`render/printcss.ts`): blurred shadows become 5 sharp layers,
  "Segoe UI Variable" is removed, and the CSS mask becomes a border;
* it inlines the fonts used as data URLs (`state/fonts.ts:106-113`, matched by **substring** of the HTML) and
  POSTs everything to `/api/export`, up to 300 MB (`server.py:34-35`).

The helper side (`engines.py`):
* engines are tried in order: Playwright, then DevTools (CDP over a hand-written websocket, `cdp.py`), then
  the command line `--headless=new --print-to-pdf`, each with self-tests;
* geometry is checked twice (`GEOMETRY_JS`, `engines.py:158-176`);
* `check_output` runs, and `pdf_fit_pages` (`pdf.py:222-283`) finds a `#FFFFFE` marker rectangle in the
  content stream to cut the MediaBox to the slide;
* this check is skipped when Chrome writes object streams (`pdf.py:134-135`, `engines.py:191`).

There are 11 timeouts, from 5 s to 600 s (`engines.py:240-530`). Policy blocks are decoded from Windows
error codes (`engines.py:91-107`). Chrome for Testing is mirrored to `%LOCALAPPDATA%` because programs may
not start from the share (`engines.py:67-89`).

If no engine is ready, an **in-window fallback** runs: SVG `foreignObject` → canvas ×3 → JPEG →
`/api/assemble` (`export.ts:34-61`).

### 2.5 Conversions

* `.xlsb`/`.xls` are converted by **PowerShell `New-Object -ComObject Excel.Application`**
  (`convert.py:97-129`). This is blocked when PowerShell runs in Constrained Language Mode, which the
  environment brief says may be the case.
* EMF/WMF/TIFF go through GDI+ via `ctypes` (`convert.py:25-60`), with a PowerShell fallback.

---

## 3. Measured baseline

Machine: Linux container, 4 vCPU Xeon 2.1 GHz, Chromium 1194 (Playwright build), local disk. The spike
workbooks come from `spikes/baseline/make_workbooks.py`:
* **deck20.xlsx**: 20 sheets, each with two weekly-report tables. Every table has 15 columns × 17 rows, merged
  blue headers, Δ groups, ± formats, green/red conditional formatting and a superscript. This gives 20 slides
  of 2 tables;
* **big30.xlsx**: 30.4 MB, three data sheets of 130 000 rows × 12 columns (75.7 MB of XML each).

### 3.1 Open, render, edit (`spikes/baseline/measure.mjs` → `baseline.json`)

| Step | Measured | Note |
|---|---|---|
| Open deck20 → wizard shown (index + parse of 20 small sheets) | **316 ms** | longest task 83 ms |
| Wizard *Finish* → 20 slides built, first slide drawn | **268 ms** | |
| Open big30 → wizard (index only, lazy) | **336 ms** | |
| Read **one** 130k-row data sheet (wizard step 2) | **6 093 ms** | **35 long tasks, the longest 561 ms (UI frozen)**; JS heap 336 MB |
| Same sheet, regex loop alone in Node (`spikes/parser`) | 3 148 ms, 242 MB of cell objects for 1.56 M cells | JSZip inflate 692 ms |
| Edit (Ctrl+B) → POST `/ops` on the helper | **5–8 ms** per request | 300 ms debounce before it |
| Edit → status bar shows "✓ Saved" | 1 810–5 344 ms | **a display bug, not a save cost:** see §5 |

### 3.2 Export, 20 slides (median of 2 runs; DevTools engine was used)

| Design | Time | PDF size | per page | Inside the PDF | PDFium render per page (viewer cost) |
|---|---|---|---|---|---|
| Liquid Glass, vector | **9.4–10.7 s** | **24.7 MB** | **1 204 KB** | **5 741 Form XObjects, ~18 300 image objects (9 000 with SMask)**, 1 **Type 3** font | **766 ms** (15.6 s for the deck) |
| Excel, vector | 2.2–2.5 s | 2.7 MB | 134 KB | 5 TrueType Type0 fonts, 0 images | 15 ms |
| Excel Refined, vector | 2.2–2.3 s | 2.7 MB | 134 KB | (same as Excel for this deck: no text boxes) | 15 ms |
| Liquid Glass, "as pictures" | **90 s** | **125 MB** | 6.1 MB | 20 lossless page images (460 Mpix) | – |

The README says Excel slides are "≈ 35 KB each" and a 4-slide Glass PDF is "≈ 1.2 MB". That matches
1.2 MB per Glass page only for small slides. With two full tables per slide, Glass is **1.2 MB per page**.
**Chrome turns every CSS gradient with alpha into an image with a soft mask** (thousands per deck), and
Acrobat must decode all of them. This is the measured root cause of "large and slow to open".

### 3.3 Shared folder (`tools/loadtest.py`, 30 existing backups, 30 s, `spikes/storage/current-*.txt`)

| Users on one deck | fs ms | POST p50 / p95 | lock wait p95 | others see an edit after p50 / p95 | lock time-outs (503) |
|---|---|---|---|---|---|
| 10 | 15 | 262 / 903 ms | 730 ms | 1.4 / 2.8 s | 0 |
| 10 | 40 | 1 792 / 7 528 ms | 7 230 ms | 7.0 / 16.1 s | 2 |
| 20 | 15 | 1 434 / 5 280 ms | 5 163 ms | 4.5 / 10.1 s | 0 |
| 20 | 40 | 3 786 / 9 128 ms | 8 829 ms | **12.0 / 27.9 s** | **20** |

No acknowledged edit was lost in any run, so the protocol is correct. It is serialised by the lock: about 12
round trips per save (24–44 under contention). That does not scale past about 10 users at 15 ms.

## 4. What is good and must be kept

* **The data model and its merge rules.** Field-level `patch` / map-merge semantics, inverse ops for
  own-changes-only undo, "never treat unreadable as empty", file-server clock, versioned formats with
  backups. These are sound and well tested; the rebuild keeps the document shape **unchanged**.
* **The reading and design algorithms.** The marker regions, number formats with Italian separators, the CF
  evaluator, the Liquid Glass scene inference (`glass.ts` `buildScene`/`inferRoles`), `computeLayout`, and
  the automated comment analysis (`model/comment.ts`). They hold years of tuning and are covered by unit
  tests. They are pure TypeScript and can be **moved, not rewritten**.
* **The security model of the helper:** 127.0.0.1, Host/Origin checks, per-start token, body limits.
* **The operational care:** stable workbook reads, atomic writes with Windows sharing-violation retries,
  install and update under locks, cp1252-safe console output.

## 5. Pain points, verified

| # | Pain point | Evidence |
|---|---|---|
| P1 | Glass export is big and slow, and its CSS work-arounds are fragile | 24.7 MB / 10 s / 766 ms per page to view (§3.2). Work-arounds in `printcss.ts`, `wallpaper.ts:19-21`, `pdf.py` marker fitting. A Type 3 font is still present. |
| P2 | Exports depend on a browser engine that policies break | Three engines, 11 timeouts, error-code decoding, a mirror to `%LOCALAPPDATA%`, CLI calibration by screenshotting a green page (`engines.py:458-502`), and an in-window fallback that rasterises. |
| P3 | Parsing blocks the UI and is not shared | 6.1 s, a 561 ms freeze and 336 MB for one large sheet. Every user re-parses; no cache. |
| P4 | Saves are serialised under a lock on the share | §3.3: 20 users at 40 ms → 12–28 s to see an edit, 503s. |
| P5 | Hidden polling costs | `/api/files` reads every deck's document every 6 s per user. Presence reads every heartbeat file every 10 s. |
| P6 | Two implementations of the op semantics | `model/ops.ts` and `ops.py`, kept equal only by vectors. |
| P7 | Layout depends on the PC's fonts | Max-digit width from canvas: Calibri may be missing, or a different version. Segoe UI Variable is used on screen but removed in the PDF (`printcss.ts:50`), so screen ≠ PDF by design. |
| P8 | Build artefact in git | The 464 KB `slide_builder.html` is committed and a test fails if it is stale. Every UI change is a 460 KB diff. |
| P9 | `.xlsb`/`.xls` conversion uses PowerShell COM | Blocked in Constrained Language Mode (`convert.py:113-117`). |
| P10 | "✓ Saved" indicator lags 2–5 s | `DocSync.flush` emits with no document change, and `emit` only notifies on a change or a local edit (`docsync.ts:40,82`). The status bar refreshes on the next 3 s tick. A user waiting for the tick before closing can think the save is slow. |
| P11 | Pictures mode is impractical | 90 s and 125 MB for 20 slides. If Chrome returns RGBA, the whole deck is silently re-rendered as JPEG (`exports.py:84-91`). |

## 6. Discrepancies between the documentation and the code

1. **"Edits visible after ≈ 1.4 s"** (README §9) holds for 10 users at 15 ms only. The load test never
   includes `/api/files` or wizard previews (§2.3).
2. **"Excel slides ≈ 35 KB each"** (README §10.3) applies to small tables. A two-table weekly slide is
   134 KB (§3.2).
3. **The pictures-mode description is incomplete.** README §1.1/§10.2 say "lossless PNG pages". Not
   mentioned: an RGBA screenshot falls back to JPEG q95 for the whole deck (`exports.py:86-91`,
   `pdf.py:46-48`).
4. **Version export file names.** The documented pattern is `<workbook> - <version> - <design>.pdf`. Because
   `all:true` is passed, the real name ends `… - <design> - slides.pdf`, and `… - slides (images).pdf` in
   pictures mode (`exports.py:77,83`).
5. **The "big" rule also counts shared strings.** README §5.1 says "> 12 MB sheet XML"; the code adds
   sharedStrings (`workbook.ts:78`).
6. **"Yields to the UI".** The yield is `setTimeout(0)`, not a frame callback, and the shared-strings and
   styles parses do not yield at all.
7. **LCACHE keying.** README §5.3 says the key includes "workbook identity". The workbook is checked after
   lookup, not keyed (`model/preset.ts:57-59`). `def.scales` is not in the key.
8. **Font measurement.** "Columns widened for the system font" in Liquid Glass is a character-count
   heuristic (`glass.ts:44`), not a measurement.
9. **The parity test is not in the repository.** `docs/RENDERING.md` §1 mentions a parity test against the
   old DOM parser; no such test exists in `frontend/tests`.
10. **Unsupported conditional formatting.** RENDERING says "data bars, colour scales and icons are reported".
    In fact every rule type other than `cellIs`/`expression` is reported. Expressions not in `REF op operand`
    form are silently ignored (`layout.ts:192`).
11. **Number formats.** Conditional sections like `[>100]` are stripped, not evaluated (`numfmt.ts:76`).
    Built-in format ids 23–36, 41–44 and 50+ fall back to General.
12. **There is no reload banner on a format mismatch.** README §6.3 mentions one; the message appears only
    in the status bar save text (`App.tsx:89`).
13. **Engine warm-up stops at the first working engine** (`engines.py:618-628`); later engines are untested
    until used.
14. **The Excel Refined tooltip is stale.** It still says "one consistent, polished style"
    (`Topbar.tsx:216`); the design now draws Excel's own colours.
15. **Smaller UI and README mismatches** (from the parity survey):
    * "span" text boxes are reachable only via Comment… › Placement;
    * the Tables row of Text styles has only a font control;
    * page-number font is set in Text styles, not in Options;
    * Ctrl+S, Ctrl+A and Alt+↑/↓ exist but are not documented.
16. **In-window fallback, PNG.** "PNG · every slide" exports only the first slide there (`export.ts:57-60`).
17. **Prefs are written without a lock.** `users/<user>.json` is written by `write_prefs` with no lock
    (`store.py:337-348`); two tabs of one user can race. This is harmless (personal data, last write wins)
    but undocumented.
18. **`/api/assemble` also accepts PNG**, not only the JPEG data URLs ARCHITECTURE §5 lists.
