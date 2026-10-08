# 02 · Options considered

Each decision area below lists the candidates, the constraints that eliminate some of them outright, a
score for the survivors, and the spike that settled the question.

**Scoring.** 1 = poor … 5 = excellent, on six criteria:

| Code | Criterion | Weight | What it measures |
|---|---|---|---|
| **Pol** | Policy fit | ×3 | AppLocker/WDAC, antivirus, no admin, constrained PowerShell, proxy |
| **Perf** | Performance | ×2 | – |
| **Fid** | Fidelity | ×2 | screen = PDF, vector |
| **Rel** | Reliability | ×2 | fewer moving parts, fewer fallbacks |
| **Eff** | Effort and risk to build | ×1 | – |
| **Mnt** | Maintenance | ×1 | one language, boring tools |

Maximum = 55. **H** = a hard constraint violated: the option is rejected regardless of score.

Spike results are in `spikes/` (how to run: `spikes/README.md`).

---

## A. Host: what runs on the PC

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **A1 Browser page (Edge app window) + Python stdlib helper, slimmed** | **5** | 4 | 5 | 4 | 5 | 4 | **50** | **chosen** |
| A2 Single native helper binary (Rust or Go), page as today | 2 | 5 | 5 | 4 | 3 | 3 | 40 | rejected |
| A3 .NET 8 self-contained helper (single-file exe) | 2 | 4 | 5 | 4 | 3 | 3 | 38 | rejected |
| A4 Frozen Python (PyInstaller/Nuitka exe) | 2 | 4 | 5 | 3 | 4 | 3 | 37 | rejected |
| A5 Tauri 2 shell (WebView2 + Rust) | 2 | 5 | 5 | 4 | 2 | 3 | 39 | rejected |
| A6 Electron (bundled Chromium, ≈ 150 MB) | 1 | 4 | 5 | 3 | 3 | 3 | 33 | rejected |
| A7 Native .NET UI (WPF/WinUI 3/MAUI) | 2 | 5 | 3 | 4 | 1 | 2 | 33 | rejected |
| A8 Central server (Next.js, ASP.NET, …) | – | – | – | – | – | – | – | **H**: no server, no inbound ports, no IT hosting (constraint) |
| A9 Headless Edge driven via DevTools as the engine | – | – | – | – | – | – | – | **H**: DevTools/headless may be disabled by policy (constraint), and it is the fragility being removed |

**Why A1 wins.** A2–A7 all add a **new executable**. Today the team already mirrors Chrome for Testing to
`%LOCALAPPDATA%` because `T:\` is blocked (`engines.py:67-89`), and it decodes AppLocker/WDAC/antivirus
error codes (`engines.py:91-107`). That is the evidence that new executables are the riskiest thing on these
PCs:
* AppLocker default rules allow only `%ProgramFiles%` and `%WINDIR%`;
* WDAC can block unsigned binaries anywhere;
* an Authenticode certificate trusted by the bank is not in the team's hands;
* every update of an exe is a new unknown file for the antivirus.

`python.exe` and `msedge.exe` are already allowed on every PC that runs v3 today.

The helper's own speed has never been the bottleneck. It moves bytes; the time goes into SMB round trips
(LOADTEST) and Chrome printing (01 §3.2). Once export and parsing leave the helper, a faster helper language
buys nothing measurable.

WebView2 (A5) is attractive, because the runtime is part of Windows 11. But it still needs a host exe of
ours, and an Edge app window (`msedge --app=`) gives the same look with **no** new binary.

**If a native helper is ever needed** (for example, to keep SMB handles open across helper restarts):
build it as a Python extension (`.pyd`) loaded by the allowed `python.exe`. AppLocker's DLL rules are
usually off, though WDAC may still apply, so this needs a test. It is not needed for v4.

## B. Language and placement of the core (model, ops, reader, layout, renderers)

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **B1 One TypeScript core in Web Workers; helper stores bytes only** | 5 | 4 | 5 | 5 | 4 | 5 | **52** | **chosen** |
| B2 Rust core compiled to WASM (`calamine`-like reader, `krilla`/`pdf-writer`), TS UI | 5 | 5 | 5 | 4 | 1 | 3 | 47 | rejected for v4; kept as a lever for hot spots |
| B3 Status quo: TS in the page + Python ops in the helper | 5 | 3 | 4 | 3 | 5 | 2 | 42 | rejected: two implementations (P6) |
| B4 Python core in the helper (`openpyxl`, ReportLab) | 3 | 2 | 3 | 3 | 1 | 2 | 28 | rejected: not stdlib (pip through the proxy on every PC), slow on 30 MB workbooks, a third renderer |

**Spike `spikes/parser`** settled B1 against B2 for the reader. On a 75.7 MB sheet (1.56 M cells), a plain
TypeScript byte scanner into typed arrays took **303 ms**:
* versus **3 148 ms** for v3's regex loop;
* with 26.5 MB of memory versus 242 MB;
* plus 357 ms of inflate with fflate (JSZip: 692 ms).

The parse is no longer the dominant cost: downloading 30 MB over SMB is. A Rust/WASM reader might halve
303 ms, but it would bring a second toolchain and would rewrite years of tuned TS reading code (number
formats, CF, drawings). The tuned code moves as it is (03 §2.3).

**Spike `spikes/pdfwriter`** settled B1 against B2 for export. A 400-line TypeScript writer produces the
20-slide Glass deck in about 0.1 s. Rust crates (`krilla` 0.4, MIT/Apache) are excellent, but they are not
needed to reach the budget.

## C. Export engine

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **C1 Own PDF writer (TS) fed by the display list; PNG via OffscreenCanvas** | 5 | 5 | 5 | 5 | 3 | 4 | **52** | **chosen** |
| C2 Keep headless Chrome/Edge printing, more CSS work-arounds | 2 | 1 | 2 | 1 | 5 | 2 | 21 | rejected: the problem itself (01 §3.2, P1, P2) |
| C3 `pdf-lib` (MIT) + own drawing | 5 | 4 | 3 | 4 | 3 | 3 | 43 | rejected: no shading or soft-mask API (gradients with alpha are the Glass look), font subsetting via fontkit only for TrueType. We would extend it as much as write our own |
| C4 `jsPDF` | 5 | 3 | 2 | 3 | 4 | 3 | 38 | rejected: same gaps; weak on transparency groups |
| C5 Rust `krilla` / `pdf-writer` via WASM | 5 | 5 | 5 | 5 | 2 | 3 | 50 | close second: good libraries (they subset fonts, do shadings, masks). Rejected only to keep one toolchain; it is the fallback if our writer hits a wall |
| C6 ReportLab (Python, BSD) in the helper | 3 | 3 | 3 | 4 | 2 | 2 | 33 | rejected: not stdlib, and a second renderer in a second language |
| C7 .NET QuestPDF / PDFsharp | 2 | 4 | 4 | 4 | 2 | 2 | 34 | rejected: needs the .NET helper (A3); QuestPDF needs a commercial licence for companies over $1 M revenue |
| C8 Microsoft Print to PDF (Windows printing from Edge) | 3 | 1 | 1 | 1 | 4 | 2 | 21 | rejected: same rasterisation as Chrome, plus page-size dialogs |

**Spike `spikes/pdfwriter`** (20 slides, each with two full weekly tables):

| | v3 via Chrome (measured) | C1 native (measured) | Gain |
|---|---|---|---|
| Liquid Glass: time | 9.4–10.7 s | 0.10–0.14 s | ≈ 80× |
| Liquid Glass: size | 24.7 MB (1 204 KB per page; 18 300 images, 5 741 forms, a Type 3 font) | 597 KB (29 KB per page; 2 images, 0 Type 3) | 41× |
| Liquid Glass: viewer render per page (PDFium) | 766 ms | 108 ms | 7× |
| Excel: time / size | 2.2–2.5 s / 2.7 MB | 0.04–0.08 s / 142 KB | 30× / 19× |
| Text selectable and searchable | yes | yes (ToUnicode; pypdf extracts 2 345 chars on page 2, same as v3) | = |

**Spike `spikes/fonts`.** HarfBuzz `hb-subset.wasm` (608 KB, MIT):
* subsets a **CFF** OpenType font (Inter 591 KB → 12.7 KB, 18 ms), which my 150-line TrueType subsetter
  cannot;
* **instances a variable font** with all axes pinned. The variable tables are removed, so Type 3 output
  becomes impossible.

## D. Workbook reading and caching

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **D2 TS reader in a worker, columnar SheetStore** | 5 | 4 | 5 | 5 | 5 | 5 | **53** | **chosen** (M2) |
| D1 D2 + parsed-sheet cache on the share, keyed by part CRC-32 + size | 5 | 5 | 5 | 4 | 4 | 4 | 51 | **added in M6 if measured necessary**: D2 alone meets the targets for one user; the cache pays off when several people open the same 30 MB workbook over a slow link |
| D3 `calamine` (Rust, MIT) via WASM | 5 | 5 | 3 | 4 | 2 | 3 | 44 | rejected: reads values, not the styles, borders, drawings and CF that Slide Builder needs |
| D4 Excel COM to export values | 2 | 1 | 3 | 2 | 3 | 2 | 23 | rejected: slow (seconds to minutes), PowerShell COM is blocked in Constrained Language Mode (`convert.py:113`) |
| D5 Native `.xlsb` (BIFF12) reader in TS | 5 | 4 | 4 | 4 | 2 | 3 | 44 | **added in M6**: removes the COM dependency for `.xlsb` (B10). `.xls` (BIFF8) stays on COM: rare in this team |

**The cache key matters.** The zip central directory already holds a CRC-32 and the size of every part.
Nothing has to be hashed, and when someone edits one sheet in Excel the other sheets' caches stay valid.
Measured: 3.1 MB on the share for the 75.7 MB sheet; it loads in 205 ms.

## E. Storage and concurrency on the share

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **E1 Snapshot + per-writer append-only journals, Lamport order, compaction under a lock** | 5 | 5 | 5 | 4 | 3 | 3 | **49** | **chosen** |
| E2 Single document under a lock, trimmed to the minimum round trips (LOADTEST option A, completed) | 5 | 2 | 5 | 4 | 5 | 4 | 46 | rejected as the target (spike below); its fallback form is a single shared journal appended under the lock (same API, same fold in the core) if E1 fails the field test on the real share |
| E3 SQLite on the share (any journal mode) | – | – | – | – | – | – | – | **H**: SQLite documents that locking on network filesystems is unreliable, and WAL needs shared memory on one host, so WAL does not work over SMB. Risk of corruption |
| E4 SQLite or LMDB **locally** + sync through files | 4 | 4 | 4 | 2 | 1 | 2 | 35 | rejected: a sync protocol is still needed (= E1), plus a second store |
| E5 SharePoint/OneDrive synced folder | – | – | – | – | – | – | – | **H**: lock files do not work across sync clients; conflicts become copies |
| E6 Peer-elected coordinator (one helper serves the others) | – | – | – | – | – | – | – | **H**: needs inbound connections between PCs (constraint: none). Done through files, it becomes E1 with a single point of failure |
| E7 Database server, message bus | – | – | – | – | – | – | – | **H**: no server |

**Spike `spikes/storage/journal_sim.py`.** One process per user, real files, simulated round trips, 30 s
runs (full table in 04 §2.5):

| 20 users on one deck | E1 journals | E2 lean lock | v3 today |
|---|---|---|---|
| 15 ms per operation: save p95 / visible p95 | 37 ms / 2.1 s | 3.2 s / 5.6 s | 5.3 s / 10.1 s |
| 40 ms per operation: save p95 / visible p95 | **96 ms / 3.1 s** | 8.8 s / 19.7 s (overloaded) | 9.1 s / 27.9 s, 20 × 503 |
| Converged, no acknowledged edit lost | yes | at 40 ms queues had not drained at run end | yes, eventually |

## F. Seeing other people's changes

| Option | Verdict |
|---|---|
| **F1 Poll journal tails every 1.5 s** (open, seek, read the new bytes; parallel) | **chosen**: correct on every SMB server; its cost is measured above |
| F2 `ReadDirectoryChangesW` (SMB2 CHANGE_NOTIFY) via `ctypes` in the helper, as a **hint** that triggers an immediate poll | **added behind a flag** after the field test. Windows file servers support it; some NAS/DFS setups drop or coalesce events, and the SMB client may not report size changes of an open file until the writer closes or flushes. Never the source of truth |
| F3 `FindFirstChangeNotification` polling of directory metadata | rejected: directory metadata is cached by the SMB client for up to 10 s (`DirectoryCacheLifetime`) |
| F4 UDP broadcast/multicast between helpers | **H**: no traffic between PCs allowed (constraint) |

## G. Text measurement and fonts

| Option | Pol | Perf | Fid | Rel | Eff | Mnt | Score | Verdict |
|---|---|---|---|---|---|---|---|---|
| **G1 Core measures with HarfBuzz WASM from font files in the shared library (system fonts captured once); screen pins run widths (`textLength`)** | 5 | 4 | 5 | 5 | 3 | 4 | **50** | **chosen** |
| G2 Browser measures (status quo: canvas digit width, DOM `fitNotes`) | 5 | 3 | 2 | 2 | 5 | 4 | 38 | rejected: P7. Differs per PC, and screen ≠ PDF |
| G3 Own `cmap`/`hmtx` reader only (no kerning or ligatures), as in the spike | 5 | 5 | 4 | 4 | 4 | 4 | 49 | kept as the **fallback** if `hb.wasm` misbehaves: exact by construction, but loses kerning |
| G4 Ship one open font (Inter) for everything | 5 | 5 | 1 | 5 | 5 | 5 | 47 | rejected: fidelity, since it changes the look of every Excel table (Calibri, Aptos, Century Gothic) |

## H. Screen rendering of slides

| Option | Verdict |
|---|---|
| **H1 Display list → SVG on the stage (one `<g>` per table, swapped on change), canvas for thumbnails and PNG** | **chosen**. The SVG primitives map 1:1 to the PDF primitives, so screen = PDF. Vector at every zoom. DOM-addressable, so incremental patching and hit regions stay simple |
| H2 Keep HTML/CSS slides | rejected: CSS is the reason screen ≠ PDF and why `printcss.ts` exists |
| H3 Canvas-only stage | rejected for the stage: re-rendering a whole 1600 × 900 canvas per edit and per zoom step, and accessibility. It is used for thumbnails and PNG |

## I. Distribution and updates

| Option | Verdict |
|---|---|
| **I1 CI-built release ZIP (GitHub Releases), SHA-256 checked, installed side by side into `app\<version>\`, atomic `current.json` pointer** | **chosen**: the same one-click friction as today, instant rollback, and no build artefact in git |
| I2 Status quo: `git reset --hard` of a repository that contains the built page | rejected: a 460 KB generated file in every commit (P8); no side-by-side versions |
| I3 MSIX / ClickOnce | rejected: MSIX sideloading needs policy; ClickOnce needs a .NET app and signing |
| I4 winget / Intune / SCCM | not ours to operate. It would be welcome if IT offered it, but it is not needed |

## K. UI framework

| Option | Verdict |
|---|---|
| **K1 React 19 SPA + Zustand selector store; document owned by the core worker; stage = React components placing display-list SVG** | **chosen** (ADR-012). The problem in v3 is the global `S` + `emit()` that re-renders 15 components on every change, not the library. React adds the mainstream tooling (Profiler, Testing Library, `useTransition`, React Compiler) for the largest UI task, the stage rewrite. The port is mechanical (same JSX and hooks) |
| K2 Keep Preact, fix only the store | about 2 weeks cheaper and the same runtime smoothness; rejected to avoid `preact/compat` edge cases and to gain the tooling during the stage rewrite |
| K3 Solid / Svelte | rejected: a full rewrite of 170 KB of components for no measured gain |
| K4 Next.js / any server-rendered framework | **H**: no server (REVIEW §6) |

## J. What a "markedly faster, lighter, more reliable" rebuild does NOT need

* **No new runtime on the PCs.** Python and Edge stay; Playwright, Chrome for Testing and the `engine\`
  folder go.
* **No new language.** TypeScript stays, and only HarfBuzz is compiled code, shipped as WASM inside the
  page.
* **No server and no database.**
