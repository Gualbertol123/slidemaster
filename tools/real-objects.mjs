/* What each slide of a PowerPoint export must hold as real objects (S14.P gate; AUDIT-2 VER-3, PX-02 / PX-03, 09 §7.2),
   for pptxcheck (5): as many real tables (a:tbl, python-pptx has_table) and native charts (has_chart) as the core's own
   export draws – never a picture of either.

   The counts come from the core, not from the deck's JSON (S14.P review, 1): the export's display lists as the PowerPoint
   writer gets them (slideLists with `pptx`, forExport), so what the core leaves out is left out here too –
   * a table whose sheet is not in the workbook (tests/corpus/decks/missing-table.json: slide 2 lists only a table of a
     deleted sheet, so nothing is exported for it);
   * the design's hidden slides (4.6, B47: an export skips them, so slide n of the file is the n-th shown slide);
   * slides and tables added with slide.add / table.add, removed with slide.remove / table.remove (4.6), and anything
     else the folded document holds that a preset.set alone does not say.
   A table is a "tw" hit followed by its group (as pptx/scene.ts reads it), a chart a chart member of the slide's
   PowerPoint semantics (`sem.items`). */

/** the expectation from the core's PowerPoint lists: [{slide (1-based, in the file's order), tables, charts}] for the
    slides that hold any. Self-contained: its source is what the page runs (pageRealObjects) */
export function realObjectsOf(lists) {
  const tables = ns => { let n = 0; for (let k = 0; k < ns.length; k++) { const x = ns[k]; if (x && x.t === "hit" && x.id === "tw" && ns[k + 1] && ns[k + 1].t === "group") { n++; k++; } else if (x && x.t === "group") n += tables(x.children || []); } return n; };
  return lists.map((l, i) => ({ slide: i + 1, tables: tables(l.dl.nodes), charts: Object.values((l.sem && l.sem.items) || {}).filter(x => x && x.kind === "chart").length }))
    .filter(e => e.tables || e.charts);
}
/** the script page.evaluate runs in the page (after load): the current deck's expectation in `design`, the version shown
    ("") – realObjectsOf's own source over the core's lists, so the page and the unit test run the same code */
export const pageRealObjects = design => `(async () => (${realObjectsOf})(await window.__sbTest.slideLists(${JSON.stringify({ design, version: "", forExport: true, thumb: false, pptx: true })})))()`;
