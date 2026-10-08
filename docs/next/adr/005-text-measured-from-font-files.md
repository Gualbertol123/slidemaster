# ADR-005: Text is measured and shaped by the core from font files with HarfBuzz; fonts are pinned in the shared library

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
Layout depends on each PC's fonts. The canvas digit width drives the column widths, and `fitNotes` uses
the DOM. Glass widening is a character-count heuristic. Screen fonts differ from PDF fonts by design.

## Decision
* `hb.wasm` (HarfBuzz, MIT) shapes every string in the core, with kern and liga on.
* Every layout decision uses those advances.
* Windows fonts a deck uses are copied once into `data/fonts/system/` (hash-named), so every PC lays out
  with the same bytes.
* Variable fonts are instanced to static ones on import (`hb-subset`).
* The screen pins each run's width with SVG `textLength`, and falls back to glyph outlines per font when the
  parity check fails.
* Liquid Glass uses static Segoe UI (B2).

## Consequences
+ The same layout on every PC and in the PDF; no Type 3 or variable fonts in PDFs.
− About 1 MB of WASM in the page.
− Some cells wrap or shrink differently from v3 (B7, listed by the parity harness).
− Needs the licence owner's OK for copying Windows fonts (R7; there is a fallback).

## Evidence and alternatives
`spikes/fonts` (CFF subset, variable instancing), `spikes/pdfwriter/ttf.ts` (fallback measurement G3).
