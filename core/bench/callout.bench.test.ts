/* ⏱ S9.4 · a callout's display list (docs/next/07 §6.4, PLAN Part F): a speech bubble quoting two cells, its shape and its
   text laid out by the text-box renderer (fitted from 18 px), built in under 2 ms – measured as the slide with the
   callout less the same slide without it (a slide of no tables: the title and subtitle only), in Liquid Glass and
   Excel. Median of 20 after 3 untimed builds; the limit scales with this machine's speed (tools/calibrate.mjs). */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { applyOps, emptyDoc } from "../src/model/ops";
import { runtimeSlides } from "../src/model/preset";
import { resolveStyle } from "../src/model/style";
import { slideToDisplayList } from "../src/render/slide-dl";
import type { Metrics } from "../src/render/excel-dl";
import type { RenderCtx } from "../src/render/context";
import type { Design, Op, RuntimeSlide } from "../src/model/types";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CALLOUT_MS = 2;
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const M: Metrics = {
  run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
  lines: t => [t],
};

it("callout: a bubble quoting two cells builds in under 2 ms (Liquid Glass and Excel)", async () => {
  const speed = speedFactor();
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks/report.xlsx"));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/decks/report.json"), "utf8")) as { ops: Op[] };
  const base = applyOps(emptyDoc("W.xlsx"), [...d.ops, { op: "slide.patch", id: "u9t3fqb", patch: { title: "Callout" } } as Op]).doc;
  /** both designs, median of 20 each */
  const measure = () => {
    const ms: Record<string, number> = {};
    for (const design of ["glass", "excel"] as Design[]) {
      const style = resolveStyle({}, { ...base.style, design });
      const ctx: RenderCtx = { style, edits: {}, slides: runtimeSlides(wb, base.preset, "W.xlsx", design), preset: base.preset, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
      // the slide without its tables (the furniture alone), with and without the callout
      const R0: RuntimeSlide = { ...ctx.slides[0], tables: [], cfg: { ...ctx.slides[0].cfg, tables: [] } };
      const withItem = (run: number): RuntimeSlide => ({ ...R0, cfg: { ...R0.cfg, items: { k: { kind: "shape", shape: "bubble", text: `Loans ${run}: {SLIDE_1!D6} · deposits {SLIDE_1!F6}`, fmt: { b: true }, box: { x: 600, y: 300, w: 380, h: 140 }, tail: { x: 560, y: 520 } } } } });
      const img = { wall: null, logo: null }, times: number[] = [];
      for (let run = 0; run < 23; run++) {
        const R1 = withItem(run);
        const t0 = performance.now(); slideToDisplayList(R0, 0, ctx, [], [], img, M, "1 October 2026"); const bare = performance.now() - t0;
        const t1 = performance.now(); const dl = slideToDisplayList(R1, 0, ctx, [], [], img, M, "1 October 2026"); const full = performance.now() - t1;
        expect(dl.items.k.issue).toBeNull();
        if (run >= 3) times.push(Math.max(0, full - bare));
      }
      ms[design + "_ms"] = median(times);
    }
    return ms;
  };
  // on CI a design over its limit is measured again and fails only if over twice (tools/benchgate.mjs)
  const limit = CALLOUT_MS * speed.factor;
  const { gates, bad } = await judge({ limits: { glass_ms: limit, excel_ms: limit }, first: measure(), again: () => measure(), strict: true });
  const report = gates.map(g => `${g.key.replace("_ms", "")} ${describe(g)}`).join(", ");
  console.log(`bench · callout (bubble, two cells): ${gates.map(g => `${g.key.replace("_ms", "")} ${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${CALLOUT_MS} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `callout: ${report} (+ 10 %)`).toEqual([]);
}, 60_000);
