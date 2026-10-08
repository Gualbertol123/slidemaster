# ADR-003: Export with our own PDF writer fed by the display list; no headless browser

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/02-options.md`, `docs/next/03-architecture.md`

## Context
Chrome-printed Liquid Glass PDFs are 24.7 MB for 20 slides, with 18 300 images, 5 741 forms and a Type 3
font. They take 10 s to make and 766 ms per page to view. The engines need 11 timeouts, three fallbacks,
marker-based page fitting and CSS work-arounds (`printcss.ts`).

## Decision
* A PDF 1.7 writer in TypeScript draws the 8 display-list node types:
  * rect, path and line;
  * images de-duplicated per document;
  * axial/radial shadings with luminosity soft masks, shared per gradient style;
  * stepped soft shadows;
  * Type0/CIDFontType2 (or CFF) subset fonts with ToUnicode, via HarfBuzz `hb-subset`.
* The page is `[0 0 1200 675]`, with the slide mapped by one `cm`.
* PNG comes from the same DL on an OffscreenCanvas.
* The helper only saves the bytes (v3 `save_export`).

## Consequences
+ 80× faster, 41× smaller Glass PDFs; 7× faster to view; no engine install, no policy exposure; exports
  work offline.
+ Screen and PDF are two renderers of one DL (ADR-004).
− We own a PDF writer (mitigated: small, tested with qpdf, PDFium, pypdf and Acrobat).
− The "PDF as pictures" mode loses its reason to exist and is kept for compatibility only.

## Evidence and alternatives
`spikes/pdfwriter` (02 §C). Rejected: pdf-lib/jsPDF (no shadings or soft masks), ReportLab (not stdlib, second renderer), QuestPDF (licence, .NET), krilla via WASM (good, kept as the fallback).
