# ADR-020: The Tabler icon set is vendored into the core worker, unpacked on first use; notices ship for every runtime dependency

* **Status:** proposed (Phase 0 design `09-charts-annotations-icons.md` §2.4, §3.5, 2026-10-20; needs §9 Q10, Q11)
* **Deciders:** product owner, maintainers
* **Related:** ADR-004 (display list; amended below), ADR-013 (vendoring pattern of IronCalc), AUDIT-2 LIC-1 and ARCH-4

## Context
The owner wants the full Tabler icon set (https://github.com/tabler/tabler-icons) on slides and in a searchable picker,
with no network at run time and no CDN. Measured on `@tabler/icons` **3.49.0** (npm, published 2026-10-05, MIT,
"Copyright (c) 2020-2026 Paweł Kuna"): 5,184 outline icons and 1,054 filled ones, 41 categories (376 icons in "Brand"),
51,757 tags; every icon is `path` elements only on a 24 × 24 grid (outline: stroke 2, round caps and joins, no fill).
Compressed as the page inlines its WASM (zlib level 9 + base64): outline paths 303,192 B, filled 136,260 B, the index of
names / categories / tags 150,052 B – **≈ 0.59 MB** for the whole set (the page today: 3,916,092 B). AUDIT-2 LIC-1: no
third-party licence text ships at all (React, react-dom, scheduler, zustand, fflate, IronCalc, harfbuzzjs / HarfBuzz).

## Decision
* `@tabler/icons@3.49.0` becomes a pinned **devDependency**; `tools/vendor-tabler.mjs` converts every path to the
  display list's absolute `M L C Z` commands (arcs → cubics ≤ 90°), drops the invisible `stroke="none"` frame path
  every outline icon starts with, keeps an alias table of renamed icons (old name → new), writes `core/src/icons/tabler-data.ts` (deflate +
  base64 strings for outline, filled and index) and copies the package's `LICENSE` to `core/src/icons/LICENSE-tabler`.
  A test inflates the inlined strings and checks their sha256 against the vendor script's record (ARCH-4's lesson).
* The data lives in the **core worker bundle** only, decoded on first use (an icon item drawn, the picker opened),
  cached per icon name. The picker's search runs in the worker; the page receives only the visible results.
* Icon names in the deck: `tabler:<name>`, `tabler-filled:<name>`; the 17 built-in icons keep their names.
* **ADR-004 amendment:** `Stroke` gains `join?: "miter" | "round" | "bevel"` (default miter = today). It is an
  attribute, not a node type; every backend implements it (SVG, canvas, PDF `j`, PowerPoint `a:round`/`a:bevel`/`a:miter`),
  `validate` and `tools/dlcheck.mjs` check it.
* **Notices (fixes LIC-1 for every runtime dependency, not only the icons):** `tools/notices.mjs` writes
  `THIRD-PARTY-NOTICES.txt` from the licence files of the page's runtime dependencies in `node_modules`, the vendored
  `LICENSE-*` files, HarfBuzz's COPYING and the Apache-2.0 text (harfbuzzjs's Apache parts; IronCalc is MIT or
  Apache-2.0 – both texts shipped, the MIT one chosen) (added to the repository); `tools/make_release.py` puts it in ROOT_FILES and
  REQUIRED; ⚙ Options › *About › Licences* shows it; a test fails when a runtime dependency has no entry.
* Page-size budget, in bytes (09 §7.4): a test fails above the current limit – M13 today's 3,916,092 + 60,000, raised
  in M14 and M15 by the measured chart code and icon set (expected total ≤ 4,700,000), each change recorded in PROGRESS.

## Consequences
+ Every icon works offline, on every PC, in every export (paths, not fonts or pictures), editable in PowerPoint.
+ Opening a deck costs nothing until an icon or the picker is needed (first use ≤ 150 ms budget).
+ A renamed icon in a later Tabler keeps its picture through the alias table; an unknown name draws "info" and is
  named in the Issues panel (today's fallback is silent).
− The page grows by ≈ 0.6 MB (the parse cost of one more string in the worker bundle; measured in S15.1).
− Brand icons (376) show trademarks; the MIT licence covers the drawings, not the marks – the picker labels the
  category "Brands (trademarks of their owners)".
− A Tabler update is a deliberate vendor step (new version, new hash, the CHANGELOG names it); no automatic update.

## Alternatives
Load the SVG files at run time from the helper (needs the package on the share and a route; slower; rejected); an icon
font (text, not shapes, in PDF and PowerPoint; rejected); only a curated subset (the owner asked for the full set; the
whole set costs ≈ 0.6 MB, kept); another set (Lucide ISC ≈ 1,600 icons; Material Symbols Apache-2.0, larger) – the owner
named Tabler.
