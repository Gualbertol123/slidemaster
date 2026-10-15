# AUDIT · Slide Builder 4 against `docs/next/PLAN.md`

Independent audit of the rebuild, 2026-10-15. Audited commit **4df923b** (`v4/M6-hardening`, = `origin`); fixes on
branch **`v4/audit-fixes`** (one commit per finding, §8). Read: `00-summary.md`, `PLAN.md` Parts A–F,
`05-test-and-parity.md`, `README.md`, `docs/ARCHITECTURE.md`, `PROGRESS.md` (ticks, Decisions, Waiting for,
Measurements), `CHANGELOG.md`.

## Summary verdict

**Not yet: the rebuild meets most of PLAN.md, but the audited commit had two security holes that chain into code
execution and two ways to lose acknowledged deck data, and it does not prove three of PLAN's acceptance conditions
on this PC.** All of those defects had failing reproductions and are fixed on `v4/audit-fixes`; what remains needs
people (§9).

What holds, with evidence below:
* **Build and tests are reproducible.** Two clean GitHub clones, two complete runs: the build equals the committed page,
  `npm run check` 460 + 41, helper 228 on Python 3.8 **and** 3.12, e2e 24, parity / dlparity 0 not accepted, `sp` 8/8,
  load 5/5 scenarios, 42 + 48 PDFs pass `pdfcheck` and `qpdf --check` with the golden texts – **identical in both runs**
  except the bench (§1, §4).
* **v3 → v4 renders identically.** v3.8.0 (the last v3 tag, in a worktree) and 4df923b captured on the same PC and
  compared in full: **0 differences** over 135 slides, 36 screenshots, 48 PDF summaries, comments and issues (§3).
  The differences against v3.4.0's goldens are all signed B2 / B3 / B7 / S4.1 / seams entries.
* **Architecture rules hold:** one owner per state (two documented mirrors, two low concerns), op semantics only in
  `core/src/model/ops.ts`, no DOM types in `core/`, no native executable, standard-library helper; REVIEW S1–S4 attacks
  all refused (§5).
* **Migration, freeze and rollback pass with the real v3.8.0 helper** on 3.8 and 3.12, and unreadable files are never
  read as empty – except the two holes below (§6).
* **Documentation:** 28 of 30 random statements true, 2 partly true, none false (§7).

What did not hold at 4df923b (all fixed, §8):

| Severity | Finding |
|---|---|
| **critical** (chain) | SEC-1 + SEC-2: a crafted workbook ran script in the page (reproduced: it read the token), and the page's token can run a PowerShell command through `convert-workbook` |
| high | SEC-1 stored XSS from workbook theme colours in the wizard grid |
| high | SEC-2 PowerShell injection through a file name's Unicode quotes |
| high | DATA-1 a journal length field damaged into a bigger number hides acknowledged records, and compaction later deletes them |
| high | DATA-2 a missing `snapshot.json` re-migrates the deck at gen 1 and overwrites its only backup |
| medium | DATA-3 an unreadable journal at open is folded as empty; a default preset can overwrite the user's |
| medium | DATA-4 a read-only deck accepts edits on screen that are never saved, without a warning on close |
| medium | PERF-1 helper start → page ready 1.6–1.9 s (Part F: 1 s), not gated by any bench |
| low | UX-1 the approved start-up reopen-race fix was never delivered; SEC-4 no socket timeout; SEC-5 ids with a final line end → 500; SEC-11 SyntaxWarning at every start |

What this audit could not prove and leaves to people (§9): the Part F time budgets on a quiet reference PC (this PC
ran 2–2.7× slower than the reference during most of the audit: corporate agents), geometry / pixel / screen = PDF
parity (the goldens' environment no longer exists here), 53 feature rows without an automated guard, the W/M field
checks, and the product-owner approvals of four visible changes outside B1–B14.

---

## 0. Method

* Clones: `git clone https://github.com/gualbertol123/slidemaster.git` twice into `%TEMP%\audit\r1`, `r2`, checkout
  `v4/M6-hardening` (4df923b, = the local checkout), tags v3.8.0 and v4.0.0 present. After the fixes:
  `git clone -b v4/audit-fixes <local checkout>` twice (`f1`, `f2`; the branch is not pushed).
* Each run executed the same script (README §11 order; every step runs even when one fails), with Node 22.23.3
  (portable, `NODE_OPTIONS=--use-system-ca`), Python 3.12.7 and 3.8.10 (embeddable), Playwright Chromium 153 (1243),
  qpdf 12.4.2, pypdf 6.7.5, pypdfium2 5.14.0, openpyxl 3.1.5:

  | # | Step | Command |
  |---|---|---|
  | 1–4 | install, build, fresh page | `npm ci` · `npx playwright install chromium` · `npm run build` · `git diff --exit-code -- helper/slide_builder.html` |
  | 5 | big30 | `python tools/make_corpus.py big30 tests/corpus/workbooks` (before `check`, so its big30 cases run) |
  | 6 | check | `npm run check` |
  | 7–8 | helper | `python -m unittest discover -s helper/tests` on 3.12 and on 3.8 |
  | 9 | e2e | `npm run test:e2e` |
  | 10–12 | parity | `npm run parity` · `npm run dlparity` · `npm run sp` |
  | 13 | bench | `npm run bench` |
  | 14 | load | `python tools/loadtest4.py --ci` (20 users: same deck at 15 and 40 ms, different decks 40, burst 15, compaction 40) |
  | 15 | PDFs × design | `npm run export-check` (14 decks × 3 designs, `pdfcheck.py check` incl. `qpdf --check`, GT, size, time) |
  | 16 | PDFs × design × version | audit script `audit-export.mjs`: every deck × design × **version** exported with the Export button; each PDF through `pdfcheck.py check`, a separate `qpdf --check` (exit code and warnings) and the golden texts of its version |
  | 17 | helper start | audit script `helper-start.mjs`: 7 × spawn helper → `GET /` 200 → Chromium shows `#openBtn` with the helper answering |
* Parallel read-only reviews (feature map, architecture/security, documentation, v3→v4 behaviour, data safety) were
  run by sub-agents; every finding kept here was re-checked against the code by the auditor, and every fixed one was
  reproduced first. The audit scripts are not committed (they live in the session's scratch folder); everything they
  check is described here.

## 1. Build and tests (two clean clones of 4df923b)

| Step | Run 1 (r1) | Run 2 (r2) | Same? |
|---|---|---|---|
| `npm ci` · build · page fresh | ok 33 s · ok · **equal** | ok 28 s · ok · **equal** | yes |
| `npm run check` | core 460 passed (24 files), app 41 passed (9 files) | 460 · 41 | yes |
| helper, Python 3.12.7 | 228 OK (1 skipped: `test_http` 501-off-Windows) | 228 OK (same skip) | yes |
| helper, Python 3.8.10 | 228 OK (same skip) | 228 OK | yes |
| e2e | 24 passed (app 19, file 4, open 1), 3.1 min | 24 passed, 3.4 min | yes |
| parity | 11,051 differences, **0 not accepted**, text-only | the same | yes |
| dlparity | 11,051 (all `style`), **0 not accepted**, text-only | the same | yes |
| sp (`tools/dlcheck.mjs`) | 8/8 node types + negative control detected | the same | yes |
| bench | **FAIL** `longest_task_ms` 57 (limit 50 + 10 %), calibration ×1.28 | **FAIL** `longest_task_ms` 77, `thumbs_gap_ms` 33.4, calibration ×2.00 (64.7–85.7 ms) | **differs** (§4) |
| load `--ci` | 5/5 PASS | 5/5 PASS | yes (numbers ≤ 4 % apart, §4) |
| export-check | 42 PDFs: GT 42 equal, pdfcheck + qpdf 42 ok; 12 small decks over the per-slide size (reported, not gated – decision 2026-10-13) | the same 42 / 42, the same 12 | yes |
| PDFs × version | **48 PDFs** (13 decks × 3 designs + weekly-options × 3 designs × {full, Chief, All}): pdfcheck ok, `qpdf --check` exit 0 without warnings, GT equal – 48/48 | 48/48 | yes |
| helper start → page ready | median 1,617 ms (GET / 200 after 1,387 ms) – **over 1 s** | median 1,925 ms – **over** | same verdict |

Differences between the runs: only the bench, and only in its load-sensitive numbers – run 2's PC was 2× slower
(calibration 64.7–85.7 ms vs 40.8 ms). Re-running the bench in both clones later gave calibration 77–91 ms again
(`BESClient` 58 % CPU, WMI and `MsSense` busy; nothing of the audit running), so no valid quiet-PC bench exists from
this audit (§4, PERF-2).

## 2. Features (05 §4)

Every row of 05 §4 (251 rows; grouped rows once; KB-01–KB-25 as one row with a per-shortcut sub-table) is in
**[`audit/features.md`](audit/features.md)** with its guard (path:line, test title) and verdict. The guarding suites
passed in all four runs, so a row with a real guard PASSes:

| Area | Rows | PASS | PASS (partial) | MISSING | MANUAL |
|---|---|---|---|---|---|
| 4.1 WB · 4.2 WZ | 60 | 14 | 25 | 21 | 0 |
| 4.3 DS · TH | 20 | 8 | 12 | 0 | 0 |
| 4.4 TX · FT | 30 | 13 | 12 | 5 | 0 |
| 4.5 CE · 4.6 TA | 37 | 11 | 14 | 12 | 0 |
| 4.7 NB · 4.8 AC | 43 | 24 | 9 | 10 | 0 |
| 4.9 VR · CV · 4.10 EX | 29 | 17 | 11 | 1 | 0 |
| 4.11 CO · UN · KB · SP · SB · OF | 17 | 6 | 8 | 3 | 0 |
| 4.12 IN · UP · DA | 15 | 9 | 3 | 1 | **2** (IN-01, IN-11: W only) |
| **All** | **251** | **102** | **94** | **53** | **2** |

* **Manual parts, not passed here:** IN-01 and IN-11 (W), WB-09's W6 (`.xlsb` under Constrained Language Mode),
  FT-15's W13 (two real PCs), W14 (Acrobat), and every W1–W14 row (PROGRESS: G0's field tests never run).
* **The most important MISSING rows** (finding VER-2): WZ-32 (two-user "Discard mine / Save mine anyway"), WZ-33
  (wizard = one undo step), TA-14–TA-18 (the whole Sizes… dialog), KB-01–KB-25 (05's "one table-driven test per
  shortcut" does not exist: 13 of 24 shortcut groups never pressed), UN-01 / UN-03 (Undo/Redo buttons, "Undo:" toast),
  AC-21 / AC-22 / AC-23 / AC-25, CE-04 / CE-07 / CE-08 / CE-09, WB-06 / WB-07 / WB-17, VR-03, CO-07, TX-04 / TX-08.
  Spot checks: `grep "Discard mine" app/e2e app/tests core/tests` → nothing; `grep "#undoBtn" app/e2e` → nothing;
  `grep stepSize app/tests core/tests app/e2e` → nothing; TA-02's guard confirmed (`app/e2e/app.spec.ts:346-355`).
* **Partial because of the environment** (VER-1): rows relying on GG / GP / SP (57 rows marked in the appendix) are
  guarded here by texts and styles only – see §4 and §9.

## 3. Behaviour changes, v3 → v4

**Rendered output.** `git worktree add v3wt v3.8.0` (in clone r1), `npm ci`, then each version captured the corpus
with its own tools on this PC (`node tools/parity.mjs --keep --no-sp --accepted <empty>`), and
`node tools/parity.mjs --golden <v3.8.0 capture> --actual <4df923b capture> --accepted <empty>` compared them:

```
parity: 0 difference(s), 0 not accepted (full comparison)
captures: 135 slide-*.json, 36 slide-*.png, 48 pdf.json, 48 comments.json, 48 issues.json each; environment equal
(win32 10.0.26100); deck20/glass/full/slide-2.json byte-identical
```
So 4.0 and 4.1-unreleased draw every corpus slide, PDF, comment and issue exactly as 3.8.0. Against v3.4.0's goldens
(the pre-rebuild look) parity reports 11,051 differences, every one listed in `tests/parity/accepted.json` (204
entries): B2 (90 style), B7 (74 geometry, 4 pixels, 2 PDF text), B3 / G1 (7 pixels), S4.1 grey text (8 pixels), the
"Fix all 4 points" seams (14 pixels), Excel Refined B2 (3), SP hairlines (2) – each signed in PROGRESS Decisions.

**Everything else a user or maintainer sees** (`git diff v3.8.0 4df923b` of app, core, helper, `*.bat`,
`tools/update.py`; and every CHANGELOG item 3.4.0–4.1.0 mapped to B1–B14 or a Decision). All of B1–B14 are in the
CHANGELOG. 34 changed behaviours: 4 are B4 / B5 / B6 / B10, 12 operator tooling required by PLAN S5.1–S5.7, 2 not
visible; the rest are findings BEH-1 … BEH-6 (§8): not in B1–B14 and not approved, or missing from the CHANGELOG.

| Visible change (4df923b) | Where | Covered by | CHANGELOG | Verdict |
|---|---|---|---|---|
| Deck-health line in every user's side panel | `app/src/ui/Chrome.tsx:63-71` | none – listed as "to confirm" (PROGRESS Waiting for) | 4.0.0 under "For the maintainer" | BEH-1 |
| *Options › Administration › Prepare rollback* in every user's menu | `app/src/ui/Topbar.tsx:138-143`, `state/app.ts:470-506` | PLAN S5.3 requires it; approval "to confirm" | maintainer section | BEH-1 |
| A damaged deck turns read-only (status bar) | `core/src/sync/docsync.ts:233,258` | approval "to confirm" | "can be read but not changed" – was not true (DATA-4) | BEH-1 + DATA-4 |
| Slide Builder 3 refuses a moved deck ("Slide Builder was updated…") | `helper/slidebuilder/migrate_v3.py:7-11` | approval "to confirm" | yes | BEH-1 |
| "moved back to Slide Builder 3 – reload (F5)", pinned and mid-rollback refusals; F5 then moves an unpinned deck to v4 again | `decks.py:295`, `migrate_v3.py:137,183,18-24` | none | **none** | BEH-2 |
| Open menu "slides by <name>" read from `snapshot.json` (stale until a compaction; none for new decks) | `helper/slidebuilder/workbooks.py:38-44` (v3 read the live document) | none | none | BEH-3 |
| 4.x starts on the next port beside 3.x; compare-and-set defaults with a conflict toast | `main.py:34-52`; `api.ts:258-266` | recorded deviations, not approvals | yes | BEH-4 |
| Backups: one per compaction under `backups\v4\<key>` + the migration copy (v3: every 5 min) | `decks.py:10,61,865` | none | partial | BEH-5 |
| `--use 3.x` rolls every deck back first; a release install replaces `Install Slide Builder.bat` | `tools/update.py:755-760,598` | PLAN S5.3 / S5.7 | **none** | BEH-5 |
| Deck open ≈ 150 ms slower than 3.8 (bench 389–419 vs 244–265 ms) | PROGRESS Waiting for | none | none | PERF-3 (info) |
| CHANGELOG items approved only through a release sign-off (3.6 Chromium 94+, 3.7 Enter in dialogs, static `.ttf` of variable uploads, 3.7 "also in 3.6.0", 3.8 install FAIL on the data-folder check) | CHANGELOG | release approvals | yes | BEH-6 (bookkeeping) |

## 4. Performance (PLAN Part F), measured by the audit

Two runs of 4df923b (calibration: reference PC ≈ 32 ms). "Raw" = against Part F's own number; `npm run bench` scales
open / read / export by calibration (≤ 2×) and adds 10 %.

| Budget (Part F) | Limit | Run 1 (×1.28) | Run 2 (×2.00) | Verdict |
|---|---|---|---|---|
| Open deck20 → first slide | 400 ms | 386 (wizard 217 + slides 169) | 585 | run 1 PASS raw; run 2 only within the scaled limit |
| Read 130k-row sheet, page | 1 s | 878 ms | 1,577 ms | run 1 PASS; run 2 scaled only |
| … in Node (core bench) | 0.5 s | parse 426–467 ms | 739–747 ms | run 1 PASS; run 2 scaled only |
| … memory, page + core worker | 150 MB | 52 MB | 66 MB | PASS |
| Longest main-thread task, opening / editing | 50 ms | **57** | **77** | **FAIL both** (gate 55) |
| First slide after Finish | 250 ms | 0 | 88 | PASS |
| Keypress → pixels, p95 | 50 ms | 31 | 45 | PASS |
| Drag frame | 16 ms | 12.2 | 16.4 | run 1 PASS; run 2 within the 10 % slack only |
| Selection change re-renders | ≤ 5 | 5 (Canvas, FxBar, Ribbon, Status, TableRibbon) | 5 | PASS – at the limit; PROGRESS still says 4 (DOC-4) |
| Thumbnail scroll gap (S4.3 gate) | 20 ms | 16.9 | **33.4** | run 2 FAIL |
| Export deck20, Liquid Glass / Excel | 2 s / 1 s | 1,017 / 485 ms | 1,696 / 754 ms | PASS raw |
| PDF size, Glass / Excel (deck20) | 80 KB/slide + 190 / 40 KB/slide | 1,338.3 KB (≤ 1,790) / 313.2 KB (≤ 800) | the same bytes | PASS (1–3-slide decks over, reported per the 2026-10-13 decision) |
| Save durable p95, 20 users, 40 ms | 150 ms | 116 ms | 112 ms | PASS |
| Others see an edit p50 / p95, 20 users, 40 ms | 2 s / 4 s | 1.39 / 2.18 s | 1.39 / 2.19 s | PASS |
| Helper start → page ready | 1 s | **1,617 ms** (median of 7) | **1,925 ms** | **FAIL** (no bench gate) → PERF-1 |

Load test, both runs (save p50/p95 ms · visible p50/p95 ms · lost · converged): same 15 ms 47/59 · 1241/1989 and
35/56 · 1243/1987; same 40 ms 97/116 · 1389/2184 and 92/112 · 1390/2194; different 40 ms 97/116 and 88/112; burst
15 ms 47/58 · 1238/1986 and 36/57 · 1239/2001; compaction 40 ms 95/116 · 1466/2281 (gens 2, 3, 4; saves during
compaction p95 110, max 113) and 87/110 · 1465/2276 – 0 lost, all converged, every difference ≤ 4 %.

Re-runs of the bench on the same clones with nothing else of the audit running: calibration 77–91 ms (r2: longest
task 83 ms; r1: 69 ms, keypress p95 99 ms, thumbnail gap 33.4 ms). The cause is outside the program (Windows
`BESClient` at 58 % CPU, WMI, `MsSense`). **No Part F time budget could be verified on a quiet machine in this audit**
(PERF-2): the longest-task gate failed in every run, at 1.28× and at 2× speed.

## 5. Architecture and logic

| Check | Result | Evidence |
|---|---|---|
| One owner per state (Part B §2) | PASS, 2 low concerns | edits go as ops to the core worker (`app/src/state/app.ts:430-438`); `doc.view` is a prediction with the core's own `applyOps`, rebased by acknowledgement count (`app.ts:356-375`, `core/src/worker/host.ts:86-98`); `deck.wb` / `deck.slides` are rebuilt mirrors (`app.ts:377-410`); shared defaults by compare-and-set (`api.ts:261-270`, `store.py:202-217`, a recorded M5a deviation). Concerns: SEC-9 a `notes[key]` entry is replaced whole (`core/src/model/ops.ts:63-69`) from the page's copy (`stage/actions.ts:71,82,86`, `drags.ts:174,201`) – a move and a text edit of one box at once lose one; SEC-10 prefs are PUT whole (`app.ts:172-176`, `store.py:246-257`) – two windows overwrite each other's keys |
| Op semantics only in `core/src/model/ops.ts` | PASS | `app/src` imports the core's appliers only; the helper reads the record envelope (`decks.py:95-138`: JSON object check), `/api/config` stores the style opaquely (`server.py:466-474`); `migrate.py` (v2 import) builds `preset.set` / `cell.patch` ops but never applies them (info) |
| `core/` has no DOM types | PASS | `core/tsconfig.json` `lib: ["ES2022","WebWorker"]`, `types: []`; grep for `document.`, `window.`, `HTMLElement`, `DOMParser`, `Element`, `lib="dom"`, `@ts-ignore` → 7 hits, all in comments |
| No native executable, stdlib-only helper | PASS | `git ls-files` has no `.exe .dll .node .pyd .so .wasm`; `make_release.py:37-41,83-112` ships `helper/**` (no tests, data), 4 `.bat`, README, CHANGELOG, `update.py`, `fieldcheck.html`; 44 files / 372 imports, all in `sys.stdlib_module_names` (3.12); HarfBuzz WASM inlined zlib + base64 (`core/src/text/wasm/*.ts`) |
| S1 Host check (DNS rebinding) | PASS | foreign Host, no port, trailing dot, `[::1]`, `0.0.0.0`, none → 403 (`server.py:249-252`) |
| S2 Origin + token | PASS | foreign / `null` / other-port / https origins → 403; 35 routes × {no, wrong} token → 70 × 403; `?t=` only on `/assets`, `/fonts`; no CORS headers; `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `no-store` |
| S3 conversion | **FAIL → fixed (SEC-2)** | cross-site refused; with the token, a file name ran PowerShell |
| S4 limits | PASS (+ SEC-4 fixed) | JSON 3 MB, upload 400 MB, compact 33 MB, logo 11 MB, font 16 MB, 20-digit Content-Length → 413; chunked → 411; `-1` / `abc` → 400; slow bodies were held for ever (SEC-4) |
| Path safety | PASS | every file route × `../`, `%2f`, `%2e%2e`, `%252e`, `..\`, `C:\`, UNC, `\\?\`, `D:x`, junctions, `::$DATA`, `%00`, `NUL`, `CON`, 300-char names: reads 403/404/400, writes reduced to a bare name; `safe_path` uses `realpath` (`util.py:83-92`). Low: `CON.pdf` / `NUL.pdf` accepted as names (SEC-7), long export names exceed MAX_PATH → misleading 404 (SEC-6) |
| Page hardening | **FAIL → fixed (SEC-1)**; CSP still absent | a workbook colour reached `innerHTML` unescaped; no Content-Security-Policy on the page that holds the token |
| Shared Windows hosts | concern (SEC-3) | `/api/ping` is unauthenticated and start-up opens the page of any same-major helper on the port: on Citrix / RDS user B uses user A's helper as A |

The attack scripts (252 raw-socket requests) ran against a helper copy on port 21100 with fresh folders and an
`outside\` folder of marker files and junctions: no response contained a marker, nothing outside the allowed folders
was created or changed.

## 6. Data safety

| Check | Result | Evidence |
|---|---|---|
| Migration / freeze / rollback / coexistence with the **real v3.8.0 helper** | PASS, 13 tests on 3.12.7 (31 s) and 3.8.10 (37 s) | `helper/tests/test_migrate_v3.py`: worktree of v3.8.0 at `:111-123`, a real v3 helper per test (`:40-61`); 409 for a frozen deck `:178-182`; a racing v3 save `:185-209`; rollback then v3 edits `:239-247`; v4 append after rollback 409 `:248-251`; re-migration keeps v4-only fields `:253-258`; config.json from both versions `:408-434` (30/30 keys). Not end to end: the v3 *page* turning "outdated" (only the 409) |
| Journal damage: body bit flip, shorter length, garbage / `\n` / zeros between frames, bad CRC field, cut frame | PASS | 423 read-only, incident file, `readonly` in every tail, journal bytes unchanged |
| Journal length field made **bigger** (one bit: 141 → 941) or digits before a header | **FAIL → fixed (DATA-1)** | read as a torn tail: no incident, records 3–6 invisible, append and compact 200, after 24 h compaction (or `rotate`) the journal was **deleted** |
| `snapshot.json` truncated, invalid, 0 bytes, `[]` | PASS | snapshot / open / compact 503; nothing written; `--migrate-all` leaves it |
| `snapshot.json` deleted (migrated deck; deck born in v4) | **FAIL → fixed (DATA-2)** | open re-migrated at gen 1 (v3 content / empty deck), the next compaction overwrote `backups/v4/<key>/2.json` |
| v3 document unreadable (truncated, 0 bytes, `[]`, `null`), frozen file damaged, rolled back + damaged | PASS | 503, nothing written (observation: a v3 file that is exactly `{}` migrates as an empty document) |
| Core on 503 / 423 / failed tail | PASS | `docsync.ts:255-263` keeps the last fold; read-only stops flush (`:200`) and compaction (`:301`); a skipped journal blocks compaction (`:151,:308,:373`) |
| Open with a journal the helper could not read (`skipped`) | **FAIL → fixed (DATA-3)** | `app/src/state/app.ts:286-289` folded without it; the null preset led to the default / wizard preset written over the user's (live helper with a share-mode-0 handle; the page step from the code) |
| A read-only deck and an edit | **FAIL → fixed (DATA-4)** | applied on screen (`docsync.ts:190`), never sent (`:200`), no warning on close (`app.ts:131-134`) |

After the fixes the same experiments (`exp_journal.py`, `exp_snapshot.py`, `exp_v3.py` against `v4/audit-fixes`):
A0–A9 **all PASS** (A3, A5 now 423 + incident, nothing changed), B1–B6 **all PASS** (B5, B6: open refused 503),
C1–C8 PASS as before.

## 7. Documentation truth (30 random statements)

Sampled with `random.Random(20261015)` from the lines that can hold a claim (README 619, ARCHITECTURE 459; 15 each;
two drawn lines without a claim replaced by the next one that has one). **28 TRUE, 2 PARTLY, 0 FALSE.**

| # | Doc:line | Statement | Evidence | Verdict |
|---|---|---|---|---|
| 1 | README:28 | a React 19 app with one store | `app/package.json:19` 19.2.8; `app/src/state/store.ts:1`; a second Zustand store `useStage` `app/src/stage/data.ts:28` | PARTLY (DOC-1) |
| 2 | README:45 | the wizard picks sheets and tables and arranges slides | `app/src/wizard/Wizard.tsx:1` | TRUE |
| 3 | README:59 | CF `cellIs` + simple `expression`; sup/sub; EMF/WMF/TIFF via the helper | `core/src/xlsx/workbook.ts:328`, `strings.ts:26`, `drawing.ts:9`, `helper/slidebuilder/convert.py:3` | TRUE |
| 4 | README:429 | the 5 saved-format fixtures | `helper/tests/fixtures/saved/` | TRUE |
| 5 | README:436 | rollback writes `rolled-back.json`, waits 14 s, rechecks, gives back | `migrate_v3.py:328,264` (QUIET 3 × 4 + 2), `:334,:344,:365` | TRUE |
| 6 | README:459 | 13 bytes a cell; read-only map views | `core/src/xlsx/sheetstore.ts:8-9,579,604` | TRUE |
| 7 | README:489 | wallpaper in the worker on OffscreenCanvas; `roles.ts` used by a test only | `core/src/workers/core.worker.ts:13-23`, `worker/host.ts:302`, `core/tests/design.test.ts:4` | TRUE |
| 8 | README:767 | append / prepare / compact (CAS on gen) / rotate shapes | `server.py:451-460`, `decks.py:556,801-803,898-926` | TRUE |
| 9 | README:770 | presence `{deck, client}`, 25 s window | `decks.py:59`, `server.py:475-480` | TRUE |
| 10 | README:803 | bad length / CRC / newline = corruption → incident → 423 | `decks.py:114-126,706,366-385,395-397` (but see DATA-1: a bigger length was not) | TRUE as written |
| 11 | README:826 | never Type 3 / variable fonts; 1200 × 675 pt | `core/src/pdf/writer.ts:44,110,427,450,457`; 48 PDFs checked (§1) | TRUE |
| 12 | README:890 | parity exits 1 on an unaccepted difference | `tools/parity.mjs:340` | TRUE |
| 13 | README:911 | bench needs big30, exits 2 | `tools/bench.mjs:59` | TRUE |
| 14 | README:946 | export / shape / measure / w13 tests, w13 = three PCs | `core/tests/w13.test.ts:36,62,65` | TRUE |
| 15 | README:1013 | drag preview and drawn slide from the same `computeLayout` | `core/src/render/layout.ts:105`, `app/src/stage/drags.ts:9,66,77` | TRUE |
| 16 | ARCH:77 | `--use 3.x` rolls back every deck; older sets `held` | `tools/update.py:755-762,528` | TRUE |
| 17 | ARCH:79 | `--rollback [WORKBOOK]` | `tools/update.py:976,826-831` | TRUE |
| 18 | ARCH:83 | `before-update-<time>`, last 5, `data\v4` not copied | `tools/update.py:65,147,150-168` | TRUE |
| 19 | ARCH:233 | clients never send documents | compaction sends a folded document (`app/src/sync/api.ts:144`, `core/src/model/fold.ts:107`, `decks.py:779-780`; ARCHITECTURE §6.2 says so) | PARTLY (DOC-2) |
| 20 | ARCH:282 | journals `O_CREAT\|O_EXCL\|O_APPEND`, names never reused | `decks.py:483,430-438,492-494` | TRUE |
| 21 | ARCH:285 | `IDLE_CLOSE` 600 s, closer every 60 s | `decks.py:57`, `server.py:115-119` | TRUE |
| 22 | ARCH:320 | corruption rechecked from 0, then read-only | `decks.py:683-689,706` | TRUE |
| 23 | ARCH:409 | compact validation 400; read-only 423; rolled back 409 | `decks.py:766-780,54,795-796` | TRUE |
| 24 | ARCH:441 | a frontier is cut back to the first record not included | `core/src/sync/docsync.ts:354-360` | TRUE |
| 25 | ARCH:572 | append handles notice in 4 s, tails in 10 s, lean-lock at once | `decks.py:66,463-472,65,677-679,568-573` | TRUE |
| 26 | ARCH:623 | `GET /files/`: extensions, `~$`, ROOT then backend, X-SB headers, 8 × 0.5 s then 503 | `paths.py:59`, `workbooks.py:19,56-68,91-97`, `server.py:305-320,397-401` | TRUE |
| 27 | ARCH:654 | `POST /api/fonts` ≤ 15 MB, 64 faces, 400 | `fonts.py:21-22,56,81,104` (over 15 MB answers 413, not listed) | TRUE |
| 28 | ARCH:667 | `prepare` `{ok: true}`, idempotent, nothing in lean-lock | `decks.py:510-526,146-147,413-415,389-397` | TRUE |
| 29 | ARCH:672 | `presence/leave` `{ok: <deleted>}` | `server.py:478-480`, `decks.py:1007-1011` | TRUE |
| 30 | ARCH:839 | the v2 import writes `config.json` rev 1 only when none | `migrate.py:171`, `store.py:220-228` | TRUE |

Outside the sample: README:1011-1012 puts `tableSizes` and `sizePatch` in `core/src/render/layout.ts`; they are in
`core/src/model/preset.ts:39` and `app/src/editor/tables.ts:31` (DOC-3).

## 8. Findings

Severity: critical · high · medium · low · info. "Fixed" = a commit on `v4/audit-fixes` whose test fails before it.

### Fixed (failing reproduction first)

**SEC-1 · high (critical in the chain with SEC-2) · stored script injection from a workbook's colours** – fixed in
c8fdaef.
* *Defect.* `core/src/xlsx/workbook.ts:98` took a theme colour's `srgbClr val` / `sysClr lastClr` unvalidated;
  `core/src/xlsx/color.ts:37-43` returned `"#" + raw`; the wizard grid wrote it into `style="…"`
  (`app/src/wizard/Wizard.tsx:400-405`) and assigned the HTML with `innerHTML`. The page has no CSP.
* *Reproduce (4df923b).* A copy of `report.xlsx` whose theme colours are
  `4472C4&quot;&gt;&lt;img src=x onerror=&quot;window.__pwned=document.querySelector('meta[name=sb-token]').content&quot;&gt;`,
  opened in the app, wizard → Next: `window.__pwned` holds the 32-character token, 87 `<img>` in the grid (Chromium,
  Playwright). After the fix: `null`, 0 `<img>`.
* *Fix.* `hex6()` admits only `RRGGBB` for theme, `rgb` and drawing colours (else the default / fallback colour); the
  grid escapes the style attribute. Test `core/tests/colors.test.ts`.
* *Still proposed:* a Content-Security-Policy with a per-start nonce on the page (defence in depth).

**SEC-2 · high · PowerShell command injection in `/api/convert-workbook`** – fixed in ad1b4b0.
* *Defect.* `helper/slidebuilder/convert.py:107-121` named the temp copy with the request name's extension and pasted
  the path into `powershell -Command '…'`, doubling only ASCII `'`; PowerShell also ends a quoted string at U+2018–U+201B.
* *Reproduce.* name `Budget.x’);Start-Process notepad}finally{};#` → the command text contains
  `…in.x’);start-process notepad}finally{};#'…` (PowerShell's parser: two commands). Chain: SEC-1's script holds the
  token and can POST that name with OLE bytes.
* *Fix.* Both PowerShell commands read `SB_SRC` / `SB_DST` from the environment; the copy's extension is one of
  `.xls .xlsx .xlsm .xlsb`. Checked with Excel on this PC: `O’Brien report.xlsx` converts. Test
  `helper/tests/test_convert.py`.

**DATA-1 · high · a damaged length field hides and later deletes acknowledged records** – fixed in 9182965.
* *Defect.* `helper/slidebuilder/decks.py:116-118` read a frame whose declared length ran past the end of the file as
  a tail still being written; `_covered` (`:828-838`) then counted the journal as covered, so `_drop_dead`, `rotate`
  and the rollback check went ahead.
* *Reproduce.* 6 records, then one digit of the 3rd frame's length 141 → 941: tail returns records 1–2, no
  `readonly`, no incident, append / compact 200; with the journal 25 h old one compaction deleted it (records 3–6).
* *Fix.* A line end after the header of an incomplete frame is corruption (a body is compact JSON). Test
  `FramingTests.test_a_length_grown_past_the_end_is_corruption_not_a_torn_tail`; experiments A3 / A5 now PASS.

**DATA-2 · high impact, low likelihood · a missing snapshot restarts the deck from nothing** – fixed in f78f164.
* *Defect.* `migrate_v3.migrate()` and `decks.create_if_missing()` decided from `os.path.exists(snapshot.json)` alone.
* *Reproduce.* Migrate, compact to gen 2, append, delete `snapshot.json`: open → 200 at gen 1 with the v3 content
  (or an empty deck); the next compaction overwrote `backups/v4/<key>/2.json`, the only copy of gen 2.
* *Fix.* A deck with journals, snapshot backups or `moved-from-v3.json` but no snapshot is refused (503, a message to
  restore from `data/backups/v4/<key>`); `_backup()` never replaces a different snapshot of the same gen. Test
  `DeckTests.test_a_missing_snapshot_is_never_started_again_from_nothing`; B5 / B6 now PASS.
* *Still proposed:* DocSync could treat a lower `gen` from the helper as an anomaly (read-only) instead of ignoring it.

**DATA-3 · medium · open folds without an unreadable journal** – fixed in b6b366e.
* *Defect.* `app/src/state/app.ts:286-289` folded the first tail as it came, `skipped` journals included as empty.
* *Reproduce.* User preset in w1's journal, w1's file held with share mode 0: the helper answers `skipped: [w1]`, the
  fold has `preset: null` → default or wizard preset written over the user's (`app.ts:300-302`, `host.ts:205`).
* *Fix.* `openTail()` asks again while a journal is skipped (4 × 0.5 s), then fails the open ("open it again in a
  moment"). Tests `app/tests/api.test.tsx` "the first tail of a deck being opened".

**DATA-4 · medium · a read-only deck accepts edits that are never saved** – fixed in e725d20.
* *Defect.* `DocSync.apply` applied edits in the `readonly` state (`core/src/sync/docsync.ts:190`), `flush` never sent
  them (`:200`), `beforeunload` ignores `readonly` (`app/src/state/app.ts:131-134`); CHANGELOG 4.0.0 promises "can be
  read but not changed".
* *Fix.* `apply` returns null on a read-only deck; the page refuses the change / undo with a toast naming the reason.
  Test docsync "a read-only deck takes no change".

**PERF-1 · medium · helper start → page ready over Part F's 1 s, and nothing gates it** – fixed in part in 0eaf8cb.
* *Defect.* `helper/slidebuilder/main.py:14-21` probed each port with a 1 s HTTP timeout; on Windows a refused loopback
  connection is retried for ≈ 2 s, so every start waited the full second (`running_version(free port)` = 1,018 ms).
* *Measured.* 1,617 ms (run 1) and 1,925 ms (run 2) median helper start → page ready.
* *Fix.* A 0.25 s TCP connect first. Test `StartTimeTests.test_a_free_port_is_found_free_at_once`. After the fix see
  §10; the rest is Python start (≈ 0.14 s), imports (≈ 0.3 s: `urllib.request`/`ssl` via `slidebuilder.util`) and the
  1.5 MB page in the browser (≈ 0.4 s). *Proposed:* gate it in `npm run bench`.

**UX-1 · low · the approved start-up reopen fix was never delivered** – fixed in c2d28d9.
* *Defect.* Decided 2026-10-14 ("all yes", 4; PROGRESS: carried into M5) but `app/src/state/app.ts:116-119` was v3.8.0's
  code: a workbook picked during start-up was replaced by the reopen of the last one.
* *Reproduce.* e2e holding start-up's `/api/files` until the user picked weekly.xlsx → the top bar showed
  "report.xlsx · 2 slides".
* *Fix.* Reopen only when no open has started. Test open.spec "a workbook picked while start-up still reopens the last
  one stays open"; CHANGELOG 4.1.0 line.

**SEC-4 · low · no socket timeout** – fixed in 0349e69. 40 slow-body connections were all still held after 21 s; now
`Handler.timeout = 60`. Test `HttpTests.test_a_stalled_request_does_not_hold_its_thread_for_ever`.

**SEC-5 · low · identifiers with a final line end** – fixed in 9fe0cd3. `KEY_RE` / `WRITER_RE` / `CLIENT_RE` /
`JOURNAL_RE` ended in `$`, which matches before a final `\n`: `<key>\n` passed and failed later as a 500 with a
traceback. Now `\Z`. Test `DeckTests.test_identifiers_with_a_line_end_are_refused`.

**SEC-11 · low · SyntaxWarning at every start on 3.12** – fixed in 1c4342d. `paths.py` docstrings held `\ `, `\a`,
`\b`. Test `SourceTests.test_every_module_compiles_without_a_warning`.

### Not fixed (no failing reproduction of a defect, or a decision for people)

| ID | Severity | Finding | Reproduce / evidence | Proposed fix |
|---|---|---|---|---|
| VER-1 | **high** (process) | Since M5 nothing verifies geometry, pixels or screen = PDF: the goldens' environment (10.0.22631, 357 fonts) is gone from this PC (10.0.26100, 350), parity / dlparity run text-only, SP not at all, and in text-only mode the 90 signed Liquid Glass style entries are accepted **without their digests**, so any glass style change passes | §1 parity logs ("text-only comparison"); `tests/parity/accepted.json`; PROGRESS Waiting for (M5a item 3) | re-capture `golden/` on a machine kept as the reference (a decision), or check digests in text-only mode too |
| VER-2 | medium | 53 feature rows have no automated guard, incl. the table-driven shortcut test 05 asks for; PLAN Part E: "Nothing is done while a guard is red" | §2, `audit/features.md` | add the e2e / unit tests named there |
| PERF-2 | medium | The longest-task gate failed in every audit run (57, 77, 69, 83 ms > 55) and the thumbnail gap in two (33.4 ms); open / read / parse pass only within the scaled limits at ×2 | §4 | a quiet reference-PC run (people); then decide the open-gate method (PROGRESS Waiting for M6 item 3) |
| BEH-1 | medium | Visible changes outside B1–B14 still "to confirm": deck-health line, Prepare rollback in every user's Options, read-only deck, v3's refusal of a moved deck | §3 | product-owner approval; show the deck-health line and Prepare rollback to the maintainer only, or list them under "What users notice" |
| SEC-3 | medium (shared Windows hosts only) | `/api/ping` is unauthenticated and start-up opens any same-major helper's page: on Citrix / RDS a second user works in the first user's helper as that user | `main.py:14-52`, `server.py` ping route | document "one interactive user per PC", or let ping carry a hash of the user and skip other users' helpers |
| SEC-9 | low | A text box's `notes[key]` entry is replaced whole: a move and a text edit of one box by two people at once lose one | `core/src/model/ops.ts:63-69`; `app/src/stage/actions.ts:71,82,86`, `drags.ts:174,201` | field-level merge for notes entries in `ops.ts`, with op vectors |
| SEC-10 | low | Prefs are PUT whole from every window: two windows overwrite each other's keys | `app.ts:172-176`, `store.py:246-257` | merge keys under a lock, or compare-and-set on a revision |
| BEH-2 | low | Rollback / pin refusal messages are not in the CHANGELOG; "reload (F5)" on a rolled-back, unpinned deck moves it to v4 again | `decks.py:295`, `migrate_v3.py:18-24,137,183` | CHANGELOG lines; point the message at `Start Slide Builder (v3).bat` |
| BEH-3 | low | Open menu "slides by <name>" comes from `snapshot.json` (stale until compaction; none for new decks) | `helper/slidebuilder/workbooks.py:38-44` | read `updatedBy` from the last tail, or accept and list it |
| BEH-4 / 5 / 6 | low | Behaviours recorded but not approved (next-port start, compare-and-set toast), missing maintainer lines (backups now per compaction, `--use 3.x` rolls back, Install `.bat` replaced), CHANGELOG items approved only by a release sign-off | §3 | CHANGELOG lines and explicit approvals |
| SEC-6 | low | Long export names exceed MAX_PATH with `.<uuid>.tmp` → misleading 404 | 200-char name on `T:\Slide Builder\export\` = 265 chars | cap names by the full path; map write `OSError` to a clear 400 / 503 |
| SEC-7 | low | `CON.pdf`, `NUL.pdf`, `COM1.pdf` accepted as export names (devices on older Windows / SMB servers) | attack table | prefix reserved device names |
| SEC-8 | low | `POST /api/decks/open` creates a deck and a frozen v3 stub for a workbook that does not exist | attack table | require the workbook (or an upload id) |
| DATA-5 | low | If the incident file cannot be written, `_look` clears this helper's read-only flag (`decks.py:422-426`) | code reading | keep the in-memory flag until the file exists |
| DATA-6 | info | `--migrate-all` names unreadable v3 files "workbook name does not match its file name" (`migrate_v3.py:232-235,248-249`); a refused migration leaves an empty deck folder; a too-deep data path answers 404 | experiments C1–C4, I4 | precise messages; 503 for `FileNotFoundError` on the share |
| PERF-3 | info | Deck open ≈ 150 ms slower than 3.8 (open + migration check + first tail + fold) | PROGRESS Waiting for M6 | profile the first tail |
| DOC-1…4 | low | README:28 "one store" (two); ARCH:233 "clients never send documents" (compaction does); README:1011-1012 wrong file for `tableSizes` / `sizePatch`; PROGRESS S1.3–S2.6 render counts "4" – measured 5 (`Canvas` re-renders on selection, within ≤ 5) | §7, §4 | correct the sentences |
| INFO | info | v2 import builds ops in Python (`migrate.py:70-80,209`, not covered by ops-vectors); writer ids are not bound to user/PC; `/files` and `/assets` serve any matching file below the roots; `make_release.py` has no extension denylist; the HarfBuzz WASM hash is checked in tests only | §5 | – |

## 9. What still needs a human

1. **Merge decision for `v4/audit-fixes`** (not pushed; 11 commits on 4df923b) – then a release (4.0.1 or with 4.1.0)
   and a share update, since SEC-1 / SEC-2 / DATA-1 / DATA-2 affect 4.0.0 as installed.
2. **A quiet reference-PC bench** (PERF-2) and the open-gate decision; the helper-start budget gate (PERF-1).
3. **Reference environment for parity** (VER-1): re-capture or a kept machine; until then GG / GP / SP are unverified.
4. **Approvals** (BEH-1 … BEH-6): the four "to confirm" items and the CHANGELOG bookkeeping.
5. **Field checks never run** (G0): `tools/sharetest.py` on the real share from 3–5 PCs, `fieldcheck.html` in Edge,
   W1–W14 (incl. W6 `.xlsb` under CLM, W13 two PCs, W14 Acrobat), IN-01 / IN-11.
6. **Missing tests** (VER-2) and the design choices SEC-3, SEC-9, SEC-10.
7. **S6.5** stays stopped until four weekly cycles without a rollback are recorded (not before 2026-11-12).

## 10. After the fixes: the protocol twice more

Two clean clones of `v4/audit-fixes` at c2d28d9 (`f1`, `f2`), the same script as §0:

| Step | Run 3 (f1) | Run 4 (f2) | Before (runs 1 / 2) |
|---|---|---|---|
| `npm ci` · build · page fresh | ok · ok · **equal** | ok · ok · **equal** | equal |
| `npm run check` | core **462**, app **43** passed | 462 · 43 | 460 · 41 (+ `colors.test`, docsync read-only, 2 × `openTail`) |
| helper 3.12.7 / 3.8.10 | **236** OK / 236 OK (1 skip each) | 236 / 236 | 228 (+ convert × 2, framing, missing snapshot, line ends, start time, compile, stalled request) |
| e2e | **25** passed, 3.4 min | 25 passed, 3.5 min | 24 (+ UX-1) |
| parity · dlparity | 11,051 · 11,051 differences, **0 not accepted** (text-only) | the same | the same |
| sp | 8/8 + negative control | 8/8 | 8/8 |
| load `--ci` save p95 / visible p95 (same deck, 40 ms) | 114 ms / 2.20 s; 5/5 PASS, 0 lost | 116 ms / 2.19 s; 5/5 PASS | 116 / 2.18 · 112 / 2.19 |
| export-check | 42/42 GT, pdfcheck + qpdf ok | 42/42 | 42/42 |
| PDFs × design × version | **48/48** (pdfcheck, `qpdf --check` exit 0 no warnings, GT) | 48/48 | 48/48 |
| helper start → page ready (median of 7) | **1,136 ms** (GET / 738 ms) | **1,146 ms** (746 ms) | 1,617 · 1,925 ms |
| bench (calibration) | ×1.85–2.00: FAIL `longest_task_ms` 63, `thumbs_gap_ms` 33.6; open 565 · read 1,399 · keypress p95 42 · drag 16.4 · export 1,650 / 687 ms · 1,338.3 / 313.2 KB · heap 44 MB | ×1.94–2.00: FAIL `thumbs_gap_ms` 33.4; longest task 52 (within slack); open 534 · read 1,419 · keypress 46 · drag 16.4 · export 1,475 / 674 ms · heap 77 MB | §4 |

* **The two post-fix runs agree with each other and with the pre-fix runs** on every correctness result; only the
  test counts grew (the new tests) and the helper start fell by ≈ 0.5–0.8 s.
* **The reproductions now pass:** data-safety experiments A0–A9, B1–B6, C1–C8 (§6); the crafted-theme workbook runs no
  script (0 `<img>` in the grid, `window.__pwned` null); every new test but one fails with its fix reverted and passes
  on c2d28d9 – the exception is DATA-3, whose tests exercise the new `openTail()` (its defect was reproduced against
  a live helper, §6).
* **Still not shown:** helper start → page ready ≤ 1 s (1.14 s on a PC running ≈ 2× slower than the reference) and the
  bench's long-task and thumbnail gates – the machine stayed at calibration 62–91 ms (reference ≈ 32 ms) for the whole
  second half of the audit, so these remain for a quiet reference-PC run (§9.2). Proposed next saving for start-up:
  build `util.LOCAL` (an `urllib` opener that loads the Windows certificate store, ≈ 60 ms at import) on first use.
