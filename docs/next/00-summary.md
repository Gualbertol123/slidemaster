# 00 · Slide Builder 4: summary

## Recommendation

**Keep the deployment; replace the engine.** Users still start a Python standard-library helper and work in
an Edge window, and the shared folder is still the only channel between PCs. Behind that, five changes:

0. **A proper React 19 app.** It uses a small selector-based store instead of today's global object that
   re-renders every component on any change (ADR-012).
1. **One TypeScript core in Web Workers.** It is the only implementation of the document, its operations,
   the Excel reader, the layout, the three designs and the automated comments, and it never blocks the
   window. The Python copy of the operation semantics is deleted.
2. **A display list as the single rendering contract.** It has eight primitives: rect, path, line, image,
   shadow, shaped text, group and hit area. The screen draws it as SVG, PNG export uses a canvas, and
   **our own PDF writer** produces the PDF.
3. **No headless browser.** Playwright, Chrome for Testing, DevTools, the three engine fallbacks, the CSS
   print hacks and the page-fitting code all disappear.
4. **Text measured from font files with HarfBuzz (WASM).** Fonts are pinned in the shared library, so the
   layout is identical on every PC and identical on screen and in the PDF. PDFs never contain Type 3 or
   variable fonts.
5. **Decks stored as a snapshot plus one append-only journal per writer.** Saving takes no lock, and
   concurrent edits are ordered by Lamport clocks with the same field-level merge as today.

No new executable reaches the PCs: Python and Edge are already allowed. Updates become CI-built release
ZIPs, installed side by side with an instant rollback, and v3 and v4 coexist deck by deck.

## Why

Measured on the current system with a 20-slide weekly deck (`01-current-system.md`):
* **Liquid Glass export takes 10 s and produces 24.7 MB.** Chrome turns every alpha gradient into an image,
  giving 18 300 images and 5 741 forms; each page needs 766 ms to render in a viewer.
* **Reading one large data sheet freezes the window** for up to 0.56 s, takes 6 s, and uses 336 MB.
* **With 20 people on one deck over a 40 ms link, an edit reaches the others after 12 s** (p50) to 28 s
  (p95), with lock time-outs.

The problems are the browser print engine, the UI-thread parser and the lock on the save path, not the
language of the helper. Those are the three things the design replaces.

## Expected gains (spike measurement vs v3 measurement, same deck and machine)

| | v3 | v4 (spike) | Target |
|---|---|---|---|
| Liquid Glass PDF, 20 slides | 10.1 s · 24.7 MB · 766 ms/page to view | **0.1 s · 0.6 MB · 108 ms/page** | < 2 s · < 2 MB |
| Excel PDF, 20 slides | 2.3 s · 2.7 MB | **0.05 s · 0.14 MB** | < 1 s · < 0.8 MB |
| Parse a 130k-row sheet | 6.1 s, UI frozen, 336 MB heap | **0.66 s in a worker, 26 MB** | < 1 s, UI never blocked |
| Save p95, 20 users, 40 ms share | 9.1 s | **96 ms** | < 150 ms |
| Others see an edit, 20 users, 40 ms | 12 s / 28 s | **1.8 s / 3.1 s** | < 2 s / < 4 s |
| Software on each PC | Python (+ Playwright + 150 MB Chrome) | **Python only** | – |

The spikes, with instructions to reproduce, are in `spikes/`.

## Effort

**28 calendar weeks, 54 engineer-weeks** (2 engineers + 0.5 QA/pilot), plus 20 % contingency. The work is
in six phases, and every phase ships (`06-plan.md`):

| Milestone | Ships as | Content | Weeks |
|---|---|---|---|
| M0 | v3.4 | foundations: CI, release ZIPs and updater, v3 quick fixes, golden capture, field tests | 3 |
| M1 | v3.5 | the UI becomes a proper React 19 app with a selector-based store | 3 |
| M2 | v3.6 | core in workers | 4 |
| M3 | v3.7 | display list and native export | 6 |
| M4 | v3.8 | the screen draws the display list | 4 |
| M5 | **v4.0** | journal storage and per-deck cut-over | 5 |
| M6 | v4.1 | native `.xlsb` reader, hardening | 3 |

**[`PLAN.md`](PLAN.md) is the step-by-step plan an agent follows:** a drawing of the end state, about 45 steps
with "done when" checks, human gates, the timeline and the feature preservation map.

About 70 % of v3's TypeScript moves unchanged: number formats, layout, CF, the Liquid Glass scene
inference, comments, UI and wizard.

## Top risks

1. **The bank's real share behaves differently from the simulation** (append visibility, antivirus, DFS).
   It is tested on the real share in M0, before any storage code is written. The fallback is a
   single-document lean-lock protocol behind the same helper API.
2. **Users do not accept Liquid Glass as drawn from the display list** (stepped shadows, rim), or wrapping
   differs from v3. This is handled by a golden pixel and geometry harness against v3, a pilot sign-off
   per design, and the old export engine kept for one release.
3. **Deck migration** is the only data-risk step. It is mitigated by:
   * byte backups;
   * a pilot on a copy of the data;
   * a v3 freeze proven against the real v3 helper;
   * a rehearsed, lossless rollback.

## Documents

| Document | Content |
|---|---|
| `01-current-system.md` | how v3 works, the measured baseline, discrepancies with the README |
| `02-options.md` | options scored against the constraints, with spike results |
| `03-architecture.md` | target architecture, data model, rendering, export, UX, behaviour changes |
| `04-data-and-migration.md` | storage protocol, formats, coexistence, cut-over, rollback |
| `05-test-and-parity.md` | test strategy, Windows policy matrix, full parity checklist |
| `06-plan.md` | phases, effort, reuse map, risk register, non-goals, benchmarks |
| `PLAN.md` | **the executable plan: what it will look like, and every step to get there** |
| `PROMPTS.md` | **ten copy-paste prompts for coding agents (one per milestone + a final audit), with built-in double checking** |
| `adr/001…012` | one record per decision |
