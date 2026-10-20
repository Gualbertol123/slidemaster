/* ⏱ S9.2 · a chart's display list (docs/next/07 §6.4, PLAN Part F): a 12-slice pie with labels, leaders and a legend
   built in under 5 ms – its data read from the sheet (every run a new key, so nothing comes from the cache), the slices,
   labels, legend and hits, in Liquid Glass (the glass card) and in Excel. Median of 20 after 3 untimed builds; the limit
   scales with this machine's speed like the other benches (tools/calibrate.mjs). The text is measured by a fixed rule
   here (the page measures it on screen, batched with the slide's other text). */
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
import type { RenderCtx } from "../src/render/context";
import type { ChartItem, Design, Op } from "../src/model/types";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHART_MS = 5;
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: t => [t],
};

it("chart: a 12-slice pie builds in under 5 ms (Liquid Glass and Excel)", async () => {
  const speed = speedFactor();
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks/report.xlsx"));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/decks/report.json"), "utf8")) as { ops: Op[] };
  const view = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  // twelve banks of SLIDE_1 (D6:D18 less the hidden row 9), their names on the left, small ones among them (leaders)
  const pie: ChartItem = { kind: "chart", type: "pie", values: { table: "dhnms9c", range: "D6:D18" }, show: ["label", "percent"], legend: "right", box: { x: 900, y: 200, w: 640, h: 480 } };
  /** both designs, median of 20 each; `pass` makes each run's data key new again (nothing from the cache) */
  const measure = (pass: number) => {
    const ms: Record<string, number> = {};
    for (const design of ["glass", "excel"] as Design[]) {
      const style = resolveStyle({}, { ...view.style, design });
      const ctx: RenderCtx = { style, edits: {}, slides: runtimeSlides(wb, view.preset, "W.xlsx", design), preset: view.preset, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
      const env = { V: glassVars(ctx), wall: design === "glass" ? { blurId: "wb", blurSrc: "data:" } : null, family: "Segoe UI" };
      const times: number[] = [];
      for (let run = 0; run < 23; run++) {
        const it = { ...pie, series: `Loans ${pass ? pass + "." : ""}${run}` };   // a new data key: read from the sheet every time
        const t0 = performance.now(); const r = chartNodes(it, "c1", it.box, ctx, M, env); const t = performance.now() - t0;
        expect(r.issue).toBeNull();
        if (run >= 3) times.push(t);
      }
      ms[design + "_ms"] = median(times);
    }
    return ms;
  };
  // on CI a design over its limit is measured again and fails only if over twice (tools/benchgate.mjs)
  const limit = CHART_MS * speed.factor;
  const { gates, bad } = await judge({ limits: { glass_ms: limit, excel_ms: limit }, first: measure(0), again: () => measure(1), strict: true });
  const report = gates.map(g => `${g.key.replace("_ms", "")} ${describe(g)}`).join(", ");
  console.log(`bench · chart (pie, 12 slices): ${gates.map(g => `${g.key.replace("_ms", "")} ${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${CHART_MS} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `chart: ${report} (+ 10 %)`).toEqual([]);
}, 60_000);
