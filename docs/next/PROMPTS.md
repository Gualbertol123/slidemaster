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
   - selectable text equal to v3's.
   Fix, then repeat 1–2.
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
  - the flattened-gradient recipe if G0 requires it;
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
Text metrics still come from the v3 TextMeasurer, so parity can be exact. GG and GP pass for excel and
clean.

S3.4 glassToDisplayList.
- buildScene, inferRoles and the material decisions stay UNCHANGED.
- Each material becomes its recipe from 03 §4.3. Evaluate the CSS calc() values from slide.css in TS for
  the glass level, contrast and radius; use placeGlass's LENS = 1 + .06·gi; 6-layer shadows.
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
- 6-layer shadows, plus Options › "Soft shadows on screen" (B3).
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

## Prompt 9 · Hardening (S6.1–S6.5)

```text
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

Fix ONLY defects that have a failing reproduction, in a separate branch v4/audit-fixes with one commit
per finding. Re-run the full protocol twice after the fixes and add the results to AUDIT.md.

Final reply: the verdict, the findings by severity, what you fixed, and what still needs a human.
```

---

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
