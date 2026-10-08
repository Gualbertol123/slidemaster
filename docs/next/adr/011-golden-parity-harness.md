# ADR-011: Capture v3 behaviour as golden data before rewriting; gate every change on parity

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
The rebuild changes every renderer. The only reliable reference is the running v3.

## Decision
* `tools/capture-v3.mjs` records the following per corpus deck × design × version × slide:
  * DOM geometry and text;
  * screenshots;
  * PDF text and positions;
  * comment texts.
* `tools/parity.mjs` compares v4 display lists and renders against them (GT, GG, GP, GF, SP in 05 §1).
* Accepted differences are listed with a reason and sign-off.
* CI gates are in 05 §5.

## Consequences
+ Regressions are visible as data; the visual sign-off is focused on heat maps.
− Building the corpus and anonymising real decks takes time (M0, PLAN S0.5).

## Evidence and alternatives
05.
