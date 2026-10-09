# PROGRESS · Slide Builder 4 rebuild

Tracks [`docs/next/PLAN.md`](docs/next/PLAN.md) Part C. One line per step; a step is ticked only after the
double-check protocol of [`docs/next/PROMPTS.md`](docs/next/PROMPTS.md) (tests, clean clone, review,
numbers measured twice). Measured numbers go into the step's line.

## Steps

### M0 · Foundations on v3 (v3.4)
- [x] S0.1 · CI, PROGRESS.md, one check command — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `npm run check`; `.github/workflows/ci.yml` (unit, helper 3.8 + 3.12, e2e, and parity from S0.5). Baseline 114 Vitest / 131 helper / 15 e2e. Surprises: Chrome's sandbox needs `kernel.apparmor_restrict_unprivileged_userns=0` on ubuntu-24.04; runners pinned to ubuntu-24.04 (26.04 has no Python 3.8); the helper listened with a backlog of 5, so a burst of requests waited 1 s for a TCP retry (now 128, with a test); an intermittent CI e2e failure (about 1 run in 4): the tests polled the helper's files with `expect.poll`, which fails at once - not after its timeout - when the callback throws; reading a document or field that the page had not saved yet (saves leave 300 ms after a change) threw, so a CI runner that was a little slower failed on the first read. Fixed with `pollFile` (a read that throws counts as "not yet" and is retried) on every such poll, plus the exact document name (not a save's `.tmp` file); a failing e2e test now prints the page's requests, the save status and the workbook files. Found with 6 parallel CI copies and a helper request log (temporary, removed). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.2 · Release pipeline — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `tools/make_release.py` (reproducible ZIP + MANIFEST.json, `--verify`, `--notes`), `release.yml` on `v*`. The test tag is for a person (Waiting for). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.3 · Side-by-side installs, current.json, Edge app window — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `update.py --release/--zip <file>/--use`, `--selftest`, Start file reads `app\current.json` with `python -c`, Edge `--app` (B12). Rehearsed on a copy of a share folder (install, flip, rollback, start, data untouched). Not run on real Windows cmd.exe/Edge (W5, W6 in field-results.md). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.4 · v3 quick fixes found in the review — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). B6 (save state notifies), B13 (`/api/files/<name>/stat`, list only on the Open menu), presence from one directory listing. Share operations per user per minute, idle: 910 → 78; editing: 1217 → 398 (Measurements). Side effect: the e2e suite runs in ~2 min instead of ~4 (no more waiting for the 3 s tick). verified: tests ✓ clean clone ✓ review ✓
- [x] S0.5 · Capture v3 as golden data — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). `tests/corpus/` (9 workbooks, 14 decks), `tools/capture-v3.mjs`, `tools/parity.mjs` + `npm run parity` + CI job, `tools/anonymise.py`; `golden/` 135 slides, 36 screenshots (a chosen set: tests/corpus/pixels.json). Parity on v3: 0 differences, twice (MANIFEST `git` 842ec5f is the pre-rebase commit the capture ran on; its `page` sha256 equals the committed page). Geometry/pixels are compared only where Chromium and fonts equal the capture's; the hosted CI runner compares texts and styles. 5 real decks: Waiting for. verified: tests ✓ clean clone ✓ review ✓
- [ ] S0.6 · Field tests on the real environment — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1). Kit done and tests ✓ clean clone ✓ review ✓: `tools/sharetest.py`, `tools/fieldcheck.html` (+ `GET /fieldcheck`), `docs/next/field-results.md`, `docs/next/field/acrobat-*.pdf`. **Not ticked: gate G0 is for people** (Waiting for). Found on this Linux container: a module-type Blob worker fails from file:// (classic ones pass).
- [x] S0.7 · Ship v3.4 — [PR #1](https://github.com/Gualbertol123/slidemaster/pull/1), shipped 2026-10-09: [v3.4.0](https://github.com/Gualbertol123/slidemaster/releases/tag/v3.4.0) (`slidebuilder-3.4.0.zip`, 281,569 bytes, + `.sha256`). Version 3.4.0, `CHANGELOG.md`, `docs/next/release-checklist.md`; checklist steps 2–4 run on temp copies (ZIP 35 files, verifies, reproducible; rehearsal install / self-test / start / rollback OK), then again on a corporate Windows 11 PC (field-results.md §0). CI green on `main` before the tag; `release` workflow green. Share update (step 6) on the install folder `C:\Users\U508169\Downloads\claude\Slide Builder` (Decisions): v3.3 → plain update to `main` → `--release 3.4.0` through the corporate proxy (GitHub digest ✓, MANIFEST ✓, self-test ✓), starts 3.4.0. verified: tests ✓ clean clone ✓ review ✓

### M1 · The React app (v3.5)
- [x] S1.1 · React API on the Preact runtime — [PR #2](https://github.com/Gualbertol123/slidemaster/pull/2). Vite/Vitest alias `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` → `preact/compat`; `jsxImportSource: "react"` with `@types/react` 19.2; an AST codemod renamed ~590 JSX attributes (template-string HTML keeps `class=`). New `ui/Input.tsx`: React's `onChange` fires per input and its controlled inputs restore the value after every event, which would break the 3 colour pickers (they commit on the native `change`, now `onCommit`), the 5 sliders and the wizard's boxes that store text without re-rendering. E15 also fails on console errors/warnings (4 fixture-caused browser messages allowed; a probe `console.warn` fails it). Page 464,826 → 473,244 bytes (gzip 153,654 → 155,956, +1.5 %). Review found: JSX runtime aliased to `preact/jsx-runtime` (compat mappings only active by import accident) → `preact/compat/jsx-runtime`; wizard version radio without handler → `readOnly`; Ribbon `tb()` spread `class`/string `style` (untyped, missed by tsc) → fixed. Parity 0 differences (full comparison), twice. verified: tests ✓ clean clone ✓ review ✓
- [x] S1.2 · Repository layout — [PR #2](https://github.com/Gualbertol123/slidemaster/pull/2). `git mv frontend app` (history follows); root npm workspaces `app`, `core` (one lockfile, `node_modules/` at the root, root scripts `build`/`check`/`test:e2e`/`parity`); `core/` empty, `lib: ["ES2022","WebWorker"]`, `types: []` (a `document` probe fails TS2584), own CI job `core`. The page is byte-identical (sha256 2d58fd7c0b29…). Paths fixed in CI, release.yml, tools, spikes, README §2/§7.5/§11/§16, docs, the release checklist, helper messages and tests. Surprises: `.gitignore` ignored `/app/` (side-by-side installs `app\<ver>\`, `app\current.json`): now only those are ignored, the sources sit next to them; `tools/update.py` `clear_leftovers` now removes only version-named `.old-*`/`.part` folders (test added). Review found the regenerated lockfile had bumped Playwright 1.63→1.64 (another Chromium), rollup and @types/react: rebuilt from the old lock, 0 version changes. verified: tests ✓ clean clone ✓ review ✓
- [x] S1.3 · Store with selectors replaces the global S — [PR #2](https://github.com/Gualbertol123/slidemaster/pull/2). One zustand 5.0.15 store (`subscribeWithSelector`) in slices doc / deck / selection / ui / prefs (`state/store.ts`); `S`, `emit()`, `useApp()` gone (the `S.` left in `issues.ts`/`preset.ts` are local sheets); components read through selectors (`useShallow` for objects). Render counts (`npm run bench`, Testing Library + Profiler on React 19, jsdom): selecting or extending a cell selection re-renders 4 components (FxBar, Ribbon, Status, TableRibbon; the stage overlay is imperative and follows `selection` through `followStore`), 10 polls with nothing new 0 (offline and with equal helper answers), a toast only Toast. Deviations, deliberate: the actions stay module functions over `get()`/`patch()` (the store holds data only; ADR-012's "store actions" in name); `thumbs.ts` subscribes to nothing (thumbnails are redrawn by the document changes that know which slide changed, as in v3); the stage follows `selection` and `ui.zoom` only, slides are redrawn by `state/app.ts`; PLAN's `selection.cells` is `selection.sel`; `ui/Input.tsx` attaches its `change` listener in a layout effect (its comment: a passive effect can run a frame later, and a `change` before it would be lost; no failing case was recorded for it). The render counts are measured on React 19 while the page still runs Preact until S1.4. Review (independent sub-agent) found no data-flow bug; fixed: **Fit** pressed while already fitted no longer re-fitted (`setZoom` re-fits when unchanged; test), poll test now also covers a served helper's equal-but-new answers, stage subscription unit-tested (`tests/stage-follow.test.tsx`); both new tests fail with the fix removed. Four screen updates now come at once instead of with the next poll (Decisions). Run on the corporate Windows PC (Node 22.23.3, Python 3.12.7): check 128 tests, helper 181 OK, e2e 15 passed, parity 0 differences (text-only: not the goldens' Chromium/fonts); CI green on PR #2. Page 483,809 bytes (gzip -9 160,628, +3.0 % on S1.2). verified: tests ✓ clean clone ✓ review ✓
- [x] S1.4 · Switch to real React 19 — [PR #2](https://github.com/Gualbertol123/slidemaster/pull/2). Aliases and `preact` removed; `react`/`react-dom` 19.2.8 exact in `dependencies` (the lock changes only by preact gone and dev flags cleared; no version changed); `createRoot` as before; `<StrictMode>` only under `import.meta.env.DEV` (`npm run dev`; `boot()` runs outside React, every component effect cleans up). Every raw `<input>`/`<select>` traced: their `onChange` updates the shown value synchronously (local state or a synchronous op → store), so React's controlled-input restore loses nothing; `ui/Input.tsx` (uncontrolled) and `ui/Field.tsx` (draft while focused, E8) unchanged. **React Compiler: tried, not used** (`@vitejs/plugin-react` 5.2.0 + `babel-plugin-react-compiler` 1.0.0, also in the component tests): render counts unchanged, but e2e E2 failed and parity found 48 differences (the side panel's issues text): components read objects that the app changes in place (e.g. `R.cfg`), which the compiler's caches assume never happens; reverted, nothing of it left. "No React warning": the e2e page is React's production build, which prints none, so the component tests (React's development build) now fail on any console error/warning (`tests/setup-console.ts`; it fails on the old `Dialog`); it found one: `ui/Dialogs.tsx` keyed the button instead of its fragment (fixed). New `e2e/file.spec.ts`: the built page from file:// (no helper), a fixture through `#fileInput`, the wizard, a cell edit kept in localStorage across a reload. Review (independent sub-agent): no bug in the switch; findings fixed above, plus a README nit; one older CommentDialog typing issue → Waiting for. Run on the corporate Windows PC: check 128 tests, helper 181 OK, e2e 16 passed, parity 0 differences (text-only), render counts unchanged (4 · 4 · 0 · 0 · 1). Page 659,609 bytes (gzip -9 212,518): +36 % raw / +32 % gzip on S1.3, the cost of React DOM over Preact (no budget for it in PLAN Part F). verified: tests ✓ clean clone ✓ review ✓
- [ ] S1.5 · Ship v3.5 — [PR #2](https://github.com/Gualbertol123/slidemaster/pull/2). Prepared up to the tag: version 3.5.0 everywhere (helper, the three package.json, the lock's workspace entries, `test_main.py`, backend README), `CHANGELOG.md` `## 3.5.0 - unreleased`; checklist steps 2–4 on this PC: page byte-identical to S1.4's (e2e 16 ✓ twice, parity 0), ZIP 35 files, verifies, reproducible; rehearsal on a copy of the install folder (3.4.0): install 3.5.0 → self-test PASSED → Start runs 3.5.0 on the copy's data → `--use 3.4.0` → `--use 3.5.0`. Milestone review (independent sub-agent over 767b10e..S1.5, 05 §4 rows 4.1–4.11 walked): one real finding, the status bar never showed "Saving…" under the store (DocSync did not announce entering "saving"; 3.4 showed it only when something else re-rendered) → DocSync announces it (B6; `docsync.test.ts` now expects pending → saving → saved, and its author test counts document changes only); nits fixed (README test table, CHANGELOG size). Known gap, no bug found: `change()`/`undo()` (coalescing, the 200 cap, cross-workbook undo) have no unit test yet (e2e covers Ctrl+Z of own edits only): to add in M2. **Not ticked: merging PR #2, the tag and the install-folder update are for a person** (Waiting for).

### M2 · The core in workers (v3.6)
- [ ] S2.1 · Move pure code into core/
- [ ] S2.2 · XML tokenizer instead of DOMParser
- [ ] S2.3 · Columnar SheetStore and byte scanner
- [ ] S2.4 · Core worker, typed RPC, the document moves into the worker
- [ ] S2.5 · Wizard and formula bar read cells through the worker
- [ ] S2.6 · Smoothness gate for opening
- [ ] S2.7 · Ship v3.6

### M3 · Display list and native export (v3.7)
- [ ] S3.1 · Display list, PDF writer, test tools
- [ ] S3.2 · Fonts and text shaping
- [ ] S3.3 · Excel and Excel Refined → display list
- [ ] S3.4 · Liquid Glass → display list
- [ ] S3.5 · Slide furniture → display list
- [ ] S3.6 · Pixel review
- [ ] S3.7 · Native export, in workers
- [ ] S3.8 · Pilot of the export
- [ ] S3.9 · Ship v3.7

### M4 · The screen draws the display list (v3.8)
- [ ] S4.1 · React stage on SVG
- [ ] S4.2 · Smooth drags
- [ ] S4.3 · Thumbnails as bitmaps
- [ ] S4.4 · Measurement from font files; screen = PDF
- [ ] S4.5 · Delete the old renderer and the export engine
- [ ] S4.6 · Ship v3.8

### M5 · Storage v4 and cut-over (v4.0)
- [ ] S5.1 · Helper: decks
- [ ] S5.2 · Core: fold, Lamport, DocSync v4
- [ ] S5.3 · Migration, freeze, rollback
- [ ] S5.4 · Load tests
- [ ] S5.5 · Delete the v3 storage path
- [ ] S5.6 · Pilot on a copy
- [ ] S5.7 · Cut-over

### M6 · Hardening (v4.1)
- [ ] S6.1 · Native .xlsb reader
- [ ] S6.2 · Shared parsed-sheet cache
- [ ] S6.3 · ReadDirectoryChangesW wake-up hint
- [ ] S6.4 · Documentation (README and ARCHITECTURE for v4)
- [ ] S6.5 · Remove the v3 start file

## Decisions

(Human decisions the plan needs, e.g. gate G0 outcomes. An agent never writes here on its own.)

- 2026-10-09 · M0 merged and v3.4.0 shipped with S0.6 open: gate G0 runs in parallel (PLAN Part C), results
  due before M3 (Acrobat, fonts) and M5 (storage).
- 2026-10-09 · The work runs locally on one PC: the checkout `C:\Users\U508169\Downloads\claude\slidemaster`,
  and the install folder `C:\Users\U508169\Downloads\claude\Slide Builder` takes the place of `T:\Slide Builder`
  in every "update the share" step. The product owner authorised the agent to merge PR #1 and to push the
  v3.4.0 tag.
- 2026-10-09 · The v3.4.0-rc1 pipeline test is replaced by the real v3.4.0 release (the workflow, the assets
  and the updater's digest check all passed on it).
- 2026-10-09 · S1.3: accepted as user-visible side effects of the store (the same kind of fix as B6): a toast
  hides at once when its action button is clicked; the helper pill updates at once after an engine install;
  undo/redo buttons update at once after undoing a change of another workbook; "Updated by X n min ago"
  counts on its own 10 s timer. Before, each waited for the next poll (up to 6–10 s).

## Waiting for

- **Ship v3.5 (S1.5, a person)** - after PR #2 is merged ("Create a merge commit") and CI is green on `main`, follow `docs/next/release-checklist.md`:
  * set `## 3.5.0 - <date>` in `CHANGELOG.md`, commit to `main`;
  * `git tag -a v3.5.0 -m "Slide Builder 3.5.0" && git push origin v3.5.0`, check the `release` workflow and the release assets;
  * the install folder (Decisions): `"C:\Users\U508169\Downloads\claude\Slide Builder\Update Slide Builder.bat"` (it already follows releases: a plain run installs the newest, 3.5.0); everybody restarts Slide Builder;
  * rollback if needed: `python tools\update.py --use 3.4.0` in that folder;
  * then tick S1.5 here with the date and the release link.
- **CommentDialog typing (found in the S1.4 review, as old as v3, product owner):** in the automated-comment dialog the "Unit after amounts" box trims on every keystroke (a space typed at the end disappears: "mln EUR" only by typing the space mid-word) and "Ignore below" erases a typed "0" (so "0.5" cannot be typed from the start). A fix changes what users see (not in B1–B14): fix it in a later step?
- **5 real decks (S0.5, product owner):** 5 workbooks from the share with their saved decks (`backend\data\workbooks\<name>-<hash>.json`). They are anonymised with `python tools/anonymise.py REAL.xlsx tests/corpus/workbooks/realN.xlsx --deck <deck>.json --deck-out tests/corpus/decks/realN.json --rename "<bank>=Bank A" …` (which names must be renamed?), reviewed by you, then captured into `golden/`.
- **Gate G0 (S0.6, people on the real share and PCs)** - fill in `docs/next/field-results.md`:
  1. `tools/sharetest.py` from 3–5 PCs (one over VPN), 10 writers in total, `--rdcw` → **storage decision**: journals meet 05 §3.5, or `STORAGE=lean-lock` in M5 (ADR-006);
  2. `tools/fieldcheck.html` from file:// and from the helper on each PC (Blob workers, WASM, OffscreenCanvas, fonts from bytes);
  3. the Windows policy matrix W1–W14 (05 §3.7);
  4. Acrobat and Edge with `docs/next/field/acrobat-excel.pdf` / `acrobat-glass.pdf` → **Acrobat recipe** (soft masks or flattened gradients in S3.5);
  5. the font-licence question R7 (may Windows fonts be copied to the share?) → **font decision** for S3.2;
  6. ReadDirectoryChangesW result → whether S6.3 is done.
  Then write the decisions under "Decisions".
- **Reference machine for full parity (S0.5, decision):** geometry, pixels and PDF text of `golden/` are only compared where Chromium and the installed fonts equal the capture's (`golden/MANIFEST.json` → `environment`: this Linux container, Chromium 141). Hosted CI compares texts and styles only. The GG/GP gates of M3/M4 need a decided reference: keep this container image, or pick a machine (e.g. a pinned CI image or a Windows PC) and re-capture `v3.4.0` there as new goldens. Which one?

## Measurements

| Step | What | Run 1 | Run 2 |
|---|---|---|---|
| S0.1 | e2e suite, local (15 tests) | 4.2 min | 4.1 min |
| S0.2 | release ZIP 3.4.0, built twice at the S0.7 commit (`make_release.py --no-tests`; the bytes change with any commit: README and CHANGELOG are inside, the manifest names the commit) | ≈ 281 kB (803 kB unpacked), 35 files, verifies | identical bytes on the second build |
| S0.4 | share file operations per user per minute, 10 idle users, mixed decks, 20 more decks (`tools/loadtest.py --users 10 --scenario mixed --duration 60 --count-ops --extra-books 20 --idle`; before: `--client v3.3 --helper <b2166d3>/backend/slide_builder.py`) | 909.8 → 78.2 (data 637.9 → 65.5, workbook folder 271.9 → 12.7) | 917.5 → 77.2 |
| S0.4 | the same while everybody edits (no `--idle`) | 1217.4 → 397.2 | 1217.4 → 398.1 |
| S0.4 | e2e suite, local, after B6 | 1.8 min | 2.0 min |
| S0.5 | `npm run parity` on v3 (14 decks, 135 slides, full comparison) | 0 differences, 253 s | 0 differences, 262 s |
| S0.6 | `tools/sharetest.py local --folder <temp dir> --workers 3 --duration 30 --think 0.5 1.5` on a local disk (tool check, **not** a field result): journal save p50/p95, visible p50/p95 | 0.9/1.9 ms, 1077/1707 ms | 1.0/2.1 ms, 1054/1736 ms |
| S0.6 | the same, lean lock (p95s rest on ~80 saves: one lock contention moves them) | 3.6/16.0 ms, 586/1416 ms | 3.9/13.1 ms, 592/1414 ms |
| S0.7 | release checklist steps 2–4 on temp copies | ZIP verifies; rehearsal install → self-test PASSED → start (3.4.0, share data) → rollback → forward | same on a second copy (rc1 then 3.4.0) |
| S1.1 | built page `backend/slide_builder.html` (bytes raw / gzip -9), two builds | 473,244 / 155,956 (before: 464,826 / 153,654) | 473,244 / 155,956 (identical bytes) |
| S1.2 | built page after the move (bytes; sha256 vs. S1.1), two builds | 473,244, identical to S1.1 | 473,244, identical |
| S1.3 | built page (bytes raw / gzip -9), two builds | 483,809 / 160,628 (S1.2: 473,244 / 155,937 with this PC's gzip) | 483,809 / 160,628 (identical bytes) |
| S1.3 | render counts (`npm run bench`): select a cell · extend it · 10 polls offline · 10 polls equal helper answers · a toast | 4 · 4 · 0 · 0 · 1 (Toast) | 4 · 4 · 0 · 0 · 1 (Toast) |
| S1.3 | e2e suite, corporate Windows PC (15 tests) | 1.9 min | 1.8 min |
| S1.4 | built page (bytes raw / gzip -9), two builds | 659,609 / 212,518 (S1.3: 483,809 / 160,628) | 659,609 / 212,518 (identical bytes) |
| S1.4 | render counts (`npm run bench`), as S1.3 | 4 · 4 · 0 · 0 · 1 (Toast) | 4 · 4 · 0 · 0 · 1 (Toast) |
| S1.4 | React Compiler trial (rejected) | render counts 4 · 4 · 0 · 0 · 1; e2e 1 failed; parity 48 differences; page 692,296 bytes | – (not kept) |
| S1.5 | release ZIP 3.5.0, built twice at 391aa24 (`make_release.py --no-tests`; tests run separately; the bytes change with any commit) | 342,390 bytes, 35 files, verifies | identical bytes |
| S1.5 | e2e (16 tests) and parity on the final M1 page, corporate Windows PC | 16 passed, 1.6 min · parity 0 differences (text-only) | 16 passed, 1.6 min · parity 0 differences |
