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
// S14.3: the reference chart (09 §3.3) ≤ 5 ms; a line chart of 12 series × 52 points ≤ 10 ms
it.skip("chart: the reference chart (09 §3.3) builds in under 5 ms (S14.3; skipped until introduced)", () => undefined);
it.skip("chart: a line chart of 12 series × 52 points builds in under 10 ms (S14.3; skipped until introduced)", () => undefined);
// S14.6: the reference chart's PowerPoint semantics + chart XML ≤ 10 ms
it.skip("chart: the reference chart's PowerPoint semantics and XML in under 10 ms (S14.6; skipped until introduced)", () => undefined);
