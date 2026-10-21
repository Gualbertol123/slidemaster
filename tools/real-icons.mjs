/* The icons each slide of a PowerPoint export must hold (4.8, M15 S15.2; 09 §4.3), for pptxcheck (6) check_icons: as many
   as the core's own export draws as Tabler icons – the PowerPoint semantics of a shape item with `icon` (pptx/scene.ts
   iconEls writes each as one custom-geometry shape, or one group, named "Icon"). A built-in icon and a name the set does
   not have (drawn as the built-in "info") stay the built-in shape and are not counted. M15's own file beside
   tools/real-objects.mjs (M14-M15-split §2: the icon block apart from the tables and charts). */

/** [{slide (1-based, in the file's order), icons}] for the slides that hold any, from the core's PowerPoint lists.
    Self-contained: its source is what the page runs (pageIcons) */
export function iconsOf(lists) {
  return lists.map((l, i) => ({ slide: i + 1, icons: Object.values((l.sem && l.sem.items) || {}).filter(x => x && x.kind === "shape" && x.icon).length }))
    .filter(e => e.icons);
}
/** the script page.evaluate runs in the page (after load): the current deck's icons in `design` (as pageRealObjects) */
export const pageIcons = design => `(async () => (${iconsOf})(await window.__sbTest.slideLists(${JSON.stringify({ design, version: "", forExport: true, thumb: false, pptx: true })})))()`;
/** the icons merged into realObjectsOf's entries (pptxcheck --expect: {slide, tables, charts, icons}); `real` is changed
    and returned */
export function withIcons(real, icons) {
  for (const e of icons) {
    const r = real.find(x => x.slide === e.slide);
    if (r) r.icons = e.icons; else real.push({ slide: e.slide, tables: 0, charts: 0, icons: e.icons });
  }
  return real.sort((a, b) => a.slide - b.slide);
}

/* ---- the lines (4.8, M15 S15.3; 09 §4.3, LN-03), for pptxcheck (7) check_lines: as many as the core's export draws –
   a line item with its geometry (pptx/scene.ts lineEls writes each as one shape, or one group, named "Line") ---- */
/** [{slide, lines}] for the slides that hold any, from the core's PowerPoint lists. Self-contained (pageLines runs it) */
export function linesOf(lists) {
  return lists.map((l, i) => ({ slide: i + 1, lines: Object.values((l.sem && l.sem.items) || {}).filter(x => x && x.kind === "line" && x.line).length }))
    .filter(e => e.lines);
}
/** the script page.evaluate runs in the page: the current deck's lines in `design` */
export const pageLines = design => `(async () => (${linesOf})(await window.__sbTest.slideLists(${JSON.stringify({ design, version: "", forExport: true, thumb: false, pptx: true })})))()`;
/** the lines merged into the expectation's entries ({slide, tables, charts, icons?, lines}); `real` is changed and returned */
export function withLines(real, lines) {
  for (const e of lines) {
    const r = real.find(x => x.slide === e.slide);
    if (r) r.lines = e.lines; else real.push({ slide: e.slide, tables: 0, charts: 0, lines: e.lines });
  }
  return real.sort((a, b) => a.slide - b.slide);
}
