# Prompt: design the next Slide Builder (full rebuild on a new local stack)

Copy everything below the line into a new AI agent session that has this repository checked out
(read access to the code, a shell, the ability to run the tests). It is self-contained.

---

## Your role

You are a principal software architect. Your task is to study an existing application end to end and
**design its complete rebuild on a new local technology stack** that is markedly faster, lighter and
more reliable, while keeping everything its users rely on. You produce a design and a migration plan
that another engineering team (or agent) can implement without coming back to you with questions.
You do **not** implement the rebuild in this task; you may write small spikes/benchmarks to back your
decisions, kept in a `spikes/` folder.

## The application in one paragraph

**Slide Builder** turns tables in Excel workbooks into 16:9 presentation slides and exports them as
vector PDFs (and PNGs). It is used every week by a banking team to produce a reporting deck. Each user
runs a small local helper (Python standard library) on their own locked-down Windows PC; the helper
serves a single-file browser app (TypeScript + Preact, built into `backend/slide_builder.html`) on
`127.0.0.1`. All users share one **network folder (SMB)**: the workbooks, the saved setups
(`backend/data/`), exports and the export engine live there. Several people edit the same deck at the
same time; their changes are merged operation by operation under file locks on the share. The browser
parses the `.xlsx` itself, renders each table in one of three designs (Excel, Excel Refined, Liquid
Glass), lets users edit cells, text, layout and styles, writes automated analyst comments from the
numbers, supports named "versions" with cells removed, and exports through a headless Chrome/Edge.

## Read first (in this order)

1. `README.md` – the complete engineering guide: features (§1), deployment (§2), architecture (§3),
   data model and operations (§4), every front-end and back-end module (§5, §7), the flows end to end
   (§6), HTTP API (§8), concurrency (§9), export engine (§10), tests (§11), gotchas and known technical
   debt (§14–§15). Treat it as the specification of current behaviour.
2. `docs/ARCHITECTURE.md` – the binding contract: saved files, document shape, every operation and its
   merge semantics, locking protocol, HTTP API, format versions.
3. `docs/RENDERING.md` – how workbooks are read and how each design is drawn (scene model of Liquid
   Glass).
4. `docs/LOADTEST.md` – measured behaviour with 10 users on a shared folder; where time goes.
5. `docs/REVIEW.md` – the review of the previous generation and why the current architecture was chosen
   (including why it is not a Next.js server app). Do not repeat the mistakes it lists.
6. Then the code: `frontend/src/**`, `backend/slidebuilder/**`, `shared/ops-vectors.json`, the tests
   (`frontend/tests`, `frontend/e2e/app.spec.ts`, `backend/tests`), `tools/`.

Run the existing tests to see the system working (commands in README §11). Build and start
the app, open the test workbooks in `frontend/tests/fixtures/`, go through the wizard, edit, switch
designs, export. Measure before you judge.

## Hard constraints of the environment (non-negotiable unless you prove a safe alternative)

* **Corporate Windows 10/11 PCs, no admin rights.** Users cannot install MSI/EXE installers that need
  elevation. Software must run from the user profile (`%LOCALAPPDATA%`) or from the share.
* **Programs started from the network share may be blocked** (AppLocker/WDAC, "executables cannot run
  from T:\"); the current system therefore mirrors the browser engine to `%LOCALAPPDATA%`. Antivirus
  scans every new executable. Any native binary you propose must survive this (state how).
* **Python 3.8+ is available**; Node.js is **not** on users' PCs (developers only). Microsoft Edge is
  installed but its DevTools/remote debugging and headless mode may be disabled by policy. Excel is
  installed (COM automation is available but slow).
* **TLS is intercepted** by a corporate proxy (custom root CA); downloads must work through it without
  disabling verification. PowerShell may be in Constrained Language Mode. Consoles may be cp1252.
* **The shared SMB folder is the only channel between PCs.** There is no server, no database server,
  no message bus, no open inbound ports between PCs. Latency per file operation on the share is
  typically 2–15 ms, sometimes 40 ms; file locks must work across PCs; clocks on PCs differ (the
  current code uses the file server's clock).
* **The workbook is never modified.** All user changes live beside it.
* **Data must survive**: every saved deck (`backend/data/workbooks/*.json`, `config.json`,
  `users/*.json`, fonts in `data/fonts/`) must be readable by the new system, automatically, with the
  old files backed up. Users must be able to go back to the old version for a while (state the
  coexistence rules: can old and new run on the same share at the same time? if not, how is the
  switch made safe?).
* Exports must be **vector PDFs** (real text and tables, selectable), one page per slide, filling the
  page exactly, small and fast to open in Adobe Acrobat; pictures only where content is a picture.
* Updates are pushed by one person and picked up by everybody (today: `Update Slide Builder.bat`
  pulling from GitHub into the share). Keep a mechanism of equal or lower friction.

## What must be preserved (functional parity checklist)

Build the complete checklist yourself from README §1 and the e2e tests; it must include at least:
workbook reading (values, number formats with Italian separators, fonts, fills, borders, merges,
hidden rows/cols, conditional formatting, rich-text superscripts, pictures/shapes/text boxes, `.xlsb`
and `.xls` via conversion), table discovery ("x" markers, ranges, growing ranges), the 4-step wizard,
the three designs with identical geometry rules, per-design looks and per-design table sizing, the
unified text toolbar and deck text styles, the font library (Windows, Google, uploaded), cell edits
(text, format, roles, cell colour vs highlight, merges, gridlines, colour scales, painted conditional
formats, format painter), text boxes and their placement/snapping, the notes section, automated
comments (analysis, summary/sections modes, multi-table, units), versions with removed cells, cover
and contents slides, page numbers, footer, logo, themes, exports (PDF vector/pictures, PNG, every
version × design), multi-user editing with field-level merge, presence, own-changes-only undo,
format upgrades of saved data, the installer, the updater, and offline/fallback behaviour.

## Known pain points to solve (verify each, add your own)

* **Export speed and weight.** Every export starts or drives a headless Chromium, ships the whole
  slide DOM + CSS over HTTP, prints, then post-processes the PDF (page boxes, marker detection).
  Chrome rasterises some CSS (blurred shadows, masks, filters) into 300 dpi images and embeds CFF or
  variable fonts as Type 3; the current code works around this (`frontend/src/render/printcss.ts`,
  `backend/slidebuilder/pdf.py`). Ask whether a native PDF writer (drawing text, rectangles, rounded
  rectangles and gradients directly from the scene model) would be faster, smaller and more exact.
* **Parsing in the UI thread.** The workbook is unzipped and parsed in the page (regex parser over the
  XML string, yields every 4000 rows). Large workbooks block the UI; nothing is cached between
  sessions or shared between users who open the same workbook.
* **Shared-folder storage.** Each save is a sequence of SMB round trips under a lock; every client
  polls every 3 s; backups and presence are files. See `docs/LOADTEST.md` for the numbers.
* **One 460 KB HTML file** rebuilt and committed for every change; rendering produces large HTML
  strings with inline styles; two implementations of the operation semantics (TypeScript and Python)
  kept in sync by shared test vectors.
* **Layout fidelity** depends on the browser's fonts and text measurement on each PC; fonts differ
  between PCs (Segoe UI Variable vs Segoe UI) and between screen and export.
* **Engine fragility**: three engine fallbacks (Playwright, DevTools websocket, command line), policy
  blocks, Windows display scaling, page-size rounding; an in-window fallback that rasterises.

## What to design

Evaluate the options honestly against the constraints, with evidence from spikes where it matters.
Candidates to consider (not an exhaustive or preferred list): keeping a browser UI served by a local
helper but replacing the Python helper with a single self-contained binary (Rust, Go, .NET
self-contained, or a frozen Python); a native shell (Tauri/WebView2 – WebView2 is part of Windows –,
Electron, .NET MAUI/WPF/WinUI); moving workbook parsing to a native library (e.g. `calamine`-class
readers, `openpyxl`-class readers, or a custom streaming reader) and caching parsed workbooks on the
share; replacing headless-browser printing with a direct PDF writer (e.g. `pdf-writer`/`krilla`/`printpdf`
in Rust, `QuestPDF`/PDFsharp in .NET, `pdf-lib` in TS, ReportLab in Python) fed by the scene model;
WebAssembly for the parser/layout engine shared by UI and exporter; a local embedded store (SQLite in
WAL mode is **not** safe on SMB – say what is) versus per-document files; replacing polling with file
change notifications (`ReadDirectoryChangesW` on SMB has caveats – verify) or a lightweight
peer-elected coordinator. Reject options that violate the constraints, and say why.

Your design must specify, concretely:

1. **Target architecture** – processes, languages, libraries (with versions and licences), how it is
   packaged, signed (if possible), distributed through the share and updated without admin rights; a
   diagram; what runs where.
2. **Core data model** – one canonical definition of the document, operations and merge semantics
   (a single implementation if possible, generated bindings otherwise), the scene model shared by
   screen rendering and PDF export, font handling, and how text is measured identically on screen and
   in the PDF.
3. **Storage and concurrency on SMB** – file layout, locking, atomic writes, conflict handling,
   change notification or polling, presence, backups, crash safety, clock skew; worst-case behaviour
   with 10–20 concurrent users on one deck at 15 ms and 40 ms per file operation.
4. **Rendering pipeline** – xlsx → grid → table layouts → scene → (screen | PDF | PNG), with caching
   and incremental updates; how each of the three designs (incl. the Liquid Glass look: translucent
   cards, soft shadows, gradients) is expressed in vector PDF without rasterisation.
5. **Export engine** – how a 20-slide deck is exported in < 2 s per design, the PDF size budget
   (e.g. < 150 KB per Excel slide, < 400 KB per Glass slide), font embedding (TrueType subsets), and how
   pixel-exactness between screen and PDF is verified.
6. **Editor UX** – what stays, what is redesigned (the toolbar was recently unified; keep its
   principles), performance targets (open a 30 MB workbook, first slide visible, edit latency, export).
7. **Data migration** – reading every existing saved format (`backend/tests/fixtures/saved/`), the
   upgrade path, coexistence/cut-over plan, rollback.
8. **Testing strategy** – how the existing behaviour is captured before rewriting (golden files from
   the current renderer: HTML/scene snapshots, PDF text and geometry, comment texts, op vectors), the
   parity harness between old and new, load tests on a simulated share, the Windows-policy test matrix.
9. **Migration plan** – phases with deliverables, each phase shippable, ordered by risk; estimated
   effort; what can be reused (e.g. the TypeScript parser/renderers compiled differently) and what is
   rewritten; the risk register with mitigations; explicit non-goals.
10. **Benchmarks** – a baseline you measured on the current system (open, render, edit round trip,
    save under load, export time and size per design) and the targets for the new one.

## Method and rules

* Base every claim about the current system on the code or a measurement; cite files and functions
  (`path:line`). If the README and the code disagree, the code wins – note the discrepancy.
* Prefer boring, proven technology that works offline on locked-down Windows. Every new runtime
  dependency must be justified (size, licence, maintenance, policy risk).
* Keep the user-visible behaviour unless a change is a clear improvement; list every behaviour change.
* Make decisions; do not hand back a menu. Where you are unsure, run a spike and report the result.
* Be explicit about what you could not verify in this environment (e.g. Windows policies, SMB
  behaviour, Acrobat rendering) and how the team should verify it.

## Deliverables (write them into `docs/next/` in the repository)

1. `docs/next/00-summary.md` – one page: the recommendation, why, expected gains (with numbers),
   effort, top risks.
2. `docs/next/01-current-system.md` – your understanding of the current system and the measured
   baseline, including discrepancies with the README.
3. `docs/next/02-options.md` – options considered, scored against the constraints, with spike results.
4. `docs/next/03-architecture.md` – the target architecture (sections 1–6 above), diagrams.
5. `docs/next/04-data-and-migration.md` – data model, storage, compatibility, cut-over and rollback.
6. `docs/next/05-test-and-parity.md` – testing strategy and the parity checklist (every feature, how
   it is verified).
7. `docs/next/06-plan.md` – phased plan, effort, risk register, non-goals.
8. `docs/next/adr/NNN-*.md` – one Architecture Decision Record per major decision.
9. `spikes/` – any benchmark or prototype code you wrote, with a README on how to run it.

Finish with a short message listing the documents, the headline recommendation and the three
biggest risks.
