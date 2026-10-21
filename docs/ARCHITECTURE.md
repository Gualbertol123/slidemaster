# Slide Builder 4 – architecture and contract

This document is the contract of Slide Builder 4: the files on the shared folder, the deck document, the operations
and the journal records that change it, how records are folded and compacted, the locks, presence, the HTTP API of
the helper, the display list, the font library and the file formats. It describes the code as it is (helper 4.0.0,
`helper/slidebuilder/__init__.py:7`; CHANGELOG `4.1.0 - unreleased` for the `.xlsb` reader). Where the design in
`docs/next/04-data-and-migration.md` differs, the code is described here. The v3 contract this replaces is in
`docs/v3/ARCHITECTURE.md`; the overview for engineers (deployment, flows, development) is the root `README.md`
(§2, §6, §11).

Three programs take part:

| Part | Where | Runs | Does |
|---|---|---|---|
| The page | `app/` (React), built into `helper/slide_builder.html` | the browser, on `http://127.0.0.1:<port>/` | UI; talks to the helper only (`app/src/sync/api.ts`) |
| The core | `core/src/` (TypeScript) | Web Workers started by the page | reads workbooks, folds decks (`model/fold.ts`), applies operations (`model/ops.ts`), lays out slides into display lists, draws SVG / canvas / PDF |
| The helper | `helper/slidebuilder/` (Python standard library, 3.8+) | one per user, on that user's PC | serves the page and the HTTP API, and is the only thing that touches the shared folder |

All helpers share one folder (usually an SMB share). They coordinate **only through files**: there is no server
process shared between users. The helper never parses or applies an operation; the TypeScript core is the only
implementation of the document's semantics.

---

## 1. Deployment and files

### 1.1 The main folder

```
Slide Builder\                          ROOT (paths.ROOT): the workbooks live here
├─ Start Slide Builder.bat              starts the version named in app\current.json, else helper\ (else backend\)
├─ Start Slide Builder (v3).bat         Slide Builder 3 on the same data, from port 8785 (rollback only; PLAN S6.5 removes it)
├─ Update Slide Builder.bat             runs tools\update.py with the given arguments
├─ Install Slide Builder.bat            runs slide_builder.py --install of the same program the start file picks
├─ tools\update.py                      the updater (also --migrate-all, --rollback)
├─ helper\                              the program of a git-connected folder (backend\ until 3.8)
│  ├─ slide_builder.py                  entry point
│  ├─ slide_builder.html                the page (BUILT from app/; the helper replaces __SB_TOKEN__ in it)
│  └─ slidebuilder\                     the helper package
├─ app\                                 side-by-side releases (tools/update.py --release / --zip / --use)
│  ├─ current.json                      {version, previous, at, by, held?}: the version in use
│  └─ <ver>\                            one release: MANIFEST.json, helper\ (4.x) or backend\ (3.x), tools\, *.bat …
├─ backend\                             HOME_BACKEND: the user's files, in every layout
│  ├─ logo.png …                        logos (looked up by /assets/)
│  ├─ slide_builder_settings.txt        v2 settings (imported once, then renamed *.v2-backup.txt)
│  └─ data\                             DATA: all persistent state (§1.3)
├─ export\                              PDFs and PNGs; export\feedback\ holds export problem reports
└─ *.xlsx *.xlsm *.xlsb *.xls           the workbooks (also listed from backend\ for older setups)
```

In a git checkout `app\` holds the page's sources; on a share it holds the installed releases. A release ZIP contains
`helper/**` (without `helper/tests/`), the root `.bat` files, `README.md`, `CHANGELOG.md`, `tools/update.py` and
`tools/fieldcheck.html`, with a `MANIFEST.json` (`tools/make_release.py:37-41`).

**Which program runs.** `Start Slide Builder.bat` reads `app\current.json` with Python. If it names a version whose
`app\<ver>\helper\slide_builder.py` (4.x) or `app\<ver>\backend\slide_builder.py` (3.x) exists, that program runs;
otherwise `helper\slide_builder.py`, otherwise `backend\slide_builder.py`. When the program runs from
`app\<ver>\helper\` (a folder with `MANIFEST.json` one level up), `paths.py` still takes ROOT and HOME_BACKEND from
the main folder, never from `app\<ver>\` (`helper/slidebuilder/paths.py:34-55`). The data folder is therefore the same
for every installed version.

**Ports.** The helper listens on `127.0.0.1`, first free port of 8765–8784 (`main.py:38`, `--port` changes the
start). On each port it first asks `/api/ping`: a helper of the same major version there means "already running" and
its page is opened instead; a helper of another major version is skipped (`main.py:29-52`). The page opens in an Edge
app window (`msedge --app=`) when Edge is found, else in the default browser; `SLIDEBUILDER_APP_WINDOW=0` forces the
browser. `Start Slide Builder (v3).bat` starts the newest installed 3.x on port 8785.

**At start-up** the helper creates `export\` and `DATA`, runs the v2 settings import (§13.6), converts saved setups in
an older format (`store.upgrade_all`, §13.5), then serves. Neither step blocks the start when it fails.

### 1.2 Updates (`tools/update.py`)

| Command | Effect |
|---|---|
| (none) | a folder with `app\current.json`: installs the newest release (refused while `current.json` has `held: true`); otherwise a git update in place, or a ZIP of the branch copied over the program files |
| `--release [latest\|X.Y.Z]`, `--zip FILE` | the release ZIP is checked (GitHub's SHA-256 digest when given, always its `MANIFEST.json`), extracted to `app\<ver>.part\`, renamed to `app\<ver>\`, its `slide_builder.py --selftest` must pass, then `app\current.json` is replaced atomically |
| `--use X.Y.Z` | makes an installed version current. Going to a 3.x while Slide Builder 4 owns decks first rolls every deck back (§9.2); going to an older version sets `held: true` |
| `--migrate-all` | migrates every v3 deck now (§9.1), with the program of the version in use |
| `--rollback [WORKBOOK]` | gives one deck, or every deck, back to Slide Builder 3 (§9.2) |

Details: one update at a time (`data\locks\update.lock`, O_EXCL, stale after 30 min on the PC's clock – not the
helper's lock protocol); before an update `config.json`, `workbooks\*.json`, `users\*.json` and the v2 settings files
are copied to `data\backups\before-update-<time>\` (last 5 kept; decks in `data\v4\` are **not** copied); the newest
3 versions plus the current and previous stay installed, and the newest 3.x is never pruned while a 4.x is installed;
a release install updates `Start Slide Builder.bat`, `Install Slide Builder.bat` and `tools\update.py` in the main
folder (the old ones copied to the backup folder) and adds `Update Slide Builder.bat` / `Start Slide Builder (v3).bat`
only when missing. A non-release ZIP update writes `data\app-version.json`.

### 1.3 The data folder (`backend\data\`)

```
data\
├─ config.json                         shared defaults for new decks (§13.4)
├─ users\<user>.json                   personal preferences (§13.4)
├─ fonts\                              shared font library (§12)
│  ├─ fonts.json                       the index
│  ├─ <Family>-<weight>[i]-<sha1:10>.<ext>
│  ├─ system\fingerprints.json, system\licence.json     Windows-font captures, copy-mode switch
│  └─ cache\<sha256(key):40>.sbc      what the helpers fetched from Google (B46, §12.1), ≤ 200 MB
├─ assets\                             pictures chosen in the app (POST /api/logo)
├─ v4\
│  ├─ decks\<key>\                     one deck per workbook (§2.1, §4)
│  │  ├─ snapshot.json                 the folded document and its frontier (§6)
│  │  ├─ j\<journal>.log               append-only journals of records (§4)
│  │  ├─ presence\<user>@<host>#<client>   empty files; mtime = heartbeat (§8)
│  │  ├─ lock                          the deck lock (§7)
│  │  ├─ moved-from-v3.json            written by the migration (§9.1)
│  │  ├─ rolled-back.json              written by a rollback (§9.2)
│  │  ├─ incident-<journal>-<offset>.json   a damaged journal: the deck is read-only (§7.3)
│  │  └─ incident-format-5.json        the deck holds 4.6 objects (§6.5, ADR-019): read-only for 4.0–4.5 only
│  ├─ storage.json                     optional {"storage": "lean-lock"} (§7.2)
│  └─ pinned-v3.json                   optional: decks kept on Slide Builder 3 (§9.2)
├─ workbooks\<key>.json                Slide Builder 3's documents. Read by the migration, then FROZEN (§9.1)
├─ locks\<name>.lock                   lock files (§7); also update.lock and short-lived probe files
├─ backups\
│  ├─ v4\<key>\<gen>.json              each compaction's snapshot, last 30 (§6.4)
│  ├─ <key>\<rev>.json                 Slide Builder 3's rolling backups (v4 writes none)
│  ├─ upgrades\<kind>\<file>.v<n>.<time>.json   a file before a format upgrade or the migration
│  └─ before-update-<time>\            copies made by tools/update.py (last 5)
├─ presence\                           Slide Builder 3's presence files (v4 neither reads nor writes them)
├─ migrated.json                       marker and report of the v2 settings import
└─ app-version.json                    written by a non-release ZIP update
```

Temporary files may appear for a moment: `<file>.<uuid>.tmp` (atomic writes), `<lock>.<uuid>.stale` (a stale lock
being broken), `.clock-<host>-<pid>` (the file-server clock probe, §7.4).

### 1.4 Who writes what

| File | Written by | How |
|---|---|---|
| `v4/decks/<key>/j/<writer>[~n].log` | the helper of the user whose page session is `<writer>` | append + `os.fsync`, no lock (journal mode) |
| `v4/decks/<key>/j/shared~<n>.log` | any helper, lean-lock mode | append + `os.fsync` under the deck lock |
| `snapshot.json` | the helper, on a page's `compact`; the migration; `create` of a new deck | atomic replace under the deck lock |
| `presence/*` | each helper its own user's file | create / `utime` |
| `incident-*.json` | the first helper whose read finds damage | O_EXCL, never overwritten |
| `incident-format-5.json` | a 4.6+ helper, asked by its page before the deck gets 4.6 objects (or before a format-5 compaction) | O_EXCL, never overwritten or removed; moves with the deck (deleted setups) |
| `config.json` | v4 helpers (`POST /api/config`) and v3 helpers | atomic replace under lock `config` |
| `users/<user>.json` | that user's helper (v3 or v4) | atomic whole replace |
| `fonts/*` | any helper | under lock `fonts` |
| `fonts/cache/*` | any helper (B46) | atomic replace, no lock; entries checked on read (length + SHA-256); least recently used deleted over 200 MB |
| `assets/*` | any helper (`POST /api/logo`) | atomic replace, no lock |
| `workbooks/<key>.json` | v3 helpers while v3 owns the deck; the v4 migration (freeze) and rollback | under lock `wb-<key>` |
| `backups/v4/<key>/*` | the helper that compacted, after releasing the deck lock | best effort |
| `v4/deleted/<key>~<ms>/` | the helper of the person deleting or restoring a setup (B44, `deckbin.py`) | delete, under `wb-<key>` and the deck lock: the deck's folder renamed in one step (refused while another window has the deck open, or while a journal is still open on another PC), its backups moved with it, a copy of its v3 file; then an empty deck in its place (gen + 1, its own `born` file) and a frozen v3 stub; any failure puts back what moved. Restore, under `wb-<key>`: only while the workbook's deck is empty; the empty deck set aside, the deleted one moved back, all or nothing |
| `v4/decks/<key>/born` | the helper deleting a setup, for the empty deck it leaves (B44); a restored deck brings its own (or none) | written once; no compaction touches it. A writer is bound to the deck's `born` when it is issued (`/api/decks/open`, `bind_writer`; cached 10 s, so another PC sees a delete up to 10 s later): a writer of a deleted deck never opens a journal in the deck its workbook got afterwards – while its helper (4.6+) runs |
| `export/*` | the helper of the user who exported | temp file + rename under lock `export-<doc_key(name)>` |

### 1.5 What Slide Builder 3 still reads

Slide Builder 3 (3.8.0) can run on the same data, started by `Start Slide Builder (v3).bat` or by `--use 3.x`. It
reads and writes `config.json` (same lock `config`; neither version loses the other's change, §13.4),
`users\*.json`, `fonts\`, `assets\`, its own `presence\` and `backups\<key>\`, and `workbooks\<key>.json`. A deck
that Slide Builder 4 owns has its v3 file frozen at `"schema": 4`; v3's `upgrade.needs_upgrade` raises `TooNew`
for a schema above 3, so a v3 helper answers 409 for it and its page asks to reload. v3 never reads `data\v4\`.
A rollback (§9.2) gives v3 its document back as schema 3.

### 1.6 Identity and environment

* `user` = `SLIDEBUILDER_USER` or `getpass.getuser()`; `host` = `SLIDEBUILDER_HOST` or `socket.gethostname()`
  (`util.py:34-51`).
* A **writer** is one page session on one deck: `<user>@<host>#<8 base32 chars>`, user and host passed through
  `safe_component` (`[^A-Za-z0-9._-]` → `_`, ≤ 60 chars), issued by `POST /api/decks/open` (`decks.py:182-187`).
* A **client** is the page's own id for presence (`[A-Za-z0-9_-]{1,64}`).

| Variable | Effect |
|---|---|
| `SLIDEBUILDER_ROOT`, `SLIDEBUILDER_DATA`, `SLIDEBUILDER_EXPORT` | the root, data and export folders |
| `SLIDEBUILDER_APP_FILE` | serve another page file (load tests) |
| `SLIDEBUILDER_STORAGE` | `lean-lock` or anything else (= journal); wins over `v4/storage.json` |
| `SLIDEBUILDER_USER`, `SLIDEBUILDER_HOST` | identity (tests) |
| `SLIDEBUILDER_SYSFONTS` | font folders instead of `%WINDIR%\Fonts` and the per-user font folder |
| `SLIDEBUILDER_NO_NET` | `1`: the helper makes no outbound request; Google fonts and previews answer the usual 502 "cannot be reached" (e2e, §12.1) |
| `SLIDEBUILDER_ROLLBACK_QUIET` | the rollback's pause in seconds (tests) |
| `SLIDEBUILDER_SIM_FS_MS` | load tests only: adds a delay to every data-folder file operation |
| `SLIDEBUILDER_APP_WINDOW` | `0` = open a browser tab, not an Edge app window |

---

## 2. The deck document

### 2.1 The deck key

A deck belongs to a workbook **file name**. Its key is `doc_key(name)` (`util.py:67-69`):

```
safe_component(name, 60) + "-" + sha1(name.lower()).hexdigest()[:10]
```

`safe_component` replaces every character outside `A-Za-z0-9._-` with `_` and cuts at 60. Lower-casing matches
Windows' case-insensitive names. The key is the same as Slide Builder 3's, so a deck keeps its identity across the
migration. The helper accepts only keys matching `^[A-Za-z0-9._-]{1,60}-[0-9a-f]{10}$` (`decks.py:68`; else 400).
Workbook names must be 1–255 characters, no surrounding spaces, no `/`, `\` or control characters, not `.` / `..`.

### 2.2 The document (`WorkbookDoc`, `core/src/model/types.ts:69`)

```jsonc
{
  "schema": 3,                    // the document's format; unchanged in v4 (FORMATS.workbook)
  "workbook": "IBD weekly.xlsx",
  "rev": 42,                      // derived by the fold (§5)
  "updated": 1791214363000,       // derived: the last folded record's `at` (file-server ms)
  "updatedBy": "rossim",          // derived: the last folded record's `by`
  "log": [{"rev": 42, "by": "rossim", "at": 1791214363000}],   // derived: the last 20 records
  "preset": { "sheets": [...], "tables": [...], "slides": [...], "versions": [...] },   // null = no preset yet
  "style": { ... },               // StylePatch: partial, layered over config.json's defaults
  "edits": { "<sheet>": { "<A1 ref>": { ...CellEdit } } }
}
```

A deck nobody has saved starts from `{"schema": 3, "workbook": <name>, "rev": 0, "preset": null, "style": {},
"edits": {}}` (`decks.py:727-729`). Readers ignore keys they do not know and treat missing keys as defaults; adding
an optional field needs no format change.

**Style layers.** The style a slide is drawn with is `resolveStyle(built-in, config.defaults.style, doc.style)`
(`core/src/model/style.ts:1,16`): plain keys of a later layer win when not null; `pn` and `footer` merge per key;
`theme`, `colors` and `text` merge as a "look"; then each layer's `designs[<current design>]` look is applied on top.
`color` is clamped to 0–100, `radius` to 0–200 (default 100), `contrast` to 0–100 (default 50).

### 2.3 Field reference

Types from `core/src/model/types.ts`; the meaning is what its comments state.

**Preset** `{sheets: string[], tables: TableDef[], slides: SlideDef[], version?, updated?, versions?: DeckVersion[]}`.

| Object | Fields |
|---|---|
| `TableDef` | `id`, `sheet`, and `kind: "markers"` with `anchor`, `index`, or `kind: "range"` with `range`, `grow?`; plus `name?`, `cols?` / `rows?` (`{"<column/row number>": px}`), `scales?` (`{<rule id>: {range, dir: "row"\|"col"\|"all", mode: "zero"\|"minmax", fill, ink, invert?}}`), `merges?` (`{"C4:D5": "merge"\|"split"}`), `gridH?` / `gridV?` (`"on"\|"off"`, unset = as in Excel), `cellGrid?` (4.4, B20: `{"C7": {h?, v?: "on"\|"off", o?: true, c?: "#hex", w?: px}}` – gridlines on selected cells, a layer of their own drawn where the cell has no border), `borders?` (4.4, B28: `{"C7": {top?\|left?\|right?\|bottom?: {style: thin\|medium\|thick\|dashed\|dotted\|double, color} \| "none"}}` – cell borders over the workbook's on the slide; an inside edge drawn once, by the cell below / right), `sizes?` (`{glass\|excel\|clean: {cols?, rows?}}`, per design over `cols`/`rows`) |
| `SlideDef` | `id`, `type: "cover"\|"index"\|"content"`, `tables: string[]`, `items?` (4.3: `{<item id>: Item}`, charts and callouts, changed only by `item.patch`), `title?`, `subtitle?`, `date?`, `note?`, `layout?` (`{bands: number[][], w: number[]}`), `logo?`, `align?`, `valign?`, `scale?`, `notes?` (`{"<tableId>:<top\|bottom\|left\|right>": Note}`), `subs?` (index slide: show subtitles), `fmt?` (`{title\|subtitle\|note\|date: TextFmt}`), `sizes?` (`{glass\|excel\|clean: {layout?, scale?, align?, valign?}}`, per design over `layout`/`scale`), `free?` (4.4, B18: `{<design>: {on, items: {"t:<tableId>"\|"n:<noteKey>"\|"i:<itemId>": {x, y, w, h, scale?}}}}` – the free layout of that design; `render/layout.ts computeLayout` draws the saved boxes while `on`) |
| `Note` | `text`, `font?`, `size?`, `lh?` (line spacing), `pgap?` (space between paragraphs, lines), `b?`, `i?`, `align?`, `valign?`, `color?`, `w?`, `h?`, `bubble?`, `x?` / `y?` (placed freely, slide px), `span?` (left/right box beside all tables), `auto?` (`CommentCfg`: an automated comment written from the table, `model/comment.ts`) |
| `Item` (4.3) | `kind: "chart"` – `type` (`pie`\|`donut`\|`bar`\|`column`\|`line`: pie / donut drawn from 4.3, the others reserved), `values` / `labels?` (`DataRef` = `{sheet, range}` or `{table, range}`), `series?`, `title?` (`""` = none), `legend?`, `show?`, `colors?` (`{<slice index>: hex}`), `startAngle?`, `fmt?`, `box` (`{x, y, w, h}` slide px), `attach?` (`{table, side}`); or `kind: "shape"` – `shape` (`rect`\|`round`\|`circle`\|`pill`\|`arrow`\|`bubble`\|`icon`), `icon?`, `text?` (may quote `{Sheet!C7}`), `fill?` (`"none"` = no fill), `border?`, `radius?`, `fmt?` (+ `valign`, `pad`), `tail?`, `box`, `attach?` (07 §2.2) |
| `DeckVersion` | `id`, `name`, `hide: {<sheet>: ["C5:D9", …]}` – cells removed from that version |
| `StylePatch` | `design` (`"glass"\|"excel"\|"clean"`), `glass` (`"subtle"\|"medium"\|"strong"`), `color`, `logo`, `radius`, `contrast`, `logoBubble`, `pn` (page numbers `{on, start, pos, font, size, format, style, cover}`), `footer` (`{on, text, pos, size, style, cover}`), `theme` (`{id, c1–c4, a1, a2}`; built-in ids `aurora`, `ocean`, `forest`, `sunset`, `graphite`, `intesa`), `text` (`{title\|subtitle\|table\|note\|index\|pageno: TextFmt}`), `colors` (`{accent, bg, head, headInk, total, totalInk, ink, pos, neg, stripe, rule}`), `designs` (`{glass\|excel\|clean: {theme?, colors?, text?}}`) |
| `TextFmt` | `font?`, `size?` (slide px), `b?`, `i?`, `color?`, `align?`, `lh?` |
| `CellEdit` | `text?`, `orig?`, `font?`, `sz?`, `b?`, `i?`, `color?`, `fill?` (a highlight; a capsule in Liquid Glass), `bg?` (replaces the Excel colour; `"none"` removes it), `cf?` (`"Sheet!A1"` = that cell's conditional-format rules; `"none"` = no rules), `align?`, `role?` |

---

## 3. Operations

Clients never send documents. They send **operations** inside journal records (§4). The semantics are implemented
**only** in `core/src/model/ops.ts` and pinned by `shared/ops-vectors.json` (61 vectors: 56 operation cases and 5
fold cases, run by `core/tests/ops.test.ts`). The helper applies no operation (it builds one record for the v2
import, §13.6, without applying it).

`applyOp(doc, op)` changes the document in place and returns `false` when it skips the op. A skipped op changes
nothing; an unknown `op` is skipped. Values are deep-copied. `null` means "delete this key".

| op | fields | effect (`core/src/model/ops.ts`) |
|---|---|---|
| `preset.set` | `preset` (object or `null`) | replaces `doc.preset`. Skipped when `preset` is missing or not an object/null |
| `slide.patch` | `id`, `patch` | on the slide with that `id`: keys `title, subtitle, date, note, logo, layout, align, scale, valign, subs` are set, or deleted when `null`; `notes`, `fmt`, `sizes`, `free` (4.4) are map merges (a `free` entry – one design's layout – replaced whole); other keys ignored. Skipped when there is no preset or no such slide |
| `table.patch` | `id`, `patch` | on the table with that `id`: keys `name, gridH, gridV` set / deleted; `cols, rows, scales, merges, sizes, cellGrid, borders` (4.4) map merges. Skipped without preset or table |
| `cell.patch` | `sheet`, `ref`, `patch` | `sheet` non-empty, `ref` matching `^[A-Z]{1,3}[0-9]{1,7}$` (else skipped). On `doc.edits[sheet][ref]` (created if missing): keys `text, orig, font, sz, b, i, color, fill, bg, cf, align, role` set / deleted. Then: no `text` → `orig` deleted; an empty cell is deleted; an empty sheet is deleted |
| `style.patch` | `patch` | on `doc.style`: keys `design, glass, color, logo, radius, contrast, logoBubble` set / deleted; `pn, footer, theme, text, colors, designs` map merges |
| `item.patch` (4.3) | `slide`, `id`, `patch` | on `slides[slide].items[id]` (the slide's `items` map created / removed when emptied): `patch: null` deletes the item (skipped when it is missing); otherwise keys `kind, type, values, labels, series, title, legend, show, startAngle, box, attach, shape, icon, text, fill, border, radius, tail` set / deleted, `colors, fmt` map merges. A missing item is created only by a patch with a `kind` and a `box`. Skipped: no preset, no such slide, an empty id, `kind` other than `chart` / `shape`, a `box` that is not `{x, y, w, h}` finite numbers with `w`, `h` > 0 (or `null`) |

**Map merge** (`mapMerge`, `ops.ts:90`): value `null` deletes the whole map; an object sets each entry (replacing
that entry as a whole) or deletes it when `null`; a non-object is ignored; a map left empty is deleted. So two people
changing different columns, rules, text boxes or designs do not overwrite each other; the same entry is last writer
wins in fold order (§5).

**Inverse operations and undo.** `inverseOf(doc, op)` (`ops.ts:121`) computes, from the document **before** the op,
the op that restores the touched keys: `preset.set` → the previous preset; a patch → the previous value of each
patched key (`null` where it was absent), per entry for map merges; a `cell.patch` that touches `text` also restores
`orig`; `null` for a slide or table that does not exist; for `item.patch`, the deletion of an item it creates, the whole
item for a deletion, else the previous value of each patched key (per entry for `colors` / `fmt`). `DocSync.apply` collects the inverses of the ops that applied
(in reverse order); `History` (`core/src/sync/history.ts`) keeps up to 200 steps, coalesces changes with the same
`coalesce` key within 1.5 s, and forgets the steps when another workbook opens. Undo appends the inverse as **new**
operations in a new record, so it never reverts another person's later change to other keys.

---

## 4. Journals, records and framing

### 4.1 Journal files

A deck's journals are `data/v4/decks/<key>/j/*.log`. A name must match (`decks.py:63`)

```
^(<user 1-60>@<host 1-60>#<8 chars a-z2-7> | shared)(~<n>)?\.log$      n: 1–16 digits, no leading 0
```

where user and host use `[A-Za-z0-9._-]`. A journal is named in offsets, frontiers and tail answers by its **stem**
(the name without `.log`).

**Journal mode** (the default). Each writer appends only to its own files; no lock is taken on the edit path.

* The writer's first file is `<writer>.log`, but only for a writer this helper issued and has not written yet.
  Every later file is `<writer>~<n>.log`, `n` = the larger of the file server's time in ms and one more than every
  number already listed for that writer, and above the last number this helper used for it. Files are created with
  `O_CREAT|O_EXCL|O_APPEND`, so two helpers never share one, and a name is never used twice, even after its file was
  deleted (`decks.py:430-509`).
* A new file is started when: a write or flush failed (the file may end in a torn frame and is never written again),
  the handle was idle for 10 minutes (`IDLE_CLOSE` = 600 s; a background thread closes idle handles every 60 s), the
  helper restarted, or the page asked to `rotate`. So a torn frame is always the **last** frame of its file.
* `prepare` opens the writer's file ahead of the first append (the page asks during its debounce), so an append
  costs the share a write and a flush only.

**Lean-lock mode** (§7.2): every append takes the deck lock and goes to one shared journal `shared~<n>.log`; a new
one is started when the last ends without `\n` (a torn frame), numbered above every listed one, every one the
snapshot's frontier still names, and the last this helper gave out.

### 4.2 Framing

One record is one frame (`decks.py:82-84`):

```
<decimal byte length of body>:<CRC-32 of body, 8 lower-case hex digits>:<body>\n
```

`body` is the record as compact UTF-8 JSON (`separators=(",", ":")`, non-ASCII kept as UTF-8); the CRC is zlib's
CRC-32. Example (`helper/tests/fixtures/saved/journal.v4.log`):

```
143:f0cfb6d0:{"l":4,"s":2,"ops":[{"op":"style.patch","patch":{"design":"excel","color":35}}],"w":"rossim@PC-0042#k4p2x7qa","by":"rossim","at":1792033832314}
```

A reader scans frames from an offset (`unframe_ends`, `decks.py:95-136`):

| Bytes found | Meaning |
|---|---|
| a complete frame: length, `:`, 8 hex, `:`, body, `\n`, CRC matches, body a JSON object | a record; the scan goes on after its `\n` |
| only `\0` bytes from here to the end | **torn tail** (the file grew, its data never landed): stop, no error |
| an incomplete frame at the end (header, CRC, body or newline still missing; a header of digits only, < 12 bytes) | **torn or still being written**: stop, no error; read again at the next poll |
| the last frame complete in length but with `\0` bytes in its body or newline, nothing but zeros after it | torn tail (a power loss during an append nobody was acknowledged) |
| anything else: a header that is not digits + `:` within 12 bytes, a bad CRC field, a CRC mismatch, a missing `\n`, a body that is not a JSON object, a bad frame with more data after it | **corruption** at that offset |

When the scan from a reader's offset finds corruption, the helper scans the whole file from 0 before deciding (the
offset itself may be wrong). Corruption makes the deck read-only (§7.3).

### 4.3 Records

A record is a JSON object (`DeckRecord`, `core/src/model/fold.ts:10`):

| Field | Set by | Meaning |
|---|---|---|
| `l` | page | Lamport time, integer ≥ 1 |
| `w` | page | writer id; must equal the `writer` of the append (else 400) |
| `s` | page | the writer's sequence number, 1, 2, … (a new writer per page session starts at 1) |
| `by` | page | the author shown to people (the user name), or null |
| `ops` | page | the operations (§3) |
| `at` | **helper** | the file server's time in ms when appended (`server_ms`, §7.4); any `at` the page sent is overwritten |

The helper checks only the envelope: `w` = the writer, `l` and `s` positive integers (not booleans) (`decks.py:441-451`).
Anything else in a record is passed through untouched.

**Lamport.** A page's counter is the maximum of the snapshot's `lamport` and every `l` it has read (valid records,
including ones it then drops); a new record gets `++counter` (`docsync.ts:157,203`). So a record is always later
than everything its author had seen.

**Retries.** A failed append keeps the same record (same `w`, `s`, `l`) and sends it again after 2, 4, 8, 16, 32 s
(then every 32 s). After a failed write the helper starts a new file, and an append whose answer was lost may already
be on the share, so the same record can exist twice (in one file or in two); the fold keeps one copy (§5).

**seen.** `snapshot.seen` maps each writer to the highest `s` such that all of its records `1..s` are in the
snapshot. A copy of such a record found past the frontier (in another file) is not applied again.

---

## 5. Fold order (`core/src/model/fold.ts`)

`fold(snapshot, records)` gives the document every page shows; it depends only on the set of records, not on their
order of arrival.

1. **Filter.** A record is used only if `l` and `s` are safe integers > 0, `w` is a non-empty string and `ops` is an
   array (`validRecord`). Records with `s ≤ snapshot.seen[w]` are dropped.
2. **De-duplicate** by `(w, s)`. Of two copies the one earlier in the sort order below is kept; with equal `l` the
   one with the smaller `at` (a missing `at` counts as infinite) (`firstCopy`).
3. **Sort** by `l`, then `w` (JavaScript string order), then `s` (`recordOrder`).
4. **Apply** every op of every record in that order with `applyOp` (skipped ops are ignored). Each record, whether or
   not any op applied, adds 1 to `rev`, raises `lamport` to `l`, sets `updated = at` and `updatedBy = by` when those
   are present, and appends `{rev, by, at}` to the log.
5. **Derived fields.** `rev` starts from the snapshot's `rev`; `updated`, `updatedBy` and the log start from the
   snapshot header (else from the snapshot's document); the document gets `rev`, `updated`, `updatedBy` and the last
   20 log entries (`LOG_KEEP`); `backupAt` (a v3 field) is removed.
6. **New `seen`.** Per writer, `seen` moves on over records `seen+1, seen+2, …` without a gap; a gap stops it.

The frontier is not used by the fold: a reader reads each journal from the frontier's offset, and the page's
`DocSync` also drops a record whose position is at or below the frontier.

**In the page** (`core/src/sync/docsync.ts`): `confirmed = fold(snapshot, records read past the frontier)` and
`view = confirmed + the record being appended + the operations not sent yet`. Local changes show at once; 300 ms
after the last one (`DEBOUNCE_MS`) they become one record; one append is in flight at a time; the status shows
"Saved" when the helper has flushed it. Every 1.5 s (`TAIL_MS`) the page asks for the journals past its offsets and
folds the new records in, with its local operations rebased on top. When a tail reports a higher `gen`, the page loads
the new snapshot and drops the records it holds. Simultaneous edits of the same field resolve by `(l, w, s)` order
on every PC, not by arrival.

---

## 6. Snapshot and compaction

### 6.1 The snapshot (`data/v4/decks/<key>/snapshot.json`)

```jsonc
{
  "format": 4,                  // 4, or 5 once the deck holds 4.6 objects (§6.5); anything else: 409 "saved by a newer Slide Builder"
  "gen": 12,                    // 1 at creation or first migration; +1 per compaction and per re-migration (§9.1)
  "workbook": "IBD weekly.xlsx",
  "lamport": 8120,              // the highest Lamport time folded in
  "rev": 512,                   // revisions so far
  "frontier": {"anna@PC1#k3f9abcd": 40960, "bob@PC7#77aaxyzq~1792033832313": 1024},   // journal stem -> byte offset
  "seen": {"anna@PC1#k3f9abcd": 37},                    // per writer, records 1..n are in doc
  "by": "anna", "at": 1792033836314,                    // stamped by the helper that wrote it
  "updated": 1792033832314, "updatedBy": "anna", "log": [{"rev": 511, "by": "anna", "at": …}],
  "doc": { …WorkbookDoc… }
}
```

The records **before** each frontier offset are in `doc`. A journal not in the frontier is read from 0. The helper
writes the snapshot as compact JSON with a trailing newline, atomically (§7.1). An example (indented) is
`helper/tests/fixtures/saved/snapshot.v4.json` (format 5: `snapshot.v5.json`).

### 6.2 `compact` (compare-and-set on `gen`)

A page proposes `{baseGen, snapshot}` with `snapshot.gen = baseGen + 1`. The helper (`decks.py:782-825`):

1. validates the shape (format 4 or 5, `gen = baseGen + 1`, frontier of non-negative integers, `lamport` and `rev`
   non-negative integers, `doc` an object) → else 400; refuses a read-only (423) or rolled-back (409) deck;
2. stamps `by` (its user) and `at` (file-server time);
3. under the deck lock (with keepalive), reads the current snapshot and answers **409 `{gen}`** unless its `gen` is
   `baseGen`; 409 also when the new frontier is behind the current one for a journal, leaves out a journal the current
   frontier names that still exists, or `lamport` / `rev` would go back; **400** when the current snapshot is format 5
   and the new one is not (never lowered, §6.5); a format-5 snapshot over a format-4 one gets the marker first;
4. writes the snapshot; then deletes the journals the new frontier covers (no complete record past the offset; an
   offset beyond the file's size is not trusted) **and** that nobody wrote to for 24 h, plus empty journals untouched
   for 24 h, never one this helper has open; if any were deleted, rewrites the snapshot without their frontier keys
   (same `gen`, same document);
5. after the lock, writes the backup (§6.4). Returns `{gen, dropped}`.

### 6.3 When a page compacts (the policy, `docsync.ts`)

A page considers compacting after each tail and when it learns it is alone on the deck. It compacts when there are
records past the snapshot and any of:

* more than **2 000** records past the snapshot (`COMPACT_RECORDS`);
* the oldest of them is more than **24 h** old on the file server's clock (`IDLE_WRITER_MS`);
* this page is the only one with the deck open (presence, §8), has nothing pending or in flight, and has been quiet
  for **5 s** (`REST_MS`).

A compaction first reads the tails again; it does nothing on a round where a journal could not be read (`skipped`) or
the tail had no `now` (the helper did not trust the file server's clock), and nothing while a record past the snapshot
holds an op, a patch key or an item kind this page does not know (`knownOp`, `ops.ts`: a newer page's – folded as
nothing, it would be lost for every page; AUDIT-2 DATA-7). The candidate snapshot (`candidate`,
`docsync.ts:328`) folds only records

* appended at least **30 s** before the last complete tail's `now` (`COMPACT_MARGIN_MS`): a journal created since may
  still be missing from a reader's listing (the helper caches listings 3 s, the SMB client up to 10 s more), and a
  record in it must never be folded in after a newer one that replaced it;
* that the page knows the position of (read up to its offsets, or its own acknowledged appends);
* per writer, `seen+1 … n` without a gap;

and each journal's new frontier is cut back to the end of the last record before the first one that is not
included, so every frontier is a prefix of records all in the snapshot. A 409 makes the page load the winner's
snapshot; a compaction is never needed for correctness.

**Rest snapshot on leaving.** While the page is alone and everything is saved, the core worker computes the same
candidate one second after the last change; on `pagehide`, if nobody else is present, the page sends it as a
`keepalive` `POST …/compact` when the request body is at most 60 000 characters (the browsers' keepalive budget)
(`app/src/state/app.ts:123-128`, `app/src/sync/api.ts:119,145-150`).

**Prepare rollback** (Options › Administration) compacts every deck: each once, then one wait of 32 s, then each
deck not yet covered once more, at most 15 s each; a deck that still has records past the frontier is reported as
"still being edited" (`app/src/state/app.ts:470-506`).

### 6.4 Rotation, deletion of journals, backups, history

* **rotate** (`decks.py:898-929`): the page asks when a new snapshot covers its whole current journal. Holding its
  in-process lock for that writer (no lock file), the helper closes the writer's handle (the next append opens a new file) and deletes the writer's
  files that the frontier covers or that are empty, except files of the same writer open in this helper.
* **compaction** deletes covered or empty journals idle for 24 h (§6.2), which removes the files of closed or crashed
  sessions. Lean-lock shared journals are deleted only this way. No writer ever truncates or rewrites a journal.
* **backups**: `data/backups/v4/<key>/<gen>.json` after each compaction, the last 30 kept; a failed backup never fails
  the compaction. Snapshots written by the migration or at creation are not backed up there (the v3 bytes are, §9.1).
* **history**: `GET …/history` lists those backups newest first as `{gen, rev, at, by}`.

---

### 6.5 The format guard (ADR-019, amended 2026-10-21)

Decks are created and migrated at `format: 4` (`decks.CREATE_FORMAT`), which 4.0–4.5 read. A deck that receives or
holds what 4.0.0 does not apply whole (`needsV5` / `docNeedsV5` in `core/src/model/ops.ts`: items, `free`, `looks`,
`cellGrid`, `borders`, a text box's `frame` inside a slide's `notes` map (B49: 4.0 keeps the entry whole but would draw
the box without it), and every op or key added since) is raised once, by the page (`DocSync.upgrade`), before the
record is appended or a compaction would write it:

1. `POST /api/decks/<key>/format5` writes `incident-format-5.json` `{deck, format: 5, what, by, at}` (O_EXCL; an
   existing one is kept). Every 4.0–4.5 helper takes any `incident-*.json` for a damaged journal: from its next look
   at the folder it answers 423 to appends, prepare and compactions and reports `readonly` in tails. That look comes
   when it opens a journal, every `REFRESH_S` = 4 s for a deck it has an append handle on (journal mode), and at most
   every `CHECK_TTL` = 10 s on its page's tail – the only one in lean-lock mode, which has no handle; the SMB
   directory cache may add 10 s to each;
2. the page waits `BUMP_WAIT_MS` = 23 s from the marker's `at` (10 + 1.5 + 10 + 1 s, lean-lock's bound, which covers
   journal mode's 4 + 10 + 1 s; the mode may differ per PC), then asks for the marker again (the helper drops its
   cached journal listing; a marker removed meanwhile is written again and waited for);
3. it tails until no journal is skipped;
4. it compacts the snapshot **unchanged** with `gen + 1` and `format: 5` (on 409: reload, from 1 again; found at 5:
   done). The helper refuses this with 409 while the marker is younger than `BUMP_WAIT_S` − 1 s, and writes the
   marker itself when it is missing – DocSync always asks `format5` first, so the page normally never sees that 409;
5. only then the record is appended (it waits in the pending queue, "Saving…"), with a Lamport time 2^20 above
   everything seen (`BUMP_LAMPORT`): a record an old page appended in the gap without this page reading it (a share
   slower than the bound, a journal not listed yet) folds before it, since the old page never saw the 4.6 record.
   Every other 4.6 page jumps too, the first time it sees the deck go 4 → 5 and when it opens a format-5 deck whose
   snapshot is younger than `BUMP_FRESH_MS` (`BUMP_WAIT_MS` + 13 s: its own helper's listing may still miss a gap journal).

A page opening a format-4 deck whose snapshot or journal already holds such content raises it at once; the pagehide
snapshot never raises a deck (it cannot wait). Later snapshots of a format-5 deck are format 5 (`nextSnapshot`), even
when every such object was deleted. 4.0–4.5 helpers refuse to read a format-5 snapshot (409: open, `rotate`, the
compaction's read under the lock – and so the 24 h journal drop); their tail reports `gen: null` and never folds.
A 4.6 helper that reads a format-5 snapshot whose marker is missing writes it again. The 4.6 helper does not count
the marker as an incident, and answers **409** "reload the page" on a format-5 deck
(the marker, or the snapshot read) to `open`, `snapshot`, `tail`, `append`, `prepare`, `compact` and `rotate` from a
page that does not send `X-SB-Deck-Formats: 4,5` (`decks.check_page`: a 4.0–4.5 page left open while its PC's helper
was restarted on 4.6 – its old token already gets 403).

## 7. Locks, storage modes, incidents

### 7.1 The lock protocol (`helper/slidebuilder/locks.py`)

* A lock is a file created with `O_CREAT | O_EXCL`, holding `{user, host, pid, at, token}` (`at` on the file server's
  clock), fsynced. Default place `data/locks/<name>.lock`.
* Acquisition waits up to **10 s**, retrying every 50–200 ms (random); then `LockTimeout` → HTTP 503.
* A lock file not modified for **15 s** on the file server's clock is stale: it is renamed aside atomically (one
  waiter wins), checked again (if somebody else took it meanwhile it is put back) and deleted.
* `keepalive=True` rewrites the lock file in place every 3 s (a write, so the server stamps the mtime) while held.
* Release deletes the file only if its token is still ours (retried 20 × 50 ms against Windows sharing errors).
* Atomic file writes: `<file>.<uuid>.tmp` → flush → `fsync` → `os.replace`, retried 20 × 0.1 s for Windows sharing
  violations (`util.py:125-164`). Reads of shared JSON retry 5 × 0.1 s; an existing file that stays unreadable is
  503, never an empty document.

| Lock | File | Taken by |
|---|---|---|
| `wb-<key>` | `locks/wb-<key>.lock` | Slide Builder 3 saves; v4 migration and rollback (keepalive), before the deck lock; deleting and restoring a setup (B44) |
| deck lock | `v4/decks/<key>/lock` | compaction (keepalive), migration, rollback, creating a deck, lean-lock appends, deleting a setup (the lock moves with the folder and is released there) |
| `config` | `locks/config.lock` | `POST /api/config`, the v2 import, format upgrades of config.json (v3 too) |
| `user-<name>` | `locks/user-<name>.lock` | format upgrade of a prefs file only (writing prefs takes no lock) |
| `fonts` | `locks/fonts.lock` | font library changes, Windows-font captures, the copy-mode switch |
| `migrate` | `locks/migrate.lock` | the v2 settings import (keepalive) |
| `export-<doc_key(file name)>` | `locks/…` | choosing the final name of an export |
| `export-feedback` | `locks/export-feedback.lock` | saving an export problem report |
| `firstrun-<user>-<host>` | `locks/…` | the install check (timeout 5 s) |
| `update.lock` | `locks/update.lock` | `tools/update.py` (own protocol: O_EXCL, stale after 30 min) |

Appends in journal mode take **no** lock. Lock order where two are held: `wb-<key>`, then the deck lock.

### 7.2 Storage modes

`journal` (default) is §4.1. `lean-lock` (the fallback of ADR-006) is chosen by `SLIDEBUILDER_STORAGE=lean-lock`, or
by `data/v4/storage.json` `{"storage": "lean-lock"}` (re-read at most once a minute). In lean-lock every append takes
the deck lock and goes to the shared journal; `prepare` does nothing. The endpoints, records and fold are the same,
and readers fold every journal they find, so the two modes can even mix on one deck. `POST /api/decks/open` reports
the mode as `storage`.

### 7.3 Incidents and read-only decks

When a tail finds corruption (§4.2), the helper writes `incident-<journal stem>-<offset>.json`
`{deck, journal, offset, size, at, seenBy}` in the deck folder with O_EXCL (once, never overwritten) and logs
`INCIDENT`. While any `incident-*.json` exists the deck is **read-only**: `append`, `prepare` and `compact` answer
**423** `{error, readonly: true}`, and every tail carries `readonly: <reason>`; the page then stops saving and shows
the reason (4.6+: `incident-format-5.json` is no incident, §6.5). A helper looks at the deck folder (existence,
incidents, `rolled-back.json`, the format-5 marker) when it opens a journal, at
most every 10 s from tails, and every 4 s in the background for decks it has an append handle on. Recovering a deck
is a maintainer's manual job (there is no endpoint for it).

### 7.4 The file server's clock (`fsclock.py`)

Ages of shared files (stale locks, presence, idle journals) and every `at` use the **file server's** clock, never the
PC's. The offset is measured by writing a probe file `.clock-<host>-<pid>` in the folder concerned, reading its mtime
and deleting it; it is cached 30 s, measured again at once when the PC clock jumped by more than 2 s against the
monotonic clock, and retried after 1 s when the probe failed (the offset is then "unknown": the last known value or 0
is used, and `trusted` is false). Appends use the cached offset and refresh it in the background, never waiting for a
probe. A tail includes `now` only while the offset is trusted; without `now` no page compacts.

---

## 8. Presence v2

* File: `data/v4/decks/<key>/presence/<user>@<host>#<client>`, empty. `user` and `host` are %-encoded (at most 40
  characters each, else `%23` + 12 hex of a hash). Its **mtime** is the heartbeat, set with `utime` to the file
  server's time.
* `POST /api/presence {deck, client}` touches the caller's file (creating it, 404 if the deck does not exist), lists
  the folder once (`scandir`) and returns `{others: [{user, host, client, at}]}`: files touched in the last **25 s**,
  other than this client, sorted by user, host, client. Files older than **24 h** are deleted by whoever lists them.
* The page sends a heartbeat every **10 s** while a deck is open and tells its worker whether it is alone (used by
  the compaction policy, §6.3). On `pagehide` it sends `POST /api/presence/leave {deck, client}` as a keepalive
  request, which deletes the file.
* The rollback (§9.2) refuses a deck with anybody present.

---

## 9. Moving decks between Slide Builder 3 and 4 (`migrate_v3.py`)

A deck is owned by exactly one version at a time. Every step below runs under `wb-<key>` (keepalive, so a v3
helper never takes it for stale) and then the deck lock, in an order a crash can interrupt anywhere.

### 9.1 Migration (first v4 open, or `update.py --migrate-all`)

`POST /api/decks/open` calls `ensure_deck`: a deck with a snapshot and no `rolled-back.json` is v4's already; a deck
listed in `data/v4/pinned-v3.json` (a list of workbook names or keys, or `{"decks": [...]}`) → 409; otherwise:

1. A v3 document in a format above 3 → 409. Otherwise its bytes are copied to
   `backups/upgrades/workbook/<key>.v<n>.<YYYYMMDD-HHMMSS>.json` (never overwriting; unreadable → 503, nothing written).
2. The v3 file is **frozen first**: rewritten with all its content plus `"schema": 4, "movedTo": "v4",
   "movedGen": <gen>`. From here every v3 helper refuses it (§1.5).
3. `snapshot.json` at that `gen` (1, or the old gen + 1 after a rollback) with `doc` = the v3 document as it was
   (`backupAt` dropped, `schema` 3, `rev` / `updated` / `updatedBy` / `log` also in the header); after a rollback the
   old frontier, `lamport` and `seen` carry on and `rev` never goes back. Then `moved-from-v3.json`
   `{workbook, file, at, by, sha1, rev, gen}`.
4. After a rollback, `rolled-back.json` is removed last.

A workbook with no v3 document gets an empty deck (gen 1) and a frozen **stub** `{"schema": 4, "movedTo": "v4",
"movedGen": 1, "workbook": …}` in `workbooks/`, so a v3 helper can never start a second document for it. A frozen file
without its snapshot is finished by the next try. `--migrate-all` waits 2 s per v3 lock and reports decks a v3 helper
is saving as skipped.

### 9.2 Rollback (`update.py --rollback [WORKBOOK]`, `--use 3.x`)

1. Refused (409) while anybody is present (§8) or a complete record lies past the snapshot's frontier (the message
   points to Prepare rollback, §6.3).
2. `rolled-back.json` `{at, by, gen, rev, state: "marked"}` is written **first**. From then on helpers refuse
   appends and tails of that deck with 409 (the page asks to be reloaded); helpers with an append handle notice within 4 s,
   tails within 10 s, a lean-lock append at once (it checks for the marker under the deck lock).
3. A pause of 14 s (3 × 4 s + 2 s) for all decks at once, then, under the locks again: if the marker changed (the
   deck was opened in v4 meanwhile), or a record appeared past the frontier or somebody is present (the marker is then
   removed), the deck stays with v4.
4. The frozen v3 file is backed up and replaced by the snapshot's document as a v3 document (`schema` 3, `rev`,
   `updated`, `updatedBy`, `log` from the snapshot); the marker becomes `state: "done"`.

The next v4 open migrates a rolled-back deck again (§9.1) unless it is pinned. Fields only v4 knows travel inside the
document. `GET /api/decks` lists every deck with `rolledBack`.

---

## 10. HTTP API

### 10.1 Security and conventions (`server.py`)

* The helper binds `127.0.0.1` only. The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; an
  `Origin` header, when present, must be `http://` + one of those → else **403**.
* **Token.** Each helper start makes a random token (`secrets.token_urlsafe(24)`). Serving the page replaces the
  placeholder `__SB_TOKEN__` in `slide_builder.html` (in `<meta name="sb-token">`); the page sends it as
  `X-SB-Token` on every request. Every path under `/api/` (except `/api/ping`), `/files/`, `/assets/`, `/fonts/` and
  `/sysfonts` needs it (compared in constant time) → else **403**. `/assets/*` and `/fonts/*` may pass `?t=<token>`
  instead (for `<img>` and `@font-face`).
* **Formats.** A POST, PUT or DELETE under `/api/` carrying `X-SB-Formats` (the page sends
  `workbook=3;config=3;prefs=1`, `FORMATS` in `core/src/model/types.ts:68`) that differs from the helper's `SCHEMA`
  → **409** "Slide Builder was updated – reload the page". Requests without the header, or with one that cannot be
  parsed, are accepted; a format the header does not name is not compared.
* **Deck formats.** Pages since 4.6 send `X-SB-Deck-Formats: 4,5` with every request (`DECK_FORMATS` in
  `core/src/model/fold.ts`); without `5` in it, a request on a format-5 deck → **409** "reload the page" (§6.5).
* **Bodies**: chunked bodies → 411 (a request without `Content-Length` has an empty body); JSON bodies ≤ 2 MB, a compaction ≤ 32 MB, uploads, exports
  and conversions ≤ 300 MB, a logo ≤ 10 MB, a font ≤ 15 MB → else **413**. Invalid JSON or a non-object → 400.
* **Errors** are `{"error": "<message>"}` (deck errors add fields, e.g. `{gen}` or `{readonly: true}`). Every answer
  has `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`. HTTP/1.0, one request per connection; `HEAD` = `GET` without the body; methods
  without a route answer 404.
* **Status codes**: 400 bad request · 403 Host / Origin / token / file type / path outside its folder · 404 not found
  (also an unknown route) · 409 conflict (format mismatch, a file or snapshot of a newer format, compaction lost the
  race, deck pinned to or rolled back to v3) · 411 / 413 body · 423 deck read-only · 500 unexpected (details in the
  helper's window) · 501 converter not available · 503 busy: lock timeout, file unreadable, write failed, workbook
  being saved (the page keeps its changes and retries).
* **Windows only**: `/api/convert` and `/api/convert-workbook` answer **501** off Windows (or when the conversion
  fails). `/sysfonts` lists `%WINDIR%\Fonts` and `%LOCALAPPDATA%\Microsoft\Windows\Fonts`; elsewhere it is empty unless
  `SLIDEBUILDER_SYSFONTS` is set. `/api/open` uses `os.startfile` on Windows, `open` / `xdg-open` elsewhere.

### 10.2 Endpoints

Pages and static files:

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /`, `/index.html`, `/slide_builder.html` | – | – | the page with the token injected; 503 HTML page when it was not built |
| `GET /fieldcheck`, `/fieldcheck.html` | – | – | `tools/fieldcheck.html` next to the program (browser capability check); 404 when absent |
| `GET /api/ping` | – | – | `{app: "slide-builder", version}` (the "already running" probe) |
| `GET /files/<name>` | token | – | the workbook's bytes (`.xlsx .xlsm .xlsb .xls` only, not `~$*`; ROOT, then `backend\`); headers `X-SB-Mtime`, `X-SB-Size`. Read only when size and mtime are the same before and after and a zip has its end record; retried 8 × 0.5 s, then 503. 403 not a workbook, 404 missing |
| `GET /assets/<name>` | token or `?t=` | – | a picture (`.png .jpg .jpeg .gif .svg .webp .bmp .ico`; else 403; `..` → 403) from `data\assets`, `backend\`, ROOT: exact name, then the file name alone, then ignoring case; with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` |
| `GET /fonts/<file>` | token or `?t=` | – | a library font file (`.ttf .otf .woff .woff2`) |
| `GET /sysfonts` | token | – | `{fonts: [{file, family, subfamily, weight, italic, faces, size}]}` – this PC's `.ttf/.otf/.ttc` files |
| `GET /sysfonts/<file>` | token | – | one listed file (≤ 64 MB); 400 for a name that is not a plain listed font name, 404 unlisted |

Helper, settings, workbooks:

| Method & path | Request | Response |
|---|---|---|
| `GET /api/health` | – | `{app, version, user, host, folder, export}` |
| `GET /api/config` | – | `config.json` (defaults filled in, §13.4) |
| `POST /api/config` | `{baseRev: int, style: object}` | `{doc}`; replaces `defaults.style` if `rev == baseRev` under lock `config`, `rev + 1`; **409 `{error, doc}`** when it changed meanwhile; 400 without both fields |
| `GET /api/me` | – | `{user, host, prefs}` (prefs with `lastFile`, `pdfMode`, `zoom` null when unset; `schema` removed) |
| `PUT /api/me` | `{prefs: object}` | `{ok: true}`; the user's file replaced as a whole; 409 when it is in a newer format |
| `GET /api/files` | – | `{workbooks: [{name, mtime, size, rev, updated, updatedBy}], folder}`, newest first; `rev`… from the deck's snapshot (`updated` or `at`, `updatedBy` or `by`), else from a v3 document, else null |
| `GET /api/files/<name>/stat` | – | `{name, mtime, size}` with one `stat`; 403 not a workbook, 404 gone, 503 share error |
| `POST /api/upload?name=` | bytes (≤ 300 MB) | `{id, name}` – a workbook opened from outside the folder, kept in memory (8 entries, 2 h) |
| `GET /api/upload/<id>` | – | the bytes; 404 "upload expired" |
| `POST /api/logo?name=` | picture bytes (≤ 10 MB; extension `.png .jpg .jpeg .gif .webp .bmp .ico`, not `.svg`) | `{name}`: saved as `data\assets\<safe name>` (atomic, ≤ 80 chars); 400 empty or wrong type |
| `POST /api/open` | `{name}` or `{folder: true}` | `{ok: true}`: opens a file of the export folder, or the folder, with the OS; 400 neither given; 404 missing; 403 outside the folder |
| `POST /api/export-file?name=` | PDF or PNG bytes (≤ 300 MB) | `{ok: true, files: [<name used>]}`; only `.pdf` / `.png` names whose bytes start with `%PDF-` / the PNG signature (else 400); control characters → space; Windows-invalid characters → `_`; stem ≤ 200 chars; written to a temp file in `export\`, then under lock `export-<doc_key(name)>` renamed to the first of `name`, `name (2)` … `name (50)` that is not open in another program |
| `POST /api/export-feedback` | a non-empty JSON object (≤ 2 MB) | `{ok: true, file: "feedback/<YYYYMMDD-HHMMSS>-<user>.json"}`: `{kind: "export-feedback", schema: 1, app, version, user, host, at, report}`, ≤ 64 KB (else 400), never replacing another report |
| `POST /api/convert-workbook?name=` | workbook bytes (≤ 300 MB) | `.xlsx` bytes made by Excel (§13.1); **501** off Windows or on failure |
| `POST /api/convert?ext=` | picture bytes (≤ 300 MB); `ext` = letters only, ≤ 5, default `emf` | PNG bytes (§13.2); **501** off Windows or on failure |

Fonts (§12):

| Method & path | Request | Response |
|---|---|---|
| `GET /api/fonts` | – | the library `{schema: 1, fonts: [...]}` |
| `POST /api/fonts?family=&weight=&style=&source=&name=&range=` | font bytes (≤ 15 MB) | the library; 400 not a font, bad family name, more than 64 faces |
| `DELETE /api/fonts?family=` | – | the library; 400 without `family` |
| `GET /api/fonts/google?family=` | – | a Google font's faces fetched by the helper (§12.1); 404 not a Google font, 502 unreachable |
| `GET /api/fonts/google/file?ref=` | – | one of those files' bytes; 403 any other address, 404 not there any more (the cached faces of its family are forgotten; the page asks for the family again, once), 413 over 15 MB, 502 unreachable |
| `GET /api/fonts/google/preview?family=` | – | a font to show the family's name in the picker (B46): googleapis' `&text=` subset, else the family's regular file; 400 bad name, 404 not a Google font, 502 unreachable |
| `POST /api/fonts/capture?file=` | (body ignored, ≤ 2 MB) | `{mode: "fingerprint", file, family, sha1, embeddable, noSubset, faces, otherBuilds, otherHosts}`; in copy mode `mode: "copy"` plus `copied` and `copiedFaces`, `added` or `reason`; 400 bad name, 404 unlisted |

Decks (`<key>` is URL-encoded; any `<key>` not matching §2.1 → 400; `DeckError` statuses below):

| Method & path | Request | Response |
|---|---|---|
| `POST /api/decks/open` | `{workbook}` | `{key, writer, created, migrated, storage: "journal"\|"lean-lock", snapshot}`; migrates or creates the deck first (§9.1). 400 bad name · 409 pinned to v3, a v3 file of a newer format, a snapshot not of format 4 or 5, or a format-5 deck without `X-SB-Deck-Formats: 4,5` · 503 a lock busy or a file unreadable |
| `GET /api/decks` | – | `{decks: [{key, workbook, gen, rev, format, rolledBack, …}]}` (unreadable snapshots left out) |
| `GET /api/decks/<key>/snapshot` | – | `{snapshot}`; 404 no deck · 409 newer format · 503 unreadable (after 5 tries; never an empty document) |
| `GET /api/decks/<key>/tail?since=<JSON {stem: offset}>` | – | `{journals: {<stem>: {offset, records, ends}}, gen, now?, skipped?, readonly?}`: only journals with new complete records (`offset` = after the last; `ends` = each record's end offset); `skipped` = journals that could not be read now (asked again next time, never treated as empty); a journal deleted meanwhile counts as empty; `gen` = the snapshot's gen (null if unreadable now); `now` = file-server ms (only when trusted). 400 bad `since` · 404 no deck · 409 rolled back |
| `POST /api/decks/<key>/append` | `{writer, record}` | `{journal: <stem>, offset: <end of the record>, at}` after `os.fsync`. 400 envelope (§4.3) · 404 · 409 rolled back · 423 read-only · 503 write failed (send the same record again; a new file is used) |
| `POST /api/decks/<key>/prepare` | `{writer}` | `{ok: true}`; opens the writer's journal now (idempotent; nothing in lean-lock). 400 · 404 · 409 · 423 |
| `POST /api/decks/<key>/compact` | `{baseGen, snapshot}` (≤ 32 MB) | `{gen, dropped: [stems]}` (§6.2). 400 shape · 409 `{gen}` lost the race or would go back · 409 rolled back · 423 read-only · 503 lock busy |
| `POST /api/decks/<key>/rotate` | `{writer}` | `{deleted: [stems]}` (§6.4). 400 · 404 · 503 |
| `POST /api/decks/<key>/format5` | `{}` | `{created, at, now}` (§6.5: the marker; `at` = when it was written, file-server ms). 404 · 409 rolled back · 423 read-only · 503 |
| `GET /api/decks/<key>/history` | – | `{backups: [{gen, rev, at, by}]}` newest first |
| `POST /api/presence` | `{deck, client}` | `{others: [{user, host, client, at}]}` (§8). 400 bad key or client · 404 no deck |
| `POST /api/presence/leave` | `{deck, client}` | `{ok: <file was deleted>}` |

Removed routes answer 404: v3's `/api/workbooks/<name>/doc|ops|history` and `/api/config/ops` (4.0), and the export
engine's `/api/export`, `/api/assemble`, `/api/engine/*` (3.8). v3's presence without a deck is refused: `POST
/api/presence` without a valid `deck` answers 400.

**Page-side timeouts** (`app/src/sync/api.ts:79`): 60 s per request, 300 s for reading a workbook, uploading,
converting, compacting and exporting. A read (and `open`, `prepare`) is asked again once when the connection drops; a
write is not.

---

## 11. Display list (`core/src/dl/types.ts`)

The display list is the only contract between the designs (`core/src/render/`) and the three backends. A slide is a
flat, JSON-serialisable array of nodes in **slide px** (1600 × 900, y down), with paint fully resolved. Nothing else
reaches a backend, so nothing can be drawn on screen that the PDF cannot draw.

Shared types: `RGB` = `[r, g, b]` 0–255; `Stop` = `{o: 0–1, c: RGB, a: 0–1}`; `Paint` = `{solid: RGB, a?}` |
`{linear: [x1, y1, x2, y2], stops}` (in the shape's unit box) | `{radial: {cx, cy, rx, ry, stops}}`; `Stroke` =
`{w > 0, paint, dash?, cap?: "butt"|"round"|"square"}`; `Radii` = one number or `[tl, tr, br, bl]`; `PathCmd` =
`["M", x, y]` | `["L", x, y]` | `["C", x1, y1, x2, y2, x, y]` | `["Z"]`; `Matrix` = `[a, b, c, d, e, f]`.

| Node | Fields | Validation (`validate`) |
|---|---|---|
| `rect` | `x, y, w, h, r?, fill?, stroke?` | box numbers, `w`, `h` ≥ 0; fill or stroke required; a gradient stroke allowed |
| `path` | `d: PathCmd[], fill?, stroke?, rule?: "nonzero"\|"evenodd"` | non-empty, starts with `M`, right argument counts; fill or stroke; solid stroke only |
| `line` | `x1, y1, x2, y2, stroke` | numbers; stroke required (gradient allowed) |
| `image` | `id` (content hash), `x, y, w, h`, `crop?: {l, t, r, b}` (fractions cut away), `rotation?` (degrees clockwise about the centre), `flipH?`, `flipV?`, `alpha?`, `shadow?: {id, x, y, w, h}` (a pre-rasterised drop shadow drawn under it) | `id` non-empty; crop fractions 0–1 with `l + r < 1`, `t + b < 1`; alpha 0–1 |
| `shadow` | `x, y, w, h, r?, dx, dy, blur, spread, c: RGB, a, inset?` – CSS box-shadow semantics, drawn as 5 sharp layers (`dl/geom.ts`) | numbers; `blur` ≥ 0; `a` 0–1 |
| `text` | `font` (family key), `b?`, `i?`, `css?` (screen font list), `weight?` (1–1000), `size` > 0, `x, y` (baseline start), `src` (the Unicode text), `w?` (measured advance: every backend pins the run to it), `ls?` (letter-spacing included in `w`, informative), `gids?` + `adv?` (shaped glyph run) or `adv?` alone (one advance per code point, tabular figures), `tnum?`, `cl?` (cluster offsets), `dx?`, `dy?` (glyph offsets, y up), `fill` (solid only), `decoration?: {underline?, strike?}` (needs `w`), `decorative?` (drawn, not text) | lengths of `gids`/`adv`/`dx`/`dy`/`cl` consistent; `dx`, `dy`, `cl` need `gids` |
| `group` | `children`, `clip?` (an `RRect` or `{d}`), `alpha?` (a transparency group), `transform?: Matrix`, `blend?: "multiply"` | clip valid; alpha 0–1; 6-number matrix; only `multiply` |
| `hit` | `kind, id, x, y, w, h, label?` – an editor hit region | strings and box numbers |

Every number must be finite and within ±1e6. `validate(list)` returns every problem as `"path: what"`; it runs in the
tests, before every PDF / PNG export (an invalid list fails the export), and for thumbnails (an invalid slide gets no
picture). The backends do not validate.

| Backend | File | Draws | `hit` |
|---|---|---|---|
| SVG | `core/src/dl/svg.ts` | the editing stage | transparent `<rect data-hit data-id>` when asked for |
| Canvas 2D | `core/src/dl/canvas.ts` | thumbnails, PNG export, the "as pictures" PDF, clipboard (OffscreenCanvas in a worker) | ignored |
| PDF | `core/src/pdf/writer.ts` | vector PDF 1.7; each page `MediaBox [0 0 1200 675]`, the slide mapped by one `cm`; fonts subset and embedded as Type0 / Identity-H; `decorative` text as `/Artifact` | ignored |
| PowerPoint (4.5) | `core/src/pptx/scene.ts` + `writer.ts` | native shapes, real tables, text boxes, charts on a master and layouts made from the deck; 1 px = 7 620 EMU, px × 0.6 pt; `decorative` text as its run's shadow | marks elements, cells, items |

Geometry shared by all three (rounded rects, shadow layers, gradient strokes, image placement, decorations) is in
`core/src/dl/geom.ts`. `core/src/pdf/README.md` describes how each node becomes PDF operators.

---

## 12. Font library

### 12.1 The shared library (`data/fonts/`, `helper/slidebuilder/fonts.py`)

```jsonc
// data/fonts/fonts.json
{"schema": 1, "fonts": [{"family": "Inter", "source": "upload" | "google" | "system",
  "faces": [{"file": "Inter-400-1a2b3c4d5e.woff2", "weight": 400, "style": "normal", "range": "U+0000-00FF"}],
  "by": "rossim", "at": 1792033832313}]}
```

* Files are named `<family without spaces, safe, ≤ 40>-<weight>[i]-<first 10 hex of sha1(bytes)>.<ext>` and written
  before the index refers to them. Every change runs under lock `fonts`; afterwards font files no family refers to
  are deleted.
* `POST /api/fonts` adds one face: the format is detected from the first bytes (TrueType, OpenType, WOFF, WOFF2;
  else 400), at most 15 MB; family names `^[\w][\w .\-&+]{0,63}$`; weight clamped 1–1000; `style` `italic` or
  `normal`; `source` `google` or `upload`; a face with the same weight, style and range is replaced; at most 64 faces
  per family. `DELETE` removes a family.
* Google fonts are downloaded **by the helper** (`helper/slidebuilder/gfonts.py`; until 4.5 by the page, but at the
  office `fonts.googleapis.com` does not resolve for it): `GET /api/fonts/google?family=` reads
  `<ofl|apache|ufl>/<folder>/METADATA.pb` of the google/fonts repository from `raw.githubusercontent.com`, else
  `cdn.jsdelivr.net/gh/google/fonts`, else asks the CSS API (which answers Python with static TTF files), and answers
  `{family, source, license?, faces: [{weight, style, file, variable, range?}]}` – regular and bold, upright and
  italic as the family has them (a variable file gives both weights); 404 not a Google font, 502 unreachable (the
  message says what to do). `GET /api/fonts/google/file?ref=` fetches one such file (a google/fonts path or a
  `fonts.gstatic.com` address only, else 403). The page posts each face like an upload with `source=google`, a
  variable file made static at its weight first (core `text/static.ts`), so slides and exports never need Google
  later. The page asks Google itself only when the helper answers 502, and from disk (only the `latin` and
  `latin-ext` subsets when the stylesheet names subsets, `core/src/model/fonts.ts:148`).
* Proxy: Python ignores PAC files. The helper uses the first line (`http://host:port`, or `none` for a direct
  connection; `#` lines skipped) of this PC's `%LOCALAPPDATA%\SlideBuilder\proxy.txt`, else of the shared
  `data/proxy.txt`, else `HTTPS_PROXY` / the Windows proxy setting (urllib's lookup). The shared file applies to every
  PC using the data folder; a laptop at home or on VPN, where the office proxy does not answer, overrides it with its
  own file (`none` there for a direct connection). A proxy that asks for a password (407, also when it refuses the
  HTTPS tunnel: `Tunnel connection failed: 407`) is not supported: the message says to upload the files.
* Only a 404 means a source lacks the family; any other answer (a 429 rate limit, a proxy's 403, a sign-in page
  answering 200 to `METADATA.pb`) counts as unreachable and the next mirror is tried. When GitHub has no folder of
  that name and googleapis cannot be asked, the 404 says so ("not found on GitHub; Google could not be asked") instead
  of "check the spelling". The page stores a family's faces only once all its files have arrived.
* Cache (B46, 4.6): what the helper fetched is kept in `data/fonts/cache/`, so it is fetched once for the office – a
  family's faces (`family:<folder>`, `{at, res}`: asked again 30 days after `at`, the fetch, however often it is read
  meanwhile, and kept when Google cannot be asked then; a 404 for one of its files forgets it at once, and the page
  asks for the family again), each file
  (`file:<ref>`) and each preview (`preview:<folder>`: the subset, or which file it was). Every helper reads and
  writes it at once: an entry is `SBFC`, its length (8 bytes) and SHA-256, then the bytes, written to a temp file and
  `os.replace`d; a missing, vanished, locked, half-written or damaged entry is a miss and is fetched again (a font
  entry must also start like a font); a write that fails only costs a later fetch. After each write the helper
  deletes the least recently used entries (a hit sets its mtime, which only orders pruning) while the folder is over
  200 MB, down to 90 %,
  and temp files over an hour old; an entry another PC has open cannot be deleted on Windows and stays (the next one
  goes). 4.0's `fonts.py _sweep` deletes only font files at the top of `data/fonts`, so it leaves `cache/` alone
  (`test_gfonts.py` runs a frozen copy of it); `update.py` never touches `data`.
* Picker previews (B46): the page never links a googleapis stylesheet. The Google names on screen (an
  `IntersectionObserver`) are previewed through `GET /api/fonts/google/preview` with the token header, 4 at a time,
  each loaded with `new FontFace("sbpv <family>", bytes)` (a name of its own, so a subset never stands in for the
  library's faces); after one failure the picker asks no more in that window and the names show in fallback fonts.
  Cost at the office (googleapis does not resolve there): every preview is the family's whole regular file, often
  0.5–2 MB for a variable TTF (`METADATA.pb` lists either static or variable files, so there is no smaller face to
  choose); scrolling the list the first day pulls some 20–40 MB through the proxy into the cache, and each window
  holds about as much in `FontFace`s. A slow first preview may outlast the page's 60 s wait (the helper's worst case
  is longer): that window shows no more previews, the helper still finishes and caches it for the next.

### 12.2 Windows fonts (`helper/slidebuilder/sysfonts.py`)

The core measures and draws text from font files. A PC's Windows fonts are listed by `GET /sysfonts` (the first
face's names, weight and italic flag read from the file's `name` and `OS/2` tables; the per-user folder wins over
`%WINDIR%\Fonts`) and read by `GET /sysfonts/<file>`. The page captures each Windows font file a deck uses
(`POST /api/fonts/capture`) once per session, in the background, after 3 s without new font requests.

* **Fingerprint mode** (the default, gate G0): nothing is copied. The capture records the file's SHA-1, size and per
  face the names, `fsType` (embeddable, no-subset), variable or not, units per em, ascender / descender / line gap,
  average width and a SHA-1 of the advance widths, in `data/fonts/system/fingerprints.json`
  `{schema: 1, mode: "fingerprint", fonts: [{file, family, subfamily, sha1, size, embeddable, noSubset, faces,
  seen: [{user, host, at}]}]}` (the last 50 sightings per build; a build no PC has any more is dropped). The answer
  names the other builds of the same file and the PCs that have them (their slides may lay out differently).
* **Copy mode**: enabled by `slide_builder.py --allow-font-copy "<who confirmed, when>"` (written to
  `data/fonts/system/licence.json` `{copy: true, confirmedBy, at, by}`; `--allow-font-copy off` writes
  `{copy: false, …}`). A capture then copies **every** face of the family on this PC into the library as
  `source: "system"` – all or none – when each is a single-face `.ttf`/`.otf`, embeddable and not variable; a family
  the library already has from another source is not touched. The library's family then wins over each PC's copy.

---

## 13. Formats

### 13.1 Workbooks

The page lists `.xlsx`, `.xlsm`, `.xlsb`, `.xls` in ROOT and `backend\` (not `~$` lock files), reads one with
`GET /files/<name>` (or a local file, uploaded to `/api/upload`), and the **core** reads it in a worker. The kind is
decided from the bytes, not the extension (`core/src/xlsx/workbook.ts:42-58`):

| Content | Read by |
|---|---|
| a zip with `xl/workbook.xml` (`.xlsx`, `.xlsm`) | the core: fflate, a byte scanner for sheet data, XML for the rest (`core/src/xlsx/`) |
| a zip with `xl/workbook.bin` (`.xlsb`) | the core, natively since 4.1: BIFF12 records for workbook, styles, shared strings and sheets (`core/src/xlsx/xlsb/`); relationships, theme and drawings stay XML; cell values are formulas' cached results; conditional-format formulas are turned back into A1 text where covered (any other is kept as `#NAME?`, so the rule never matches) |
| a compound file with an `EncryptedPackage` stream (an encrypted / labelled workbook) | refused: "protected" |
| another compound file (`.xls`) | the helper's `POST /api/convert-workbook`: the PC's Excel via COM in PowerShell opens a temporary copy read-only (macros, events and link updates off; a dummy password so a protected file fails at once), saves it as `.xlsx` (format 51); 4 minutes at most; last 4 results cached in memory. Windows only (501). The original is never touched |
| anything else | refused ("not an Excel workbook") |

Hidden and very hidden sheets and chart sheets are not read. Workbooks are never written.

### 13.2 Pictures in workbooks

PNG, JPEG, GIF, BMP, SVG, WebP and ICO pictures are used as they are. EMF, WMF, TIFF, WDP and JXR pictures are
sent to `POST /api/convert?ext=` (`core/src/xlsx/drawing.ts:9`), which draws them to PNG with GDI+ (fallback:
PowerShell `System.Drawing`), scaled by 1600 / width but kept between ×1 and ×4, on a transparent background;
the last 64 results are cached in memory. Windows only: elsewhere, when the conversion fails, and from a page opened
from disk, the picture is reported as unsupported and drawn as such. A linked (not embedded) picture is unsupported
too.

### 13.3 Exports

The page renders every export itself, in the export worker, from display lists:

| Export | How |
|---|---|
| PDF (vector) | `core/src/pdf/writer.ts`: one page per slide, text in embedded fonts subset per document (the subsetter passed in, hb-subset; without one TrueType is subset by `pdf/ttf.ts`), pictures as JPEG pass-through or Flate with an SMask |
| PDF "as pictures" (`pdfMode: "exact"`) | each slide drawn by the canvas backend to PNG, one full-page image per page |
| PNG | the canvas backend, one file per slide |
| PowerPoint (4.5, B21) | `core/src/pptx/`: the lists asked with `pptx: true` (`SlideList.sem`: the kind of slide, charts' data, callouts' shapes, the palette); every node native (`core/src/pptx/README.md`), each picture once; fonts named, not embedded (`text/resolve.ts pptxFamily`) |

The bytes are posted to `POST /api/export-file`, which saves them in `export\` (§10.2). The helper has no export
engine (removed in 3.8).

### 13.4 `config.json` and personal preferences

```jsonc
// data/config.json  (format "config" 3)
{"schema": 3, "rev": 7, "updated": 1792033832313, "updatedBy": "rossim", "defaults": {"style": { …StylePatch… }}}
```

Only `defaults.style` changes. The page reads the config, applies a `style.patch` to `defaults.style` with the
core's operations and posts the result with the `rev` it read; on 409 it reads again and redoes the change (5 tries)
(`app/src/sync/api.ts:262-268`). Slide Builder 3 helpers change the same file under the same lock with `rev + 1`, so
neither loses the other's change. The page re-reads the config every 30 s (every tenth 3 s tick).

```jsonc
// data/users/<safe user name ≤ 80>.json  (format "prefs" 1) – whole file replaced by PUT /api/me
{"schema": 1, "lastFile": "IBD weekly.xlsx", "pdfMode": "exact" | "vector", "zoom": 1.25 | "fit",
 "versions": {"<workbook>": "<version id>"}, "softShadows": true}
```

### 13.5 Format numbers and upgrades (`helper/slidebuilder/upgrade.py`)

`SCHEMA = {workbook: 3, config: 3, prefs: 1}`; a file without `schema` counts as the first numbered version
(`workbook` 3, `config` 3, `prefs` 1). Reading an older file converts it once under its lock, after copying it byte
for byte to `backups/upgrades/<kind>/<file>.v<old>.<time>.json`; a newer file is never changed (409 "restart Slide
Builder"); a missing step raises an error. There are no steps yet (format 3 / 1 is the first). Frozen v3 documents
(`movedTo: "v4"`) are skipped by the start-up conversion and the self-test. A deck snapshot carries `format: 4`; the
helper refuses any other value with 409. Changing a format means: raise the number, add a step, raise `FORMATS` in
`core/src/model/types.ts`, and **add** a new example to `helper/tests/fixtures/saved/` (existing examples are never
edited; `test_upgrade.py` reads all of them).

### 13.6 The v2 settings import (`helper/slidebuilder/migrate.py`)

At start-up, under lock `migrate` (keepalive), if `backend\slide_builder_settings.txt` exists (a copy left in ROOT by
the old flat layout is moved there first) and `data\migrated.json` does not:

* `app.design, glass, color, logo, pn` (with v2's defaults merged in, `pageStart` turned into `pn.on/start`, nulls
  dropped) → a new `config.json` with `rev 1`, only when there is none;
* `app.lastFile, pdfMode` → `users\<current user>.json`, only when there is none;
* each workbook in `presets` / `files` → a new deck (§9.1 creates it, with its frozen stub) and **one record** in it:
  writer `v2-import@slide-builder#<8 base32 of sha1(key)>`, `l = 1`, `s = 1`, `by` = the user, `ops` = a `preset.set`
  (cover and index slides keep their position) and one `cell.patch` per stored cell. The core folds it like any
  record. A deck or v3 document that already exists is skipped, unless it is an import that stopped before its record
  (gen 1, empty, no record), which is finished;
* the settings file is renamed `slide_builder_settings.v2-backup.txt` (or `…v2-backup-<time>.txt`), and
  `migrated.json` records what was imported.

---

## 14. Concurrency and failure model

| Situation | What happens |
|---|---|
| Two people edit the same deck | each appends to its own journal with no lock; every page folds all journals in `(l, w, s)` order. Different keys never overwrite each other; the same key ends with the later Lamport time on every PC |
| Two compactions at once | one wins the compare-and-set on `gen`; the other gets 409 and loads the winner's snapshot |
| A slow share | the page shows changes at once and keeps them queued; one append in flight; `prepare` keeps the append to a write and a flush; reads are retried once on a dropped connection; requests time out after 60 s (300 s for big ones) and an append is then retried with back-off |
| A failed or interrupted append | the helper answers 503 and closes the file (it may end in a torn frame); the page sends the same record again, which goes to a new file; the fold keeps one copy (`w`, `s`) and the earlier `at` |
| A crash during a write | a torn last frame is ignored for ever (incomplete, or zeros); snapshot, config and prefs writes are atomic (temp + fsync + replace); a crash in the middle of a migration or rollback is finished or undone by the next try |
| Corruption in the middle of a journal | an incident file; the deck becomes read-only (423) until a maintainer intervenes |
| An unreadable file | 503 and retry; never an empty document. An unreadable journal is left out of that tail (`skipped`) and no page compacts on that round |
| Clock skew between PCs | ordering uses Lamport times, not clocks. Every `at`, lock age, presence age and journal idle time uses the file server's clock; with an unknown offset no `now` is sent and nobody compacts |
| A new journal not yet in a listing | the helper caches listings 3 s and the SMB client may add up to 10 s: a newcomer's first records appear late, and the 30 s compaction margin keeps them from being folded out of order |
| A page whose tails failed for longer than the margin | it may append a record with a Lamport time older than records a compaction already folded; the record then lands on top of the snapshot. Nothing is lost and every page converges, but a value somebody knowingly replaced can come back for that field (known limit B4) |
| A helper of an older or newer version | a page built for other formats is refused with 409 and asks to be reloaded; a v3 helper refuses frozen decks; a snapshot of another format is refused with 409 |
| A deck rolled back while open | its tails and appends get 409 and the page asks to be reloaded; the next v4 open migrates it again |

Not in this version (design items in `docs/next/` not implemented in the code): the shared parsed-sheet cache
(`v4/cache/`, PLAN S6.2), the `ReadDirectoryChangesW` wake-up (S6.3), and restoring a deck "as of" a time from the
journals.
