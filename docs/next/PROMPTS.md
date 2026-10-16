# PROMPTS · ten prompts that build Slide Builder 4, each with double checking

Send these **ten prompts in order**, each to a **fresh agent session**, with this repository checked out. They
carry out every step of [`PLAN.md`](PLAN.md); the step ids (S0.1 …) refer to PLAN Part C.

## How to use them

1. **Before prompt 1:** merge the design branch (`docs/next/`, `spikes/`) into `main`.
2. **One prompt = one milestone = one pull request**, with one commit per step. You review and merge the PR,
   then send the next prompt.
3. **Every prompt can be resumed.** At a 🚦 human gate the agent stops on purpose and writes what it needs
   under "Waiting for" in `PROGRESS.md`. Do the human part (field tests, sign-off, pilot, tag), write the
   outcome under "Decisions", then **send the same prompt again**. The agent continues from the first
   unticked step.
4. **Double checking is built in.** Every step goes through the protocol in the prompt:
   1. the full test run;
   2. the same run again from a clean clone;
   3. an independent review pass against the checklist in the Appendix;
   4. measurements taken twice.

   Prompt 10 is an independent audit of the finished system.
5. **Agents never push tags and never touch the real share.** They hand you the exact commands.

| # | Prompt | PLAN steps | Human gates inside | Ships |
|---|---|---|---|---|
| 1 | Foundations on v3 | S0.1–S0.7 | tag v3.4 | v3.4 |
| 2 | The React app | S1.1–S1.5 | tag v3.5 | v3.5 |
| 3 | The core in workers | S2.1–S2.7 | tag v3.6 | v3.6 |
| 4 | Display list, PDF writer, fonts, designs | S3.1–S3.6 | needs G0 decisions; 🚦 G1 visual review | – |
| 5 | Native export | S3.7–S3.9 | 🚦 export pilot; tag v3.7 | v3.7 |
| 6 | The screen draws the display list | S4.1–S4.6 | 🚦 sign-off of layout differences (B7); tag v3.8 | v3.8 |
| 7 | Storage v4 | S5.1–S5.5 | needs the G0 storage decision; real-share load run | – |
| 8 | Pilot and cut-over | S5.6–S5.7 | 🚦 G2 pilot; 🚦 G3 cut-over | v4.0 |
| 9 | Hardening | S6.1–S6.5 | `.xlsb` twins from Windows; D+28 | v4.1 |
| 7b | Two consulting designs (McKinsey, Bain) – between M7 and M8 of docs/next/07 | S7b.1–S7b.5 | 🚦 specs approved; 🚦 pixel review | 4.2.x |
| 11–15 | docs/next/07 milestones M8 scenario export, M9 charts and callouts, M10 free layout and cell gridlines, M11 PowerPoint, M12 audit (see "Prompts 11–15" below) | S8.1–S11.5, audit | G5, G6, G7, G8 | 4.2.0–4.5.0 |
| 10 | Final independent audit | all | – | audit report |

---

## Prompt 1 · Foundations on v3 (S0.1–S0.7)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers milestone M0: steps S0.1–S0.7.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md if it exists.
- Resumable: continue from the first step of this milestone that is not ticked in PROGRESS.md. If a step
  needs a decision that is not under "Decisions", stop there.
- Git:
  - branch v4/M0-foundations from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S0.x · <title>";
  - one PR for the milestone.
- Never:
  - edit golden/ or */tests/fixtures/saved/ (add files only);
  - add a Python runtime dependency or ship a native executable;
  - remove an element id or data-* that e2e uses without updating the test in the same commit;
  - skip or disable a test;
  - put operation semantics anywhere but the TypeScript ops module;
  - push a tag or write to a real user share.
- User-visible changes only from B1–B14 (PLAN Part B §8). Anything else needs a human: write it under
  "Waiting for" in PROGRESS.md and stop.
- Environment facts to respect in all code:
  - Windows 10/11, no admin rights;
  - executables may not run from the share;
  - TLS proxy with a corporate root CA (ssl.create_default_context, never disable verification);
  - PowerShell may be in Constrained Language Mode (use no PowerShell for anything new);
  - cp1252 consoles (ASCII output);
  - Python 3.8 compatible;
  - helper = Python standard library only.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run:
   - npm run check (or the frontend equivalent before it exists);
   - the helper unittest suite;
   - npm run test:e2e;
   - npm run parity and npm run bench, once they exist;
   - every "Done when" check of the step.
   Keep the summaries.
2. Clean-clone re-run: commit, then `git clone <repo> /tmp/verify-<step> && cd /tmp/verify-<step>`,
   install from scratch, and run 1 again. This catches uncommitted files, local caches and machine state.
3. Independent review: if you can start a sub-agent, give it the step's diff and the Appendix checklist and
   ask it to try to prove the step wrong; otherwise do that pass yourself, reading the diff line by line.
   Fix every real finding, then repeat 1 and 2.
4. Measure twice: every number the step records is measured in two separate runs. If they differ by more
   than 10 %, find out why before recording.
5. Only then tick the step in PROGRESS.md: PR link, numbers (both runs), and "verified: tests ✓ clean
   clone ✓ review ✓".
At the end of the milestone, run 1–3 once more over the whole milestone diff and walk the rows of
docs/next/05-test-and-parity.md §4 that it touches (PLAN Part E).
Final reply:
- per step: what changed, the commands and results of both runs, the review findings and how they were
  fixed;
- the numbers;
- everything under "Waiting for".

STEPS (details in PLAN Part C; key facts below)

S0.1 CI, PROGRESS.md, one check command.
- frontend/package.json "check": "tsc --noEmit && vitest run".
- .github/workflows/ci.yml with three jobs:
  - unit: Node 22, `npm ci`, `npm run build` FIRST (build.test.ts fails if backend/slide_builder.html is
    stale), then `npm run check`;
  - helper: Python 3.8 and 3.12, `python -m unittest discover -s backend/tests`;
  - e2e: Playwright Chromium; set CHROME to `node -e "console.log(require('playwright').chromium.executablePath())"`
    (playwright.config.ts reads env CHROME).
- PROGRESS.md: one checkbox per step S0.1…S6.5 with its PLAN title, plus the sections Decisions, Waiting
  for and Measurements.
- Baseline today: 114 Vitest tests, 131 helper tests, 15 e2e tests (~4 min).

S0.2 Release pipeline.
- tools/make_release.py (stdlib): builds a ZIP of backend/ (no data/, tests/, __pycache__), the built
  page, tools/update.py, the .bat files, README.md and MANIFEST.json (sha256 per file); `--verify`
  re-hashes.
- .github/workflows/release.yml on tags v*: tests, ZIP, verify, then a GitHub Release.
- Unit tests for both.

S0.3 Side-by-side installs and the Edge app window (B12). Extend tools/update.py (441 lines; keep the
git path, the update lock, the protected paths, the saved-setup backups and the deck test-load):
- --release [latest|X.Y.Z] checks the GitHub asset "digest" when present, and MANIFEST.json always;
- extract to app/<ver>.part → rename to app/<ver>;
- `slide_builder.py --selftest` (read every deck/config/prefs read-only; probe create, rename and delete in
  data/locks) must exit 0 before app/current.json is written atomically;
- keep the last 3 versions; --use X.Y.Z rolls back; --zip <file> installs offline.
"Start Slide Builder.bat" starts app\current.json's version if present (parse it with `python -c`, not
PowerShell), else backend\. main.py opens `msedge.exe --app=<url>` (found in Program Files,
Program Files (x86) or the App Paths registry key via winreg), falling back to webbrowser.
Tests: install, flip, rollback, digest mismatch refused, an interrupted install leaves nothing, the
selftest gates the pointer, the data folder is never touched.

S0.4 v3 quick fixes (B6, B13).
(a) docsync.ts: emit() (~lines 32-40) notifies only on doc changes, so after flush (~line 82) "✓ Saved"
    waits for the 3 s tick. Notify on save-state change; add a test.
(b) app.ts tick (~57-62) calls /api/files every 6 s, and workbooks.py list_workbooks (~21-45) reads every
    deck document. Add GET /api/files/<name>/stat for the changed-on-disk banner; fetch the list only when
    the Open menu opens and at boot.
(c) presence.py others() reads every heartbeat file. Encode user/host/client/workbook in the file name and
    use directory-listing mtimes on the file-server clock (fsclock); still read old-format files.
(d) tools/loadtest.py simulates this traffic. Record the SMB operations per user per minute before and
    after.
Rebuild the committed page.

S0.5 Golden capture of v3 (docs/next/05 §2).
- tests/corpus/ holds the 4 fixtures, deck20 and big30 (move spikes/baseline/make_workbooks.py into
  tools/make_corpus.py), edge-case workbooks, and saved decks covering every option family of 05 §4,
  created through ops.
- tools/capture-v3.mjs (start from spikes/baseline/measure.mjs) freezes the clock (page.clock) and writes
  golden/<deck>/<design>/<version>/: slide-<n>.json (geometry, text, font, colour of every .t .wb .tw .note
  title logo page-number footer), slide-<n>.png, pdf.json, comments.json, issues.json, and MANIFEST.json
  (git sha, Chromium version, fonts).
- tools/parity.mjs + `npm run parity`: texts exact, boxes ±2 px, pixels by ΔE, an HTML report,
  tests/parity/accepted.json, exit code 1 on unaccepted differences, and a CI job.
- tools/anonymise.py.
Done when: 0 differences, twice in a row. Add to "Waiting for": 5 real decks to anonymise.

S0.6 Field-test kit (gate G0 is for humans; do NOT invent results).
- tools/sharetest.py (stdlib) runs the journal and lean-lock protocols from spikes/storage/journal_sim.py
  against a temp sub-folder of a REAL folder, from several PCs (coordinator/worker with a barrier file), with
  real round-trip measurement and convergence checks, plus an optional Windows ReadDirectoryChangesW probe.
  Test it locally with 2–4 processes.
- tools/fieldcheck.html: Blob Worker + WASM check, from file:// and the helper.
- docs/next/field-results.md: a template for W1–W14, sharetest, Acrobat with the spike PDFs, and the
  font-licence question.
- Add the G0 questions to "Waiting for".

S0.7 Prepare v3.4.
- Version 3.4.0; CHANGELOG.md.
- docs/next/release-checklist.md (reused for every release).
- Run it up to tagging on a temp copy.
- Put the tag and share-update commands under "Waiting for".
```

## Prompt 2 · The React app (S1.1–S1.5)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers milestone M1: steps S1.1–S1.5. Read docs/next/adr/012 and PLAN Part B §2 and §7 first.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: S0.1–S0.5 ticked (parity must exist). Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M1-react from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S1.x · <title>";
  - one PR for the milestone.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove an element id or data-* that e2e uses without updating the test in the same commit;
  - skip or disable a test;
  - put op semantics outside the TS ops module;
  - push a tag or write to a real share.
- User-visible changes only from B1–B14. Anything else → "Waiting for" in PROGRESS.md, and stop.
- Environment facts: Windows, no admin, single-file page that must still open from file://.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests, npm run test:e2e, npm run parity (must report 0 differences in this
   whole milestone: M1 changes no behaviour), npm run bench if present, and the step's "Done when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review (a sub-agent with the Appendix checklist if possible; otherwise yourself, line by
   line). Fix the findings, then repeat 1–2.
4. Measure twice (bundle size, render counts); investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the whole milestone diff, and walk 05 §4 rows 4.1–4.11 (all UI).
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S1.1 React API on the Preact runtime.
- Alias react/react-dom/react/jsx-runtime → preact/compat in Vite and Vitest; tsconfig jsxImportSource
  "react"; @types/react.
- Replace every preact import.
- Convert: class → className; for → htmlFor; string style="…" → objects; onInput on text fields → React
  semantics. ui/Field.tsx must keep the draft while focused (e2e E8 guards it).
- Keep every id and data-*.
- Extend the e2e "no page errors" test to fail on console errors and warnings.

S1.2 Repository layout.
- `git mv frontend app` (keep history).
- Root npm workspaces ["app", "core"].
- core/ with tsconfig lib ["ES2022", "WebWorker"] and NO DOM, type-checked in its own CI step.
- The build still writes backend/slide_builder.html.
- Fix the paths in CI, tools, README §11/§16, build.test.ts and spikes/README.

S1.3 Store with selectors.
- Replace the global S (state/store.ts ~line 15), emit() (~52) and useApp() (~56; 15 callers) with one
  zustand@5 store (subscribeWithSelector) in slices: doc, deck, selection, ui, prefs.
- Actions from state/app.ts become store actions.
- editor/stage.ts and thumbs.ts subscribe only to the slices they need.
- Grep must find no "S." left.
- Render-count test (Testing Library + Profiler): moving the selection re-renders ≤ 5 components (Ribbon,
  TableTools, FormulaBar, StatusBar, stage overlay); a poll with no change re-renders 0; a toast re-renders
  only Toast.

S1.4 Real React 19.
- Remove the alias and preact; react@19, react-dom@19 pinned; createRoot.
- StrictMode in dev only: boot() effects must be idempotent.
- Try babel-plugin-react-compiler; keep it only if all checks stay green and render counts do not worsen
  (record the decision).
- Check the single file opens from file://: a Playwright test loads a fixture via the file input and edits
  a cell.

S1.5 Prepare v3.5 with docs/next/release-checklist.md. Tag commands go under "Waiting for".
```

## Prompt 3 · The core in workers (S2.1–S2.7)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers milestone M2: steps S2.1–S2.7. Read docs/next/03-architecture.md §2 and §4.1,
06-plan.md §3 and spikes/parser/ first.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: M1 ticked. Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M2-core-workers from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S2.x · <title>";
  - one PR for the milestone.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove an element id or data-* that e2e uses without updating the test in the same commit;
  - skip or disable a test;
  - put op semantics outside core's ops module;
  - push a tag or write to a real share.
- User-visible changes only from B1–B14 (this milestone: only B8). Anything else → "Waiting for", and stop.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests, npm run test:e2e, npm run parity (0 differences in this whole
   milestone), npm run bench, and the step's "Done when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Specifically try to find:
   - a DOM type in core/;
   - a second owner of the document;
   - a large structured clone on the main thread.
   Fix, then repeat 1–2.
4. Measure twice; investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the milestone diff, and walk 05 §4 rows 4.1, 4.2, 4.8, 4.11.
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S2.1 Move pure code into core/.
- `git mv` xlsx/, model/ and the pure parts of render/.
- Put every DOM use behind interfaces in core/src/platform.ts, with browser implementations in
  app/src/platform/:
  - TextMeasurer: the canvas digit width (workbook.ts ~169-176) and fitNotes (slide.ts ~311-332);
  - CanvasFactory: wallpaper.ts makeWall (split the CSS injection out) and drawing.ts analyzeImages;
  - XmlParser: the DOMParser uses.
- Move the pure unit tests; shared/ops-vectors.json runs in core.
- Find them all by grepping for document., window., canvas, measureText, DOMParser,
  getBoundingClientRect and scrollHeight.

S2.2 XML tokenizer.
- core/src/xlsx/xml.ts: elements, attributes, text, CDATA, entities, namespace prefixes, plus a small tree
  helper.
- Port rels, workbook, styles (incl. gradient fills, dxfs), theme and drawings.
- An equivalence test (jsdom in the test only) checks that JSON of the parsed context is identical to the
  DOMParser path for every corpus workbook.

S2.3 Columnar SheetStore.
- fflate (pinned) replaces JSZip.
- The byte scanner (start from spikes/parser/parse_bench.mjs) must cover EVERY cell shape the regex parser
  in workbook.ts readSheet handles:
  - types s, inlineStr, str, b, e, d;
  - numbers with date-by-format;
  - rich runs;
  - _xHHHH_ escapes;
  - namespace prefixes;
  - rows and cells without r.
- Typed-array columns plus a Sheet facade with the same methods (cellAt, xfAt, colPx, rowPx, colStart,
  rowStart, iteration). buildLayout, findRegions, evalCF, formatValue, detect and comment run unchanged.
- An equivalence test, cell by cell, on every corpus sheet incl. big30.
- ⏱ npm run bench: a big30 sheet parses in under 0.5 s and retains under 40 MB.

S2.4 Core worker and typed RPC.
- core/src/rpc/messages.ts and app/src/rpc/client.ts (transferables).
- The core worker OWNS the workbook, DocSync (still the v3 HTTP ops protocol) and undo/redo (labels;
  coalesce 1.5 s). It returns view snapshots and HTML per table, as today. The UI never mutates the
  document.
- Inline the worker as a Blob URL in the single file. A Playwright file:// test: open, edit, "Saved in
  this browser only".

S2.5 RPCs getSheetMeta, getSheetWindow, detectTables and getCell. The wizard and the formula bar use only
these. No long task over 50 ms on big30.

S2.6 ⏱ Browser benchmarks in CI, from spikes/baseline/measure.mjs: deck20 open under 400 ms; a big30
sheet read under 1 s; no main-thread task over 50 ms; heap under 150 MB (B8). Record v3's numbers next to
them.

S2.7 Prepare v3.6 with the release checklist. Tag commands go under "Waiting for".
```

## Prompt 4 · Display list, PDF writer, fonts, designs (S3.1–S3.6)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers steps S3.1–S3.6 of milestone M3. Read docs/next/03-architecture.md §2.4–2.6, §4.3 and
§5, adr/003–005, and spikes/pdfwriter and spikes/fonts first.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: M2 ticked AND the G0 decisions under "Decisions" (Acrobat recipe, font copying allowed or
  fingerprint mode). Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M3a-display-list from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S3.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove e2e ids or data-* without a test update;
  - skip tests;
  - put op semantics outside core's ops;
  - push a tag or write to a real share.
- User-visible changes: none in this prompt. The display list is built and verified, but users still see
  the HTML path.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests, npm run test:e2e, npm run parity, npm run bench,
   tools/pdfcheck.py where PDFs are produced, `qpdf --check` on every generated PDF, and the step's "Done
   when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Also open 3 generated PDFs
   with pypdf and PDFium and confirm:
   - no Type 3 fonts, no variable fonts;
   - images only for pictures and wallpapers;
   - selectable text equal to the golden slide texts (GT), not v3's PDF text (unreadable for glass and
     part of clean; PROGRESS Decisions 2026-10-12, 5).
   Fix, then repeat 1–2.
   On the reference PC `npm run parity` must say "full comparison" (golden/README.md).
4. Measure twice (PDF size, times); investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the milestone diff, and walk 05 §4 rows 4.3, 4.4, 4.7, 4.8, 4.9.
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S3.1 Display list and backends.
- core/src/dl/types.ts: the 8 nodes of 03 §2.4, with validators.
- core/src/dl/svg.ts: text as <text x y textLength lengthAdjust="spacing">.
- core/src/dl/canvas.ts.
- core/src/pdf/: port spikes/pdfwriter/pdf.ts and complete it:
  - paths, dashes, radial shadings, image SMask, group alpha and transforms;
  - de-duplication of images by hash and of gradients by style;
  - fflate Flate; no object streams;
  - MediaBox [0 0 1200 675] with the cm mapping;
  - soft masks for the glass transparency (G0 decision 2026-10-12: no flattened-gradient recipe);
  - the contract additions of ADR-004's amendment (blend multiply, inset shadows, elliptical radial
    paints, image-alpha drop shadows);
  - core/src/pdf/README.md.
- tools/pdfcheck.py (from spikes/baseline/pdfinfo.py and spikes/pdfwriter/render_cost.py); qpdf in CI.
- Tests: every node × 3 backends; PDF (via PDFium) vs canvas within tolerance.

S3.2 Fonts and text.
- harfbuzzjs@0.4.12 pinned (hb.wasm + hb-subset.wasm, inlined).
- core/src/text: FontRegistry by sha1; shape(); breakLines(); fitText() (shrink 1 px down to 9 px).
- PDF fonts via hb-subset: TrueType → FontFile2, CFF → FontFile3; Widths; ToUnicode. Keep the spike
  subsetter as a fallback.
- Helper: GET /sysfonts/<name> (C:\Windows\Fonts and the per-user fonts folder; whitelisted; a
  configurable directory in tests). POST /api/fonts/capture writes to data/fonts/system/ after an OS/2
  fsType check, or fingerprint mode per G0.
- Variable font uploads are instanced to static faces (pin all axes, as in spikes/fonts/subset_check.mjs).
- fonts.json stays schema 1; a test proves v3's fonts.py still reads it.

S3.3 excelToDisplayList for Excel and Excel Refined.
- fills;
- border styles → widths and dashes (hair 0.5, thin 1, medium 2, thick 3, dashed, dotted, dashDot,
  slantDashDot, double = two lines);
- text with alignment, indent, wrap, overflow clips, rotation, sup/sub runs;
- pictures, shapes, text boxes.
Text metrics still come from the page's browser layout, so parity can be exact (PROGRESS Decisions
2026-10-12, 3): TextMeasurer gains measureRuns and breakLines, implemented on the page and called by the
core worker through the RPC, batched per table. GG and GP pass for excel and clean.

S3.4 glassToDisplayList.
- buildScene, inferRoles and the material decisions stay UNCHANGED.
- Each material becomes its recipe from 03 §4.3. Evaluate the CSS calc() values from slide.css in TS for
  the glass level, contrast and radius; use placeGlass's LENS = 1 + .06·gi; 5-layer shadows (v3's
  printcss.ts STEPS = 5, as in today's PDFs; PROGRESS Decisions 2026-10-12, 4).
- The wallpaper is made in the worker on OffscreenCanvas: two JPEGs with stable ids.
- GG passes; the expected shadow and rim differences go into accepted.json with reason "B3 pending G1".

S3.5 Slide furniture into the DL:
- title, subtitle (push), cover, index (leaders, page numbers);
- page numbers and footer (placeholders, corners);
- logo (bubble, hidden per slide);
- text boxes (markup, bubble, spacing, vertical alignment, fitting), the notes section, comments;
- hit nodes.
Uses computeLayout unchanged. GG and GT pass for all corpus slides × designs × versions.

S3.6 🚦 G1 review package.
- review/G1/index.html: v3 | DL | heat map per slide, with filters and the accepted list.
- 3 sample PDFs per design (tools/export-dl.mjs).
- review/G1/README.md (what to look at, how to answer).
Then STOP with "G1: approve per design or list problems" under "Waiting for". When re-sent with problems
under "Decisions", fix them (commits "S3.6-fix · …"), regenerate the package and stop again until
approved.
```

## Prompt 5 · Native export (S3.7–S3.9)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers steps S3.7–S3.9 of milestone M3.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: S3.6 approved under "Decisions" (G1). Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M3b-native-export from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S3.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove e2e ids or data-* without a test update;
  - skip tests;
  - put op semantics outside core's ops;
  - push a tag or write to a real share.
- User-visible changes: B1 (partly: exports work offline), B9, B11. Nothing else.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests, npm run test:e2e, npm run parity, npm run bench,
   tools/pdfcheck.py on every exported PDF, qpdf --check, and the step's "Done when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Also export the corpus
   decks with the old and the new engine, and compare text per page and the page count; any difference is a
   finding. Fix, then repeat 1–2.
4. Measure the export time and size twice; investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the milestone diff, and walk 05 §4 row 4.10 (EX-01…EX-18) item by item.
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S3.7 Export workers.
- core/src/workers/export.worker.ts, up to 3 in parallel, one per (design, version), handles:
  - vector PDF;
  - "as pictures" = 2× PNG pages, Flate, "(images)" in the name (B9);
  - PNG current and all;
  - clipboard (ClipboardItem PNG).
- Helper POST /api/export-file?name= → the existing save_export (temp, lock export-<name>, " (2)" when
  the target is open), with tests.
- Version names "<workbook> - <version> - <design>.pdf" (B11).
- Keep every Export-menu data-x key (pdf, pdf-vector, pdf-exact, pdf-current, copy, png-current, png-all,
  versions, versions-2, versions-3). Add "PDF · text & tables (old engine)" for one release.
- In file:// mode, exports download (B1).
- ⏱ Budgets: 20 Glass slides click → file under 2 s; Excel under 1 s. Excel under 40 KB/slide; Glass under
  80 KB/slide + 190 KB per document. 0 Type 3, 0 variable fonts. Text equal to v3.
- e2e: E3 and E13, plus new tests for PNG current/all, clipboard and versions × 3 designs.

S3.8 🚦 Export pilot.
- A pilot build (make_release 3.7.0-pilot).
- docs/next/pilot-export.md: 2 weekly cycles with both engines, compare in Acrobat, a report form.
- An offline "Report a problem with this export" action (write JSON to export\feedback\ or mailto; say
  which).
Then STOP with "pilot result, go/no-go" under "Waiting for". If re-sent with problems, fix them
("S3.8-fix · …") and stop again until go.

S3.9 Prepare v3.7 with the release checklist; the CHANGELOG has before/after numbers. Tag commands go
under "Waiting for".
```

## Prompt 6 · The screen draws the display list (S4.1–S4.6)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers milestone M4: steps S4.1–S4.6. Read PLAN Part B §1–§3 and §7, adr/012, and the whole
of app/src/editor/stage.ts first. List every e2e selector that targets the stage before you change
anything.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: M3 ticked (v3.7 released). Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M4-stage from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S4.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove e2e ids or data-* without a test update (mapping table in the PR);
  - skip tests;
  - put op semantics outside core's ops;
  - push a tag or write to a real share.
- User-visible changes: B1, B2, B3, B7, B14. Nothing else.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests, npm run test:e2e, npm run parity (incl. SP: screen vs PDF),
   npm run bench, and the step's "Done when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Also:
   - record a Playwright trace of typing, selection, every drag and slide switching, and list any frame
     over 16 ms or task over 50 ms;
   - check the React Profiler for components rendering without cause.
   Fix, then repeat 1–2.
4. Measure twice (keypress → pixels, frame times); investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the milestone diff, and walk 05 §4 rows 4.3–4.7 and 4.11 (keyboard, side
panel).
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S4.1 React stage on SVG.
- app/src/stage/:
  - Stage (zoom, fit);
  - SlideSvg;
  - TableLayer (memo by DL id; writes svg.ts output through a ref);
  - Overlays (selection, active cell, handles, + buttons, guides);
  - InlineCellEditor, TextBoxEditor, SlideTextEditor.
- Hit testing from DL hit nodes with v3's binary search over edges (cellFromPoint).
- Keep "never redraw under an open editor" (E8).
- 5-layer shadows (as in today's PDFs), plus Options › "Soft shadows on screen" (B3).
- ⏱ keypress → pixels p95 under 50 ms.

S4.2 Smooth drags.
- computeLayout and sizing go to core/src/render/layout.ts (pure), shared by the worker and the UI.
  README gotcha 11: sizes are per design (sizingOf / sizingPatch / sizingChange).
- Drag previews at rAF rate on the UI thread; one op batch on pointer-up (one undo step).
- New e2e for corner scale, grip move and border double-click. Trace frames under 16 ms.

S4.3 Thumbnails as worker-rendered ImageBitmaps in a virtualised list. Keep tags, badges and data-i. A
100-slide deck scrolls at 60 fps (B14).

S4.4 Measurement from font files (B2, B7).
- The TextMeasurer becomes HarfBuzz:
  - the Excel max digit width from the workbook's default font;
  - Glass widening from real widths (keep v3's caps 3× / +60 px and fixed columns; glass.ts ~38-54);
  - wrapping, fitText and title geometry.
- Static Segoe UI for Glass.
- Screen text uses textLength; the per-font outline fallback is used when Chrome's natural width differs by
  more than 0.5 % (05 §3.4).
- Every GG difference against v3 → accepted.json "B7 measured", with review/S4.4/.
- SP passes.
Then 🚦 STOP: "Sign off B7 differences in review/S4.4/" under "Waiting for".

S4.5 (after sign-off) Delete:
- the HTML renderers, the slide rules in slide.css, printcss.ts, placeGlass;
- the in-window fallback and the old-engine menu item;
- engines.py, cdp.py, pdf.py, the engine parts of installer.py and firstrun.py;
- /api/export and /api/assemble (keep save_export and /api/export-file);
- requirements.txt Playwright, "Install export engine.bat", the engine pill and dialog,
  SLIDEBUILDER_BROWSER and SLIDEBUILDER_ENGINES.
firstrun.py goes to 5 steps (add a journal append/flush probe). Update the README and ARCHITECTURE.
Grep must find no headless, printToPDF, cdp or engine in product code.

S4.6 Prepare v3.8; the CHANGELOG tells the maintainer the engine folders can be deleted. Tag commands go
under "Waiting for".
```

## Prompt 7 · Storage v4 (S5.1–S5.5)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers steps S5.1–S5.5 of milestone M5. Read docs/next/04-data-and-migration.md (all of it),
adr/006 and adr/010, and spikes/storage/journal_sim.py first.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: M4 ticked (v3.8 released) AND the G0 storage decision under "Decisions": "journal", or
  "lean-lock" (one shared journal appended under the deck lock, with the same endpoints and fold).
  Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M5a-storage from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S5.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures (ADD snapshot.v4.json and journal.v4.log);
  - add a Python runtime dependency or ship a native executable;
  - remove e2e ids or data-* without a test update;
  - skip tests;
  - put op semantics anywhere but core/src/model/ops.ts. THE HELPER NEVER PARSES OR APPLIES OPS: records
    are opaque to it;
  - push a tag or write to a real share.
- User-visible changes: B4, B5, B6. Nothing else.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run npm run check, the helper tests on Python 3.8 and 3.12, npm run test:e2e, npm run parity,
   npm run bench, the load CI job, and the step's "Done when".
2. Clean-clone re-run of 1 in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Also try to break each
   invariant of 04 §2.3 with a targeted test:
   - kill a writer mid-append;
   - append the same record twice;
   - run two compactions at once;
   - skew clocks by ±10 min;
   - corrupt a CRC mid-file.
   Any failure is a finding. Fix, then repeat 1–2.
4. Measure the load results twice; investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓".
At the end: protocol 1–3 over the milestone diff, and walk 05 §4 rows 4.11 and 4.12.
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S5.1 Helper: decks.
- `git mv backend helper`; fix all paths (bat files, CI, release, tools, docs).
- helper/slidebuilder/decks.py implements the 04 §2.2 endpoints exactly:
  - append: handle per writer session, write + os.fsync, `at` on the file-server clock (fsclock);
  - tail: ≤ 8 parallel reads from offsets, complete frames only, listing cached 10 s;
  - snapshot: retries; unreadable → 503, never empty;
  - compact: CAS on gen under the v3 Lock; backup after unlock;
  - rotate: only when the frontier covers the file;
  - presence v2: touched empty files, scandir mtimes.
- Tests 1–6 of 05 §3.6.

S5.2 Core.
- fold.ts: sort by (l, w, s), de-duplicate (w, s), honour the frontier; derive rev, updated, updatedBy and
  log(20); Lamport counter.
- DocSync v4:
  - 300 ms debounce, one append in flight, "saved" when flushed;
  - tail every 1.5 s with rebase and authors;
  - compaction policy (more than 2 000 records, idle over 24 h) and compaction on pagehide by the last one
    present;
  - rotation;
  - undo unchanged (inverse ops appended).
- Extend ops-vectors with ordering and dedupe cases.
- A property test with ≥ 1 000 seeds (2–5 writers, random delivery and compaction): replicas converge and
  no acknowledged record is lost.

S5.3 Migration, freeze, rollback.
- migrate_v3.py on first v4 open, under the v3 lock wb-<key>:
  1. byte backup;
  2. snapshot gen 1 (doc = the v3 document);
  3. moved-from-v3.json;
  4. freeze the v3 file (schema 4, movedTo "v4").
- tools/update.py --migrate-all.
- --rollback refuses any deck with bytes past the frontier; *Prepare rollback* in the page compacts all
  decks.
- Tests 7–9 of 05 §3.6 WITH THE REAL v3 HELPER from a git worktree of the last v3 tag on the same temp data
  folder:
  - v3 refuses a frozen deck (409), and its page turns "outdated";
  - a racing v3 save is in the snapshot or refused;
  - rollback lets v3 edit again;
  - re-migration keeps v4-only fields;
  - concurrent config.json edits lose nothing.

S5.4 tools/loadtest4.py against real v4 helpers.
- Extend simfs to decks, charging handle reads and writes.
- The 05 §3.5 scenarios; a CI job at 15 and 40 ms with 20 users.
- `--real-folder` for humans.
- Add "run on the real share" to "Waiting for".

S5.5 Delete:
- ops.py;
- the v3 workbook-document write path of store.py (keep read-only reading for migration and the
  selftest);
- v3 presence;
- /api/workbooks/<name>/ops and /doc;
- the old DocSync.
Keep config, prefs, fonts, locks, fsclock and upgrade, which are shared with v3. Add a deck-health line in
the side panel. Update ARCHITECTURE to the v4 decks contract. Grep: no patch application or key lists in
Python.
```

## Prompt 8 · Pilot and cut-over (S5.6–S5.7)

```text
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers steps S5.6–S5.7 of milestone M5. Read docs/next/04-data-and-migration.md §4 and
docs/next/release-checklist.md first.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md.
- Requires: S5.1–S5.5 ticked AND the real-share load result under "Decisions". Otherwise stop and say what
  is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M5b-cutover from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S5.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - skip tests;
  - push a tag;
  - touch the real share or real data. The pilot runs on a COPY.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run every suite (check, helper, e2e, parity, bench, load) and the step's "Done when".
2. Clean-clone re-run in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Also do a dry run of the
   runbook on a temp copy of a share folder seeded with tests/corpus decks:
   - install v3.8, then v4;
   - open a deck in each;
   - migrate-all;
   - Prepare rollback;
   - rollback --all;
   - start v3 and edit.
   Paste the transcript. Fix, then repeat 1–2.
4. Run the dry run twice from scratch; results must match.
5. Tick with PR link and "verified: tests ✓ clean clone ✓ review ✓ dry run ×2 ✓".
Final reply: per step the changes, the dry-run transcripts, review findings and fixes; "Waiting for".

STEPS
S5.6 🚦 G2 pilot on a copy.
- "Start Slide Builder (v4 pilot).bat":
  - copies backend\data to backend\data\v4-pilot ONCE (refuses if it exists unless --refresh);
  - sets SLIDEBUILDER_DATA to the copy; exports go to export\v4-pilot\;
  - window title "PILOT – copy of the data".
- Build 4.0.0-pilot.
- docs/next/pilot-v4.md: 2 weekly cycles with several people on the same deck, a report form, a rollback
  rehearsal on the copy.
Then STOP: "G2: pilot result and rollback rehearsal, go/no-go" under "Waiting for". If re-sent with
problems, fix them ("S5.6-fix · …") and stop again until go.

S5.7 🚦 G3 cut-over package.
- Version 4.0.0; CHANGELOG (B4, B5, B6; decks, settings and fonts unchanged).
- docs/next/cutover.md, a minute-by-minute runbook for the agreed Monday:
  - announcement; update the share with --release 4.0.0; checks from 2 PCs; optional --migrate-all;
  - keep "Start Slide Builder (v3).bat";
  - the rollback commands and who decides;
  - 4 weeks of monitoring (deck-health lines, incident files under data\v4\, user reports).
- Run the release checklist up to tagging.
Then STOP: "G3: agree the Monday, tag v4.0.0, follow cutover.md" under "Waiting for".
```

## Prompt 7b · Two consulting designs, "McKinsey" and "Bain" (M7b, between M7 and M8)

```text
You are a senior engineer on Slide Builder 4 (this checkout, branch main after the merge of v4/M7-recalc; if M7 is
not merged yet, branch from v4/M7-recalc). You add TWO NEW DESIGNS, "McKinsey" and "Bain": design modes that sit
beside Liquid Glass, Excel and Excel Refined in the design switch, are saved and shared like them (DS-01), have
their own per-design sizing, looks and text styles (DS-07, DS-08, TH-02), draw every table, text box, comment, chart
and callout, and export to PDF (and later PPTX) through the display list like the others. They are NOT themes of
Liquid Glass: they are designs of their own (their own renderer recipes, fonts, palettes, furniture), in the style
of the slides of those two consulting firms – not copies of their logos, trademarks or fonts.

This is milestone M7b. Work the way docs/next/PLAN.md Part A and docs/next/PROMPTS.md require: branch
v4/M7b-consulting-designs, one commit per step titled "S7b.n · <title>", one pull request, PROGRESS.md ticked per
step with measured numbers, the double-check protocol after every step (the full test run; the same run from a clean
clone; an independent review against the PROMPTS.md Appendix checklist by a fresh sub-agent; numbers measured
twice), and the AUDIT.md §0 protocol twice on clean clones at the end.

READ FIRST
- README.md §1, §3.3, §5.3, §6.6; docs/ARCHITECTURE.md; docs/next/PLAN.md Parts A, B (§8 B-items), E, F;
  docs/next/03-architecture.md §4 (rendering, the Liquid Glass recipes); docs/next/05-test-and-parity.md §1, §3.2,
  §3.4, §4.3 (DS/TH rows); docs/next/07-scenarios-charts-pptx.md §3 (charts/callouts are drawn per design – your
  designs must leave hooks for them), §6.3; docs/next/adr/004 (display list: the only contract; no new node types),
  adr/005 (text measured from font files), adr/011 (goldens); PROGRESS.md (Decisions, Waiting for).
- The code the designs live in: core/src/model/types.ts (Design = "glass" | "excel" | "clean" – grep every use:
  sizes per design, DESIGNS in core/src/render/layout.ts, resolveStyle and COLOR_KEYS in core/src/model/style.ts,
  SLIDE_FONT in render/slide-dl.ts, tableDrawKey in render/slide.ts), core/src/render/glass.ts + glass-dl.ts (the
  scene model and its materials), excel-dl.ts, slide-dl.ts (titles, text boxes, notes, footer, page numbers, logo),
  cover.ts, pagenumbers.ts, wallpaper.ts, core/src/text/ (fonts: library fonts, Windows fonts captured per deck, W13),
  core/src/pdf/writer.ts; app/src/ui/Topbar.tsx (the design switch), app/src/ui/DesignDialog*, the Design… dialog's
  Colours / Text styles / Fonts tabs; tools/parity.mjs, tools/capture-v3.mjs, tools/dlparity.mjs, tools/g1-package.mjs
  (the pixel-review report of gate G1), tests/corpus/, tests/parity/accepted.json.

PHASE 0 – RESEARCH FIRST, THEN STOP FOR APPROVAL (no product code)
1. Look up references. Use web search and fetch to collect at least 12 public reference images or documents for
   EACH firm's slide style (published reports, case studies, teaching decks, public style analyses, design-community
   write-ups; e.g. McKinsey Global Institute reports, "McKinsey slide style" analyses; Bain & Company published
   briefs and "Bain slide" analyses). For each reference record the URL, what it shows, and what you take from it.
   Save the list in docs/next/08-consulting-designs.md §1 and the images you may legally keep for internal reference
   (public web pages, no scraping behind logins) as links only – do not commit third-party images.
2. From the references derive, per design, a written DESIGN SPEC (08 §2, one subsection per design), each item with
   a measurable value in slide px (1600 × 900) and the reference it comes from:
   - the grid: margins, content area, title band, the "action title" (one or two lines of sentence-case text stating
     the message), subtitle/lead-in, the horizontal rule under the title (McKinsey: thin dark rule; Bain: often a
     coloured bar or none – take it from the references, not from memory), the footer line with "Source:" /
     "Note:" footnotes, page number position, the small tracker/section marker at the top right, the logo position;
   - colour palette: ink, background (white), the one accent and its tints (McKinsey deep blue family; Bain red
     family), table banding, highlight and emphasis colours, positive/negative colours – as hex values with the
     reference each comes from; how the deck's Colours tab maps onto them (COLOR_KEYS);
   - typography: typefaces by role (title, subtitle, table head, table body, footnotes, page number) with sizes in
     px, weights, letter spacing, line heights. Only fonts the PC has or the library can hold with a licence we may
     use: no Bower, Theinhardt or other proprietary firm fonts – choose the closest system or open fonts (e.g. Georgia
     / Times New Roman for a serif title, Arial / Segoe UI for the sans; or an SIL-OFL font added to the library) and
     say why; respect W13 (fonts captured per deck);
   - tables: borders (which edges, weights, colours), header row style, total row style, number alignment, unit row,
     column header wrapping, zebra banding or none, the "harvey ball" / arrow / highlight conventions you will support
     through the existing roles (Header / Total / Body / Note) and highlights (CE-11, CE-13), hairline rules between
     groups;
   - text boxes, automated comments and the notes section: box style (none / thin rule / tinted box), bullet
     markers, the "takeaway box" (Bain) or "so-what" side column (McKinsey), spacing;
   - charts and callouts hooks (07 §3): palette order for series, label style, legend style, callout shapes;
   - cover and index slides, versions (nothing changes), page numbers (format and position), the footer.
3. Write the implementation plan in 08 §3: how the two designs enter the code with ONE set of geometry rules kept
   (computeLayout unchanged): extend Design to "glass" | "excel" | "clean" | "mckinsey" | "bain"; where each use of
   Design needs a case; a shared "consulting" renderer core/src/render/consult-dl.ts parameterised by a DesignSpec
   object (two specs, one renderer) built from the Excel item list (effItems) like excel-dl.ts, not from the glass
   scene; the furniture (title, rule, footer, tracker, page number) in slide-dl.ts per design; SLIDE_FONT entries;
   per-design defaults in resolveStyle (text styles, colours) so "Reset" returns to the spec; the design switch
   buttons and the Design… dialog; the export file names (B11: the design name in the file name); the saved format:
   a deck saved with design "mckinsey" opened by a 4.0/4.1 page must fall back to a known design without data loss
   (optional field semantics – state how, add a test); thumbnails; the parity harness: new goldens are CAPTURED FROM
   YOUR OWN FIRST RENDER after the pixel sign-off (05 §2, ADR-011: goldens are evidence) under golden/<deck>/
   mckinsey|bain/, existing goldens untouched, existing designs 0 unaccepted differences.
4. Write 08 §4: the new 05 §4 rows (DS-10 … for each design: switch, looks, text styles, sizing, tables, text
   boxes, comments, cover/index, page numbers/footer, export PDF facts, parity/pixel sign-off), the B-items (one per
   design, plus one for any change to existing behaviour – there must be none), Part F budgets (export time and
   PDF size per slide for each design, keypress → pixels unchanged, no new main-thread task), the ADR
   (ADR-018 "Consulting designs as parameterised Excel-item renderers").
5. Write 08 §5: the steps S7b.1 … (Read / Do / Done when, ⏱, 🚦) and §6: your questions. Then STOP and write under
   PROGRESS.md "Waiting for" what you need: approval of the two specs (show the palette, type and a labelled layout
   sketch as an SVG or PNG you render yourself from the spec – docs/next/designs/<design>-sketch.svg – so the
   product owner sees the structure before any code), the font choices, the B-items.

THEN, PER STEP AFTER APPROVAL (expected steps; adjust in 08 §5)
S7b.1 · Design type and plumbing: Design extended; every switch/case; resolveStyle defaults per design; the switch
       buttons; saved-format fallback test; parity still 0 for the three existing designs. No new drawing yet.
S7b.2 · The consulting renderer: core/src/render/consult-dl.ts (tables from effItems: fills, borders, text with
       the existing measured text path, roles, highlights, colour scales, merges, superscripts, pictures/shapes/text
       boxes of the workbook) + furniture per design in slide-dl.ts + cover/index + page numbers/footer + the
       notes/comment boxes. Unit tests: DL snapshots of every corpus slide in both designs (the DL validators pass;
       no node outside the eight types); dlparity for the three old designs unchanged.
S7b.3 · Pixel review 🚦: render every corpus slide in both designs (tools/g1-package.mjs style report) and the
       product owner signs off; fix and re-review; then capture the goldens.
S7b.4 · Export and budgets ⏱: PDF of deck20 in each design (GF facts: fonts subset, no Type 3, size budget per
       slide you set in 08 §4, time < 1.5 s for 20 slides), PNG/clipboard/thumbnails, "every version × all
       designs" now exports five designs (the menu text and the names), e2e for the switch and the export.
S7b.5 · Close: AUDIT §0 twice on clean clones; CHANGELOG; PROGRESS; 🚦 final sign-off.

HARD RULES (PLAN Part A, keep them)
- Operation semantics only in core/src/model/ops.ts (a new design needs no new op: design is a style field).
- Everything drawn goes through the display list (ADR-004): no new node types; no DOM types in core/.
- Helper = Python standard library only; no native executable; no new runtime dependency without its licence in an
  ADR (fonts included: SIL OFL / Apache only; no proprietary firm fonts; no copying of logos or trademarks).
- Existing goldens and 05 §4 rows keep passing: 0 unaccepted parity differences for Liquid Glass, Excel, Excel
  Refined; no test skipped; element ids and data-* the e2e uses stay.
- Every user-visible change is a B-item approved by the product owner before it ships; the CHANGELOG lists it.
- Stop at every 🚦 and whenever a decision changes what users see; write it under "Waiting for".
- Never push tags, never write to a real user share; the product owner pushes.

START WITH PHASE 0. Do not write product code until the specs in 08 are approved.
```

## Prompt 9 · Hardening (S6.1–S6.5)

```text
v4.0.0 is tagged and live on slider since 2026-10-15 (record under Decisions; the four weeks of monitoring run in parallel)
You are a senior engineer on Slide Builder (this checkout). We rebuild it following docs/next/PLAN.md.
This prompt covers milestone M6: steps S6.1–S6.5.

STANDING RULES
- Read first:
  - docs/next/PLAN.md Part A (rules), Part B (target) and Part C (your steps);
  - docs/next/PROMPTS.md Appendix (review checklist);
  - PROGRESS.md and docs/next/field-results.md.
- Requires: S5.7 done (v4.0 live) under "Decisions". Otherwise stop and say what is missing.
- Resumable: continue from the first unticked step of this milestone. If a step needs a decision that is
  not under "Decisions", stop there.
- Git:
  - branch v4/M6-hardening from main (if the PR is already open, keep pushing to it);
  - one commit per step, titled "S6.x · <title>";
  - one PR.
- Never:
  - edit golden/ or saved fixtures;
  - add a Python runtime dependency or ship a native executable;
  - remove e2e ids without a test update;
  - skip tests;
  - put op semantics outside core's ops;
  - push a tag;
  - touch the real share.

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it)
1. Run every suite (check, helper, e2e, parity, bench, load) and the step's "Done when".
2. Clean-clone re-run in /tmp/verify-<step>.
3. Independent review against the Appendix checklist (sub-agent if possible). Fix, then repeat 1–2.
4. Measure twice; investigate differences over 10 %.
5. Tick with PR link, both numbers and "verified: tests ✓ clean clone ✓ review ✓". A step that is not
   needed is ticked "not needed" with the evidence.
Final reply: per step the changes, results of both runs, review findings and fixes; numbers; "Waiting for".

STEPS
S6.1 Native .xlsb (B10).
- core/src/xlsx/xlsb/: a BIFF12 record reader (variable-length type and size) for the workbook, sheets
  (BrtRowHdr, BrtCell*), SST, styles (BrtXF, BrtFont, BrtFill, BrtBorder, BrtFmt), merges, col info, CF
  and drawings, into the SAME SheetStore.
- .xlsb twins of the corpus edge cases are needed. If you cannot produce them with Excel on Windows, ask
  under "Waiting for" and stop this step.
- Twins must be equal cell by cell and render identically.
- Excel COM stays only for .xls and protected files.

S6.2 Shared parsed-sheet cache. ONLY if PROGRESS.md "Measurements" shows a large-workbook open over 3 s on
the real share; otherwise tick "not needed" with the number. If needed:
- key = CRC-32 + size from the zip central directory;
- data/v4/cache/<crc>-<size>.sbc (versioned header + deflated columns);
- helper GET/PUT with an atomic write and an LRU sweep to 2 GB;
- a corrupt or mismatched file means re-parse;
- ⏱ second opener under 300 ms.

S6.3 ReadDirectoryChangesW hint. ONLY if field-results.md shows that it wakes another PC on the real
share; otherwise tick "not applicable" with the evidence. If it does:
- a ctypes watcher on j\ marks the deck dirty; long-poll tail ≤ 1.5 s;
- it auto-disables after 30 s without an expected event;
- an Options flag; polling stays the truth;
- ask a human to measure the visibility on the share.

S6.4 Documentation.
- `git mv` the v3 docs to docs/v3/.
- Write the v4 README.md (the same depth as v3's, with PLAN Part B's drawings updated to what was built)
  and docs/ARCHITECTURE.md as the v4 contract (files, document, ops, records and framing, fold order,
  snapshot and compaction, locks, presence, HTTP API, display-list nodes, font library, formats).
- Check every statement against the code.
- Prove README §11 works from a clean clone, with the transcript.

S6.5 Remove the v3 start file. ONLY after "Decisions" records 4 weekly cycles after cut-over with no
rollback; otherwise stop.
- Drop it from the release ZIP and tell the maintainer to delete it from the share. Keep all data.
- Prepare v4.1.0 (no tag).
```

## Prompt 10 · Final independent audit (all milestones)

```text
You are an independent auditor of the Slide Builder 4 rebuild (this checkout). You did not build it. Your
job is to prove, with evidence, that the finished system meets docs/next/PLAN.md, and to find what does not.

Read:
- docs/next/00-summary.md, PLAN.md (Parts A–F) and 05-test-and-parity.md;
- the README.md and docs/ARCHITECTURE.md (v4);
- PROGRESS.md (all ticks, Decisions, Measurements);
- the CHANGELOG.

Do everything from a FRESH clone in a temp directory, and run every check TWICE: two clean clones, two
complete runs. Report any difference between the runs.

1. Build and tests. Install from scratch exactly as README §11 says. Run:
   - npm run check;
   - the helper tests on Python 3.8 and 3.12;
   - npm run test:e2e;
   - npm run parity;
   - npm run bench;
   - the load jobs at 15 and 40 ms;
   - tools/pdfcheck.py and qpdf --check on PDFs of every corpus deck × design × version.
2. Features. For EVERY row of 05 §4 (WB, WZ, DS, TH, TX, FT, CE, TA, NB, AC, VR, CV, EX, CO, UN, KB, SP,
   SB, OF, IN, UP, DA), find the guarding test, run it, and mark it PASS, FAIL or MISSING. For the rows
   whose guard is manual (M or W), state that clearly instead of passing them.
3. Behaviour changes. Compare v3 (the last v3 tag, in a git worktree) with v4 on the corpus. Every
   user-visible difference must be one of B1–B14 and in the CHANGELOG; anything else is a finding.
4. Performance. Check every budget of PLAN Part F against measurements you take yourself, twice.
5. Architecture and logic.
   - One owner per kind of state (PLAN Part B §2). Look for a second source of truth.
   - Op semantics exist only in core/src/model/ops.ts; the helper never parses ops.
   - core/ has no DOM types.
   - No native executable and no non-stdlib Python dependency.
   - The helper's security model: Host/Origin checks, token, body limits, path safety. Try the attacks of
     docs/v3/REVIEW.md S1–S4 again.
6. Data safety.
   - Re-run the migration, freeze and rollback tests, including the real v3 helper.
   - Corrupt a journal mid-file and a snapshot, then confirm the system never treats unreadable as empty.
7. Documentation truth. Pick 30 statements from README and ARCHITECTURE at random and verify each against
   the code (path:line).

Write docs/next/AUDIT.md:
- a summary verdict;
- a table per section above with evidence (commands, outputs, path:line);
- every finding with severity (critical / high / medium / low), how to reproduce it, and the fix you
  propose.

Fix the defects and make recommendations for further improvements.
```

---

## Prompts 11–15 · Finishing `07-scenarios-charts-pptx.md` (M8 … M12)

Five prompts, one per milestone, in the format of Prompts 1–10: send each to a fresh agent session with this
repository checked out, in order, after the previous milestone's pull request is merged (or branch from its branch
when it is not). Every prompt is resumable from the first unticked step of its milestone in `PROGRESS.md`. The
standing rules, the double-check protocol and the review checklist are the same as in Prompts 1–10; each prompt
repeats what it needs so that it is self-contained. The design every prompt builds is `docs/next/07-scenarios-charts-
pptx.md` (approved 2026-10-16 with its B-items B15–B24 in PLAN Part B §8); nothing in it is re-decided here.

| # | Prompt | 07 steps | Human gates inside | Ships |
|---|---|---|---|---|
| 11 | Scenario export | S8.1–S8.5 | 🚦 G5 real deck, 10 values | 4.2.0 |
| 12 | Charts and callouts | S9.1–S9.6 | 🚦 G6 pixel sign-off of the pie recipe in three designs | 4.3.0 |
| 13 | Free layout and cell gridlines | S10.1–S10.4 | 🚦 G7 handles and gridline look | 4.4.0 |
| 14 | PowerPoint export | S11.1–S11.5 | 🚦 G8 three decks opened in PowerPoint 2016 | 4.5.0 |
| 15 | Independent audit of 4.2–4.5 | all | – | `AUDIT-2.md` |

### The block every prompt 11–14 starts with (copy it verbatim at the top of each)

```text
STANDING RULES (docs/next/PLAN.md Part A; docs/next/PROMPTS.md)
- Read first: docs/next/PLAN.md Part A (rules), Part B §8 (B1–B24: the only user-visible changes allowed), Part F
  (budgets), docs/next/07-scenarios-charts-pptx.md (the design: §2 data model, §3 rendering, §4 PPTX, §5 free
  layout and gridlines, §6 rows / B-items / budgets, §7 your steps, §8 the answered questions), the ADRs 013–017,
  docs/next/05-test-and-parity.md §1 (verification codes) and §4 (the rows that must keep passing), docs/next/
  PROMPTS.md Appendix (the review checklist), README.md §5–§6 and §11, docs/ARCHITECTURE.md §2–§3, PROGRESS.md
  (Steps, Decisions, Waiting for – continue from the first unticked step of your milestone; stop at a step whose
  decision is not under Decisions).
- Git: branch v4/M<n>-<name> from main (or from the previous milestone's branch when its PR is not merged; say so
  in PROGRESS); one commit per step titled "S<n>.<k> · <title>"; one pull request per milestone; never push a tag;
  never write to a real user share; the product owner pushes and merges.
- Never: edit golden/ or */tests/fixtures/saved/ (add files only); add a Python runtime dependency or a native
  executable (ADR-001); add a page dependency without its licence in an ADR (MIT / BSD / Apache only; no GPL /
  AGPL / commercial); remove an element id or data-* the e2e uses without updating the test in the same commit;
  skip or disable a test; put operation semantics anywhere but core/src/model/ops.ts (ADR-002; every new op or
  key gets shared/ops-vectors.json cases and an inverse for undo); draw anything outside the display list's eight
  node types (ADR-004; no DOM types in core/); change what users see outside B1–B24 (stop and write it under
  "Waiting for"); change a budget of Part F on your own (flag it under Waiting for with the measurement).
- Saved decks stay readable by 4.0 / 4.1 (new fields optional; `format` 4 / `workbook` 3 unchanged) or the format
  goes up with a migration, a fixture and a test (README §4.4).
- Environment: Windows 10/11, no admin rights; Node 22 portable (see PROGRESS Decisions and the memory note on
  this PC: prefix its folder to PATH, NODE_OPTIONS=--use-system-ca behind the proxy); Python 3.8-compatible helper;
  the e2e helpers use fixed ports 8951/8952 (one e2e run at a time); never edit sources while a background
  `npm run check` reads them; Python on this PC takes C:\ paths and writes CRLF unless told not to (check
  `git ls-files --eol | grep w/crlf` before `npm run build`: the committed page must reproduce from a clean clone).

DOUBLE-CHECK PROTOCOL (after EVERY step, before ticking it in PROGRESS.md)
1. Run: npm run build (the page is committed; app/tests/build.test.ts compares it), npm run check, python -m
   unittest discover -s helper/tests (3.12 and 3.8), npm run test:e2e, npm run parity and npm run dlparity (0
   unaccepted differences), npm run bench (every gate within its limit; the engine bench needs a quiet PC), the
   step's own "Done when" checks, and tools/pdfcheck.py (+ qpdf) on every PDF the step makes.
2. The same run again from a clean clone (`git clone -b <branch> <checkout>` into %TEMP%).
3. An independent review by a fresh sub-agent against the PROMPTS.md Appendix checklist: give it the step's diff,
   the 07 section it implements and the rows it guards; fix every REQUEST CHANGES item; record the verdict in the
   step's PROGRESS line.
4. Measure every number twice; put both in the step's PROGRESS line ("verified: tests ✓ clean clone ✓ review ✓").
Finish the milestone with the docs/next/AUDIT.md §0 protocol (all 17 steps) twice on clean clones, the results in
PROGRESS.md, the CHANGELOG section for the release, the version numbers prepared (release checklist §1), and the
🚦 gate written under "Waiting for". Then stop.
```

## Prompt 11 · Scenario export (M8: S8.1–S8.5, B15) ⇢ 4.2.0

```text
<the standing block>

You build M8 of docs/next/07-scenarios-charts-pptx.md: "run for each bank". M7 left in the core worker: the formula
engine (core/src/calc/engine.ts), linked workbooks, the self-check (`calcCheck`), and `scenarioPreview({sheet, ref,
value} | null)` which draws every slide and export list from a view of the workbook with the recomputed cells
(core/src/calc/overlay.ts) and answers {changed, different, check}. Gate G4 (the product owner's self-check numbers
of real decks) is under PROGRESS Decisions – read it: a `different` count above 0 there changes what the run's gate
must say.

Read also: core/src/worker/host.ts (ensureCalc, scenarioPreview, lists, the export channel), core/src/worker/
export-host.ts and core/src/workers/export.worker.ts (one job per (design, version); three workers), core/src/rpc/
messages.ts, app/src/editor/export.ts and app/src/ui/Topbar.tsx (the Export ▾ menu, EX-01…EX-17, B11 names),
app/src/state/dialogs.ts and app/src/ui/Dialogs.tsx (dialogs), app/src/wizard/SheetGrid (the cell picker you reuse
for "From a range…"), helper/slidebuilder/exports.py (save_export: temp, lock, rename, " (2)"), the e2e helpers in
app/e2e/app.spec.ts (`exported`, `fromMenu`, `pollFile`), tests/corpus/workbooks/recalc/ (Banks.xlsx / Peers.xlsx:
Control!B2 is the command cell; truth/<bank>/ are Excel's recalculated copies), core/tests/host.test.ts (the
scenario describe), app/tests/fixtures/Banks.xlsx + Peers.xlsx (the e2e folder gets them).

S8.1 · The dialog (07 §7 S8.1; rows SC-01, SC-07)
- Export ▾ › "Run for each value…" opens a dialog: the input cell (the name box syntax "Sheet!C7", a sheet id
  "[Peers.xlsx]Peer!C7" allowed, or "Pick a cell" which takes the stage's selected cell); the values: a textarea
  (one per line, paste allowed), and "From a range…" which opens the wizard's grid (getSheetWindow) to drag a range
  whose displayed texts become the values; de-duplicated keeping the order, blank lines skipped; the count shown;
  "Treat as text" (07 §8 Q7: a value that parses as a number goes in as a number when the input cell holds a number
  today, else text; the switch forces text); the designs (checkboxes: Liquid Glass, Excel, Excel Refined – and the
  designs M7b added if present), the versions (checkboxes: Full deck + every version), PDF / PowerPoint (PowerPoint
  greyed with "comes with 4.5" until M11), Preview (the selected value only) and Run.
- Preview calls scenarioPreview; a banner on the stage names the value ("Previewing: Bank C – a scenario, not
  saved · Clear"); editing stays allowed (07 §2.4); Clear calls scenarioPreview(null). S8.4 completes it.
- The dialog's state is UI state (the store), never the document. Element ids: #scenarioDialog, #scInput,
  #scValues, #scFromRange, #scText, #scDesigns, #scVersions, #scPreview, #scRun, #scBanner.
- Done when: e2e SC-01 (values typed and from a range, de-dup, count), SC-07 (preview shows Bank C's title, Clear
  restores), unit tests of the value parsing; no new console error.

S8.2 · Names and files (07 §2.5; SC-03, SC-04)
- core/src/export/names.ts: scenarioFileName(valueText, design, version | null, ext) = "<value> - <design>.<ext>" or
  "<value> - <version> - <design>.<ext>"; `\ / : * ? " < > |` and controls → "_", trimmed spaces/dots, reserved
  device names prefixed "_", empty → "(blank)", cut so that "<export folder>\<name>.<uuid>.tmp" stays under 240
  characters (the helper's folder length comes from /api/ping or is assumed 60 when unknown – say which), equal
  names inside one run get " (2)", " (3)" before the helper's own " (2)" for an open target (EX-11). The existing
  B11 names move to the same module unchanged (their tests stay green).
- Done when: unit tests for every rule incl. two values that collapse to one safe name; an e2e run of 2 equal
  values gives "X - Excel.pdf" and "X (2) - Excel.pdf".

S8.3 · The run ⏱ (07 §2.4, §6.4; SC-02, SC-05, SC-06, SC-08, SC-09, RC-06)
- Worker RPC scenarioRun({input, values, designs, versions, kinds:["pdf"], runAnyway}) → id; events `scenario`
  {id, done, total, value, status, files, error}; scenarioCancel({id}).
- The loop (one value at a time, yielding between values so the stage is served): set the input through the
  engine, evaluate, build the view (as scenarioPreview does) – then, for each (design, version), the export workers
  build the lists through the existing channel and write the PDF; POST /api/export-file with the S8.2 name; the
  value's files and status go in the report; the view is dropped; the document, the deck and the workbook file are
  never touched (test: journal records and the document identical before and after; the workbook bytes identical).
- The gate (07 §1.4 (4), RC-06): before the first value, if any formula cell of the slides' tables is classed
  `different` by the self-check, the run stops with the list (sheet!ref, cached vs computed) unless the dialog's
  "run anyway, mark these cells" was ticked – then those cells are drawn with a red corner marker (a `rect` node,
  all designs) and listed in the report. G4's numbers decide the default wording.
- Cancel between values: files already saved stay; the report says "cancelled after n of m".
- The report dialog: per value: ok (its files) or failed (the reason); "Open folder"; the toast "Saved N files".
- Exports started before a run or during one must not get scenario lists by accident: the export workers' lists()
  takes an explicit scenario (the run's) or none; add the host test that proves an ordinary export during a run
  draws the workbook's own values (07 §2.4 "guarded in S8.3").
- ⏱ bench: one value recalculated + 20 Liquid Glass slides exported < 3 s; 20 values × 1 design × 20 slides < 40 s;
  no main-thread task > 50 ms during a run (Long Tasks API in tools/bench.mjs); add the gates to `npm run bench`.
- Done when: the brief's e2e "3 values × 2 designs → 6 files with the right names" (SC-02) on Banks.xlsx, SC-05
  (hashes before/after), SC-06 (progress, cancel, report), SC-08/SC-09 (bench), RC-06 (a deck whose table reads a
  `different` cell – make one with a formula the engine lacks, e.g. INFO("osversion") in a slide table – stops;
  "run anyway" marks it).

S8.4 · Preview ⏱ (SC-07; 07 §2.4 "Built in S7.4 (and its limit)")
- Decide and record (Decisions): whether the overlay's changed cells are mirrored to the page as slices during a
  preview (the ribbon, painter, comment dialog and Issues lines then follow the scenario) or the banner states that
  they show the workbook. Implement the chosen way; ⏱ preview switch (value → stage drawn) < 400 ms on deck20.
- Done when: SC-07 e2e extended (the banner, Clear, an edit during a preview saved as an ordinary op), the bench
  gate.

S8.5 · Close
- AUDIT §0 twice on clean clones; CHANGELOG 4.2.0 (B15 under "What users notice", with B22–B24 already there);
  versions prepared; 🚦 G5 under Waiting for: the product owner runs a real deck with 10 values and signs off the
  names and the report. Stop.
```

## Prompt 12 · Charts and callouts (M9: S9.1–S9.6, B16, B17, B19, B24) ⇢ 4.3.0

```text
<the standing block>

You build M9 of docs/next/07-scenarios-charts-pptx.md: pie / donut charts and data callouts on any slide, drawn per
design with the existing eight display-list nodes (ADR-015), following reloads and scenarios because they read
cells through the same `ctx.sheet()` facade as tables; and raw Excel starts drawing the user's objects (B19).
If M7b (the consulting designs) was built, every "three designs" below means every design of the switch; their
palettes come from each design's spec.

Read also: 07 §2.2 (DataRef, ChartItem, ShapeItem, Item, the `item.patch` op with field-level merge), §3 (the node
recipes per design, the palette rule, hit nodes), §6.1 (the rows that change: DS-02, DS-07, NB-18, AC-01), §6.2
(CH-01…CH-04, CL-01, CL-02), ADR-015; core/src/model/ops.ts and shared/ops-vectors.json (the pattern of a map key
and of an inverse), core/src/model/types.ts, core/src/render/slide-dl.ts (noteNodes: the text-box renderer you
reuse for callout text; noteParts; the glass card recipe), core/src/render/glass.ts + glass-dl.ts (materials,
palette, signals), excel-dl.ts, core/src/render/layout.ts (computeLayout, notesOf, fixedScale, the raw-Excel early
return you remove), core/src/dl/types.ts (validators) and dl/geom.ts, core/src/render/context.ts (tableKey, the
scenario digest), app/src/stage (hit testing, overlays, drags, actions), app/src/ui/Ribbon.tsx and TableTools.tsx,
app/src/editor/issues.ts (SP rows), tests/parity/accepted.json and tools/parity.mjs (how an accepted difference is
recorded and signed), core/tests/dl.test.ts, excel-dl.test.ts, glass-dl.test.ts, slide-dl.test.ts (the DL test
patterns), tools/g1-package.mjs (the pixel-review package for a 🚦).

S9.1 · item.patch (07 §2.2)
- types: DataRef, ChartItem, ShapeItem, Item, Box; SlideDef.items?: Record<id, Item>. Op `item.patch {slide, id,
  patch}`: field-level set/delete of the item's keys, map-merge for `colors` and `fmt`, `patch: null` deletes,
  a patch with `kind` on a missing id creates; inverseOf for undo; fold / Lamport need nothing new. ≥ 16 vectors
  (create, patch, delete, two writers merging different fields of one item, colors merge, unknown kind skipped,
  invalid box skipped, inverses round-trip). Readable by 4.1 (optional field; test with a 4.1 snapshot fixture
  added, never edited). README §4.2/§4.3 and docs/ARCHITECTURE.md §2–§3 updated.
- Done when: ops vectors and the convergence property test pass; no op semantics outside ops.ts.

S9.2 · Pie / donut display list ⏱ 🚦 G6 (07 §3; CH-01)
- core/src/render/chart-dl.ts: data resolution (a DataRef of a table or of any sheet id + range, through
  ctx.sheet(); numbers only, blanks skipped, the labels range or the row/column headers), slices as `path` nodes
  (cubic Béziers, κ = 0.5523, a 1 px separator stroke in the background colour), labels (name / value / percent,
  outside with a `line` leader under 12°), legend (right / bottom; capsule swatches in Liquid Glass, square
  otherwise), title (the deck's "note" text style, `fmt` over it), per-slice `colors[i]` else the design's resolved
  palette (resolveStyle per design), `hit {kind: "item"}` and `hit {kind: "slice"}` nodes; in Liquid Glass inside
  the glass card recipe (group clip + wallblur image + tint + shadow). The cache key hashes the item and the
  referenced values (and the scenario digest).
- Placement: `box` in slide px, or `attach` to a table side (laid out by computeLayout like a text box: it gets a
  NoteBox-like entry; keep computeLayout's signature).
- ⏱ a 12-slice pie builds in < 5 ms (vitest bench). Unit tests: DL snapshots per design of a chart from a table and
  from a hidden sheet's range; validators pass; a source that is missing draws the placeholder and reports.
- 🚦 G6: a g1-style pixel package of the corpus charts in every design for the product owner; fix and re-review.

S9.3 · Chart UI (CH-02, CH-03, CH-04, B24)
- Ribbon: "Insert chart ▾" (from the selected cells; from a range…: sheet picker incl. hidden sheets' names? – no:
  only sheets the wizard lists (WB-18 keeps hidden sheets hidden) and linked sheets); the side panel of the selected
  chart (type pie / donut, labels, legend, title, colours per slice, data source shown as text); selection by its
  hit node, delete, move/resize by drags (one op per drag, as text boxes); thumbnails follow.
- Issues lines: "Chart n: source Sheet!C5:C9 not found", empty data.
- Done when: e2e CH-02 (a pie from a range of a sheet on no slide), CH-03 (reload with a changed file → the pie
  changes; scenarioPreview → the pie follows), CH-04.

S9.4 · Callouts ⏱ (07 §3; CL-01, CL-02)
- core/src/render/shape-dl.ts: rect / round / circle / pill (`rect` with radii), arrow and bubble (`path`), icons
  (≈ 16 built-in `path` sets listed in 07 §3), fill / border / shadow per design (glass material when fill unset),
  the text through noteNodes with `{Sheet!C7}` / `{[Peers.xlsx]Peer!F7}` tokens replaced by formatValue of the cell
  (its number format; the overlay under a scenario); `#REF` + an Issues line for a missing reference. Ribbon
  "Insert shape ▾", the fill / border / text controls on ribbon 2 for the selected shape, drags.
- ⏱ a callout builds in < 2 ms. Done when: unit DL tests per design, e2e CL-01 and CL-02 (a callout quoting
  Control!B2 follows scenarioPreview "Bank C").

S9.5 · Objects in raw Excel (B19; DS-02, DS-07, NB-18, AC-01)
- Remove notesOf's raw-Excel early return and fixedScale's correction (core/src/render/layout.ts); enable the text
  box, notes and Comment… controls in raw Excel; raw Excel still adds no decoration of its own.
- The corpus slides of raw Excel that have text boxes now differ from the goldens: list each in
  tests/parity/accepted.json with reason "B19" and the product owner's sign-off (🚦 inside this step: show them the
  before/after pictures); 0 unaccepted differences remain.
- Done when: parity and dlparity 0 unaccepted; e2e E12 updated for NB-18's change (document the selector change
  in the PR).

S9.6 · Close
- AUDIT §0 twice; CHANGELOG 4.3.0 (B16, B17, B19, B24's "chart / callout source not found" lines); versions
  prepared; stop.
```

## Prompt 13 · Free layout and cell gridlines (M10: S10.1–S10.4, B18, B20) ⇢ 4.4.0

```text
<the standing block>

You build M10 of docs/next/07-scenarios-charts-pptx.md: a per-slide, per-design "free layout" in which tables, text
boxes, charts and callouts are moved and resized freely (no re-flow, no linked sizes, no auto-shrink, no
attaching), one undo step each way and nothing lost (ADR-017); and gridlines on selected cells, copied by the
format painter.

Read also: 07 §5, §6.2 (FL-01…FL-03, GL-01, GL-02), ADR-017; core/src/render/layout.ts (computeLayout, sizingOf,
sizingPatch, the `frees` branch of text boxes), app/src/stage/drags.ts (previews per frame from the same
computeLayout; snapping SNAP = 8; one op on pointer-up), app/src/stage/hit.ts, app/src/editor/tables.ts
(setColWidth, stretchTable, W/H boxes), app/src/ui/TableTools.tsx (ribbon 2: Gridlines ▾, Reset layout), app/src/
editor/painter.ts (CE-15, CE-16), core/src/render/excel-dl.ts and glass-dl.ts (borders and hairlines), core/src/
model/ops.ts (SLIDE_MAPS, TABLE_MAPS), shared/ops-vectors.json, core/tests/tables.test.ts, the e2e drag tests
(E4, E7, E10, E11) and tools/bench.mjs's drag-frame measurement.

S10.1 · Free layout model (07 §5.1; FL-01)
- SlideDef.free?: Partial<Record<Design, FreeLayout>> with FreeLayout = { on, items: { "t:<tableId>" | "n:<noteKey>"
  | "i:<itemId>": Box & { scale? } } }; `free` joins SLIDE_MAPS (map merge per design, an entry replaces the
  design's layout whole); vectors and inverses.
- computeLayout: with `free[design].on` it returns the saved boxes (tables scaled to their box, text boxes and
  items as saved, items without an entry at their automatic position alone), k = 1, fit = 1, no bisection;
  everything else unchanged (the geometry of automatic slides is byte-identical: dlparity 0).
- Switching on: one slide.patch writing every current box (nothing moves – test: the DL before and after is
  identical but for the hit nodes); switching off: `on: false`, the boxes kept; switching on again restores them;
  one undo step each (unit test counting history steps).
- Done when: unit tests + e2e FL-01 (positions before/after, undo count).

S10.2 · Drags ⏱ (FL-02, FL-03)
- drags.ts: freeMove / freeResize for every item kind (tables by corner = uniform scale, by edges = that axis; text
  boxes, charts, callouts by edges and body), snapping to the other items' edges and the slide guides unless Alt is
  held, previews per frame, one op on pointer-up; the stage's handles in free mode; "Reset layout" asks "Back to
  automatic layout?" and switches off.
- ⏱ a Playwright trace of each free drag ≤ 16 ms per frame on the CI machine (the existing drag bench gets the
  free cases). Done when: e2e FL-02, FL-03 (raw Excel, text boxes drawn since B19), the bench gate.

S10.3 · Cell gridlines (07 §5.2; GL-01, GL-02)
- TableDef.cellGrid?: Record<A1, { h?, v?, o?, c?, w? }> joins TABLE_MAPS (map merge per cell), vectors and inverses;
  Gridlines ▾ gets the section "Selected cells: H · V · Outline · Colour · Weight · Clear"; applied after the
  table-level gridH / gridV and the workbook's borders in excel-dl.ts (`line` nodes replacing that edge's border)
  and as hairlines in glass-dl.ts; versions keep them (VR-02); the painter copies cellGrid entries (CE-16's list
  grows by one, its unit test too).
- Done when: unit DL tests (every edge, outline of a rectangle, colour, weight), e2e GL-01 and GL-02; TA-10's
  tests still pass.

S10.4 · Close
- AUDIT §0 twice; CHANGELOG 4.4.0 (B18, B20); versions prepared; 🚦 G7 under Waiting for: the product owner tries
  the handles and the gridline look on a real deck and signs off. Stop.
```

## Prompt 14 · PowerPoint export (M11: S11.1–S11.5, B21) ⇢ 4.5.0

```text
<the standing block>

You build M11 of docs/next/07-scenarios-charts-pptx.md: a .pptx next to every .pdf (current slide, whole deck,
every version × design, M8's scenario runs) written in pure TypeScript in core/src/pptx/ from the display list plus
a semantic layer, with editable text, real tables and native pie / donut charts; glass materials and shadows as
pictures; fonts named, not embedded (ADR-016; 07 §4 is the fidelity contract – read it line by line, it is what
the product owner approved).

Read also: 07 §4.1–§4.4, §6.2 (PX-01…PX-04), §6.4, ADR-016; core/src/pdf/writer.ts and README.md (the writer
pattern: a pure module fed by the export worker; images by content hash; fonts by the resolver), core/src/worker/
export-host.ts (run / thumbs; the rasteriser; the OffscreenCanvas page renderer you use for the picture layer),
core/src/workers/export.worker.ts, core/src/rpc/messages.ts (ExportJob, SlideListsReq), core/src/render/slide-dl.ts
+ excel-dl.ts + glass-dl.ts (where the semantic layer must be emitted alongside the DL: tables with rows / cols /
cells / merges / borders / fonts, texts as paragraphs and runs, charts, pictures, and what is left for the picture
layer), core/src/xlsx/zip.ts and fflate's zipSync (the writer's container), app/src/editor/export.ts and the Export
▾ menu, helper/slidebuilder/exports.py (save_export accepts any extension? check, and the name rules), tools/
pdfcheck.py (the pattern for tools/pptxcheck.py), the OOXML references you know (ECMA-376 presentationML, DrawingML
tables `a:tbl`, charts `c:chartSpace` with `c:numCache` and the embedded workbook, slide size 12,192,000 ×
6,858,000 EMU, 1 slide px = 7,620 EMU). PowerPoint 16 is on the development PC (`PowerPoint.Application`): the
open-without-repair check runs here (dev tool only; the product never needs PowerPoint).

S11.1 · Writer skeleton + the checker (PX-01 partly)
- core/src/pptx/writer.ts: [Content_Types].xml, _rels, presentation.xml (16:9), one blank master and layout, a
  theme, docProps; per slide: the picture layer as one PNG (the DL rendered at 2× with the existing rasteriser,
  without the nodes the semantic layer replaces) and `p:sp` text boxes for every semantic text (font name, size px ×
  0.75 pt, bold / italic / colour, alignment, line spacing, vertical anchor; superscripts as baseline; the title's
  text shadow as outerShdw); pictures as `p:pic` with srcRect crop, rotation, flips. The semantic layer: the core's
  `slideLists` answers `semantics` per slide for kind "pptx" (07 §4.1's interface); its boxes are the DL nodes' boxes.
- tools/pptxcheck.py (Python, dev only; python-pptx 1.0.2 MIT as a dev package, stdlib for the structure): (1)
  structure (zip, content types, every rels target exists, every XML parses, slide count, slide size); (2) text:
  the GT golden texts found in the slide's shapes/tables; (3) on Windows with PowerPoint: Presentations.Open
  (ReadOnly, WithWindow 0) must not raise (a repair = failure), slide count and shape texts read back; `--no-ppt`
  for CI. Wire it into npm run export-check for every corpus deck × design.
- Done when: every corpus deck's .pptx passes (1)–(3) on this PC; a deck with one slide too.

S11.2 · Tables and shapes (PX-03)
- `a:graphicFrame` + `a:tbl` from semantics.tables: column widths and row heights from the layout, merges
  (gridSpan / rowSpan), cell fills, borders per side (width, dash, colour), margins, runs as above; cell-level
  gridlines of M10 as borders; Liquid Glass: the card as a picture under a table with transparent fills, capsules
  as rectangular cell fills (07 §4.2); callouts as `prstGeom` shapes (rect, roundRect, ellipse, rightArrow,
  wedgeRoundRectCallout) with their text, icons as custGeom from the same path data; solid and simple linear
  fills native, radial / alpha-stop gradients in the picture layer.
- Done when: pptxcheck (python-pptx: shape.has_table for every table, texts per cell equal GT), the three designs
  of the corpus open without repair.

S11.3 · Charts, the background layer, budgets ⏱ (PX-04)
- Native `c:pieChart` / `c:doughnutChart` with explicit point colours, data labels (name / value / percent), legend
  position, the chart title, and an embedded `embeddings/chartN.xlsx` (two columns, written with fflate) so Edit
  Data works; the wallpaper layer as JPEG once per deck, cards as PNG with alpha.
- ⏱ 20 Liquid Glass slides → .pptx < 3 s (click → file), Excel < 1.5 s; size < 3 MB Glass (120 KB per slide + 400
  KB once) / < 300 KB Excel; add the gates to npm run bench.
- Done when: pptxcheck has_chart and the chart's cached values equal the source cells; budgets pass twice.

S11.4 · Menu and runs 🚦 G8 (PX-01, PX-02)
- Every Export ▾ item gets "PowerPoint" and "PDF + PowerPoint" (names per B11 / 07 §2.5 with .pptx); M8's dialog
  gets the PowerPoint kind; "Saved N files" counts both; file:// mode downloads them.
- Done when: e2e PX-01 (single, deck, versions × designs, a scenario run of 2 values × 1 design → 2 .pdf + 2
  .pptx), PX-02 recorded on this PC's PowerPoint 16 in PROGRESS; 🚦 G8 under Waiting for: the product owner opens
  three decks (one per design) in PowerPoint 2016 on a corporate PC (row W15) and signs off the fidelity table of
  07 §4.2 – fonts substituted, nothing repaired.

S11.5 · Close
- AUDIT §0 twice (its PDF steps extended to the .pptx files); CHANGELOG 4.5.0 (B21, the fidelity table in two
  sentences); versions prepared; stop.
```

## Prompt 15 · Independent audit of 4.2–4.5 (M12) → `docs/next/AUDIT-2.md`

```text
You are an independent auditor. Audit Slide Builder 4 as of the merge of M11 (4.5.0) against docs/next/07-
scenarios-charts-pptx.md (the approved design of F0–F6), docs/next/PLAN.md Parts A–F (incl. B15–B24) and
docs/next/05-test-and-parity.md plus 07 §6.2's rows, exactly as docs/next/AUDIT.md did for 4.0 (read it first: its
§0 method is your method, its §1–§10 the shape of your report). Write docs/next/AUDIT-2.md; fix nothing in product
code except what you can reproduce with a failing test first, each fix one commit on branch v4/audit-2-fixes.

Do, and record with numbers and path:line evidence:
1. Two clean clones; the full §0 protocol twice (install, build, page equality, big30, check, helper 3.8 and 3.12,
   e2e, parity, dlparity, sp, bench, load, export-check incl. the .pptx checks, PDFs and PPTX × design × version,
   helper start), identical results or the difference explained.
2. Every row of 05 §4 and 07 §6.2 (RC, LK, SC, CH, CL, FL, GL, PX): the guard (test title, path:line) and verdict
   PASS / PASS (partial) / MISSING / MANUAL, in an appendix table; the MISSING ones named in a finding.
3. Behaviour changes 4.1 → 4.5: every CHANGELOG item mapped to B1–B24 or a Decision; anything visible outside them
   is a finding (BEH-n).
4. Part F and 07 §6.4 budgets measured on a quiet PC (calibration ≤ 1.3×): open deck20, read big30, longest task,
   keypress → pixels, drags incl. free layout, exports PDF and PPTX, engine first use (cold) and one value, the
   scenario run of 20 values, preview switch, chart and callout builds, thumbnails, save and visibility under load.
5. Architecture and logic: one owner per state (the engine model, the overlay view and linked workbooks live only
   in the worker; the page's mirror; name any second source of truth), op semantics only in ops.ts (item.patch,
   free, cellGrid), no DOM types in core/, no new executable, stdlib helper, the licences of every runtime
   dependency (IronCalc's MIT text with the holders' notice; fonts), the display-list contract (no node outside
   the eight types in any design incl. M7b's), the REVIEW S1–S4 attacks against the helper (unchanged routes plus
   /api/export-file with .pptx names and long scenario names: MAX_PATH, reserved device names, Unicode).
6. Data safety: a scenario run never changes the document, the deck files or the workbook (hashes before/after on a
   real-helper run with two users editing meanwhile); a deck with items / free / cellGrid / links opened by a 4.1
   page (git worktree of tag v4.1.0 or the last 4.1 commit) is readable and loses nothing when saved back; a
   missing linked workbook; a damaged .pptx is never left in export\ (temp + rename).
7. Documentation truth: 30 random claims of README and ARCHITECTURE sampled with a seeded RNG, each TRUE / PARTLY /
   FALSE with evidence; 07 §1.4's limits still true (15-digit read-back, hidden sheets, TEXT locale, spills).
8. Findings with severity, reproduction, fix or proposal; what still needs a human (G-gates not yet signed, W
   rows, PowerPoint 2016 on a corporate PC, Acrobat, the real share).
Finish with the summary verdict in AUDIT-2.md's first section and the list under PROGRESS "Waiting for".
```

## Appendix · Review checklist (used by every prompt's double-check step 3)

Report each item as PASS or FAIL with evidence (commands run, path:line).
1. **Scope.** The diff does what the step says and nothing else. Unrelated refactors or features are a
   FAIL.
2. **Rules.**
   * no edits to golden/ or saved fixtures;
   * no Python runtime dependency or native executable;
   * no e2e id or data-* removed without a test update;
   * no skipped tests;
   * op semantics only in the TS ops module;
   * no tag pushed, no real share touched.
3. **Done when.** Every check of the step was run and passed. Numbers are within PLAN Part F's thresholds
   and were measured twice.
4. **Features.** For the rows of 05 §4 that the step touches (PLAN Part E), the guarding test exists and
   passes, or the gap is named.
5. **User-visible changes.** Each is in B1–B14, and in the CHANGELOG when shipped.
6. **Logic.** State ownership follows PLAN Part B §2: the document in the core worker, a read-only mirror
   in the UI store, files only through the helper. Name any second source of truth.
7. **Smoothness.** No main-thread task over 50 ms is added; no component subscribes to more state than it
   renders; no frame over 16 ms during drags (from M4).
8. **Edge cases.** Empty workbook, hidden sheets, a huge sheet, a missing font, an unreadable file, an
   offline (file://) page, two users on one deck, a slow share. Each one the step affects is handled or
   listed.
9. **PROGRESS.md.** The step is ticked with the PR link, both measurements and the verification line.

Finish with APPROVE, or REQUEST CHANGES with a numbered list of required fixes (file:line and the expected
change).
