# PROMPTS · one prompt per step, sent to agents in order

These are the prompts that drive the rebuild. Send **one prompt to one fresh agent session**, wait for its
pull request to be reviewed and merged, then send the next. Every prompt is self-contained: it tells the
agent what to read, what to do, how to prove it is done, and when to stop and ask a person. The plan behind
them is `docs/next/PLAN.md`; the step ids match.

## How to use these prompts

1. **Before prompt 1:** merge the design branch (`docs/next/`, `spikes/`) into `main`, so every agent starts
   from a `main` that contains the plan.
2. **One step at a time.**
   * Paste the prompt into a new agent session with the repository checked out.
   * When it reports back, run the **review prompt** (end of this file) in a second fresh session against
     the pull request.
   * Merge when both are happy.
3. **🚦 Human-gate prompts end with the agent stopping on purpose.** Do the human part (field tests,
   sign-offs, pilot, cut-over date), write the result into `PROGRESS.md` under "Decisions", then send the
   next prompt.
4. **⇢ Release prompts never push a tag themselves.** They prepare everything and ask you to tag.
5. **If an agent stops with "blocked"**, answer its question in `PROGRESS.md` ("Waiting for" → "Decisions")
   and re-send the same prompt.
6. **Steps that may run in parallel**, as two sessions on separate branches, each followed by its own review:
   * S0.4 ∥ S0.5;
   * S3.3 ∥ S3.4 (after S3.2);
   * S6.1 ∥ S6.4.

Every prompt starts with the same **standing rules** block. It is repeated on purpose, so that a prompt
works when pasted alone.

---

## M0 · Foundations on v3

### Prompt 1 · S0.1 · CI, PROGRESS.md, one check command

```text
You are a senior engineer on Slide Builder (repository: this checkout). We are rebuilding it step by step
following docs/next/PLAN.md. Your step is S0.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md at the repo
  root, if it exists.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Work on a new branch v4/<step-id>-<short-name> from main. One pull request, titled "<step-id> · <title>".
- Definition of done (PLAN Part A §3): the type check, unit tests, helper tests, e2e tests and parity
  (from S0.5 on) are all green, plus your step's "Done when".
- Never:
  - edit golden/ or backend/tests/fixtures/saved/ (add files, never change them);
  - add a Python runtime dependency or a native executable;
  - remove an element id or data-* used by the e2e tests without updating the test in the same PR;
  - skip or disable a test;
  - implement operation semantics anywhere but the TypeScript ops module.
- Every user-visible change must be one of B1–B14 (PLAN Part B §8). Otherwise stop and ask.
- If anything needs a human (real share, corporate PCs, real decks, sign-off, a behaviour choice), write the
  question under "Waiting for" in PROGRESS.md, push, and stop.
- At the end:
  - tick your line in PROGRESS.md, with the PR link and any numbers you measured;
  - reply with: what changed (files), the commands you ran and their results, the numbers, and anything
    waiting for a human.

YOUR STEP: S0.1 · CI, PROGRESS.md, one check command (PLAN Part C, M0)
Context: README.md §11 lists the commands. Today:
- frontend: `npm test` = 114 Vitest tests (~4 s), including build.test.ts, which fails if
  backend/slide_builder.html is stale (so run `npm run build` before the tests in CI);
- helper: `python -m unittest discover -s tests` in backend/ = 131 tests (~32 s);
- e2e: `npm run test:e2e` = 15 Playwright scenarios, two real helpers (~4 min).
  frontend/playwright.config.ts takes Chromium from env CHROME, default
  /opt/pw-browsers/chromium-1194/chrome-linux/chrome. In CI, install Playwright's Chromium and set CHROME
  to `node -e "console.log(require('playwright').chromium.executablePath())"`.
Do:
1. frontend/package.json: add "check": "tsc --noEmit && vitest run".
2. .github/workflows/ci.yml, on pull_request and on push to main:
   - job "unit": Node 22, `npm ci`, `npm run build`, `npm run check`;
   - job "helper": a matrix of Python 3.8 and 3.12, `python -m unittest discover -s backend/tests -v`;
   - job "e2e": Node 22 + Python 3.12, Playwright Chromium, `npm run test:e2e`; upload the Playwright
     report on failure.
   - Cache npm. Use a timeout of 20 min per job.
3. Create PROGRESS.md at the repo root:
   - a header explaining the file (link to docs/next/PLAN.md);
   - sections "Steps" (one unchecked checkbox per step id S0.1 … S6.5, with the step title, copied from
     PLAN Part C), "Decisions", "Waiting for", "Measurements";
   - tick S0.1.
4. Do not change product code.
Done when: CI is green on your PR (all three jobs), and PROGRESS.md lists every step of PLAN Part C.
```

### Prompt 2 · S0.2 · Release pipeline

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.2 · Release pipeline. Depends on: S0.1.
Read: docs/next/adr/009-release-zips-side-by-side.md, tools/update.py (especially update_with_zip,
around line 286, and the list of protected paths around lines 47-64), .gitignore.
Do:
1. tools/make_release.py (Python 3.8 standard library only):
   - `--out dist/ --version X.Y.Z` builds slidebuilder-X.Y.Z.zip containing:
     - backend/ without data/, tests/ or __pycache__;
     - backend/slide_builder.html;
     - tools/update.py;
     - the three .bat files;
     - README.md;
     - MANIFEST.json = {"version", "built", "files": {"<path>": "<sha256>"}}.
   - `--verify <zip>` re-hashes every file and checks the manifest, with exit code 0/1.
   - Paths inside the ZIP use forward slashes, with no absolute paths.
2. .github/workflows/release.yml, on push of a tag v*:
   - run the same jobs as ci.yml (reuse them with workflow_call, or duplicate them minimally);
   - then make_release.py with the version from the tag, then make_release.py --verify;
   - then create a GitHub Release with the ZIP attached (use the gh CLI or an official action pinned by
     version).
3. Unit tests (backend/tests/test_make_release.py):
   - the ZIP contains no data/ and no workbook files;
   - --verify detects a modified file;
   - the manifest lists every file.
4. Document the release procedure in a short section of README.md §11.
Do NOT push any tag yourself. In your reply, give the exact commands a maintainer runs to cut a test
release.
Done when: CI is green; `python tools/make_release.py --out /tmp/d --version 0.0.0-test && python
tools/make_release.py --verify /tmp/d/slidebuilder-0.0.0-test.zip` exits 0.
```

### Prompt 3 · S0.3 · Side-by-side installs, current.json, Edge app window

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.3 · Side-by-side installs, current.json, Edge app window (B12). Depends on: S0.2.
Read:
- tools/update.py (all 441 lines) and backend/tests/test_update.py;
- "Start Slide Builder.bat" and "Update Slide Builder.bat";
- backend/slidebuilder/main.py, util.py (write_atomic, replace_retry), locks.py;
- docs/next/03-architecture.md §1.4–§1.5.

Environment facts you must respect:
- Windows, no admin rights. Programs may be blocked from running from the share, so python.exe and
  msedge.exe are local and our files are only data and scripts.
- The TLS proxy has a custom root CA: use ssl.create_default_context(); never disable verification.
- Consoles may be cp1252: ASCII-only output.
- PowerShell may be in Constrained Language Mode: do not use PowerShell for anything new.
- Python 3.8 compatible.

Do:
1. tools/update.py:
   - `--release [latest|X.Y.Z]` reads the GitHub Releases API for the repo (the existing DEFAULT_REPO) and
     downloads the asset ZIP with urllib. It checks the SHA-256 against the API's asset "digest" field when
     present, and always against MANIFEST.json.
   - It extracts to app/<ver>.part/, then renames to app/<ver>/, refusing to overwrite an existing complete
     version.
   - It runs `python app/<ver>/backend/slide_builder.py --selftest` and, only if that exits 0, atomically
     writes app/current.json {"version", "previous", "installedBy", "at"}.
   - It keeps the last 3 versions; it never deletes the current one or the previous one.
   - `--use X.Y.Z` flips the pointer (rollback).
   - `--zip <file>` installs a local release ZIP the same way.
   - Keep the existing git and branch-ZIP paths working, and keep the update lock, the backups of saved
     setups, the protected paths and the "test-load every deck" check.
2. "Start Slide Builder.bat": if app\current.json exists, start that version's backend\slide_builder.py,
   else backend\ as today. Parse the JSON with a tiny inline `python -c`, not PowerShell. Keep UNC (pushd)
   support.
3. backend/slidebuilder/main.py:
   - `--selftest`: import every helper module; read every saved deck, config and prefs file read-only
     through store.read_* (never write); create, rename and delete a probe file in data/locks; exit 0 or 1
     with ASCII lines.
   - Opening the page: look for msedge.exe in %ProgramFiles(x86)%\Microsoft\Edge\Application,
     %ProgramFiles%\Microsoft\Edge\Application and the App Paths registry key (winreg). Start it with
     `--app=<url>`; fall back to webbrowser.open on any failure. On Linux and macOS keep webbrowser.open.
4. Tests in backend/tests/test_update.py (use a local HTTP server or monkeypatched urlopen, and a temp
   folder as the share):
   - install;
   - pointer flip;
   - --use rollback;
   - digest mismatch refused (nothing written);
   - an interrupted install (exception after extract) leaves no app/<ver>/;
   - the selftest exit code gates the pointer;
   - the data folder is never touched.
5. Update README.md §2 and §7.5 for the new update flow (B12: app window).
Done when: all tests green. In your reply, include a rehearsal transcript on a temp copy of the repo used as
a fake share: install 0.0.1, install 0.0.2, --use 0.0.1, with current.json shown after each.
```

### Prompt 4 · S0.4 · v3 quick fixes found in the review

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.4 · v3 quick fixes (B6, B13). Depends on: S0.1.
Read: docs/next/01-current-system.md §2.3 and §5 (P5, P10).

Fix 1, "✓ Saved" lags 2–5 s (P10):
- frontend/src/sync/docsync.ts. `emit()` (around lines 32-40) only notifies listeners when preset, style
  or edits changed or the change is local. After a successful flush (around line 82) nothing changed, so
  the status bar updates only on the next 3 s tick.
- Notify listeners when the save state changes, and make sure the status bar re-renders.
- Add a Vitest case in frontend/tests/docsync.test.ts: the listener fires after a successful flush with
  state "saved".

Fix 2, polling cost (P5, B13):
- frontend/src/state/app.ts tick() calls /api/files every 6 s (around lines 57-62).
- backend/slidebuilder/workbooks.py list_workbooks (around lines 21-45) lists the folders, stats every
  workbook and READS every deck document.
- Add GET /api/files/<name>/stat → {mtime, size} (one stat), and use it for the changed-on-disk banner.
- Fetch the full list only when the Open menu opens (ui/Topbar.tsx) and at boot.
- Add the endpoint to backend/tests/test_http.py and docs/ARCHITECTURE.md §5.

Fix 3, presence:
- backend/slidebuilder/presence.py others() reads every heartbeat file on every beat.
- Encode user, host, client and workbook in the file name (URL-safe, length-capped) and judge freshness
  from the directory listing's mtime, using the file-server clock (fsclock), with no per-file reads.
- Keep reading the old JSON format too during the transition (files from older helpers).
- Update tests.

Fix 4, measure: extend tools/loadtest.py to simulate the Open menu (rare) and the changed-on-disk stat
(every 6 s per user). Record SMB operations per user per minute before and after in PROGRESS.md
"Measurements".

Rebuild backend/slide_builder.html with `npm run build` (the committed build must be fresh).
Done when: all suites green, including e2e E2 (presence, "Updated by") and the "✓ Saved" waits; the numbers
are recorded.
```

### Prompt 5 · S0.5 · Capture v3 as golden data

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.5 · Capture v3 as golden data. Depends on: S0.1.
Read: docs/next/05-test-and-parity.md §1–§2 and §4 (the parity checklist); spikes/baseline/measure.mjs and
make_workbooks.py (a working Playwright driver of the real app); frontend/e2e/app.spec.ts (selectors and
flows); frontend/tests/fixtures/make_fixtures.py.

Do:
1. tests/corpus/:
   - workbooks: the 4 fixtures; deck20 and big30 from spikes/baseline/make_workbooks.py, moved into
     tools/make_corpus.py; and edge cases generated with openpyxl (dev only):
     - number formats incl. locale tags, fractions, exponents, elapsed time, conditional sections;
     - CF cellIs and expression rules with relative references;
     - merges, hidden rows and columns;
     - pictures (PNG, cropped, rotated) and shapes/text boxes;
     - rich-text superscripts;
     - a 1904-date workbook.
   - saved decks (data/workbooks/*.json written via ops, never by hand) covering every option family in
     05 §4:
     - each design;
     - per-design sizes;
     - versions with removed cells;
     - text boxes on all sides, span, free, bubble, notes section;
     - comments in summary and sections mode with every switch;
     - colour scales, painted CF, merges/splits, gridlines;
     - themes incl. custom, colour overrides, text styles, an uploaded font;
     - page numbers (all formats and positions) and footer with placeholders;
     - logo hidden per slide;
     - cover and index.
2. tools/capture-v3.mjs: start a v3 helper on a temp ROOT/DATA seeded with the corpus. Freeze the clock
   (page.clock.setFixedTime) so "today" on covers is deterministic. For each deck × design × version ×
   slide at zoom 100 %, record into golden/<deck>/<design>/<version>/:
   - slide-<n>.json: every .t, .wb, .tw, .note, title, logo, page number and footer element, with its
     bounding box relative to the slide, text, computed font family/size/weight/colour, and fill;
   - slide-<n>.png;
   - pdf.json: from the vector export, via a Python helper based on spikes/baseline/pdfinfo.py: text per
     page plus text-run positions;
   - comments.json: the comment text per note;
   - issues.json: the side-panel issues.
   Also write golden/MANIFEST.json (v3 git sha, Chromium version, fonts available on the machine).
3. tools/parity.mjs: re-capture with any build into a temp folder and compare with golden/:
   - texts exact;
   - boxes within 2 px (text origins 1 px);
   - pixels by ΔE over 1 px-dilated masks (pixelmatch or a small own implementation, dev dependency);
   - an HTML report in parity-report/;
   - read tests/parity/accepted.json (initially []) for accepted differences;
   - exit code 1 on any unaccepted difference.
   Add `npm run parity`, and a CI job that runs it (use the same container/fonts as the capture; record
   that goldens are platform-specific).
4. tools/anonymise.py (dev only): scrambles numbers in a workbook and its saved deck, keeping labels and
   headers, so that real decks can be added later.
Done when: goldens are committed. `npm run parity` on the current build reports 0 differences, twice in a
row (determinism); report the run times. Add to "Waiting for": "5 real decks to anonymise and add to
tests/corpus (owner: product owner)".
```

### Prompt 6 · S0.6 · Field-test kit (🚦 G0)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.6.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.6 · Field tests on the real environment, the KIT. Depends on: S0.1.
This step has a human gate (G0). You build the kit and the instructions; people run it on the bank's PCs
and share. You cannot reach those. Do not pretend to have results.
Read: docs/next/04-data-and-migration.md §2, spikes/storage/journal_sim.py (both protocols, framing,
latency model), docs/next/05-test-and-parity.md §3.5 and §3.7 (W1–W14), spikes/pdfwriter/.

Do:
1. tools/sharetest.py (Python 3.8 stdlib, ASCII output). It runs the journal protocol and the lean-lock
   protocol against a temporary sub-folder of a REAL folder:
   - `--folder T:\Slide Builder\_sharetest`;
   - several PCs coordinate through files in that folder: `--role coordinator|worker`, a start barrier
     file, `--users-per-pc N`, `--duration`;
   - no simulated latency; it measures the median round trip of create, stat, rename and delete first;
   - every acknowledged record must be in every final view, and views must converge (as the sim checks);
   - optionally (`--notify`, Windows only, ctypes ReadDirectoryChangesW on the journal folder) it reports
     whether an append on PC A wakes PC B, and after how long;
   - output: a JSON and a readable summary per PC, plus a merged summary by the coordinator;
   - it deletes its sub-folder at the end.
   Add unit tests that run it on a local temp folder with 2 processes.
2. docs/next/field-results.md: a fill-in template with one section per test, giving the exact command,
   what to record, and pass criteria:
   - sharetest from 3–5 PCs incl. one on VPN;
   - the W1–W14 policy matrix rows, each with a concrete check:
     - W1–W3: start Python and Edge, try a copied exe from %LOCALAPPDATA%;
     - W4: Edge policy DeveloperToolsAvailability;
     - W5: `msedge --app`;
     - "Blob Worker + WebAssembly": a tiny test page, tools/fieldcheck.html, that you write; it must work
       from file:// and from the helper;
     - W6: Constrained Language Mode, `$ExecutionContext.SessionState.LanguageMode`;
     - W7: download a GitHub release through the proxy;
     - W13: fonts present (Aptos, Calibri version);
     - W14: open spikes/pdfwriter/out-native-glass.pdf and out-native-excel.pdf in Acrobat; check render
       speed, look, text selection.
   - the font licence question for R7.
3. Make the spike PDFs reproducible: a CI artefact or `npm run spike:pdf` that regenerates them.
Then STOP. Write under "Waiting for": "G0 field tests: run docs/next/field-results.md on real PCs and the
share. Decisions needed: storage (journal / lean-lock), Acrobat (OK / flatten gradients), fonts (copy
allowed / per-PC fallback), Edge app mode (OK / tab)."
Done when: sharetest passes locally with 2–4 processes; the template and fieldcheck.html exist; CI green.
```

### Prompt 7 · S0.7 · Ship v3.4

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S0.7.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S0.7 · Ship v3.4. Depends on: S0.2, S0.3, S0.4 (S0.5 and S0.6 need not be finished).
Do:
1. Bump the version string where the helper reports it (grep for the version in backend/slidebuilder and
   frontend/package.json) to 3.4.0. Rebuild the page.
2. CHANGELOG.md (create it if missing) with a "3.4.0" section in user language:
   - "✓ Saved" appears immediately;
   - lighter use of the shared folder;
   - updates install side by side, with instant rollback;
   - opens in an Edge app window.
3. Write docs/next/release-checklist.md (reused for every release):
   - CI green;
   - parity 0 unexplained differences;
   - make_release --verify;
   - tag;
   - rehearse the install on a copy of the share;
   - update the real share with `Update Slide Builder.bat --release 3.4.0`;
   - check that a second PC picks it up;
   - rollback command written in the release notes.
4. Run the whole checklist up to (not including) tagging, on a temp copy.
Do NOT push the tag. In your reply, give the maintainer the exact tag commands and the share-update
commands, and add "Tag v3.4.0 and update the share" to "Waiting for".
```

---

## M1 · The React app

### Prompt 8 · S1.1 · React API on the Preact runtime

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S1.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S1.1 · React API on the Preact runtime. Depends on: S0.5 (parity must exist), S0.7.
Read: docs/next/adr/012-react-app-with-selector-store.md, PLAN Part B §7, frontend/src/main.tsx,
frontend/src/ui/*.tsx, frontend/src/wizard/*.tsx, frontend/vite.config.ts, vitest config.
Goal: every component is written against the React API, while still running on Preact through an alias.
This step changes NO behaviour.
Do:
1. Vite and Vitest: alias react → preact/compat, react-dom → preact/compat,
   react/jsx-runtime → preact/jsx-runtime. tsconfig: jsxImportSource "react". Add @types/react (dev).
2. Replace every import from "preact" / "preact/hooks" with "react" equivalents (types: JSX, ReactNode
   instead of ComponentChildren).
3. Convert the idioms React does not accept:
   - class= → className=;
   - for= → htmlFor=;
   - string style="a:b" → style objects;
   - Preact onInput on text inputs where React needs onChange (check ui/Field.tsx: its draft-while-focused
     behaviour must stay; e2e E8 checks it);
   - dangerouslySetInnerHTML usage unchanged.
4. Keep EVERY id and data-* attribute; the e2e tests and tools/parity.mjs rely on them.
5. Do not touch editor/stage.ts behaviour (it is imperative DOM, fine for now).
Done when:
- `npm run check`, e2e and `npm run parity` (0 differences) are green;
- the bundle size before and after is in PROGRESS.md;
- there is no console error or warning during e2e (add a console listener to the existing "no page
  errors" test).
```

### Prompt 9 · S1.2 · Repository layout (app/, core/, workspaces)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S1.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S1.2 · Repository layout. Depends on: S1.1.
Read: PLAN Part B §5 (target tree), README.md §11 and §16, .github/workflows/*.yml, tools/*.mjs paths.
Do:
1. `git mv frontend app` (keep history). Root package.json with npm workspaces ["app", "core"]; scripts
   check, build, test:e2e, parity and bench delegate to the workspaces.
2. Create core/ with package.json, tsconfig.json (strict, lib ["ES2022", "WebWorker"], NO "DOM"), a
   placeholder src/index.ts and a Vitest config. CI must type-check core/ separately, so that DOM types can
   never creep in.
3. The build output path stays backend/slide_builder.html (the helper serves it).
4. Fix every path: CI workflows, tools/capture-v3.mjs, tools/parity.mjs, tools/make_release.py,
   spikes/README.md, README.md §11/§16, build.test.ts.
Done when: everything is green from the repo root with `npm ci && npm run check && npm run test:e2e && npm
run parity`; `git log --follow app/src/render/glass.ts` shows the old history.
```

### Prompt 10 · S1.3 · Store with selectors replaces the global S

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S1.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S1.3 · Store with selectors replaces the global S. Depends on: S1.2.
Read:
- app/src/state/store.ts: the global S at line ~15, emit() at ~52, useApp() at ~56;
- app/src/state/app.ts (all actions);
- state/dialogs.ts, state/fonts.ts;
- every caller of useApp() (15 components);
- the STAGE/THUMBS controller hooks used by editor/stage.ts and editor/thumbs.ts;
- PLAN Part B §2 (ownership table).
Do:
1. Add zustand@5 (pin it; MIT). One store, created with the subscribeWithSelector middleware, in slices:
   - doc: the sync state, view mirror, remote author;
   - deck: file, workbook handle, slides, current slide, version;
   - selection: cells, noteSel, textSel, painter;
   - ui: dialogs, toast, busy, zoom, banners, health, others/presence;
   - prefs.
2. Move each field of S into its slice and each action of state/app.ts into a store action. Components read
   with narrow selectors; shallow-compare for objects.
3. Keep the imperative stage working: editor/stage.ts and thumbs.ts subscribe to the slices they need (no
   full re-render on unrelated changes).
4. Delete emit(), useApp() and the global S. Grep must find no "S." access left.
5. Render-count test (app/tests/renders.test.tsx, Testing Library + React Profiler API, still running on
   preact/compat):
   - moving the selection re-renders at most 5 components (Ribbon, TableTools, FormulaBar, StatusBar,
     stage overlay);
   - a poll with no document change re-renders 0;
   - a toast re-renders only Toast.
   Add these numbers to PROGRESS.md "Measurements".
Done when: all green, including e2e and parity (0 differences); the render-count test passes.
```

### Prompt 11 · S1.4 · Switch to real React 19

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S1.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S1.4 · Switch to real React 19. Depends on: S1.3.
Do:
1. Remove the preact/compat aliases and the preact dependency. Add react@19 and react-dom@19 (pinned),
   @types/react and @types/react-dom.
2. main.tsx uses createRoot.
3. Fix the React-specific differences:
   - controlled inputs: ui/Field.tsx must keep its draft while focused; e2e E8 "typing is never
     overwritten" is the guard;
   - onChange semantics;
   - event pooling is gone (fine);
   - StrictMode double effects: wrap in StrictMode in dev only and make effects idempotent; the
     helper-start effects in boot() must not run twice (guard).
4. Try the React Compiler (babel-plugin-react-compiler, dev dependency, via @vitejs/plugin-react). Keep it
   only if all tests and parity stay green and the render-count test does not get worse; otherwise note why
   in PROGRESS.md "Decisions".
5. The single-file build still works: the page is one HTML file and opens from file:// in offline mode
   (check manually with Playwright: open backend/slide_builder.html from disk and load a fixture via the
   file input).
Done when: all green; no React warnings in the e2e console; the render-count test passes; bundle size in
PROGRESS.md.
```

### Prompt 12 · S1.5 · Ship v3.5

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S1.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S1.5 · Ship v3.5. Depends on: S1.4.
Follow docs/next/release-checklist.md:
- bump to 3.5.0;
- CHANGELOG "3.5.0": the interface is rebuilt on React (no visible change expected); the save indicator and
  presence are unchanged;
- run every check up to tagging, rehearse on a temp copy of a share.
Do NOT push the tag. Reply with the tag and share-update commands; add them to "Waiting for".
```

---

## M2 · The core in workers

### Prompt 13 · S2.1 · Move pure code into core/

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.1 · Move pure code into core/. Depends on: S1.4.
Read: docs/next/03-architecture.md §2 and §4.1; docs/next/06-plan.md §3 (reuse map); app/src/xlsx/*,
app/src/model/*, app/src/render/*.
DOM uses you must put behind interfaces (find them all with grep for document., window., canvas,
measureText, DOMParser, getBoundingClientRect, scrollHeight):
- xlsx/workbook.ts ~169-176: max digit width via canvas measureText → TextMeasurer.maxDigitWidth(font).
- render/slide.ts fitNotes ~311-332: off-screen DOM measuring → TextMeasurer.fitText(...).
- render/wallpaper.ts makeWall: canvas + it injects <style id="wallcss"> → split it. The pure part returns
  the wall images via a CanvasFactory; applying the CSS stays in app/.
- xlsx/drawing.ts analyzeImages: canvas sampling → CanvasFactory/ImageDecoder interface.
- DOMParser uses in xlsx (rels, workbook, styles, theme, drawings) → an XmlParser interface (implemented
  in app/ with DOMParser for now; S2.2 replaces it).
Do:
1. `git mv` the pure modules into core/src/{xlsx,model,render,text}/, keeping their file names. Leave thin
   re-exports in app/ only where that keeps the diff readable, and delete them by the end of M2.
2. Define the interfaces in core/src/platform.ts. Implement the browser versions in app/src/platform/.
   Inject them once at boot.
3. Move the related unit tests to core/tests (numfmt, comment, ops, design, tables, text where pure).
   shared/ops-vectors.json is run by core's ops test.
Done when: core/ type-checks without DOM types (CI job); all suites green; parity 0 differences.
```

### Prompt 14 · S2.2 · XML tokenizer instead of DOMParser

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.2 · XML tokenizer instead of DOMParser (workers have no DOMParser). Depends on: S2.1.
Read: every XmlParser use from S2.1 (rels, workbook.xml, styles.xml: numFmts, fonts, fills incl.
gradient fills, borders, cellXfs, dxfs; theme clrScheme; drawing XML: anchors, groups, AlternateContent,
blips, srcRect, xfrm rot/flip, shapes and text boxes with runs).
Do:
1. core/src/xlsx/xml.ts: a small pull tokenizer over a string.
   - It handles elements, attributes, self-closing tags, text, CDATA, the 5 entities plus numeric
     entities, and namespace prefixes. Callers query by local name, as the current code effectively does.
   - Add a tiny element-tree helper for the small parts (styles, theme, drawings), where a tree is
     simpler.
2. Port every reader to it. Remove the XmlParser interface and the DOMParser implementation.
3. Equivalence test (core/tests/xml-equivalence.test.ts, Vitest with jsdom only in this test): for every
   tests/corpus workbook, the parsed shared context (styles, theme, numFmts, xfs, dxfs), the rels and the
   drawings serialised to JSON must be identical with the old DOMParser path, which you keep in the test
   only.
Done when: the equivalence test and all suites are green; parity 0 differences.
```

### Prompt 15 · S2.3 · Columnar SheetStore and byte scanner

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.3 · Columnar SheetStore and byte scanner. Depends on: S2.2.
Read:
- spikes/parser/parse_bench.mjs (a scanner prototype; it handles only openpyxl's cell shapes);
- core/src/xlsx/workbook.ts readSheet (the regex parser: all cell types s, inlineStr, str, b, e, d,
  numeric, date detection by format, rich runs from the SST and inline strings, _xHHHH_ escapes,
  namespace prefixes, rows/cells without r, row info ht/hidden/customFormat, cols, sheetFormatPr,
  merges, CF);
- core/src/xlsx/types.ts Sheet/Cell;
- docs/next/03-architecture.md §2.3.
Do:
1. Replace JSZip with fflate (pin it; MIT); unzipSync with a filter that reads only the needed parts.
2. core/src/xlsx/sheetstore.ts: typed-array columns (row, col, kind, num, str, xf), a row offset index,
   and a sparse runs map; one workbook string table (SST plus inline strings).
3. core/src/xlsx/scan.ts: a byte-level scanner over the inflated sheet bytes. It covers EVERY cell shape the
   regex parser handles. Merges, CF, cols and sheetFormatPr may use the XML tokenizer, since they are small.
4. A Sheet facade with the same methods and semantics as today (cellAt, xfAt, colPx, rowPx, colStart,
   rowStart, cells iteration, …), so that buildLayout, findRegions, evalCF, formatValue, the wizard
   detector and the comment analysis run unchanged. Replace `cells: Map<string, Cell>` users with facade
   calls; a Cell object is created only when asked for.
5. Equivalence test: for every cell of every corpus sheet (incl. big30), value, type, xf, fmt and runs are
   identical to the old regex parser, which you keep in the test only.
6. ⏱ tools/bench.mjs, `npm run bench` (Node): parse one big30 data sheet. Thresholds: under 0.5 s parse,
   under 40 MB retained. CI fails if a threshold is exceeded by more than 10 %.
Done when: the equivalence test, bench and all suites are green; parity 0 differences; numbers in
PROGRESS.md.
```

### Prompt 16 · S2.4 · Core worker, typed RPC, the document moves into the worker

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.4 · Core worker, typed RPC, the document moves into the worker. Depends on: S2.3.
Read: PLAN Part B §2 (ownership) and §3 (an edit end to end); app/src/sync/docsync.ts and api.ts;
app/src/state/* actions that open workbooks, change, undo and poll; editor/stage.ts renderStage/refreshStage
(how HTML per table is consumed today).
Do:
1. core/src/rpc/messages.ts: typed requests, responses and events, for example:
   - openWorkbook(bytes | name), getView(), apply(ops, label, coalesceKey), undo(), redo();
   - renderSlide(index, design, version), tableHtml patches, setVersion, setDesign;
   - getIssues, exportPayload (still HTML in M2).
   Use transferables for ArrayBuffers.
2. core/src/workers/core.worker.ts owns: the workbook (SheetStore), DocSync (still the v3 HTTP ops
   protocol, called with fetch and the token from the page), the undo/redo stacks with labels and the 1.5 s
   coalesce rule, and the renderers producing HTML strings per table, as today. It emits view snapshots and
   per-table HTML patches.
3. app/src/rpc/client.ts: a promise-based client. The store's doc and deck slices are fed from worker
   events. The UI never mutates the document.
4. Build: inline the worker as a Blob URL in the single-file build, so file:// offline mode keeps working.
   Add a Playwright test that opens the built HTML from disk (file://), loads a fixture through the file
   input, edits a cell and sees "Saved in this browser only".
5. Keep behaviour identical: undo only reverts my own changes (E2), typing is never overwritten (E8).
Done when: all suites green, including the new file:// test; parity 0 differences; the PR describes the
message list.
```

### Prompt 17 · S2.5 · Wizard and formula bar read cells through the worker

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.5 · Wizard and formula bar read cells through the worker. Depends on: S2.4.
Read: app/src/wizard/Wizard.tsx (sheet preview grid capped at 400×80, detected tables, markers,
versions step), app/src/wizard/detect.ts, app/src/ui/Ribbon.tsx (formula bar, "↺ Excel value"),
app/src/editor/edit.ts.
Do:
1. RPCs:
   - getSheetMeta(sheet): sizes, used range, title/subtitle, marker tables, status;
   - getSheetWindow(sheet, r0, r1, c0, c1): displayed text, fill, bold, hidden flags, marker flags;
   - detectTables(sheet), run in the worker;
   - getCell(sheet, ref): Excel text, the edit, its orig.
2. The wizard and the formula bar use only these. No workbook data lives in the UI thread any more.
Done when: E1, E5, E13 and E14 plus all suites are green; parity 0 differences; opening the wizard on big30
shows no main-thread long task over 50 ms (check with a PerformanceObserver in a Playwright test).
```

### Prompt 18 · S2.6 · Smoothness gate for opening

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.6.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.6 · Smoothness gate for opening (B8). Depends on: S2.5.
Read: spikes/baseline/measure.mjs (open, wizard, long-task observer, heap), docs/next/06-plan.md §6
(B-1, B-2), PLAN Part F.
Do:
1. Extend tools/bench.mjs with browser benchmarks (Playwright, real helper, as measure.mjs):
   - open deck20 → first slide;
   - open big30 → read one data sheet in the wizard;
   - the longest main-thread task during both;
   - the JS heap after reading the sheet.
2. Thresholds: deck20 open under 400 ms; sheet read under 1 s; longest task 50 ms or less; heap under
   150 MB. Add a CI job "bench" that fails above +10 %.
3. Fix what is needed to pass: progress events from the worker, no large structured clones on the main
   thread (send windows, not sheets), lazy thumbnails.
4. Record the before (baseline 01 §3.1) and after numbers in PROGRESS.md.
Done when: the bench is green in CI.
```

### Prompt 19 · S2.7 · Ship v3.6

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S2.7.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S2.7 · Ship v3.6. Depends on: S2.6.
Follow docs/next/release-checklist.md:
- bump to 3.6.0;
- CHANGELOG "3.6.0": large workbooks open without freezing the window (B8), with the measured numbers;
- run every check up to tagging, rehearse on a temp copy of a share.
Do NOT push the tag. Reply with the commands; add them to "Waiting for".
```

---

## M3 · Display list and native export

### Prompt 20 · S3.1 · Display list, PDF writer, test tools

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.1 · Display list, PDF writer, test tools. Depends on: S2.4 (the G0 decisions must be in
PROGRESS.md "Decisions"; if they are not, stop).
Read: docs/next/03-architecture.md §2.4, §4.3, §5; adr/003, adr/004; spikes/pdfwriter/pdf.ts, ttf.ts and
bench.ts (a working writer: unit-box gradients with shared shadings and soft masks, stepped shadows,
JPEG passthrough, CIDFontType2 + ToUnicode); spikes/baseline/pdfinfo.py; spikes/pdfwriter/render_cost.py.
G0 decision to apply: if Acrobat had soft-mask problems, add the "flattened gradient" recipe: two solid
bands instead of an alpha gradient, selectable per document.
Do:
1. core/src/dl/types.ts: the 8 node types exactly as 03 §2.4 (rect with r or 4 radii, path, line with
   width/dash/cap, image with crop/rotation/alpha, shadow, text with font id/size/glyph run/src string,
   group with clip/alpha/transform, hit). Paint is solid, linear in the unit box, or radial. Add
   validators.
2. core/src/dl/svg.ts (DL → SVG string; text as <text x y textLength lengthAdjust=spacing>) and
   core/src/dl/canvas.ts (DL → CanvasRenderingContext2D or OffscreenCanvas).
3. core/src/pdf/: the writer, ported from the spike and completed: paths, dashed lines, radial
   shadings, image alpha via SMask, group alpha, transforms, de-duplication of images by content hash and
   of gradients by style, Flate via fflate, no object streams, MediaBox [0 0 1200 675] with the cm
   mapping. Fonts: keep the spike's TrueType subsetter for now (S3.2 switches to hb-subset). Write a
   core/src/pdf/README.md with PDF notes.
4. tools/pdfcheck.py (dev): budgets, fonts (no Type3, subset prefix), images count, text extraction,
   PDFium render time; `qpdf --check` in CI (apt install qpdf in the CI job).
5. Tests: every node type rendered by all three backends; for each, the PDF page rendered by PDFium and
   the canvas render compare within tolerance (SP); qpdf clean.
Done when: all green, with a short table of node × backend in the PR.
```

### Prompt 21 · S3.2 · Fonts and text shaping (HarfBuzz)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.2 · Fonts and text shaping. Depends on: S3.1.
Read: docs/next/03-architecture.md §2.5–2.6; adr/005; spikes/fonts/subset_check.mjs (a raw hb-subset
WASM call sequence: pin all axes to default, then wght, to remove fvar/gvar);
app/src/state/fonts.ts; core/src/model/fonts.ts; backend/slidebuilder/fonts.py (library format,
signature checks, the lock "fonts", the sweep of unreferenced files); docs/ARCHITECTURE.md §3.4.
G0 decision to apply: whether Windows fonts may be copied to the share (R7). If not, implement only
"fingerprint" mode: store the metrics hash; on a mismatch, warn in the side panel.
Do:
1. Pin harfbuzzjs@0.4.12 (MIT). Load hb.wasm and hb-subset.wasm in workers (inlined base64 in the single
   file).
2. core/src/text/:
   - FontRegistry: font files by sha1, with family/weight/style from the existing readFontInfo;
   - shape(text, fontId, sizePx) → {gids, advances, width}, with kern and liga on;
   - breakLines(text, width, …), matching the wrap rules v3 uses for cells and text boxes (word breaks,
     explicit newlines);
   - fitText(…), the fitNotes semantics: shrink 1 px down to 9 px.
3. core/src/pdf/fonts.ts: subset with hb-subset (TrueType → FontFile2, CFF → FontFile3/OpenType), plus
   Widths and ToUnicode. Keep the spike TrueType subsetter as a tested fallback.
4. Helper (stdlib):
   - GET /sysfonts/<name> serves files from C:\Windows\Fonts (and %LOCALAPPDATA%\Microsoft\Windows\Fonts),
     name-whitelisted, token-protected; 404 on other OSes, where tests use a configurable directory;
   - POST /api/fonts/capture {family} copies the system font into data/fonts/system/<family>-<sha1>.<ext>
     with source "system", after checking OS/2 fsType (refuse restricted-licence fonts) — or fingerprint
     mode per G0.
   fonts.json stays schema 1; add a test that v3's fonts.py still reads it.
5. Uploads of variable fonts: instance one static face per used weight and style (hb-subset, all axes
   pinned), stored like Google faces.
Done when:
- tests pass: shaping widths equal HarfBuzz reference values for a corpus string set; a variable upload
  produces static faces without fvar or gvar; capture refuses restricted fonts; v3 reads fonts.json;
- all suites green; parity 0 differences (nothing visible uses this yet).
```

### Prompt 22 · S3.3 · Excel and Excel Refined → display list

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.3 · Excel and Excel Refined → display list. Depends on: S3.2. (May run in parallel with
S3.4.)
Read: core/src/render/excel.ts (renderExcel, cellHtml, picHtml, rotBox/rotSpan, shapeTransform,
textboxInner), the Excel rules in app/src/styles/slide.css, core/src/render/edits.ts (effItems),
golden/*/excel and golden/*/clean.
Do:
1. core/src/render/excel-dl.ts: excelToDisplayList(L, ctx) → table DL in table pixels.
   - fill → rect;
   - each border side → line, with Excel styles mapped: hair 0.5, thin 1, medium 2, thick 3, dashed
     [3,1], dotted [1,1], dashDot, mediumDashed, slantDashDot, double = two lines;
   - text → text, with alignment, indent, vertical alignment, wrap, overflow into empty neighbours via a
     group clip, rotation via a group transform, superscript/subscript runs (smaller size, baseline shift
     as v3's <sup>/<sub>);
   - pictures and shapes → image/path; text boxes → nodes.
   IMPORTANT: in this step text metrics follow v3, through the TextMeasurer with the canvas digit width, so
   that parity can be exact. HarfBuzz-based layout comes in S4.4.
2. tools/parity.mjs learns to compare a DL (rendered to PNG with the canvas backend, and its geometry)
   against the goldens.
Done when: GG and GP for every corpus slide in the excel and clean designs pass with 0 unaccepted
differences; all suites green. The HTML path is still what users see.
```

### Prompt 23 · S3.4 · Liquid Glass → display list

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.4 · Liquid Glass → display list. Depends on: S3.2. (May run in parallel with S3.3.)
Read:
- docs/next/03-architecture.md §4.3 (the recipe table: follow it);
- core/src/render/glass.ts (renderGlass ~376-515: containers → materials, padded outlines with GAP,
  rules/separators, signals → capsules, media, text inks and weights; tintGrad/deepInk ~371-374;
  glassGeom ~38-60);
- the .gls/.wb/.card/.panel/.chip/.tinted/.cap/.hsep/.vsep/.rule.accent/.icon/.gtb/.notebub rules in
  app/src/styles/slide.css (gradients with calc(... * var(--gi)), box-shadows, mask rim);
- core/src/render/wallpaper.ts;
- placeGlass in core/src/render/slide.ts ~182-188 (LENS = 1 + .06·gi);
- printcss.ts (the stepped shadows: STEPS 5, REACH .6; use 6 steps);
- spikes/pdfwriter/bench.ts glassCard() (a working approximation).
Do:
1. Keep buildScene, inferRoles and the material decisions UNCHANGED.
2. core/src/render/glass-dl.ts: each material becomes its recipe.
   - Evaluate the CSS calc() expressions in TypeScript for the deck's glass level, contrast and radius.
   - glass = shadow + group{clip rrect: image "wallblur" at the lens transform + tint gradient + veil}
     + rim stroke.
   - Also: capsules (pos/neg/solid/scale), hairlines with faded ends, accent rule, icons in round clips,
     keyed pictures, tinted blocks with deep ink, text-shadow on strong capsules as two runs.
3. Wallpaper: run makeWall in the worker on OffscreenCanvas (2D context filter "blur(...)" is supported in
   Chromium workers). Output two JPEG images with stable ids, from a hash of their inputs.
4. tools/parity.mjs: compare against golden/*/glass for every theme, glass level and contrast present in
   the corpus.
Done when: GG passes within tolerance; the GP report is generated (it may show the expected stepped-shadow
and rim differences; list them in tests/parity/accepted.json with reason "B3 pending G1"); all suites green.
```

### Prompt 24 · S3.5 · Slide furniture → display list

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.5 · Slide furniture → display list. Depends on: S3.3 and S3.4.
Read: core/src/render/slide.ts (buildSlide, applyLayout, computeLayout, notesOf, memoBox, themeVars,
contrastVars), text.ts (titleGeom, richText markup, effNote, slideTextFmt), cover.ts (cover and index for
both designs; dotted leaders; page numbers in the index), pagenumbers.ts (positions, capsule/plain,
avoiding the logo, shared corners, footer placeholders {date} {workbook} {title}), comment.ts
(commentText); the related slide.css rules.
Do:
1. core/src/render/slide-dl.ts: buildSlideDL(R, ctx) → the complete slide DL in slide px:
   - wallpaper (Glass) or background;
   - title and subtitle (pushing tables), or cover/index;
   - tables placed by computeLayout (unchanged) with each table DL under a group transform;
   - text boxes: markup, bubble (.notebub), line/paragraph spacing, vertical alignment, fitting with v3's
     rules via TextMeasurer;
   - the notes section;
   - automated comments;
   - page number, footer, logo with bubble and per-slide hide;
   - hit nodes for every table, cell grid, text box, title/subtitle/cover texts, logo.
2. Parity over all slides: GG, GT (texts, comments, page numbers, footer, contents entries) and GP.
Done when: all slides of the corpus in all designs and versions pass GG and GT; GP is within tolerance or
accepted with reason "B3 pending G1"; all suites green.
```

### Prompt 25 · S3.6 · Pixel review (🚦 G1)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.6.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.6 · Pixel review package (human gate G1). Depends on: S3.5.
Do:
1. Produce review/G1/index.html, a static, self-contained page. For every corpus deck × design × slide it
   shows: v3 screenshot | DL render | heat map. Filters by design and by "differences only"; the accepted
   differences with their reasons; a summary table of the worst slides. Include the real (anonymised)
   decks if they are in the corpus.
2. Also export 3 sample PDFs per design with the native writer (not yet wired into the UI: use a Node
   script, tools/export-dl.mjs) for opening in Acrobat.
3. Write review/G1/README.md: what to look at (glass cards, shadows, rims, capsules, text positions,
   wrapping), and how to answer (approve per design, or list slide + problem).
Then STOP. Add to "Waiting for": "G1: review review/G1/ and approve Liquid Glass / Excel / Excel Refined, or
list problems." If problems come back, they are fixed in follow-up PRs titled "S3.6-fix …" before S3.7.
```

### Prompt 26 · S3.7 · Native export, in workers

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.7.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.7 · Native export in workers (B1 partly, B9, B11). Depends on: S3.6 approved in PROGRESS.md
"Decisions" (if not, stop).
Read: app/src/editor/export.ts (doExport, exportVersions, exportPayload, the in-window fallback),
ui/Topbar.tsx (the export menu items with data-x keys: pdf, pdf-vector, pdf-exact, pdf-current, copy,
png-current, png-all, versions, versions-2, versions-3), backend/slidebuilder/exports.py (save_export
~40-58: temp, lock, " (2)" names; export naming ~61-114), docs/next/03-architecture.md §5, the parity
checklist 05 §4.10 (EX-01…EX-18).
Do:
1. core/src/workers/export.worker.ts. Up to 3 in parallel, one per (design, version). It asks the core
   worker for DLs, writes the PDF, and returns bytes. Modes:
   - vector PDF;
   - "as pictures" = PNG pages at 2× (B9), Flate in the PDF, file name "(images)";
   - PNG current and all;
   - clipboard (navigator.clipboard.write with a ClipboardItem PNG).
2. Helper POST /api/export-file?name=<file> (body = bytes, the 300 MB limit stays) → save_export. Version
   exports named "<workbook> - <version> - <design>.pdf" (B11). Add tests in test_exports.py.
3. The Export menu: the native writer is the default; add "PDF · text & tables (old engine)", which keeps
   calling /api/export for one release. Keep every data-x key.
4. file:// mode: exports work as browser downloads (B1).
5. ⏱ bench: 20 Glass slides click → file saved under 2 s; Excel under 1 s.
   pdfcheck budgets: Excel under 40 KB/slide, Glass under 80 KB/slide + 190 KB per document, 0 Type 3,
   0 variable fonts, text extraction equal to v3's PDF text per page.
6. e2e: E3 and E13 pass; add tests for PNG current, PNG all, clipboard (grant permissions), and
   versions × 3 designs (6 files, names per B11).
Done when: all green, with the bench numbers in PROGRESS.md.
```

### Prompt 27 · S3.8 · Pilot of the export (🚦)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.8.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.8 · Pilot of the export (human gate). Depends on: S3.7.
Do:
1. Prepare a pilot build (version 3.7.0-pilot via make_release) and docs/next/pilot-export.md, which tells
   pilot users to:
   - export the real weekly deck with both engines each week for 2 weeks;
   - compare them in Acrobat (look, speed, text selection);
   - report in a simple form: slide, design, what is wrong, a screenshot.
2. Add an in-app "Report a problem with this export" link that opens a mailto: or writes a small JSON
   into export\feedback\ (choose the simplest that works offline; say which).
Then STOP. Add to "Waiting for": "Pilot export (2 weekly cycles): results and go/no-go." Problems that come
back are fixed in "S3.8-fix …" PRs.
```

### Prompt 28 · S3.9 · Ship v3.7

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S3.9.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S3.9 · Ship v3.7. Depends on: S3.8 go in "Decisions".
Follow docs/next/release-checklist.md:
- bump to 3.7.0;
- CHANGELOG "3.7.0": new export engine, with before/after numbers (time, size); the old engine is still
  in the menu for one release; "as pictures" now 2×; version file names;
- run the checks; rehearse.
Do NOT push the tag. Reply with the commands; add them to "Waiting for".
```

---

## M4 · The screen draws the display list

### Prompt 29 · S4.1 · React stage on SVG

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.1 · React stage on SVG (B3). Depends on: S3.9.
Read:
- app/src/editor/stage.ts in full (36 KB): renderStage/refreshStage, fitStage/zoom, hit testing with one
  overlay per table + binary search over column/row edges (cellFromPoint), selection painting, column/row
  border drags, inline cell editor (Enter/Shift+Enter/Tab/Esc/blur), slide-text and text-box editors, table
  handles (resize by binary search of the layout weight, edge stretch, grip move between bands), text-box
  move/stretch with 8 px snapping guides, notes section, logo state, "never redraw while an inline editor
  is open";
- editor/edit.ts, tables.ts, textfmt.ts, keys.ts;
- the e2e selectors that target the stage (#stage .slide .t, .tw, handles, data-* attributes): list them
  all first.
Do:
1. app/src/stage/: Stage (zoom/fit/scroll), SlideSvg, TableLayer, SlideFurnitureLayer, Overlays,
   InlineCellEditor, TextBoxEditor, SlideTextEditor.
   - TableLayer is memoised by DL id and writes svg.ts output through a ref, so React does not diff it.
   - Overlays are ordinary React components driven by the selection slice and the hit nodes.
2. Keep the e2e selectors working: emit the same classes/ids/data-* on the SVG groups and text (e.g.
   class="t" on <text> nodes, .tw on table groups), or update the tests in the same PR with a mapping table
   in the PR description.
3. Keep "never redraw under an open editor" (E8) and the per-table refresh semantics.
4. Shadows use the 6-layer recipe. Add Options › "Soft shadows on screen" (B3: off = same as the PDF).
5. ⏱ bench: keypress → pixels p95 under 50 ms for a cell edit (Playwright, performance marks around the
   update).
Done when: all e2e green; parity: the stage screenshot vs the DL canvas render is equal within tolerance
(SP); bench green.
```

### Prompt 30 · S4.2 · Smooth drags

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.2 · Smooth drags. Depends on: S4.1.
Read: the drag code paths in the old stage.ts (column/row borders with guide and px tip, double-click =
Excel size, table edge stretch 0.2–5×, corner scale, grip move with drop marker, text-box move and stretch
with snapping) and core/src/render/slide.ts computeLayout and sizing (per design: sizingOf/sizingPatch/
sizingChange). Remember README gotcha 11: sizes are per design.
Do:
1. Move computeLayout and the sizing helpers into core/src/render/layout.ts as pure functions, imported by
   both the worker and the UI.
2. During a drag the UI computes previews with them at requestAnimationFrame rate, using the table sizes
   it already has. It commits one op batch on pointer-up (one undo step, as today) and lets the worker
   re-render.
3. A Playwright performance trace for each drag type: no frame over 16 ms on the CI machine. Record it.
Done when: E4, E7, E10 and E11 pass, plus new drag e2e tests (corner scale, grip move, border double-click,
TA-03/04/06/07); the frame budget is met.
```

### Prompt 31 · S4.3 · Thumbnails as bitmaps

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.3 · Thumbnails as bitmaps (B14). Depends on: S4.1.
Read: app/src/editor/thumbs.ts (lazy IntersectionObserver; big tables drawn without text), ui/App.tsx
Thumbs (number, label, type tag, warning/error badges, click to go, auto-scroll), editor/issues.ts.
Do:
1. The worker renders each slide DL on an OffscreenCanvas at thumbnail size and transfers an ImageBitmap.
   Only slides whose DL changed are re-rendered.
2. A virtualised thumbnail list (simple windowing; no new dependency unless under 3 KB and MIT), keeping
   every tag, badge and data-i attribute the e2e tests use.
Done when: a synthetic 100-slide deck scrolls the list at 60 fps (trace); E2 and E7 pass; all suites green.
```

### Prompt 32 · S4.4 · Measurement from font files; screen = PDF

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.4 · Measurement from font files; screen = PDF (B2, B7). Depends on: S4.2, S4.3.
Read: docs/next/03-architecture.md §2.6 and 05 §3.4; core/src/text/*; the TextMeasurer interface (the
canvas digit width; fitNotes); glassGeom in glass.ts ~38-54 (the character-count estimate `chars × px ×
.56/.6 + 22`).
Do:
1. Switch the TextMeasurer to HarfBuzz:
   - the Excel max digit width from the workbook's default font file (captured system font);
   - Glass column widening with real shaped widths, keeping v3's caps (3× and +60 px) and fixed user
     columns;
   - cell wrapping, text-box wrapping, fitText and title geometry.
2. Liquid Glass uses static Segoe UI (captured system font; on Linux CI use the font configured for the
   goldens and document it).
3. Screen text: <text> with textLength pinned to the core's width. Per-font check (05 §3.4): if Chrome's
   natural width differs by more than 0.5 % on the corpus strings, render that font's runs as glyph
   outline paths (from hb draw) on screen. Log which fonts use outlines.
4. Parity: every GG difference against v3 caused by measurement goes into tests/parity/accepted.json with
   the reason "B7 measured". Produce review/S4.4/ (like G1) listing them with images.
5. SP (screen vs PDF) passes on the whole corpus.
Then STOP for sign-off of the accepted list. Add to "Waiting for": "Sign off B7 differences in
review/S4.4/".
Done when: SP is green; all suites green; the review package exists.
```

### Prompt 33 · S4.5 · Delete the old renderer and the export engine

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.5 · Delete the old renderer and the export engine (B1). Depends on: S4.4 signed off in
"Decisions".
Delete, with their tests and docs:
- the HTML renderers (renderExcel/renderGlass HTML emission, tableHtml, buildSlide HTML, applyLayout,
  placeGlass);
- the slide rules in styles/slide.css (keep the chrome CSS);
- render/printcss.ts;
- the in-window export fallback and the "old engine" menu item;
- backend/slidebuilder/engines.py, cdp.py, pdf.py;
- the engine parts of installer.py and firstrun.py (steps: pip, Playwright, export engine);
- exports.py's /api/export and /api/assemble (keep save_export and /api/export-file);
- requirements.txt (Playwright);
- "Install export engine.bat";
- the engine pill and the engine dialog in the UI;
- the engine/ folder handling;
- env vars SLIDEBUILDER_BROWSER and SLIDEBUILDER_ENGINES.
Update:
- firstrun.py to 5 steps (Python, shared folder incl. a journal append/flush probe, shortcut, self-test,
  summary) and its tests;
- README.md (§2, §7, §10, §14 gotchas 2–3);
- docs/ARCHITECTURE.md §5.
Done when: grep finds no product-code reference to headless, printToPDF, playwright (outside dev/e2e),
cdp or engine; all suites green; the helper size reduction is in PROGRESS.md.
```

### Prompt 34 · S4.6 · Ship v3.8

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S4.6.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S4.6 · Ship v3.8. Depends on: S4.5.
Follow docs/next/release-checklist.md:
- bump to 3.8.0;
- CHANGELOG "3.8.0": screen = PDF; the same layout on every PC; smooth drags; no export engine to install
  any more; B2, B3, B7 and B14 explained in user words;
- also tell the maintainer that the shared engine\ folder and the %LOCALAPPDATA%\SlideBuilder\engine
  copies can be deleted after the update;
- run the checks; rehearse.
Do NOT push the tag. Reply with the commands; add them to "Waiting for".
```

---

## M5 · Storage v4 and cut-over

### Prompt 35 · S5.1 · Helper: decks

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.1 · Helper: decks. Depends on: S4.6, and the G0 storage decision in "Decisions" (journal, or
lean-lock = one shared journal appended under the deck lock; same endpoints).
Read:
- docs/next/04-data-and-migration.md §2 in full (files, framing, endpoints, invariants, faults);
- adr/006;
- spikes/storage/journal_sim.py (frame/unframe, fold, the latency model);
- backend/slidebuilder/locks.py, fsclock.py, util.py (write_atomic, replace_retry, safe_component,
  doc_key), store.py (read_json retries: "unreadable is never empty"), server.py (routing, the security
  checks, body limits).
Do:
1. `git mv backend helper`. Update every path (bat files, CI, release, tools, docs). The page is now
   served from helper/.
2. helper/slidebuilder/decks.py, implementing exactly the 04 §2.2 endpoints:
   - append: one handle per writer session kept open in the helper, write + flush (os.fsync), returning
     the offset; a duplicate (w, s) is harmless; the file-server time is stamped as `at`;
   - tail: parallel reads of up to 8 journals from offsets; complete frames only; snapshot gen change by
     one stat; the journal listing is cached 10 s;
   - snapshot: retries; unreadable → 503;
   - compact: compare-and-set on gen under the deck lock; backup copy after unlock;
   - rotate: deletes the old journal only if the frontier covers its size;
   - presence v2: an empty file touched; scandir mtimes on the server clock.
   In lean-lock mode, append takes the deck lock and appends to j/all.log.
3. Tests helper/tests/test_decks.py: invariants 1–6 of 04 §2.3 and tests 1–6 of 05 §3.6 (multi-process
   with multiprocessing, torn tails via os._exit mid-write, duplicates, CRC corruption → read-only plus an
   incident file, compaction races, clock skew via fsclock offsets).
The helper NEVER parses ops: records are opaque JSON to it.
Done when: all helper tests green (Python 3.8 and 3.12); the existing suites green.
```

### Prompt 36 · S5.2 · Core: fold, Lamport, DocSync v4

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.2 · Core: fold, Lamport, DocSync v4 (B4, B5). Depends on: S5.1.
Read: 04 §2 and §5; 03 §2.2 (records, rev, log, updated/updatedBy derived); core/src/sync/docsync.ts (v3:
server + inflight + pending → view, 300 ms debounce, one request in flight, retries 2–32 s, 409 →
outdated, authors from the log); core/src/model/ops.ts; shared/ops-vectors.json.
Do:
1. core/src/model/fold.ts:
   - fold(snapshot, records[]) sorts by (l, w, s), de-duplicates by (w, s), skips bytes below the
     frontier, and derives rev, updated, updatedBy and log (last 20);
   - Lamport: max seen + 1 per new record.
2. core/src/sync/docsync.ts v4:
   - apply → pending; flush appends one record per batch (300 ms debounce, one in flight);
   - "saved" is emitted when the append returns (B6);
   - tail every 1.5 s, then rebase pending on the new view, with authors from the new records;
   - compaction policy (more than 2 000 records past the snapshot, or idle writers older than 24 h) and
     compaction on pagehide by the last one present;
   - rotation of its own journal.
   Undo and redo are unchanged: inverse ops appended as new records.
3. Extend shared/ops-vectors.json with ordering and dedupe cases. Port docsync.test.ts.
4. Property test: 2–5 simulated writers, random ops from the vectors' generators, random delivery and
   compaction timing. Every replica converges to the same document, and no acknowledged record is lost.
5. The storage switch: a v4 deck uses decks endpoints; a v3 deck still uses /ops until migrated (S5.3). In
   this step, only new decks created in a temp data folder use v4. Production paths stay v3 until S5.3.
Done when: the property test (≥ 1 000 seeds), ops vectors and the ported docsync tests are green; e2e green.
```

### Prompt 37 · S5.3 · Migration, freeze, rollback

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.3 · Migration, freeze, rollback. Depends on: S5.2.
Read:
- 04 §3–§4 in full;
- adr/010;
- helper/slidebuilder/upgrade.py (SCHEMA, TooNew, needs_upgrade, backup_path) and store.py (_load,
  _upgrade_file);
- migrate.py (the v2 import);
- tests/fixtures/saved/* (workbook.v3.json, config.v3.json, prefs.unnumbered.json);
- the v3 page's reaction to a newer schema: docsync poll (schema > FORMATS.workbook → outdated) and 409
  on save.
Do:
1. helper/slidebuilder/migrate_v3.py: per-deck migration on first v4 open.
   - Take the v3 lock wb-<key>; read (unreadable → 503).
   - Byte backup to backups/upgrades/workbook/<file>.v3.<time>.json.
   - Write v4 snapshot gen 1 (doc = the v3 document; rev/updated/updatedBy/log in the header) and
     moved-from-v3.json (sha1).
   - Freeze the v3 file: schema 4 + movedTo "v4", content kept.
   Also `tools/update.py --migrate-all` (skips decks it cannot lock and reports them).
2. Rollback: `tools/update.py --rollback <deck>|--all`. It refuses any deck with journal bytes past the
   frontier, with a clear message; otherwise it writes snapshot.doc as a schema-3 v3 document (backup
   first) and marks rolled-back.json. *Options › Administration › Prepare rollback* in the page compacts
   every deck.
3. Add new saved examples (never edit old ones): fixtures/saved/snapshot.v4.json and journal.v4.log.
4. Tests 7–9 of 05 §3.6 WITH THE REAL v3 HELPER. Create a git worktree of the last v3 release tag in the
   test setup (e.g. `git worktree add /tmp/v3 v3.8.0`) and run its slide_builder.py on the same temp data
   folder. Assert:
   - v3 refuses to write a frozen deck (409);
   - a v3 page polling it turns "outdated";
   - a v3 save racing the migration is either in the snapshot or refused;
   - after rollback, v3 opens and edits the deck;
   - re-migration recovers v4-only optional fields;
   - v3 and v4 editing config.json at the same time lose nothing.
Done when: all these tests green; all suites green.
```

### Prompt 38 · S5.4 · Load tests

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.4 · Load tests. Depends on: S5.3.
Read: tools/loadtest.py (v3: one helper per simulated user, real HTTP, the simfs latency hook
SLIDEBUILDER_SIM_FS_MS, X-SB-Timing, the correctness check); spikes/storage/journal_sim.py; 05 §3.5.
Do:
1. tools/loadtest4.py drives real v4 helpers in the same way.
   - The simulated users append records, as the page's DocSync would: they reuse the record format, and
     the op generation mirrors loadtest.py.
   - They tail every 1.5 s, and compaction happens while editing.
   - Extend simfs to the decks module, charging reads and writes on open handles too.
2. Scenarios and pass criteria of 05 §3.5 (same deck 10/20 users at 0/15/40 ms, different decks, burst,
   compaction during editing). Add a CI job at 15 and 40 ms with 20 users, 30 s.
3. `--real-folder` mode for the human run on the share.
4. Record the results next to v3's (01 §3.3) in PROGRESS.md "Measurements".
Then add to "Waiting for": "Run `python tools/loadtest4.py --real-folder T:\Slide Builder\_lt --scenario same
--users 10` from one PC (and sharetest from several), and record the result."
Done when: the CI load job is green within the criteria.
```

### Prompt 39 · S5.5 · Delete the v3 storage path

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.5 · Delete the v3 storage path. Depends on: S5.4.
Do:
1. Every deck opened by v4 goes through migrate_v3 and then decks.
2. Delete:
   - helper ops.py and its test;
   - the workbook-document part of store.py (update_workbook, _backup, history over v3 backups; keep
     read_workbook for migration and read-only selftest);
   - v3 presence;
   - routes /api/workbooks/<name>/ops and /doc (v4 pages never call them);
   - the old DocSync code path.
   Keep config, prefs, fonts, locks, fsclock and upgrade untouched; they are shared with v3.
3. The side-panel history reads backups/v4/<key>/. Add a small "deck health" line: journal size and
   records past the snapshot.
4. Update docs/ARCHITECTURE.md to the v4 contract for decks (endpoints, framing, invariants).
Done when: grep finds no op semantics in Python (no patch application, no key lists); all suites green;
parity green; the load CI job green.
```

### Prompt 40 · S5.6 · Pilot on a copy (🚦 G2)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.6.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.6 · Pilot on a copy (human gate G2). Depends on: S5.5 and the real-share load result in
"Decisions".
Read: 04 §4.5.
Do:
1. "Start Slide Builder (v4 pilot).bat":
   - it copies backend\data to backend\data\v4-pilot ONCE, refusing if the target exists unless --refresh;
   - it starts the v4 build with SLIDEBUILDER_DATA pointing there and exports to export\v4-pilot\;
   - the window title says "PILOT – copy of the data".
2. A pilot build 4.0.0-pilot via make_release.
3. docs/next/pilot-v4.md: who, what to do for 2 weekly cycles (normal work on the copy, several people on
   the same deck at once), what to report, and a rollback rehearsal on the copy (Prepare rollback →
   --rollback --all → start v3 on the copy and check the decks).
Then STOP. Add to "Waiting for": "G2 pilot: 2 weekly cycles + rollback rehearsal result, go/no-go."
```

### Prompt 41 · S5.7 · Cut-over (🚦 G3)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S5.7.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S5.7 · Cut-over package (human gate G3). Depends on: G2 go in "Decisions".
Read: 04 §4.3–§4.4; docs/next/release-checklist.md.
Do:
1. Version 4.0.0. CHANGELOG in user words: what changed (B4, B5, B6) and what does not (decks, settings,
   fonts).
2. docs/next/cutover.md, a minute-by-minute runbook for the agreed Monday:
   - announce on Friday;
   - Monday 08:00: update the share (`--release 4.0.0`);
   - check from 2 PCs;
   - optional `--migrate-all`;
   - keep "Start Slide Builder (v3).bat";
   - the rollback commands (per deck and --all) and when to use them;
   - who decides;
   - the monitoring checklist for 4 weeks (deck-health lines, incident files in data\v4\, user reports).
3. Run the release checklist up to tagging.
Do NOT tag or touch the share. Add to "Waiting for": "G3: agree the cut-over Monday, tag v4.0.0, follow
docs/next/cutover.md."
```

---

## M6 · Hardening

### Prompt 42 · S6.1 · Native .xlsb reader

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S6.1.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S6.1 · Native .xlsb reader (B10). Depends on: S5.7 done (v4.0 live).
Read: core/src/xlsx/ (the SheetStore and facade, styles), the CFB/XLSB sniffing in workbook.ts, the
[MS-XLSB] specification (BIFF12 records: BrtRowHdr, BrtCell*, BrtSST/BrtSSTItem, BrtXF/BrtFont/BrtFill/
BrtBorder/BrtFmt, BrtMergeCell, BrtColInfo, BrtBeginConditionalFormatting/BrtBeginCFRule, drawings via
the same DrawingML parts), helper convert.py (the current PowerShell COM path).
Do:
1. core/src/xlsx/xlsb/: a record reader (variable-length type and size), workbook/sheet/styles/SST
   readers into the SAME SheetStore and shared context. Unsupported parts are reported, as for xlsx.
2. Corpus: for each xlsx edge-case workbook, a .xlsb twin. Generate them on a Windows machine with Excel
   via a one-off script, and ask a human under "Waiting for" if no Windows runner is available.
   Test: cell-by-cell equality (value, type, xf-resolved format, runs) and equal parity renders.
3. Keep Excel COM only for .xls and protected files. In the UI, .xlsb no longer calls convert-workbook.
Done when: the twins are equal; W6 noted in field-results.md (to be re-checked on a CLM PC by a human).
```

### Prompt 43 · S6.2 · Shared parsed-sheet cache (only if measured necessary)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S6.2.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S6.2 · Shared parsed-sheet cache. Depends on: S5.7.
FIRST check PROGRESS.md "Measurements": opening a large workbook on the REAL share must have been measured
(S0.6/S2.6 field numbers). If it is under 3 s, do not build anything: tick the step as "not needed" with
the number, and stop.
Otherwise read adr/008, spikes/parser/parse_bench.mjs (section 4: deflated columns), 04 §1.
Do:
1. The cache key is CRC-32 + uncompressed size of the sheet part (and of sharedStrings and styles), read
   from the zip central directory. File: data/v4/cache/<crc>-<size>.sbc = a versioned header + deflated
   columns + string table slice.
2. Helper GET/PUT /api/cache/<key> (atomic write, size cap, LRU sweep to 2 GB by atime). The first opener
   writes; later openers read. A format-version mismatch or a corrupt file means re-parse, never an error.
3. ⏱ bench: second opener's sheet read under 300 ms.
Done when: bench green; a corruption test passes.
```

### Prompt 44 · S6.3 · ReadDirectoryChangesW wake-up hint (only if it worked in the field)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S6.3.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S6.3 · Change-notification hint. Depends on: S5.7.
FIRST check docs/next/field-results.md: did sharetest --notify show that an append on PC A wakes PC B on
the real share? If not, tick the step as "not applicable" with the evidence, and stop.
Otherwise read adr/007 and helper/slidebuilder/decks.py.
Do:
1. On Windows only, a helper thread calls ReadDirectoryChangesW (ctypes) on each open deck's j\ folder,
   with FILE_NOTIFY_CHANGE_SIZE | LAST_WRITE | FILE_NAME. An event marks the deck "dirty"; the page's next
   tail request returns at once; a long-poll /tail?wait=1 holds for up to 1.5 s.
2. Auto-disable per deck if no event arrives within 30 s of a known append by another writer. Polling stays
   the source of truth.
3. A behind-a-flag setting (Options › Administration), default per the field results.
Done when: tests pass on Linux (feature off, no behaviour change); the Windows path is covered by a test that
runs only on Windows CI if available. Ask a human to measure the median visibility on the share and record
it.
```

### Prompt 45 · S6.4 · Documentation for v4

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S6.4.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S6.4 · Documentation. Depends on: S5.7. (May run in parallel with S6.1.)
Do:
1. Move the v3 README.md, docs/ARCHITECTURE.md, RENDERING.md, LOADTEST.md and REVIEW.md to docs/v3/
   (git mv).
2. Write the v4 README.md as a complete engineering guide, with the same depth and structure as the v3
   one: product, deployment and updates, architecture (with the drawings of PLAN Part B, updated to what
   was actually built), data model, front end (app/), core (core/), helper (helper/), key flows, HTTP API,
   concurrency, export, development and tests, recipes, security, gotchas, known limitations,
   repository map.
3. Write docs/ARCHITECTURE.md as the v4 contract:
   - files on the share;
   - the document (unchanged fields);
   - ops;
   - records and framing;
   - fold order;
   - the snapshot and compaction;
   - locks;
   - presence;
   - HTTP API with shapes;
   - display-list node types;
   - font library;
   - format versions.
4. Check every statement against the code (cite path:line where useful). List any discrepancy you fix.
Done when: a fresh agent can follow README §11 from a clean checkout and get all suites green (do it in a
clean clone and paste the transcript).
```

### Prompt 46 · S6.5 · Remove the v3 start file (D+28)

```text
You are a senior engineer on Slide Builder. We are rebuilding it following docs/next/PLAN.md. Your step is S6.5.

STANDING RULES (apply to every step)
- Read first: docs/next/PLAN.md Part A (rules) and your step in Part C. Then read PROGRESS.md.
- Check that the steps your step depends on are ticked in PROGRESS.md. If one is not, stop and say which.
- Branch v4/<step-id>-<short-name> from main; one PR titled "<step-id> · <title>".
- Definition of done: PLAN Part A §3 + your step's "Done when".
- Never: edit golden/ or saved fixtures; add Python runtime deps or native executables; remove e2e
  ids/data-* without updating tests; skip tests; implement op semantics outside the TS ops module.
- User-visible changes only from B1–B14 (PLAN Part B §8).
- Anything needing a human → write it under "Waiting for" in PROGRESS.md and stop.
- At the end: tick your line in PROGRESS.md (PR link, numbers); reply with changes, commands and results,
  numbers, and what is waiting for a human.

YOUR STEP: S6.5 · Remove the v3 start file. Depends on: "Decisions" records 4 weekly cycles after cut-over
with no rollback. If it does not, stop.
Do:
1. Remove "Start Slide Builder (v3).bat" from the release ZIP and add a release note telling the maintainer
   to delete it from the share. Do not delete data: backend\data\workbooks and the v3 backups stay as
   history.
2. Remove the v3 code paths kept only for coexistence that are no longer reachable: the v2 import stays;
   read-only v3 reading for migration stays for decks never opened.
3. Release 4.1.0 via the checklist (without tagging).
Done when: all suites green; the release is prepared; the PROGRESS.md milestone M6 is complete.
```

---

## Review prompt (send after every step, in a fresh session)

```text
You are reviewing a pull request of the Slide Builder rebuild. Be strict and concrete.
Read: docs/next/PLAN.md Part A (rules), the step in Part C named in the PR title, PROGRESS.md, and the PR
diff.
Check, and report each item as PASS or FAIL with evidence (commands run, path:line):
1. Scope: the diff does what the step says and nothing else. Unrelated refactors or features are a FAIL.
2. Rules:
   - no edits to golden/ or tests/fixtures/saved;
   - no Python runtime dependency or native executable;
   - no e2e id or data-* removed without a test update;
   - no skipped tests;
   - op semantics only in core/src/model/ops.ts.
3. Done-when: run every check the step lists, plus `npm run check`, the helper tests, `npm run test:e2e`,
   `npm run parity` and `npm run bench` (when it exists). Paste summaries. Compare numbers with the
   thresholds in PLAN Part F.
4. Features: walk the rows of docs/next/05-test-and-parity.md §4 that this step touches (PLAN Part E). For
   each, confirm the guarding test exists and passes, or name the gap.
5. User-visible changes: every one is in B1–B14 and in the CHANGELOG when the step ships.
6. Logic: state ownership follows PLAN Part B §2 (document in the core worker, UI store read-only mirror,
   files only via the helper). Name any second source of truth.
7. Smoothness: no main-thread work over 50 ms is added; no component subscribes to more state than it
   renders.
8. PROGRESS.md: the step is ticked with the PR link and numbers.
Finish with: APPROVE, or REQUEST CHANGES with a numbered list of required fixes (each with file:line and the
expected change). Do not fix the code yourself.
```
