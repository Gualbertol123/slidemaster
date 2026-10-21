/* The chart panel's changes in the PowerPoint export (S14.5; the owner's rule of 2026-10-21: every new feature works in the
   PowerPoint export too): a pie of report.xlsx turned into a combo by the panel alone – a second series from another
   sheet as a line on the right axis, a third with targets, a point's colour, a hidden legend entry, the legend on top,
   axis bounds, a category group, an arrow and a text mark – exported by the core's writer: native chart groups (bar +
   line on two axes), the point's c:dPt, the legend entry deleted, the fixed bounds, the marks as plain shapes over the
   chart (their native arrowheads are S14.6's); no picture, no connector shape, no external link. CHART_PPTX_OUT=<folder> writes the file (pptxcheck runs on it). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { readWorkbook } from "@slide-builder/core/xlsx/workbook";
import { applyOps, emptyDoc } from "@slide-builder/core/model/ops";
import { runtimeSlides } from "@slide-builder/core/model/preset";
import { resolveStyle } from "@slide-builder/core/model/style";
import { excelToDisplayList, type Metrics } from "@slide-builder/core/render/excel-dl";
import { slideToDisplayList } from "@slide-builder/core/render/slide-dl";
import { computeLayout } from "@slide-builder/core/render/layout";
import { writePptx } from "@slide-builder/core/pptx/writer";
import type { SlideSem } from "@slide-builder/core/pptx/scene";
import { pptxFamily } from "@slide-builder/core/text/resolve";
import { wrapLines } from "@slide-builder/core/text/lines";
import { validate } from "@slide-builder/core/dl/types";
import type { RenderCtx } from "@slide-builder/core/render/context";
import type { ChartItem, Design, ItemPatch, Op } from "@slide-builder/core/model/types";
import { addGroupPatch, addMarkPatch, addSeriesPatch, axisPatch, labelsPatch, legendHidePatch, pointPatch, refPatch, seriesPatch, typePatch } from "../src/editor/chart-panel";

const here = path.dirname(fileURLToPath(import.meta.url));
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

/** the chart as the panel makes it, step by step (each step one item.patch, as the page sends it) */
function panelOps(): Op[] {
  let it: ChartItem = { kind: "chart", type: "pie", values: { sheet: "SLIDE_1", range: "D6:D8" }, labels: { sheet: "SLIDE_1", range: "C6:C8" }, series: "Loans", box: { x: 120, y: 160, w: 1300, h: 640 },
    colors: { 2: "#2E75B6" } };                                                // a slice's own colour: the point's after the switch (review 6)
  const ops: Op[] = [{ op: "item.patch", slide: "x", id: "c", patch: it } as Op];
  const step = (p: ItemPatch | null) => {
    expect(p).not.toBeNull();
    ops.push({ op: "item.patch", slide: "x", id: "c", patch: p } as Op);
    it = (applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: { sheets: [], tables: [], slides: [{ id: "x", type: "content", tables: [] }] } } as Op, ...ops]).doc.preset!.slides[0].items!.c) as ChartItem;
  };
  /** a new series' id (random since the S14.5 review: two writers adding at once keep both) */
  const added = (p: ItemPatch) => { step(p); return Object.keys(p.sers!)[0]; };
  step(typePatch(it, "combo"));
  const s2 = added(addSeriesPatch(it, { sheet: "SLIDE_1", range: "F6:F8" }));   // Deposits (combo: a line)
  step(seriesPatch(it, s2, { axis: "y2", name: "Deposits", smooth: true }));
  const s3 = added(addSeriesPatch(it, { sheet: "Numbers", range: "B9:B11" }));  // another sheet
  step(seriesPatch(it, s3, { type: "column", name: "Other" }));
  step(refPatch(it, { what: "target", ser: "s1" }, { sheet: "SLIDE_1", range: "F6:F8" }));
  step(labelsPatch(it, "s1", { show: ["ofTarget"], pos: "inEnd" }));
  step(pointPatch(it, "s1", 0, { color: "#A6A6A6" }));
  step(legendHidePatch(s3, true));
  step({ legendAt: "top" });
  step(axisPatch(it, "y", { min: 0, num: "#,##0" }));
  step(addGroupPatch(it, { sheet: "SLIDE_1", range: "C9:C10" }));
  step(addMarkPatch(it, "arrow", { s: s2, i: 1 }, 3));
  step(addMarkPatch(it, "text", { s: "s1", i: 2 }));
  return ops;
}

describe("the panel's chart in the PowerPoint export (S14.5)", () => {
  for (const design of ["excel", "glass", "mckinsey"] as Design[]) it(`${design}: native bar + line groups on two axes, its point colour, the hidden entry, marks as plain shapes; no picture, connector or link`, async () => {
    const b = fs.readFileSync(path.join(here, "fixtures/report.xlsx")), wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), [{ op: "preset.set", preset: { sheets: ["SLIDE_1", "Numbers"], tables: [], slides: [{ id: "x", type: "content", title: "Panel chart", tables: [] }] } } as Op, ...panelOps()]);
    expect(skipped).toEqual([]);
    const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
    const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
    const lists = slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
    const info = lists[0].items.c;
    expect(validate(lists[0].nodes)).toEqual([]);
    expect(info.issue).toBeNull();
    expect(info.pptx?.kind).toBe("chart");
    const bytes = writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: { type: "content" as const, items: Object.fromEntries(Object.entries(l.items).flatMap(([id, x]) => x.pptx ? [[id, x.pptx]] : [])), palette: [] } as SlideSem })), image: () => PNG, face: css => pptxFamily(css) });
    const z = unzipSync(bytes), charts = Object.keys(z).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts).toHaveLength(1);
    const x = strFromU8(z[charts[0]]);
    expect(x).toContain("<c:barChart>");
    expect(x).toContain("<c:lineChart>");
    expect(x.match(/<c:valAx>/g)).toHaveLength(2);                                  // the right axis for Deposits
    expect(x).toContain('<c:legendPos val="t"/>');
    expect(x).toMatch(/<c:legendEntry><c:idx val="\d+"\/><c:delete val="1"\/><\/c:legendEntry>/);
    expect(x).toMatch(/<c:dPt><c:idx val="0"\/>.*A6A6A6/);
    expect(x).toMatch(/<c:dPt><c:idx val="2"\/>.*2E75B6/);
    expect(x).toContain('<c:min val="0"/>');
    expect(x).toContain('<c:smooth val="1"/>');
    expect(x).not.toMatch(/<c:f>[^<]*[[\]]/);
    const slide = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(n => strFromU8(z[n])).join("");
    expect(slide).not.toContain("<p:cxnSp");
    expect(slide).not.toContain("<p:pic");
    // the marks over the chart: plain shapes – the text mark's text box (native arrowheads on the arrow: S14.6)
    expect(slide).toContain("<a:t>Note</a:t>");
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
    if (process.env.CHART_PPTX_OUT) fs.writeFileSync(path.join(process.env.CHART_PPTX_OUT, `panel-${design}.pptx`), bytes);
  });
});
