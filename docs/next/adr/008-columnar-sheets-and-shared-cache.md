# ADR-008: Columnar SheetStore in the worker; optional parsed-sheet cache on the share keyed by part CRC-32

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
One object per cell costs 242 MB for 1.56 M cells. Every user re-parses every workbook.

## Decision
* Sheets are typed-array columns (row, col, kind, num, str, xf) with v3's `Sheet` facade, so v3's
  layout, CF, formats and comment code run unchanged.
* Phase 4, if real-share measurements need it: the first opener writes
  `data/v4/cache/<crc32>-<size>.sbc` (deflated columns); later openers load it.
* The key comes from the zip central directory, so no hashing is needed and unchanged sheets of an edited
  workbook stay cached.

## Consequences
+ 10× faster parse, 9× less memory; 205 ms cache load.
− A cache folder to sweep (LRU 2 GB).
− The cache format is versioned; a mismatch means re-parse, never an error.

## Evidence and alternatives
`spikes/parser`.
