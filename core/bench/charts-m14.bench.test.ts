/* ⏱ M14's budgets of docs/next/09 §7.4 (S14.P: listed here, skipped until the step that introduces each measures it).
   M14 owns this file: each step replaces its `it.skip` with the measurement (median of 20 after 3 untimed, the limit
   scaled by tools/calibrate.mjs, judged by tools/benchgate.mjs – as chart.bench.test.ts's pie gate). */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { chartNodes } from "../src/render/chart-dl";
import { glassVars } from "../src/render/glass-dl";
import type { Metrics } from "../src/render/excel-dl";
import type { Node } from "../src/dl/types";
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import type { Sheet } from "../src/xlsx/types";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const count = (l: Node[]): number => l.reduce((s, n) => s + 1 + (n.t === "group" ? count(n.children) : 0), 0);
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: t => [t],
};

// S14.2: a column chart, 12 categories × 4 series – its display list ≤ 5 ms
const COLUMN_MS = 5;
it("chart: a column chart of 12 categories × 4 series builds in under 5 ms (Liquid Glass and Excel)", async () => {
  const speed = speedFactor();
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks/report.xlsx"));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/decks/report.json"), "utf8")) as { ops: Op[] };
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  // the twelve banks of SLIDE_1 (D6:D18 less the hidden row 9) × Loans, Δ, Deposits, Δ – each series from its own column,
  // value labels on two of them, the legend at the bottom
  const col = (c: string, labels: boolean) => ({ vals: [{ table: "dhnms9c", range: `${c}6:${c}18` }], ...(labels ? { labels: { show: ["value" as const] } } : {}) });
  const chart: ChartItem = { kind: "chart", type: "column", values: { table: "dhnms9c", range: "D6:D18" }, legendAt: "bottom", box: { x: 400, y: 200, w: 1100, h: 560 },
    sers: { a: { n: 1, ...col("D", true) }, b: { n: 2, ...col("E", false) }, c: { n: 3, ...col("F", true) }, d: { n: 4, ...col("G", false) } } };
  /** both designs, median of 20 each; `pass` makes each run's data key new again (nothing from the caches) */
  const measure = (pass: number) => {
    const ms: Record<string, number> = {};
    for (const design of ["glass", "excel"] as Design[]) {
      const style = resolveStyle({}, { ...view.style, design });
      const ctx: RenderCtx = { style, edits: {}, slides: runtimeSlides(wb, view.preset, "W.xlsx", design), preset: view.preset, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
      const env = { V: glassVars(ctx), wall: design === "glass" ? { blurId: "wb", blurSrc: "data:" } : null, family: "Segoe UI" };
      const times: number[] = [];
      for (let run = 0; run < 23; run++) {
        const it: ChartItem = { ...chart, sers: { ...chart.sers!, a: { ...chart.sers!.a, name: `Loans ${pass}.${run}` } } };
        const t0 = performance.now(); const r = chartNodes(it, "c1", it.box, ctx, M, env); const t = performance.now() - t0;
        expect(r.issue).toBeNull();
        if (run === 0) expect(count(r.nodes)).toBeGreaterThan(48);            // the 48 bars and their hits at least
        if (run >= 3) times.push(t);
      }
      ms[design + "_ms"] = median(times);
    }
    return ms;
  };
  // on CI a design over its limit is measured again and fails only if over twice (tools/benchgate.mjs)
  const limit = COLUMN_MS * speed.factor;
  const { gates, bad } = await judge({ limits: { glass_ms: limit, excel_ms: limit }, first: measure(0), again: () => measure(1), strict: true });
  const report = gates.map(g => `${g.key.replace("_ms", "")} ${describe(g)}`).join(", ");
  console.log(`bench · chart (column, 12 × 4): ${gates.map(g => `${g.key.replace("_ms", "")} ${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${COLUMN_MS} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `chart column: ${report} (+ 10 %)`).toEqual([]);
}, 60_000);
// S14.3: the reference chart (09 §3.3) ≤ 5 ms; a line chart of 12 series × 52 points ≤ 10 ms – the chart corpus's lines
// deck (tests/corpus/charts/lines.json, its workbook loans-weekly.xlsx)
const REF_MS = 5, LINES_MS = 10;
async function linesDeck() {
  const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/charts/lines.json"), "utf8")) as { workbook: string; ops: Op[] };
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks", d.workbook));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const item = (id: string) => view.preset!.slides.flatMap(s => Object.entries(s.items || {})).find(([k]) => k === id)![1] as ChartItem;
  const ctxOf = (design: Design, sheet?: (n: string) => Sheet | null): RenderCtx => ({ style: resolveStyle({}, { ...view.style, design }), edits: {}, slides: runtimeSlides(wb, view.preset, "W.xlsx", design), preset: view.preset,
    workbook: "W.xlsx", logoSrc: "", sheet: sheet || (n => wb.sheets.find(s => s.name === n) || null), version: null });
  return { wb, item, ctxOf };
}
/** a chart measured in both designs: median of 20 after 3 untimed; `vary` makes each run's item new (no cache) */
async function gate(name: string, limitMs: number, minNodes: number, build: (design: Design) => { ctx: RenderCtx; it: (run: number, pass: number) => ChartItem }) {
  const speed = speedFactor();
  const measure = (pass: number) => {
    const ms: Record<string, number> = {};
    for (const design of ["glass", "excel"] as Design[]) {
      const { ctx, it: mk } = build(design);
      const env = { V: glassVars(ctx), wall: design === "glass" ? { blurId: "wb", blurSrc: "data:" } : null, family: "Segoe UI" };
      const times: number[] = [];
      for (let run = 0; run < 23; run++) {
        const it = mk(run, pass);
        const t0 = performance.now(); const r = chartNodes(it, "c1", it.box, ctx, M, env); const t = performance.now() - t0;
        expect(r.issue).toBeNull();
        if (run === 0) expect(count(r.nodes)).toBeGreaterThan(minNodes);
        if (run >= 3) times.push(t);
      }
      ms[design + "_ms"] = median(times);
    }
    return ms;
  };
  const limit = limitMs * speed.factor;
  const { gates, bad } = await judge({ limits: { glass_ms: limit, excel_ms: limit }, first: measure(0), again: () => measure(1), strict: true });
  const report = gates.map(g => `${g.key.replace("_ms", "")} ${describe(g)}`).join(", ");
  console.log(`bench · chart (${name}): ${gates.map(g => `${g.key.replace("_ms", "")} ${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${limitMs} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `chart ${name}: ${report} (+ 10 %)`).toEqual([]);
}
it("chart: the reference chart (09 §3.3) builds in under 5 ms (Liquid Glass and Excel)", async () => {
  const { item, ctxOf } = await linesDeck(), ref = item("ref");
  // (a new series name each run: its data is resolved again, nothing comes from the caches)
  await gate("the reference chart", REF_MS, 40, design => ({ ctx: ctxOf(design), it: (run, pass) => ({ ...ref, sers: { ...ref.sers!, vol: { ...ref.sers!.vol, name: `Loans ${pass}.${run}` } } }) }));
}, 60_000);
it("chart: a line chart of 12 series × 52 points builds in under 10 ms (Liquid Glass and Excel)", async () => {
  const { wb, ctxOf } = await linesDeck();
  // 12 series of 52 weeks: a sheet of the workbook's shape (Gallery) with 12 rows × 52 columns of numbers, week names above
  const G = wb.sheets.find(s => s.name === "Gallery")!, big = Object.create(G) as Sheet;
  big.get = (r: number, c: number) => r === 1 && c >= 2 && c <= 53 ? { ...G.get(1, 2)!, v: `W${c - 1}`, t: "s" } : r >= 2 && r <= 13 && c >= 2 && c <= 53 ? { ...G.get(2, 2)!, v: 300 + 40 * Math.sin(r + c / 5) + 10 * r, t: "n" } : r >= 2 && r <= 13 && c === 1 ? { ...G.get(2, 1)!, v: `Series ${r - 1}`, t: "s" } : G.get(r, c);
  const vals = (r: number) => [{ sheet: "Gallery", range: `B${r}:BA${r}` }];
  const sers = Object.fromEntries(Array.from({ length: 12 }, (_, k) => [`s${k}`, { n: k + 1, vals: vals(k + 2), smooth: k % 2 === 0, marker: k < 4 ? { shape: "circle" as const } : undefined }]));
  const chart: ChartItem = { kind: "chart", type: "line", values: vals(2)[0], legendAt: "right", box: { x: 100, y: 150, w: 1400, h: 650 }, sers };
  await gate("line, 12 × 52", LINES_MS, 12 * 52, design => ({ ctx: ctxOf(design, n => n === "Gallery" ? big : null),
    it: (run, pass) => ({ ...chart, sers: { ...sers, s0: { ...sers.s0, name: `Series ${pass}.${run}` } } }) }));
}, 60_000);
// S14.6: the reference chart's PowerPoint semantics + chart XML ≤ 10 ms
it.skip("chart: the reference chart's PowerPoint semantics and XML in under 10 ms (S14.6; skipped until introduced)", () => undefined);
