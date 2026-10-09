# Slide Builder 2.3 – functional review

Scope: the full v2.3 code base (`backend/slide_builder.py`, `backend/src/*.js`, CSS, launchers),
reviewed for correctness, for use from a **shared network drive by several people at the same time**
(same or different workbooks), for security, and for maintainability. The last section explains the
architecture chosen for the rebuild (v3) and why it is not Next.js.

Severity: **Critical** = data loss or wrong output with no warning · **High** = broken feature or
security hole · **Medium** = wrong in some cases / painful to maintain · **Low** = polish.

---

## 1. How v2.3 works when several people use it

```
 PC of user A                        PC of user B
 ┌───────────────────────┐            ┌───────────────────────┐
 │ browser ⇄ helper :8765 │            │ browser ⇄ helper :8765 │
 └──────────┬────────────┘            └──────────┬────────────┘
            │  SMB                               │  SMB
            ▼                                    ▼
   T:\Slide Builder\  ── workbooks, export\, engine\, backend\slide_builder_settings.txt
```

Every user runs their **own** helper process on their own PC. The only thing the helpers share is
the folder on the network drive. They never talk to each other, and the one file that holds all
state (`slide_builder_settings.txt`: presets, cell edits, design, page numbers, logo, last file)
is rewritten **in full** by every helper.

## 2. Concurrency findings

| # | Sev. | Finding | Effect |
|---|---|---|---|
| C1 | **Critical** | **Lost updates on the settings file.** The client loads the whole settings object once at start-up and from then on `PUT`s the *entire* object (debounced 450 ms) after every change. The helper's lock (`threading.Lock`) only serialises threads *inside one process*. | User A edits the preset of `Weekly.xlsx`, user B (who opened the app earlier) edits anything – B's save writes back B's stale copy and A's work is gone. Reproduced: after A and B save one after the other, A's preset no longer exists. This also hits a single user with two browser tabs. |
| C2 | **Critical** | **An unreadable settings file is served as `{}`.** `read_settings()` copies a broken file aside and returns `{}`; the client turns that into defaults; its next save writes the defaults over the shared file. | One torn read (antivirus scan, an editor saving, an SMB hiccup, a second helper half-way through a write – see C3) can wipe **every preset and every edit of every user**. Reproduced. |
| C3 | High | **Shared temp file name.** All helpers write `slide_builder_settings.txt.tmp` and then `os.replace` it. Two helpers saving at the same moment truncate each other's temp file; the loser's `replace` can publish a half-written file (→ C2) or fail after 5 retries ("locked by another program"). | Corrupt settings, random "Not saved" errors. |
| C4 | High | **No change propagation.** A user never sees changes made by others after start-up; their next save silently reverts them (C1). There is no indication that someone else has the same workbook open. | Two people preparing the same weekly deck overwrite each other without knowing. |
| C5 | High | **Undo restores whole snapshots** (`snap()`/`restore()` = JSON of the whole preset + all edits of the workbook). | Undoing *your* last change also reverts every change other users made to that workbook in the meantime. |
| C6 | High | **Global "app" settings are shared by everybody**: design, glass strength, colour, page numbers, logo, PDF mode and `lastFile` live in one object. | User A switching to the Excel design changes the next export of user B; everybody's app reopens the workbook *someone else* opened last. |
| C7 | Medium | **Export file names collide.** Two users exporting the same workbook write `"<workbook> - slides.pdf"` directly (non-atomic `open(…,"wb")`). `unique_output()` only reacts to a file locked by a PDF viewer, and its fallback name has 1-second resolution. | Interleaved/garbled PDFs, or a colleague's export silently replaced. |
| C8 | Medium | **Workbook read races.** `GET /files/<name>` and the `mtime` used by the change banner come from two separate requests, and a workbook being saved by Excel can be read half-way. A failed parse is reported as a broken file, not retried. | Spurious "could not be unpacked" errors; the "workbook changed" banner can miss a save or show a stale one. |
| C9 | Medium | **Engine installation is not coordinated.** Two people running "Install export engine" on a non-network root unzip into the same `engine\` folder at once; `mirror_engine_locally()` races with `--setup` on the same PC. | Broken engine folder until it is deleted by hand. |
| C10 | Low | The legacy "flat layout" migration moves the settings file at start-up without a lock. | Only on the first start after an upgrade. |

## 3. Security findings

| # | Sev. | Finding |
|---|---|---|
| S1 | High | **No `Host` check → DNS rebinding.** A web page in the same browser can re-bind its domain to 127.0.0.1 and then read `/api/settings` and `/files/<workbook>` (confidential bank figures) and write settings. |
| S2 | High | **No CSRF protection.** Any web page can `POST` "simple" requests (`text/plain`) to `/api/export`, `/api/assemble`, `/api/upload`, `/api/convert-workbook` (starts Excel via COM), `/api/engine/install` (downloads and runs a browser) and `/api/open`. |
| S3 | Medium | `POST /api/convert-workbook` hands arbitrary bytes to Excel; with S2 that is a remote trigger for Excel parsing untrusted files (macros/links are disabled, which limits but does not remove the risk). |
| S4 | Low | Unbounded request bodies (`Content-Length` is trusted) and an unbounded upload store (6 h retention, no size cap) – a single tab can exhaust memory. |
| S5 | Low | Error responses include raw exception text and absolute paths (`/api/health` returns the folder path). Acceptable on localhost once S1/S2 are fixed. |

## 4. Functional findings (single user)

| # | Sev. | Finding |
|---|---|---|
| F1 | High | **Cell edits are keyed by address** (`Sheet!C7`). Inserting a row above a table shifts every text edit, format and role onto the wrong cell; text edits are protected by `orig`, formats are not. (Known limitation in the README; the rebuild reports edits whose anchor value changed.) |
| F2 | Medium | `evalCF` only evaluates numeric cells and two rule shapes (`cellIs`, `$X$n="TEXT"`). Relative references in expressions are evaluated against the literal cell instead of being offset for each cell in the range. Text-based `cellIs` rules (`equal "Yes"`) never match. |
| F3 | Medium | `formatValue` ignores locale tags: dates formatted `[$-410]mmmm` show English month names ("March" instead of "marzo"), and **currency tags such as `[$€-410]` are dropped entirely**, so `1.235 €` is shown as `1.235`. Times with `AM/PM` show 24-hour values ("18:00 PM"). |
| F4 | Medium | `fmtGeneral` keeps up to 10 significant digits; Excel's General shows 11 characters max → long numbers look different from Excel. Exponent formats (`0.00E+00`) are not handled (the exponent is dropped). Fractions (`# ?/?`) are rendered as decimals. |
| F5 | Medium | `readSheet` limits column info to 400 columns (`if(i>400) break`) but tables may extend further; widths beyond column 400 fall back to the default width. |
| F6 | Medium | `S.cellAt()` walks columns/rows one by one (up to 1,048,576 iterations) for every absolute-anchored picture – slow on tall sheets. |
| F7 | Low | `growG()` ("grows with new rows") silently stops after 2000 added rows. |
| F8 | Medium | The wizard adds a `window` `pointerup` listener every time a sheet grid is drawn (leak); grids of huge sheets are capped at 400×80 cells silently except for a note. |
| F9 | Medium | The cover and index are always the first two slides; they cannot be reordered, and there can be only one of each. |
| F10 | Medium | Page numbers, design, glass level, colour and logo are global (see C6) although they are properties of a *deck*: two workbooks cannot have different page-number settings. |
| F11 | Low | In-window PDF fallback uses `foreignObject`: web fonts and some CSS (backdrop-filter) are not rendered – the "exact" promise does not hold there; the UI does not say so. |
| F12 | Low | `convertImage` caches by a key made of the base64 length + first/last 64 chars – two different pictures with the same size and edges collide. |
| F13 | Low | `todayLabel()` uses `en-GB`; the date chip on the cover is English even for Italian decks. |
| F14 | Low | Escape in the wizard asks `confirm()`; native dialogs block the page and are blocked in some managed browsers. |
| F15 | Low | `defaultPreset` creates one slide per sheet with "x" tables without asking when the workbook is reopened at start-up – surprising if markers were added by someone else. |

Verification of the rebuild: `app/e2e/parity.mjs` renders the same workbooks with v2.3 and
v3 in the same browser; every table is byte-identical in both designs except where the fixes above
apply (number formats, CF relative references).

Everything else in the reading and rendering pipeline is careful and well tuned: the regex
sheet parser, merged-cell geometry, border resolution, hidden-row handling, picture anchoring,
the scene model behind Liquid Glass, and the multi-engine export with self-tests. The rebuild
keeps these algorithms and their behaviour; it changes the structure around them.

## 5. Maintainability findings

| # | Sev. | Finding |
|---|---|---|
| M1 | High | ~200 KB of JavaScript in **one global scope**, concatenated by string replacement. Any name can be shadowed by any file; load order matters; there are no imports to show dependencies. |
| M2 | High | **No automated tests** in the repository (the README describes manual Playwright scripts that are not included). |
| M3 | Medium | No types. The core objects (`L`, `R`, `S`, items, scene nodes) have 20–40 fields each, documented only in the README. |
| M4 | Medium | UI is built with `innerHTML` strings and manual event wiring; state lives in globals (`DOC`, `SEL`, `CUR`, `SETTINGS`, `EDITV`, …) mutated from everywhere. |
| M5 | Medium | One 1,550-line Python file mixes HTTP, PDF writing, a websocket client, three export engines, Windows COM/GDI+ and an installer. |
| M6 | Low | The committed `slide_builder.html` must be rebuilt by hand; nothing checks that it matches `src/` (it currently does). |

---

## 6. Architecture decision for the rebuild

### Why not Next.js

Next.js was considered and rejected **for this deployment**:

1. **It does not fix the concurrency problem.** Lost updates (C1–C5) come from *how state is stored
   and merged*, not from the web framework. A Next.js app that each user runs locally would still
   share one folder and would need exactly the locking and merge logic described below.
2. **It needs Node.js at run time.** The target PCs have Python and nothing else (no admin rights,
   AppLocker on network shares, SSL inspection that breaks Node downloads – see README §11).
   Shipping a portable `node.exe` + `node_modules` (~100 MB) has the same "programs can't run from
   T:\" problem the Chrome engine already has.
3. **The app must work offline and from `file://`.** Next.js' output assumes a server and absolute
   asset URLs; static export does not work from `file://`.
4. **Its strengths are not used here.** Server rendering, routing and API routes add nothing to a
   single-screen editor whose hot path is hand-tuned DOM generation for ~9k nodes per slide.

Next.js (or any server framework) *becomes* the right choice if the team gets a **central server**
(one process, one database, real-time sync, one export engine for everybody). The v3 API was designed
so that such a server can implement the same endpoints later without touching the front end.

### What v3 uses instead

* **Front end: TypeScript + Preact (React API) + Vite**, bundled into the same single
  self-contained `slide_builder.html`. Node is needed only on a developer's machine, never on users'
  PCs. Modules with explicit imports, strict types, unit tests (Vitest) and end-to-end tests
  (Playwright).
* **Helper: Python standard library only** (as before), split into a package with one module per
  concern, plus `unittest` tests, including multi-process concurrency tests.
* **State: one JSON document per workbook, changed by small operations**, merged under a
  cross-process lock on the share, with a revision number. Clients poll for changes and see who else
  has the workbook open. Personal preferences are stored per user. Details: `docs/ARCHITECTURE.md`.

### How each finding is addressed in v3

| Finding | v3 |
|---|---|
| C1, C3 | Per-workbook documents; changes are field-level operations applied by the helper to the **latest** version under an exclusive lock file (`O_EXCL`, works on SMB, stale-lock recovery measured on the file server's clock so PCs with skewed clocks cannot break a live lock); unique temp names + atomic replace. |
| C2 | A document that cannot be read is never treated as empty: the request fails, the file is left untouched, the client keeps its pending operations and retries. |
| C4 | Clients poll `?since=<rev>` every 3 s, apply remote changes, and show "updated by …" (from a 20-entry revision log in each document) and who else has the workbook open (presence heartbeat files). |
| C5 | Undo/redo are inverse **operations**, so undo only reverts your own change. |
| C6, F10 | Deck style (design, glass, colour, logo, page numbers) belongs to the workbook document; personal preferences (last file, PDF mode, zoom) are per user; shared defaults for new decks in `config.json`. |
| C7 | Exports are written to a unique temp file and atomically renamed; a name in use gets a ` (2)` suffix instead of being overwritten mid-write. |
| C8 | The workbook bytes are returned together with their `mtime`/`size`; the read is retried if the file changes during the read or the zip is incomplete. |
| C9, C10 | Installer and migration run under named locks. |
| S1, S2, S4 | `Host` must be `127.0.0.1/localhost:<port>`; every `/api` call needs a per-start random token that is injected into the served page; `Origin`, if present, must match; body size limits; upload store capped. |
| F2 | Relative references in CF expressions are offset per cell (from the first cell of the rule's range); `cellIs` rules also compare text; expression rules apply to text cells. |
| F3 | Locale tags are honoured: `[$-410]` → Italian month/day names, `[$€-410]` keeps the symbol; 12-hour clock with AM/PM; `m` = minutes after `h`/before `s`. Default stays as before (Italian separators, English names). |
| F4 | Exponent and fraction formats; General follows Excel's 11-character rule; `[h]`/`[mm]` elapsed times. |
| F5, F6, F7, F8, F12, F14 | Column widths beyond column 400; binary-search `cellAt`; no 2000-row cap; one shared wizard listener; picture-conversion cache keyed by full content; in-app dialogs instead of `confirm()`/`alert()` (also fixes the oversized wizard checkboxes). |
| F9, F10 | Cover and index are ordinary entries in the slide list and can be moved; style is per deck. |
| F1, F11, F13, F15 | Unchanged (documented as known limitations in the README). |
| M1–M6 | TypeScript modules, Preact components, unit tests (Vitest), v2↔v3 renderer parity script, end-to-end tests with two helpers on one folder (Playwright), helper tests (unittest, incl. multi-process), and a test that fails if the committed HTML is stale. |
