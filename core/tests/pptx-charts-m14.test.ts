/* M14 S14.6 (PX-05, PX-06; 09 §4.2): M14's chart corpus (tests/corpus/charts/: charts, lines, scatter-waterfall,
   series) as PowerPoint files, in every design, through the core's own writer – the structure export-check's PowerPoint pass gates, checked here without a
   browser:
   * every chart a native chart whose chart groups are the ones the core writes (tools/real-charts.mjs: "bar+line",
     "scatter", "pie" …), as many as the slide's chart items;
   * the caches equal the embedded workbook's cells (Edit Data), each cell with its number format (a point's own where it
     has one), every formula inside the embedded workbook (no file named, no external relationship);
   * the arrow and line marks plain line shapes with native ends (a:headEnd / a:tailEnd), never p:cxnSp, never a picture;
   * the same bytes again.
   CHART_PPTX_OUT=<folder> writes each file with its expectation for pptxcheck (`expect.json`: --expect, the real objects
   and chart kinds) and for PX-06 on Windows (`<file>.plots.json`: `pptxcheck.py plots`, the plot and axis bounds each
   chart must have in PowerPoint). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { excelToDisplayList, type Metrics } from "../src/render/excel-dl";
import { slideToDisplayList, type SlideDL } from "../src/render/slide-dl";
import { computeLayout } from "../src/render/layout";
import { writePptx } from "../src/pptx/writer";
import type { ChartSem } from "../src/pptx/chart-sem";
import type { SlideSem } from "../src/pptx/scene";
import { pptxFamily } from "../src/text/resolve";
import { DESIGNS } from "../src/model/designs";
import { wrapLines } from "../src/text/lines";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op } from "../src/model/types";
import { realObjectsOf } from "../../tools/real-objects.mjs";
import { chartKindsOf, withChartKinds } from "../../tools/real-charts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOKS = path.join(here, "../../tests/corpus/workbooks"), CHARTS = path.join(here, "../../tests/corpus/charts");
// (S14.6 review 1: M14's four chart decks by name – the folder also holds other milestones' decks, M15's icons among
// them, that have no chart items)
const DECKS = ["charts", "lines", "scatter-waterfall", "series"];
const OUT = process.env.CHART_PPTX_OUT;
const ab = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: (t, font, width) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return wrapLines(t, width, s => [...s].length * size * .5); },
};
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function deck(id: string, design: Design, more: Op[] = []) {
  const d = JSON.parse(fs.readFileSync(path.join(CHARTS, id + ".json"), "utf8")) as { workbook: string; ops: Op[] };
  const wb = await readWorkbook(ab(path.join(BOOKS, d.workbook)));
  const { doc: view, skipped } = applyOps(emptyDoc("W.xlsx"), [...d.ops, ...more]);
  expect(skipped).toEqual([]);
  const style = resolveStyle({}, { ...view.style, design }), slides = runtimeSlides(wb, view.preset, "W.xlsx", design);
  const ctx: RenderCtx = { style, edits: {}, slides, preset: view.preset || null, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null, forExport: true };
  return slides.map((R, i) => slideToDisplayList(R, i, ctx, R.tables.map(L => excelToDisplayList(L, ctx, M)), computeLayout(R, ctx).boxes, { wall: null, logo: null }, M, "1 October 2026", { sem: true }));
}
const semOf = (l: SlideDL): SlideSem => ({ type: "content", items: Object.fromEntries(Object.entries(l.items).flatMap(([id, it]) => it.pptx ? [[id, it.pptx]] : [])), palette: [] });
const pptxOf = (lists: SlideDL[]) => writePptx({ slides: lists.map(l => ({ nodes: l.nodes, sem: semOf(l) })), image: () => PNG, face: css => pptxFamily(css) });
const chartsOf = (l: SlideDL): ChartSem[] => Object.values(l.items).flatMap(it => it.pptx?.kind === "chart" ? [it.pptx.chart] : []);
/** a zip part's relationships: id → target, resolved against the part's folder */
function rels(z: Record<string, Uint8Array>, part: string): Map<string, string> {
  const dir = path.posix.dirname(part), r = z[`${dir}/_rels/${path.posix.basename(part)}.rels`], out = new Map<string, string>();
  if (r) for (const m of strFromU8(r).matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) out.set(m[1], path.posix.normalize(path.posix.join(dir, m[2])));
  return out;
}
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** an embedded workbook's cells: ref → {v, s} and its number formats by style index */
function book(x: Uint8Array) {
  const b = unzipSync(x), sheet = strFromU8(b["xl/worksheets/sheet1.xml"]), styles = strFromU8(b["xl/styles.xml"]);
  const cells = new Map<string, { v: string; s: number }>();
  for (const m of sheet.matchAll(/<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="[^"]*")?>(?:<f>.*?<\/f>)?(?:<v>(.*?)<\/v>)?/g)) cells.set(m[1], { v: m[3] ?? "", s: +(m[2] || 0) });
  const fmts = new Map<number, string>([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)].map(m => [+m[1], unesc(m[2])]));
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(styles)?.[1] ?? "").matchAll(/<xf numFmtId="(\d+)"/g)].map(m => +m[1]);
  return { cells, fmt: (s: number) => xfs[s] ? fmts.get(xfs[s]) ?? "?" : "General" };
}
const PLOT = { barChart: "bar", lineChart: "line", areaChart: "area", scatterChart: "scatter", pieChart: "pie", doughnutChart: "doughnut" } as Record<string, string>;
const expectAll: Record<string, unknown> = {};

describe("the chart corpus as PowerPoint files (S14.6, PX-05 / PX-06)", () => {
  for (const id of DECKS) for (const design of DESIGNS) it(`${id} · ${design}: native charts of the core's kinds, caches = the embedded cells with their formats, native arrow ends, no connector / picture / link`, async () => {
    const lists = await deck(id, design), bytes = pptxOf(lists), z = unzipSync(bytes);
    const want = chartKindsOf(lists.map(l => ({ sem: semOf(l) })));
    let ends = 0, wantEnds = 0, cells = 0, styled = 0;
    const slides = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +/\d+/.exec(a)![0] - +/\d+/.exec(b)![0]);
    expect(slides).toHaveLength(lists.length);
    slides.forEach((n, i) => {
      const s = strFromU8(z[n]), R = rels(z, n), sems = chartsOf(lists[i]);
      expect(s, n).not.toContain("<p:cxnSp");
      // the chart parts of the slide (in frame order), their chart groups
      const parts = [...s.matchAll(/<c:chart [^>]*r:id="([^"]+)"/g)].map(m => R.get(m[1])!);
      expect(parts.length, n).toBe(sems.length);
      const kinds = parts.map(p => [...strFromU8(z[p]).matchAll(/<c:(barChart|lineChart|areaChart|scatterChart|pieChart|doughnutChart)>/g)].map(m => PLOT[m[1]]).join("+")).sort();
      expect(kinds, n).toEqual(want.find(w => w.slide === i + 1)?.kinds ?? []);
      for (const p of parts) {
        const x = strFromU8(z[p]), wbPart = [...rels(z, p).values()].find(t => t.endsWith(".xlsx"))!;
        expect(x).not.toContain("cx:");
        for (const f of x.matchAll(/<c:f>([^<]*)<\/c:f>/g)) expect(f[1]).toMatch(/^Sheet1!\$[A-Z]+\$\d+(:\$[A-Z]+\$\d+)?$/);
        const B = book(z[wbPart]);
        // every cached number is its cell's, and the cell carries the cache's format (a point's own over the series')
        for (const m of x.matchAll(/<c:numRef><c:f>Sheet1!\$([A-Z]+)\$(\d+)(?::\$[A-Z]+\$\d+)?<\/c:f><c:numCache><c:formatCode>([^<]*)<\/c:formatCode><c:ptCount val="\d+"\/>(.*?)<\/c:numCache>/g)) {
          for (const pt of m[4].matchAll(/<c:pt idx="(\d+)"(?: formatCode="([^"]*)")?><c:v>([^<]*)<\/c:v><\/c:pt>/g)) {
            const ref = m[1] + (+m[2] + +pt[1]), c = B.cells.get(ref);
            expect(c, `${p} ${ref}`).toBeDefined();
            expect(+c!.v, `${p} ${ref}`).toBeCloseTo(+pt[3], 9);
            expect(B.fmt(c!.s), `${p} ${ref}`).toBe(unesc(pt[2] ?? m[3]));
            cells++; if (c!.s) styled++;
          }
        }
      }
      ends += (s.match(/<a:headEnd /g) || []).length + (s.match(/<a:tailEnd /g) || []).length;
      for (const ch of sems) for (const a of ch.arrows || []) wantEnds += (a.head ? 1 : 0) + (a.tail ? 1 : 0);
      // an arrow shape is a plain line (prst line), never a connector; its ends on its own a:ln
      for (const m of s.matchAll(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Arrow \d+"\/>.*?<\/p:sp>/g)) expect(m[0]).toMatch(/<a:prstGeom prst="line">.*<a:(head|tail)End type="(triangle|arrow|stealth|oval|diamond)"/);
      // (review 5: what `pptxcheck.py plots` reads back from PowerPoint – each line shape's ends from its box and flips –
      // are the marks' ends, in the marks' order; 1 px = 7 620 EMU)
      const lines = [...s.matchAll(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="(?:Arrow|Line) \d+"\/>.*?<a:xfrm( flipH="1")?( flipV="1")?><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)].map(m => {
        const [x, y, w, h] = [m[3], m[4], m[5], m[6]].map(v => +v / 7620);
        return { a: { x: m[1] ? x + w : x, y: m[2] ? y + h : y }, b: { x: m[1] ? x : x + w, y: m[2] ? y : y + h } };
      });
      const marks = sems.flatMap(ch => ch.arrows || []);
      expect(lines.length, n).toBe(marks.length);
      marks.forEach((w, k) => { for (const e of ["a", "b"] as const) { expect(Math.abs(lines[k][e].x - w[e].x), `${n} mark ${k} ${e}`).toBeLessThanOrEqual(.01); expect(Math.abs(lines[k][e].y - w[e].y), `${n} mark ${k} ${e}`).toBeLessThanOrEqual(.01); } });
    });
    expect(ends).toBe(wantEnds);
    expect(cells).toBeGreaterThan(10);
    if (id === "lines") { expect(ends).toBeGreaterThanOrEqual(2); expect(styled).toBeGreaterThan(0); }
    console.log(`${id} · ${design}: ${cells} cached values = cells (${styled} with a number format), ${ends} native ends`);
    expect(Object.keys(z).some(n => n.endsWith(".rels") && /TargetMode="External"/.test(strFromU8(z[n])))).toBe(false);
    expect(Buffer.from(pptxOf(lists)).equals(Buffer.from(bytes))).toBe(true);
    if (OUT) {
      const file = path.join(OUT, `${id}-${design}.pptx`);
      fs.writeFileSync(file, bytes);
      expectAll[file] = withChartKinds(realObjectsOf(lists.map(l => ({ dl: { nodes: l.nodes }, sem: semOf(l) }))), want);
      fs.writeFileSync(path.join(OUT, "expect.json"), JSON.stringify(expectAll, null, 1));
      // PX-06: the plot and the value axes PowerPoint must have for each series chart (the marks stand on them)
      const plots = lists.flatMap((l, i) => chartsOf(l).flatMap(ch => ch.bars ? [{ slide: i + 1, frame: ch.box, plot: ch.bars.plot, val: { min: ch.bars.val.min, max: ch.bars.val.max },
        ...(ch.bars.val2 ? { val2: { min: ch.bars.val2.min, max: ch.bars.val2.max } } : {}), arrows: (ch.arrows || []).map(a => ({ a: a.a, b: a.b, head: a.head, tail: a.tail })) }] : []));
      fs.writeFileSync(file.replace(/\.pptx$/, ".plots.json"), JSON.stringify(plots, null, 1));
    }
  });
  it("the corpus has every chart type of PX-05: column, bar, line, area, scatter, combo on two axes, waterfall – and arrows with native ends", async () => {
    const all = (await Promise.all(DECKS.map(id => deck(id, "excel")))).flat().flatMap(chartsOf);
    const types = new Set(all.map(c => c.type));
    for (const t of ["pie", "donut", "column", "bar", "line", "area", "scatter", "combo", "waterfall"]) expect(types, t).toContain(t);
    expect(all.some(c => c.bars?.val2)).toBe(true);
    expect(all.flatMap(c => c.arrows || []).filter(a => a.head || a.tail).length).toBeGreaterThanOrEqual(3);
  });
  it("the arrows stack as on the slide (review 6): a text mark of a later id over an arrow, of an earlier id under it; a limiter's bar tick over its line", async () => {
    const marks = {
      aa: { kind: "text", text: "EARLY", a: { s: "vol", i: 2 }, dy: -40 },
      zz: { kind: "text", text: "LATE", a: { s: "vol", i: 2 }, dy: -60 },
      zy: { kind: "line", a: { s: "vol", i: 1 }, b: { s: "vol", i: 3 }, style: { heads: { a: "bar", b: "diamond" } } },
    };
    const lists = await deck("lines", "excel", [{ op: "item.patch", slide: "r0", id: "ref", patch: { marks } } as unknown as Op]);
    const s = strFromU8(unzipSync(pptxOf(lists))["ppt/slides/slide1.xml"]);
    const grp = /<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="Chart ref \d+"\/>.*?<p:graphicFrame>.*$/.exec(s)![0];
    // the shapes over the native chart, in document order (later = on top): their names and texts
    const seq = [...grp.matchAll(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="([^"]+)"\/>(.*?)<\/p:sp>/g)].map(m => /<a:t>(EARLY|LATE)<\/a:t>/.exec(m[2])?.[1] ?? m[1].replace(/ \d+$/, ""));
    const at = (x: string) => seq.indexOf(x);
    // marks in id order: aa (EARLY), ia, ib (icons), start (arrow), ta, tb (texts), zy (line, bar tick, diamond), zz (LATE)
    expect(at("EARLY")).toBeGreaterThanOrEqual(0);
    expect(at("EARLY")).toBeLessThan(at("Arrow"));
    expect(seq.lastIndexOf("Arrow")).toBeLessThan(at("LATE"));
    expect(at("LATE")).toBe(seq.length - 1);
    // the first arrow ("start") under the later texts ta / tb: some shape between it and the zy line
    const arrows = seq.flatMap((x, i) => x === "Arrow" ? [i] : []);
    expect(arrows).toHaveLength(2);
    expect(arrows[1] - arrows[0]).toBeGreaterThan(1);
    // zy's bar tick (a shape of the overlay) right after its line, under LATE
    expect(arrows[1] + 1).toBeLessThan(at("LATE"));
    // a chart without arrows: one walk of its overlay, as before (the ids of the other charts unchanged is the bytes test)
  });
  it("every head PowerPoint has natively: both ends, sizes, a dashed line; a limiter's bar stays a shape beside the line (it has no native end)", async () => {
    const marks = {
      zz1: { kind: "line", a: { s: "vol", i: 0 }, b: { s: "vol", i: 2 }, style: { color: "#C00000", w: 2, dash: "dashed", heads: { a: "oval", b: "stealth", size: "l" } } },
      zz2: { kind: "line", a: { s: "vol", i: 1 }, b: { s: "vol", i: 3 }, style: { heads: { a: "bar", b: "diamond", size: "s" } } },
      zz3: { kind: "arrow", a: { s: "vol", i: 3 }, b: "ceiling", style: { heads: { a: "arrow" } } },
    };
    const lists = await deck("lines", "excel", [{ op: "item.patch", slide: "r0", id: "ref", patch: { marks } } as unknown as Op]);
    const info = Object.values(lists[0].items).find(it => it.pptx?.kind === "chart")!;
    if (info.pptx?.kind !== "chart") throw new Error();
    const A = info.pptx.chart.arrows!;
    expect(A.map(a => [a.head, a.tail, a.size])).toEqual([[ "triangle", undefined, undefined ], ["oval", "stealth", "l"], [undefined, "diamond", "s"], ["arrow", undefined, undefined]]);
    // the slide (not the export) still draws every head itself; the export's overlay keeps only the bar's tick
    const over = info.pptx.overlay!.filter(n => n.t === "path" && n.stroke && !n.fill);
    expect(over.length).toBeGreaterThanOrEqual(1);
    const s = strFromU8(unzipSync(pptxOf(lists))["ppt/slides/slide1.xml"]);
    expect(s).toMatch(/<a:custDash>.*?<\/a:custDash><a:headEnd type="oval" w="lg" len="lg"\/><a:tailEnd type="stealth" w="lg" len="lg"\/><\/a:ln>/);
    expect(s).toMatch(/<a:ln w="11430"[^>]*>(?:(?!<\/a:ln>).)*<a:tailEnd type="diamond" w="sm" len="sm"\/><\/a:ln>/);
    expect(s).toContain('<a:headEnd type="arrow" w="med" len="med"/>');
    expect(s).not.toContain('type="bar"');
    expect(s).not.toContain("<p:cxnSp");
    // the arrows' ends are exactly the marks' points (the line not shortened under a head: PowerPoint draws its own)
    const b = A[1];
    expect(Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y)).toBeGreaterThan(10);
  });
});
