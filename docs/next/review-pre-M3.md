# Independent review before M3 (Prompt 4)

Reviewed: `origin/main` at **6aafcb9** (merge of PR #5; its tree is identical to d4c72ac, which is tagged `v3.6.0`).
Reviewer: an agent that did not build M0–M2. Date: 2026-10-12. Machine: the corporate Windows 11 PC that PROGRESS calls
the reference PC (Node 22.23.3, npm 10.9.9, Python 3.12.7, Playwright's Chromium 1243 for e2e/parity/bench).

Nothing in the repository was changed except this file. The two clean clones and the logs are outside the repo. Five
review threads (architecture, correctness, PROGRESS claims and features, visible changes and tooling, readiness)
were run as independent sub-agents. I checked their key evidence again before it went in here; every finding below
has a command and its output or a path:line on 6aafcb9.

---

## Summary

**Verdict: NOT READY FOR M3.**

M0–M2 mostly do what PROGRESS says. Every deliverable named in a ticked step exists. Both clean runs are green
(once two Windows-only problems are worked around, see finding 6), parity shows 0 differences in text-only mode, and
the Part F budgets that exist so far are met with margin on this PC. The architecture rule holds: one owner of the
document in the core worker, and no DOM in `core/`.

Prompt 4 cannot start safely, for these blocking items:

1. **The G0 decisions are not on main.** Prompt 4 says "Requires: M2 ticked AND the G0 decisions under
   'Decisions' (Acrobat recipe, font copying allowed or fingerprint mode). Otherwise stop". `PROGRESS.md` on main has
   neither decision, and `docs/next/field-results.md` §2–§5 are blank. The decisions exist only on the unmerged branch
   `origin/m2-followups` (f1b45cb), with no field result behind them (finding 1).
2. **There is no machine that can run the M3 parity gates.** The reference machine is still under "Waiting for".
   Geometry and pixel parity (GG/GP) have not run since S1.1. S3.3–S3.6 are defined by "GG and GP pass" (finding 2).
3. **CI on main is red.** The `bench` job failed on the merge commit 6aafcb9, although the same tree passed on the
   PR. The proposed fix, a calibrated bench on `m2-followups`, is unmerged and changes a Part F gate (finding 3).
4. **Prompt 4's text-measurement premise does not hold.** S3.3 says "Text metrics still come from the v3
   TextMeasurer, so parity can be exact", but `TextMeasurer` only has `maxDigitWidth` and `noteFits`, and in the
   worker `noteFits` always returns `true`. The display list needs per-run advances and line breaks. Prompt 4 and
   ADR-004 need an amendment before S3.3 (finding 4).

The next most important items are not blockers for starting S3.1, but they should be fixed in a short M2 follow-up:

- five correctness bugs, each reproduced by a failing test: overlapping opens bind the wrong workbook, a late poll
  rolls the document back, a stuck busy overlay, lost shared styles, hung calls after a worker crash (findings 5,
  7–10);
- a fresh clone on Windows fails README's own steps: the committed page is "stale" under `core.autocrlf`,
  `python3` is hard-coded, and one e2e test depends on the PC (finding 6);
- every edit costs O(document) JSON work on the page thread (finding 11).

---

## Both runs

Two fresh clones of `origin/main` (6aafcb9) with `git clone` defaults on this PC (`core.autocrlf=true`), run one after the
other: `runA`, `runB`. To check the build I also made two clones with `-c core.autocrlf=false` (`lf1`, `lf2`).
Environment for both runs: `NODE_OPTIONS=--use-system-ca`, because npm otherwise fails on the corporate TLS inspection
with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Two workarounds were added outside the repo and are explained in finding 6:
a `python3` shim on PATH, and `PYTHONNOUSERSITE=1` for e2e, parity and bench.

| # | Check (command) | Run 1 (runA) | Run 2 (runB) | Same? |
|---|---|---|---|---|
| 1 | `npm ci` | OK | OK | = |
| 2 | `npm run build` | OK, page 734,305 bytes, sha256 86a1600b… | OK, page 734,305 bytes, sha256 86a1600b… | = |
| 3 | committed page = fresh build (`git diff --exit-code backend/slide_builder.html`), default clone | **differs** (739 lines; `\r` escapes from CRLF sources) | **differs** (same 739 lines) | = |
| 3b | the same in an `autocrlf=false` clone (lf1, lf2) | **matches**: 732,838 bytes, sha256 ed631c39… = `git show HEAD:backend/slide_builder.html` | matches, identical sha256 | = |
| 4 | `npm run check` (core + app) | 223 core + 14 app passed (big30 not yet generated) | 223 core + 14 app passed | = |
| 5 | `python -m unittest discover -s backend/tests` | 181 tests OK (skipped=4), 139 s | 181 tests OK (skipped=4), 143 s | = |
| 6 | `python tools/make_corpus.py big30 tests/corpus/workbooks` | OK | OK | = |
| 7 | `npm run test:e2e`, as README says | **fails to start**: `python3` → Microsoft Store alias, "Python non è stato trovato", exit 9009 | (same, by construction) | = |
| 7b | the same with a `python3` shim | **1 failed, 3 passed, 12 did not run**: E3 expects "Export: Chrome", got "Export: Playwright · Chrome for Testing" | – | – |
| 7c | the same with `PYTHONNOUSERSITE=1` (helper does not see the per-user `playwright` package, as on CI) | **16 passed (1.6 min)** | **16 passed (1.6 min)** | = |
| 8 | `npm run parity` (with the shim) | **0 differences, 0 not accepted (text-only comparison)**, 137 s | **0 differences, 0 not accepted (text-only comparison)**, 139 s | = |
| 9 | `npm run bench`: core parse big30 (limit 500 ms + 10 %, median of 3) | 373 / 386 / 384 ms → median 384 ms; retained 31.9–32.9 MB (limit 40 MB); inflate 197–209 ms | 378 / 402 / 385 ms → median 385 ms; retained 31.9–32.9 MB; inflate 203–208 ms | = (±1 %) |
| 10 | `npm run bench`: render counts (select · extend · 10 polls offline · 10 equal polls · toast) | 4 · 4 · 0 · 0 · 1 | 4 · 4 · 0 · 0 · 1 | = |
| 11 | `npm run bench`: browser (`tools/bench.mjs`), worse of 2 runs | deck20 open 277 ms (limit 400) · big30 sheet read 695 ms (1,000) · longest gated task 0 ms (50) · heap 15 MB (150) · not gated: start-up task 306 ms, first-draw task 93 ms | deck20 open 333 ms · big30 sheet read 784 ms · longest gated task 0 ms · heap 25 MB · not gated: start-up 371 ms, first draw 111 ms | **no: +20 % / +13 % / +10 MB** (see below) |
| 12 | Calibration factor printed by `npm run bench` | **none printed.** main has no calibration: limits are absolute + 10 % (`tools/bench.mjs:30`, `core/bench/parse.bench.test.ts:18`). `tools/calibrate.mjs` exists only on `origin/m2-followups` | – | = |
| 13 | Working tree after the run | ` M backend/slide_builder.html` (the CRLF rebuild, row 3) | ` M backend/slide_builder.html` (same) | = |

Differences between the runs: everything except the browser bench is identical in result (same test counts, same page bytes, same parity). The browser bench was slower in run 2: deck20 open 333 vs 277 ms (+20 %), big30 sheet read 784 vs 695 ms (+13 %), page heap 25 vs 15 MB, start-up task 371 vs 306 ms. Run 2 ran right after run 1 on the same PC, with no other test process running (orphans from an aborted first attempt were killed before; checked with `Get-CimInstance Win32_Process`). Cause not investigated (PC load / antivirus / thermal: not verified). Both stay inside the limits, but the spread between two runs on the reference PC (13–20 %) is larger than the +10 % slack, which supports finding 3. Extra check, both clones: with big30 generated, `npx vitest run` in `core/` → 226 passed (223 + the big30 cases), as CI's bench job runs them.

Part F budgets that exist so far, measured twice (rows 9–11):

| Budget (PLAN Part F) | Limit | Run 1 | Run 2 | Status |
|---|---|---|---|---|
| Open 20-slide deck → first slide (S2.6) | 400 ms | 277 ms | 333 ms | met |
| Read a 130k-row sheet in the page (S2.6) | 1 s | 695 ms | 784 ms | met |
| Same in Node, parse only (S2.3) | 0.5 s | 384 ms (median) | 385 ms (median) | met |
| Memory in the page | < 150 MB | 15 MB (**page heap only, the worker is not measured**, finding 14) | 25 MB | met for what it measures |
| Longest main-thread task while opening (S2.6) | 50 ms | 0 gated (first draw 93 ms and start-up 306 ms not gated, decision 1.a) | 0 gated (first draw 111 ms, start-up 371 ms) | met under decision 1.a |
| Selection change re-renders (S1.3) | ≤ 5 | 4 | 4 | met |
| Longest task while **editing** | 50 ms | **not measured by any bench** (finding 11) | – | not verified |

### CI on GitHub (public API, `GET /repos/Gualbertol123/slidemaster/actions/runs`)

| Run | Commit | Result | Failed job |
|---|---|---|---|
| 38207605198 (main, push, 2026-10-12 05:21) | 6aafcb9 (merge of PR #5) | **failure** | `bench` (step "Run npm run bench") |
| 38207151036 / 38207155144 (branch, push and PR) | d4c72ac (same tree) | success | – |
| 38207730140 (release v3.6.0) | d4c72ac | success | – |
| 38036878930 (main, 2026-10-10) | e821f02 | failure | `helper (3.12)` (fixed by 1de1d39, "backup spacing ignores a few ms of clock jitter") |
| 38199377802, 38174918530, 38152165701, 38143795427 (branch) | 1a29042, db0cada, 90f3ca3, ddc0cb1 | failure | `bench` and/or `e2e` (fixed by 1a29042 and d4c72ac) |
| 38208543065 (m2-followups) | 426d215 | failure | `core` (fixed by a06aece) |

**Flaky: yes, the `bench` job.** The identical tree passed on the PR and on the release and failed on main. The
job log needs admin rights (`403 Must have admin rights`). The cause given in m2-followups' commit 426d215 is
"the big30 read took 1,124 ms on main after the merge (limit 1,000 + 10 %)". That is not verified from the log. The
helper job was flaky once (`test_fsclock`) and has been fixed. No e2e failure on main.

---

## Findings (most severe first)

### 1 · blocker · The G0 decisions that Prompt 4 requires are not on main

- **Evidence:**
  - `PROGRESS.md:69-97` (Decisions, main): the only G0 line is "M0 merged and v3.4.0 shipped with S0.6 open: gate
    G0 runs in parallel …, results due before M3 (Acrobat, fonts) and M5 (storage)". There is no Acrobat recipe
    and no font decision.
  - "Waiting for" items 4 and 5 are still open.
  - `docs/next/field-results.md:118-137`: the §4 Acrobat table and the §5 R7 answer/who/date row are empty. §2
    (fieldcheck) and §3 (W1–W14) are empty too.
  - `git show origin/m2-followups:PROGRESS.md` has "Acrobat recipe: soft masks", "Fonts: fingerprint mode (R7)" and
    "Reference machine: keep the Linux goldens". Commit f1b45cb does not touch `field-results.md`, whose header
    says the product owner writes the decisions once every section is filled.
- **Why it matters:** Prompt 4's STANDING RULES say to stop. S3.1 (PDF writer: soft masks or the flattened
  recipe) and S3.2 (fonts: `/api/fonts/capture` copy vs fingerprint) are shaped by these answers.
- **Fix:**
  - A person fills `field-results.md` §2, §4, §5 and the header.
  - The product owner reviews m2-followups and merges it, with the decisions pointing at those results.
  - Settle where the recipe lives, S3.1 (`PROMPTS.md:402`) or S3.5 ("Waiting for", field-results §4).
  - For fingerprint mode, write down what file:// does without system font bytes and where the fingerprint is
    stored. fonts.json schema 1 must stay readable by v3, and `fonts.py:73` coerces `source`.

### 2 · blocker · No machine can run the M3 parity gates; GG/GP have not run since S1.1

- **Evidence:**
  - Every parity run since S1.3 says "text-only" (PROGRESS S1.3–S2.6). Both of my runs printed
    `NOTE: this machine's Chromium or fonts differ from the goldens' - only texts were compared`.
  - `golden/MANIFEST.json` → environment: Linux, Chromium 141.0.7390.37, `/opt/pw-browsers/chromium-1194`.
  - `git ls-files | grep -i docker` → nothing, so the capture environment cannot be rebuilt.
  - `tools/capture-v3.mjs:49-50` fingerprints fonts with `fc-list`, which Windows does not have.
  - Golden PDFs use Liberation/Carlito/DejaVu. 21 of 48 `golden/**/pdf.json` have private-use characters and an
    empty font name (all 16 glass, 5 clean), for example `golden/plain/glass/full/pdf.json`.
- **Why it matters:**
  - S3.3 "GG and GP pass", S3.4 "GG passes", S3.5 "GG and GT pass" and the S3.6 heat maps need full mode.
  - The M1/M2 changes (render code moved in S2.1, new parser in S2.3, HTML from the worker in S2.4) have only had a
    text guard.
  - Prompt 4's "selectable text equal to v3's" cannot hold for glass PDFs.
  - The G1 pilot would compare pixels drawn with fonts users never see.
- **Fix (decision for the product owner):**
  - (a) This Windows PC with Playwright's pinned Chromium (not system Chrome 146) and a Windows font fingerprint.
    Re-capture v3.4.0 goldens there as a new commit with a reason. Recommended: it matches what users see.
  - (b) A committed container definition (image digest, Chromium 141, the 103 fonts) that the agent can run.
  - Define the GF text oracle as GT texts for glass and clean, or normalise private-use runs, in accepted.json
    before S3.1's tests.
  - Change `capture-v3.mjs:49` to a cross-platform font fingerprint.

### 3 · blocker · CI on main is red (flaky bench gate); the proposed fix changes a Part F gate and is unmerged

- **Evidence:**
  - Run 38207605198: `bench` failure on 6aafcb9. The same tree is green on runs 38207151036, 38207155144 and
    38207730140 (table above).
  - The bench limits are absolute (`tools/bench.mjs:30` `LIMITS = { open_deck20_ms: 400, read_big30_ms: 1000, … }, SLACK = 1.1`).
  - This PC measures 695 ms for big30 read. 426d215's message says the runner is "1.3–1.6× slower than the
    reference PC".
- **Why it matters:**
  - PLAN Part E says "Nothing is 'done' while a guard is red".
  - Prompt 4's protocol runs `npm run bench` after every step, and the S3.7 export budgets will add more absolute
    time gates.
  - m2-followups' `tools/calibrate.mjs` scales the time limits "never below 1×". That loosens the gate on slow
    machines, and the reference factor is a constant measured on this PC. It is a gate change written as a
    product-owner decision by an agent session ("An agent never writes here on its own", `PROGRESS.md:71`).
- **Fix:**
  - The product owner decides between scaling and running the bench only on the reference PC (CI reports, does
    not gate).
  - If scaling is kept, print the factor in the result table and cap it, e.g. at 2×, so a slow runner cannot hide
    a 2× regression.
  - Then get main green before Prompt 4.

### 4 · blocker for S3.3/S3.5 as written · TextMeasurer cannot supply display-list text metrics

- **Evidence:**
  - `core/src/platform.ts:35-41`:
    ```ts
    export interface TextMeasurer { maxDigitWidth(cssFont: string): number | Promise<number>; noteFits(note: NoteMeasure, size: number): boolean; }
    ```
  - `core/src/workers/core.worker.ts:12`:
    ```ts
    text: { maxDigitWidth: font => port.call("digitWidth", { font }), noteFits: () => true }
    ```
  - Glass widths are character-count estimates (`core/src/render/glass.ts:44,64`, `length * px * .56`).
  - PROMPTS.md Prompt 4, S3.3: "Text metrics still come from the v3 TextMeasurer, so parity can be exact."
- **Why it matters:** a DL text node needs positioned glyph runs. Today wrap points, alignment offsets, ellipsis
  and vertical text come from Chromium's CSS layout of HTML strings, and the worker measures nothing.
- **Fix:** before S3.3, decide and record one of two options, and amend Prompt 4 S3.3 and ADR-004 accordingly.
  - (a) Add `measure(runs, cssFont) → advances` and `breakLines(...)` to `TextMeasurer`, implemented in the worker
    with `OffscreenCanvas.measureText`. This needs fieldcheck's "OffscreenCanvas text in a worker" on Edge, which
    is unverified.
  - (b) Build the DL on the page thread, under the 50 ms gate.

### 5 · major · Overlapping opens bind one workbook's document to another workbook's sheets

- **Evidence:**
  - `core/src/worker/host.ts:90-98`: `candidateBook = ++this.books` is taken before `await wb.ensure(...)`, and
    `book: this.candidateBook` is read after it. A second `index` in between gives both answers the second
    number.
  - Reproduced by `zz-race.test.ts` (reviewer test, not committed; in the scratch clone at 6aafcb9):
    ```
    report.xlsx answer: book 2 sheets SLIDE_1,SLIDE_2 panel
    deck20.xlsx answer: book 2 sheets SLIDE_01,SLIDE_02
    × overlapping index calls: each answer names its own workbook
    ```
  - Reachable: `openLocalFile` sets `opening` only inside `openBuffer`, after `arrayBuffer()`, `files()` and
    `upload()` (`app/src/state/app.ts:287-292`). The drop guard (`App.tsx:22-24`) and the Open button do not cover
    that window.
- **Why it matters:** deck20's sheets are drawn and saved under report.xlsx's document. That corrupts a shared deck.
- **Fix:**
  - `host.ts:93`: `const n = ++this.books` right after `indexWorkbook`; after every await, refuse if
    `this.candidateBook !== n`; return `book: n`.
  - `app.ts`: an open generation counter taken at the start of `openLocalFile`/`openFromFolder` (or set `opening`
    there), and disable Open/Browse while opening.
  - Add `zz-race`-style tests to `core/tests/host.test.ts`.

### 6 · major · A fresh clone on Windows does not pass README's own steps

- **Evidence:**
  - **CRLF build:** in both default clones, `git diff --exit-code --stat -- backend/slide_builder.html` →
    `1478 ++++----` (739 lines). The fresh page contains literal `\r` escapes from CRLF sources. In two
    `-c core.autocrlf=false` clones the build is byte-identical to the committed page (sha256 ed631c39…).
    `.gitattributes` has only `*.bat text eol=crlf`. Git's Windows default is `core.autocrlf=true`, and the
    maintainer's checkout is named `slidemaster-lf`.
  - **`python3`:** `app/playwright.config.ts:20` runs `python3 ../backend/slide_builder.py …`. `tools/capture-v3.mjs:59,140`
    spawn `python3`. On this PC `python3` is the Store alias, so e2e fails with
    `Python non è stato trovato … Exit code: 9009` and parity with `helper did not start`. `tools/bench.mjs:32`
    already does `process.platform === "win32" ? "python" : "python3"`.
  - **e2e depends on the PC:** `app/e2e/app.spec.ts:142` expects `"Export: Chrome"`. With the per-user Python
    `playwright` package installed (as `Install Slide Builder.bat` installs it), the helper picks "Playwright ·
    Chrome for Testing" and the test fails. Serial mode then skips 12 of 16 tests ("12 did not run").
  - **Linux default:** `playwright.config.ts:18` defaults CHROME to `/opt/pw-browsers/chromium-1194/...`.
  - **TLS:** npm needs `NODE_OPTIONS=--use-system-ca` behind the proxy. README does not say so.
- **Why it matters:** Prompt 4's double-check runs on this PC from a clean clone. Today that needs undocumented
  workarounds, and "committed page matches" is only true for an LF checkout. CI is Linux-only, so nothing
  catches this.
- **Fix:**
  - Add `* text=auto eol=lf` (keeping `*.bat eol=crlf`) to `.gitattributes`, or normalise CRLF in `app/vite.config.ts`
    before inlining.
  - Use `python` on win32 in `playwright.config.ts:20` and `capture-v3.mjs:59,140`, as `bench.mjs:32` does.
  - E3: accept any ready engine (`/Export: (Chrome|Playwright)/`), or set `SLIDEBUILDER_ENGINES` in the e2e env.
  - Default CHROME to `require('playwright').chromium.executablePath()`.
  - Document `--use-system-ca` in README §7.
  - Optional: a `windows-latest` CI job for check + e2e.

### 7 · major · A late poll answer rolls the document back

- **Evidence:**
  - `core/src/sync/docsync.ts:107`: `if (!doc || this.inflight || doc.rev === this.server.rev) return;` accepts a
    lower rev.
  - `poll()` is not single-flight, and `tick()` runs from `setInterval` every 3 s (`app.ts:115`).
  - `zz-poll.test.ts`:
    ```
    before the late answer: rev 3 edits {"S":{"A1":{"b":true},"B2":{"i":true}}}
    after the late answer:  rev 1 edits {"S":{"A1":{"b":true}}} B2 undefined
    × a slow poll answer does not replace a newer server document
    ```
- **Why it matters:** on a slow share, others' and my own saved edits vanish from view until the next poll, and an
  undo in that window inverts against the old view. This is the "slow share" case of 05 §3.
- **Fix:** `docsync.ts:107`: use `doc.rev <= this.server.rev`, plus a `polling` flag (single flight). Add a test.

### 8 · major · A failed background read leaves the full-screen busy overlay up for ever

- **Evidence:**
  - `host.ts:166`: `if (c.presetChanged) { await this.wb!.ensure(...); this.port.emit("progress", null); }`, and
    likewise at `:95, :111, :133, :144`. The overlay is hidden only on success.
  - The page only logs worker `error` events (`app.ts:168`).
  - `zz-busy.test.ts`: `… Preparing pictures… → ERROR(page could not decode a picture)`, with no hide.
- **Why it matters:** the UI is blocked with no message after a colleague's preset change or a worker OOM on a
  huge sheet.
- **Fix:** wrap each `ensure` in `try … finally { this.port.emit("progress", null) }`. On an `error` event in
  `app.ts:168`, call `hideBusy()` and show a toast.

### 9 · major · A big workbook whose saved preset reads no sheet never gets its shared styles

- **Evidence:**
  - `host.ts:125-127` adds to `sentSharedFor` even when `wb.shared` is still null (big workbooks are not read at
    `index`).
  - `MirrorWorkbook.receive` (`core/src/xlsx/mirror.ts:26`) drops every sheet when it has no shared styles.
  - `zz-edge.test.ts`: `mirror sheets: 0 mirror shared: false`.
- **Why it matters:** every table added later (wizard, or a colleague) shows no data until a reload. This is the
  "huge sheet" edge case.
- **Fix:** `host.ts:126` and `:219`: add to `sentSharedFor` only after a non-null `shared` was sent.

### 10 · major · After a worker crash, later calls never settle and edits are silently not saved

- **Evidence:**
  - `app/src/rpc/client.ts:21` calls `failPending` for calls in flight only. There is no dead flag, no restart and
    no `messageerror` listener.
  - `zz-edge.test.ts`: `call after crash settled: false`.
  - `client.ts:23-27` also falls back silently to running the whole core on the page thread when the worker cannot
    start.
  - The worker's `error` listener fails pending calls even when the worker survived an uncaught exception
    (`core.worker.ts:17` does not `preventDefault()`).
- **Why it matters:** edits look applied and stay "pending" for ever. With the page fallback, B8 ("never
  freezes") silently does not hold.
- **Fix:**
  - Mark the port dead and reject new calls at once.
  - Call `hideBusy()`, show a persistent "Reload the page" banner, and block `change()`.
  - Handle `messageerror`.
  - In the worker, `preventDefault()` after reporting.
  - Log and show a warning when running without a worker.

### 11 · major · Every edit costs O(document) work on the page thread

- **Evidence:**
  - Every doc event sends the whole `view` (`core/src/worker/host.ts:249`
    `this.port.emit("doc", { ...this.state(), change: c, ack: this.ack })`). A served edit gives at least three:
    applied, saving, saved.
  - The page compares old and new view with `JSON.stringify` (`app/src/state/app.ts:296` →
    `app/src/state/store.ts:98` `same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)`).
  - The page JSON-clones the document for prediction (`app.ts:291,360`).
  - The worker proxies `postOps`/`getDoc` through the page (`app.ts:41-42`).
  - No bench measures a task while editing.
- **Why it matters:** this conflicts with PLAN Part B §2 (no large structured clone on the page's thread) and with
  the "longest task while opening **or editing**" budget. A large deck (many cell edits) will push edits past
  50 ms, and M4's 50 ms keypress→pixels budget builds on this path.
- **Fix:**
  - Send `view` only when the `Change` says it changed, and compare by a revision counter instead of JSON.
  - Let the worker call the helper directly (fetch works in workers).
  - Add an edit-latency case to `tools/bench.mjs` (a large deck, 20 edits, longest task).

### 12 · major · Opening another workbook while saves are failing drops the queued edits

- **Evidence:** reasoned, not executed.
  - `host.ts:135` `this.sync?.dispose();` runs with no flush, and
    `docsync.ts:114` `dispose() { if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }` cancels the
    retry.
  - The page clears its `pending` (`app.ts:371`).
  - There is no `beforeunload` guard (`grep -rn beforeunload app/src` → nothing).
- **Why it matters:** silent loss of edits on a flaky share.
- **Fix:** flush (bounded) before dispose, or ask before switching when the save state is error or pending. Add a
  `beforeunload` guard while edits are queued.

### 13 · major · M2 is ticked, but the v3.6.0 release is half-recorded; the shipped CHANGELOG says "unreleased"

- **Evidence:**
  - S2.7 `[x]` says "**prepared** (the tag and the install-folder update are a person's steps, under 'Waiting
    for')". "Waiting for" still lists the whole release.
  - `git ls-remote --tags origin` → `v3.6.0^{}` = d4c72ac, the PR head, not the merge 6aafcb9.
  - `git show d4c72ac:CHANGELOG.md` → `## 3.6.0 - unreleased`. `release-checklist.md:46` says to date it before
    tagging.
  - `make_release.py --notes` matches that heading, so the release notes and the ZIP's CHANGELOG say "unreleased".
  - At v3.5.0 the same state was left unticked (S1.5 `[ ]`).
- **Why it matters:** Prompt 4 requires "M2 ticked". The tick is not supported by what the step says. Install-folder
  update and ZIP verification are not recorded.
- **Fix:** merge the dated CHANGELOG (on m2-followups), record the release link and date in S2.7 and close the
  "Waiting for" entry, or untick S2.7 until a person confirms steps 5–7.

### 14 · major · Bench and e2e gates that cannot catch what they guard

- **Evidence:**
  - Heap gate: `tools/bench.mjs:100` measures `performance.memory.usedJSHeapSize` of the page. Since S2.4 the
    workbook lives in the core worker, which nothing measures. Run 1: "heap 15 MB" while big30 (75 MB of XML) is
    open.
  - First-draw tasks are excluded with no upper bound (`tools/bench.mjs:85-86`), so a 400 ms freeze at Finish
    passes (decision 1.a; the S2.7 reviewer suggested a loose 150 ms cap).
  - E8 "typing is never overwritten" waits a fixed `waitForTimeout(4500)` (`app/e2e/app.spec.ts:350,361`) instead
    of proof that bob's change arrived. On a slow runner it passes without testing anything. There is also a
    redundant `waitForTimeout(3500)` at `:119`.
  - `app/tests/build.test.ts` cannot fail in CI, which builds the page just before (ci.yml unit job). Its real
    guard is the `git diff` step.
- **Fix:**
  - Measure the worker's heap (`performance.measureUserAgentSpecificMemory()` under COOP/COEP, or have the worker
    report `performance.memory`, or a retained-size probe RPC).
  - Cap the first-draw window (e.g. 150 ms) as reported-but-failing above it.
  - E8: wait for a marker of bob's edit on anna's page, then type.

### 15 · major · Many 05 §4 rows that M0–M2 touched have no guarding test

- **Evidence:** see the feature table below. In the areas PLAN Part E assigns to M0–M2:
  - Part E's "new open/drop/reload e2e" does not exist (WB-04 drop was changed in S2.7 and is untested).
  - The "new wizard e2e (drag between slides, detected tables)" does not exist.
  - The "new shortcut table test" does not exist.
  - The undo stack's 200 cap has no test (`core/src/sync/history.ts:11`; `grep -n 200 core/tests/host.test.ts`
    → nothing), although S1.5 says "to add in M2".
  - `fitNoteSize` (moved in S2.1, NB-14) has no unit test.
- **Why it matters:** Part E: "Nothing is 'done' while a guard is red". A missing guard is weaker than a red one.
  M3 will touch 4.3, 4.4, 4.7, 4.8 and 4.9 next.
- **Fix:** add the three Part E e2e tests and the history-cap and `fitNoteSize` unit tests in the M2 follow-up.

### 16 · major · Display-list contract and fonts: gaps M3 will hit (readiness)

- **Evidence:**
  - Inset box-shadows on almost every glass material (`app/src/styles/slide.css:49-51,57,59,67,74-76,…`).
  - `filter: drop-shadow` (`:18 .pic.gcut`).
  - `mix-blend-mode: multiply` (`:19 .pic.gink`).
  - Elliptical off-box radial gradients (`:45-46`).
  - Title `text-shadow` (`:35,:95`).
  - None of these is in the 8-node contract of 03 §2.4 / §4.3.
  - Shadow layers: `core/src/render/printcss.ts:8` `const STEPS = 5`, while 03 §4.3 and Prompt S3.4 say 6.
  - Fonts: CSS fallback stacks (`core/src/render/excel.ts:11` `XLFONT`), WOFF2 library fonts
    (`app/src/state/fonts.ts:61`), zero-byte Google fonts from file:// (`fonts.ts:57`), weights 520/650 with no
    static face, `tnum`, letter-spacing, ellipsis and vertical text.
  - Geometry lives in three places until S4.5: HTML strings in core, `slide.css`, and DOM code
    (`app/src/render/slidedom.ts`).
- **Why it matters:** S3.3–S3.5 cannot pass GG without either extending the contract or accepting differences;
  doing that mid-step invites silent scope creep.
- **Fix:**
  - Amend ADR-004 with the product owner before S3.1: add `blend`, an inset shadow, radial paint with a transform,
    and an image-alpha shadow, or record accepted approximations.
  - Settle STEPS 5 vs 6 (B3).
  - Add `resolveFace` plus WOFF/WOFF2 → sfnt to S3.2's scope.
  - Freeze slide.css geometry, and transcribe it into a tested `core/src/render/metrics.ts`.

### 17 · minor · Further correctness issues

- **F7 (reasoned):** encrypted .xlsx is always sent to Excel's conversion first (`app.ts:312-317`).
  `backend/slidebuilder/convert.py:116` opens it without a `Password` argument, so the invisible Excel waits on a
  prompt until the 240 s timeout (`:118`), and EXCEL.EXE can be left running.
  - Fix: detect `EncryptionInfo`/`EncryptedPackage` in the CFB directory in `core/src/xlsx/workbook.ts` with a
    distinct code, and do not call Excel. Also pass a dummy password and kill Excel on timeout.
- **F8:** a refused or failed `start` resets the page's store (`app.ts:374-377`) while the worker still owns the
  previous document (`host.ts:131,134` throw before the switch).
- **F9:** there are no fetch timeouts against the helper (`app/src/sync/api.ts:62`). On a hung share, "Saving…" and
  "Opening…" never end.
  - Fix: `AbortSignal.timeout(30_000)` by default.
- **F11:** on the file:// page, `LS.set` swallows `QuotaExceededError` (`api.ts:129`), and `offline.postOps` still
  reports success, so the page says "saved in this browser" when nothing was saved.
- **Smaller leaks:**
  - the never-revoked Blob URL (`client.ts:16`);
  - a cancelled candidate workbook kept in the worker;
  - `openingWb` and `tableHtmls` never cleared;
  - a second `runWizard`/`ask` leaves the first promise unsettled (`dialogs.ts:12-24`);
  - the wizard's row-block rAF chain continues after close (`Wizard.tsx:413-418`);
  - the workbook lock has no keepalive (`backend/slidebuilder/locks.py`, STALE = 15 s).

### 18 · minor · Ownership leaks on the page (architecture rules 1, 2, 4)

- **Rule 1:**
  - When the worker's HTML for a table is missing, the page silently renders it itself
    (`core/src/render/slide.ts:185`, `app.ts:60-64`).
  - The page re-derives slides and layouts on its mirror and mutates `R.cfg` in place (`app.ts:325`).
  - Any drift (e.g. the worker's `noteFits: () => true` vs the page's DOM measure) falls back to UI-thread
    rendering without notice.
- **Rule 1:** in file:// mode the page owns the stored document in localStorage and applies ops to it
  (`app/src/sync/api.ts:138-153`). The page also fetches the doc on open (`app.ts:235`) and posts config ops
  directly (`app.ts:384`).
- **Rule 5:** sheet slices clone `strs`, `runs`, `cfRules` and the drawings with base64 pictures
  (`core/src/xlsx/slice.ts:128-135`). Sheets up to 200k cells travel whole, and `convertPicture` bytes are copied,
  not transferred (`host.ts:48`).
- **Rule 4:** the Python helper still interprets ops (`backend/slidebuilder/ops.py:151`, `store.py:203,315`).
  This is expected until S5.5, but S5.5 keeps the config route, which needs Python's `style.patch`. That
  contradicts S5.5's own done-when.
- **Fix:** count page-side table renders in the e2e (must be 0, as `file.spec.ts` does) and in the bench. Move the
  offline store into the worker (IndexedDB) by S5. Record the config route's op handling as an exception in ADR-002
  or move it.

### 19 · minor · User-visible changes missing from the CHANGELOG

- **Evidence** (v3.3 = b2166d3, the last commit before S0.1; there is no v3.3 tag):
  - New wizard texts "Reading the workbook…", "Reading “<sheet>”…" and "“<sheet>” could not be shown: …"
    (`app/src/wizard/Wizard.tsx:138,360-364`).
  - New message "The workbook reader stopped (…). Reload the page to continue." (`app/src/rpc/client.ts:21`).
  - The corrupt-zip error wording now comes from the new reader (`core/src/xlsx/zip.ts:40,51,79,87`).
  - The helper's `request_queue_size = 128` (`backend/slidebuilder/server.py:512`) means a save no longer waits
    ~1 s for a TCP retry.
  - The new messages in `Start Slide Builder.bat`.
  - All are covered by B8/B6 in spirit, but none is in the CHANGELOG. The CSS files are byte-identical to v3.3, and
    the render modules are byte-identical or refactored without output change.
- **Fix:** one CHANGELOG line per item under 3.6.0 (or 3.6.1), or a recorded decision that error texts are not
  listed.

### 20 · minor · Tooling and docs

- Dead code: `presetOf` (dead since S1.3), `isInlineOpen`, `hasCF`.
- `playwright` is imported by `tools/*.mjs` but not declared (it arrives through `@playwright/test`).
- `app/e2e/parity.mjs` drives the v2 page and is broken on Windows, yet README and two docs present it as current.
- `npm run bench -w app` reruns `renders.test.tsx`, which `npm run check` already runs.
- Fake timers are not restored when a test fails (`core/tests/docsync.test.ts:34,57,110`).
- Fixed ports 8951/8952 and 8981/8982; e2e temp folders are never removed.
- `spikes/` is untested and will go stale (Prompt 4 ports `spikes/pdfwriter`; `hb-subset.wasm` is not in the repo).
- PROGRESS nits: the S1.5 ZIP size is 342,384 in the text and 342,390 in Measurements; the S2.7 row sits between
  two S2.6 rows; helper skips are "5 platform skips" (S2.1) vs `skipped=4` here.
- This PC lacks `qpdf` and `pypdfium2`, which Prompt 4's protocol needs from S3.1 (`which qpdf` → not found;
  `import pypdfium2` → ModuleNotFoundError). PROMPTS' "/tmp/verify-<step>" is a Linux path.

### 21 · note · What was checked and is clean

- **No DOM in core:** `core/tsconfig.json` has `lib: ["ES2022","WebWorker"]` and `types: []`. A grep of `core/src`
  for `document`/`window`/`HTMLElement`/`DOMParser`/`localStorage`/`requestAnimationFrame` finds only comments
  and the `platform.ts` interfaces. `core/tests/tsconfig.json` (DOM for tests) is type-checked separately.
- **One owner of the document:** DocSync and the history exist only in `core/src/worker/host.ts:33-34`. The page
  has no undo stack. All 54 `change()`/`undo()` call sites go to the worker. The page applies ops only to predict,
  with core's `applyOps`.
- **Corrupt input is handled:** an empty file, non-zip data, a truncated zip and a bare `PK` header all give
  NOTZIP. A CFB file gives the CFB code. A sheet with corrupt deflate data opens as a broken sheet while the
  others open. A workbook whose sheets are all hidden gives 0 sheets and an empty wizard (no explicit message:
  note).
- **Tests are real:** no tests that assert nothing, no swallowed exceptions, no Python tests without asserts, no
  unused npm dependencies.

---

## PROGRESS claims not supported by the code

| Step | Claim | What I found |
|---|---|---|
| S2.7 | `[x]` with "verified" | The line itself says "prepared". The release steps are still under "Waiting for". The tag exists on origin (d4c72ac) with an undated CHANGELOG. There is no date or release link. Not supported as a tick (finding 13). |
| S1.5 → M2 | "`change()`/`undo()` (coalescing, the 200 cap, cross-workbook undo) … to add in M2" | Coalescing (`host.test.ts:87-90`) and cross-workbook (`:136`) were added. **The 200 cap was not.** |
| S2.7 | "UN-04 coalescing has no unit test of its own" | Understated: `host.test.ts:87-90` asserts it. |
| S1.3–S2.6 | "parity 0 differences" | Reproduced (twice), but **text-only**. Geometry and pixels last ran at S1.1, so this is not a geometry guard for S2.1–S2.4. |
| S1.2–S2.6 | "Page … identical in the clean clone" | True only for an LF checkout. A default Windows clone differs (finding 6). |
| S2.6 | "bench all within limits" (both runs) | Reproduced on this PC (row 11). On CI the same gate failed on main (finding 3). |
| S2.1 | "helper 181 OK (5 platform skips as before)" | 181 OK, **skipped=4** on this PC (run 1). Minor. |
| S1.5 | ZIP 342,384 bytes | Measurements says 342,390. Minor. |
| S2.3–S2.6 | core counts 159 → 216 | 223 core tests on 6aafcb9 (the S2.7 fixes added tests). Consistent, not a defect. |

Every other concrete deliverable named in S0.1–S2.7 exists, with path:line in the PROGRESS thread of this review:

`pollFile`, `failPending` and its test, `pacer`, `fitNoteSize`, `tableHtmlKey`, the four wizard RPCs and their
tests, `defaultPreset(book)`, `start` refusing an older workbook, zip inflating without a size, the heap gate
counting a missing `performance.memory` as over, the median-of-three rule, the backlog-128 test,
`update.py --release/--zip/--use`, `--selftest` (a flag of `slide_builder.py`), `make_release.py --verify/--notes`,
`/api/files/<name>/stat` and `test_file_stat`, and the CI jobs.

Static test counts match:

- helper 181 (`grep -c 'def test_'`);
- e2e 15 + 1;
- app 14.

---

## Feature table (05 §4 rows touched by M0–M2)

Status meanings:

- **PASS**: the guarding automated test ran green in both runs (unit = `npm run check`/helper tests; E1–E15 =
  `app/e2e/app.spec.ts` in order, F1 = `app/e2e/file.spec.ts`; PAR = `npm run parity`, text-only).
- **PASS (text)**: guarded by parity only in text mode.
- **MISSING**: no automated guard exists.
- **MANUAL**: a W/M guard, listed and not counted as passed.

### 4.1 Workbooks

| Row | Test | Status |
|---|---|---|
| WB-01 Open list | E1, E2; `test_http.py::test_files_listing_and_stable_read` | PASS ("slides by" text not asserted) |
| WB-02 "Loading…"/"No .xlsx files" | – | MISSING |
| WB-03 Browse… formats | F1 (.xlsx only) | MISSING (partial) |
| WB-04 Drop to open (changed in S2.7) | – | MISSING |
| WB-05 Empty state | – | MISSING |
| WB-06 Browsed = folder file | – | MISSING |
| WB-07 Non-folder file uploaded | – | MISSING |
| WB-08 "Opening…"/"N slides" | E1 | PASS |
| WB-09 .xlsb/.xls converted | `test_http.py::test_convert_is_501_off_windows`; W6 | PASS (helper) + MANUAL (W6) |
| WB-10 Clear errors | `host.test.ts` "an unreadable file is refused with its code" (:127), "start is tied to the workbook being opened…" (:216) | PASS (unit); e2e part MISSING |
| WB-11 Small whole, big per sheet | E14; `sheetstore.test.ts`; `parse.bench.test.ts`; bench `read_big30_ms` | PASS |
| WB-12 Busy overlay, ≤ 50 ms | bench `longest_task_ms` | PASS (first draw not gated; overlay stuck on error: finding 8) |
| WB-13 Saved preset dialog | E2 (:102), F1 | PASS |
| WB-14 No preset → wizard | E1 | PASS |
| WB-15 Reload from disk | – | MISSING |
| WB-16 Last file reopens | E2 | PASS |
| WB-17 Last version per workbook | – | MISSING |
| WB-18 Hidden sheets never listed | – | MISSING |
| WB-19 Number formats | `numfmt.test.ts` (8); PAR | PASS |
| WB-20 Dates | `numfmt.test.ts` (4); PAR | PASS |
| WB-21 Super/subscripts | `numfmt.test.ts:25`; E13; PAR | PASS |
| WB-22 "x" tables | E1; `host.test.ts:53-56` | PASS |
| WB-23 Range tables, growth | E5; PAR | PASS (growG unit MISSING) |
| WB-24 Fonts, fills, borders, CF, pictures | `design.test.ts`, `tables.test.ts`, `xml.test.ts:58`, `slice.test.ts:84`, `sheetstore.test.ts`; PAR | PASS (text); GG/GP not run |
| WB-25 Changed on disk banner | – | MISSING |
| WB-26 Stable read (503 + retry) | `test_workbooks.py::test_stable_read`, `::test_incomplete_zip_is_retried_then_unstable`; `test_http.py::test_incomplete_workbook_is_503` | PASS |
| WB-27 Errors become toasts | `host.test.ts:231` (failPending) | MISSING (e2e); partial unit |

### 4.2 Wizard

| Row | Test | Status |
|---|---|---|
| WZ-01, 05, 08, 09, 20, 22, 23, 26 | E1 (and E5) | PASS |
| WZ-03 ✕/Esc | E5, E14 (✕ only) | PASS (Esc MISSING) |
| WZ-04 Sheet list | E14; `host.test.ts:177` | PASS |
| WZ-07 "not read yet" | E14 (text not asserted) | PASS (weak) |
| WZ-10 Preview grid | E14; `host.test.ts:206` | PASS |
| WZ-11 Drag/Shift/arrows | E5, E14 | PASS (S2.7 side effect untested) |
| WZ-12, 13 Enter/Esc, range box | E5 | PASS |
| WZ-16 Detected tables | `detect.test.ts` (corpus + crafted :27) | PASS (unit); e2e MISSING |
| WZ-17 Table list sizes | E5; `host.test.ts:177` | PASS |
| WZ-28–31 Versions step | E13 | PASS |
| WZ-02, 06, 14, 15, 18, 19, 21, 24, 25, 27, 32, 33 | – | MISSING |

### 4.4 Text toolbar, styles, fonts (M1)

| Row | Test | Status |
|---|---|---|
| TX-01/02/03/05/13/14/23, TX-16–18, FT-01/05–10 | E9 | PASS |
| TX-06/07 Bold/Italic | E2, E8 | PASS |
| TX-09, TX-12 | E7, E9 | PASS |
| TX-10/11 | E11 | PASS |
| TX-15, 19, 20, 21, 22 | `text.test.ts:55,49,70,76,61` | PASS |
| FT-12/13 | `text.test.ts` "fonts" (5); `test_fonts.py` | PASS |
| TX-04, TX-08, FT-02/03, FT-04, FT-11 | – | MISSING |
| FT-14 | – (M3) | MISSING (not due) |
| FT-15 | W13 | MANUAL |

### 4.5 Cell editing, painter (M1)

| Row | Test | Status |
|---|---|---|
| CE-01 | E4, E6; `renders.test.tsx` | PASS |
| CE-03, 05 | E2, F1 | PASS |
| CE-06 Formula bar (via `getCell`) | E4; `host.test.ts:201` | PASS |
| CE-10, 12 | E6; `tables.test.ts:80` | PASS |
| CE-14 | E6; `tables.test.ts:74` | PASS |
| CE-15, 16 | E6, E7; `tables.test.ts:116` | PASS |
| CE-18 | `stage-follow.test.tsx:17` | PASS (partial) |
| CE-21 | E8 | PASS (fixed waits, finding 14) |
| CE-11 | PAR (GG/GP) only | MISSING (GG/GP not run) |
| CE-02, 04, 07, 08, 09, 13, 17, 19, 20 | – | MISSING |

### 4.8 Automated comments (moved in S2.1)

| Row | Test | Status |
|---|---|---|
| AC-01, 19, 20 | E10, E12 | PASS |
| AC-03 | E10; `comment.test.ts` "summary comments" (3); PAR | PASS |
| AC-04, 07, 08, 09, 10–12, 13, 15, 16 | `comment.test.ts:96,33,42,106,55,116,86` | PASS |
| AC-05, 06, 14 | PAR `comments.json` | PASS (text) |
| AC-24 | E10; PAR per version | PASS |
| AC-17, 18 | PAR (GG only) | MISSING (GG not run) |
| AC-02, 21, 22, 23, 25 | – | MISSING |

### 4.11 Collaboration, undo, keyboard, side panel, status

| Row | Test | Status |
|---|---|---|
| CO-01 Field merge | `ops.test.ts` (ops vectors); `docsync.test.ts:23`; `host.test.ts:109`; E2 | PASS |
| CO-02, 04, 06 | E2, E8; `test_presence.py` | PASS |
| CO-03 "Updated by X" | `docsync.test.ts:97,87` | PASS |
| CO-05 | `test_presence.py::test_leave`; `test_http.py::test_presence_between_two_clients` | PASS |
| UN-02 Undo only mine | `ops.test.ts:33`; `docsync.test.ts:78`; `host.test.ts:109`; E2 | PASS |
| UN-04 Coalescing | `host.test.ts:87-90` | PASS |
| UN-05 200 cap, redo cleared, per workbook | `host.test.ts:136` (per workbook only) | MISSING (cap, redo) |
| SP-01–15 | PAR `issues.json` | PASS (text) |
| SB-01–13 | `docsync.test.ts:33,56,109`; `stage-follow.test.tsx:47`; e2e `saved()`; F1 | PASS (partial) |
| OF-01–06 file:// | F1 | PASS (fonts/uploads offline not covered) |
| CO-07, CO-08, UN-01, UN-03, KB-01–25 | – | MISSING |

### 4.12 Install, start, update, data (M0)

| Row | Test | Status |
|---|---|---|
| IN-02, 03, 09, 10, 12, 13 | `test_firstrun.py`, `test_main.py`, `test_migrate.py` | PASS |
| IN-07, IN-08 | `test_firstrun.py::test_probe`, `::test_slow_share_warns`, `::test_unc_folder_uses_pushd`, … ; W/W6 | PASS (unit) + MANUAL |
| UP-01–10 | `test_update.py` (19), `test_release.py` (11); W5–W7 | PASS (unit) + MANUAL |
| DA-01, DA-02 | `test_upgrade.py` | PASS |
| IN-01, IN-11 | W | MANUAL |
| DA-03 | – (M5) | MISSING (not due) |

Areas 4.3, 4.6, 4.7, 4.9 and 4.10 were walked only in S1.5. Their automated guards ran green in both runs (E4–E13,
`design.test.ts`, `tables.test.ts`, `text.test.ts`, `test_exports.py`). Their GG/GP-only rows (DS-05,
TH-03/10/11/13, NB-10, NB-14) are effectively unguarded until finding 2 is resolved.

No row's existing automated guard FAILED in either run, once the Windows environment issues of finding 6 were worked
around. Without the workarounds, E1–E15 fail to start on this PC.

---

## Open questions for the product owner

1. **G0:** who fills `field-results.md` §2–§5, and when? Are the m2-followups decisions (soft masks, fingerprint
   mode, Linux goldens) yours, and do they rest on observations that should be recorded there first?
2. **Reference machine:** "keep the Linux goldens" leaves no machine that can run GG/GP. Will you choose this
   Windows PC with Playwright's pinned Chromium and re-captured v3.4.0 goldens, or a committed container? Who
   signs off the re-capture?
3. **Bench on CI:** should time gates be scaled by a calibration factor (m2-followups, never below 1×), capped, or
   should CI only report while the reference PC gates?
4. **S2.7:** keep it ticked (release done by a person on 2026-10-12?) or untick until the install-folder update
   and ZIP verification are recorded? Is the tag on d4c72ac (not the merge commit) acceptable?
5. **Text measurement for the display list:** worker (`OffscreenCanvas.measureText`, needs the Edge fieldcheck) or
   page thread? Prompt 4 S3.3 needs rewording either way.
6. **DL contract:** may ADR-004 grow (blend, inset shadow, elliptical radial, image-alpha shadow), or are
   approximations accepted in accepted.json? Five or six shadow layers?
7. **M2 follow-up before M3:** fix findings 5–12 first in a short PR (recommended), or carry them into M3?
8. **CHANGELOG policy:** should new error and progress texts (finding 19) be listed?

---

Logs (outside the repo): `runA.logs/`, `runB.logs/` (one log per check, `summary.txt`), the reviewer threads'
write-ups, and the reproduction tests `zz-race`, `zz-poll`, `zz-busy`, `zz-edge` (in a scratch clone at 6aafcb9;
they fail on main, which demonstrates the bugs, and are not committed here because this review changes no tests).
