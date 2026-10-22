/* The native chart types each slide of a PowerPoint export must hold (M14, S14.6; 09 §4.2, PX-05): beside
   tools/real-objects.mjs's counts, per slide the chart groups of each native chart as the core's own export writes them
   (pptx/chart.ts: the plot area's c:barChart / c:lineChart / c:areaChart / c:scatterChart in order; a pie's
   c:pieChart, a donut's c:doughnutChart) – "bar+line" for a combo or a waterfall's construction, "scatter", "pie" …
   pptxcheck (5) compares them with python-pptx's plots of each chart (BarPlot, LinePlot, AreaPlot, XyPlot, PiePlot,
   DoughnutPlot), sorted per slide. Self-contained, as realObjectsOf: the page runs its own source. */

/** per slide (1-based, as realObjectsOf numbers them) its charts' kinds, sorted: [{slide, kinds}] for slides with charts */
export function chartKindsOf(lists) {
  const kind = c => { const ch = (c && c.chart) || {}; if (!ch.bars) return ch.type === "donut" ? "doughnut" : "pie"; const g = ch.bars.groups; return g && g.length ? g.map(x => x.kind).join("+") : "bar"; };
  return lists.map((l, i) => ({ slide: i + 1, kinds: Object.values((l.sem && l.sem.items) || {}).filter(x => x && x.kind === "chart").map(kind).sort() }))
    .filter(e => e.kinds.length);
}
/** the page's script: the current deck's kinds in `design` (the lists realObjectsOf reads) */
export const pageChartKinds = design => `(async () => (${chartKindsOf})(await window.__sbTest.slideLists(${JSON.stringify({ design, version: "", forExport: true, thumb: false, pptx: true })})))()`;
/** realObjectsOf's expectation with each slide's chart kinds added (pptxcheck --expect) */
export function withChartKinds(real, kinds) {
  for (const k of kinds) { const e = real.find(x => x.slide === k.slide); if (e) e.kinds = k.kinds; }
  return real;
}
