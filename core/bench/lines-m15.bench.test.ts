/* ⏱ M15's budgets of docs/next/09 §7.4 (S14.P: listed here, skipped until the step that introduces each measures it).
   M15 owns this file: each step replaces its `it.skip` with the measurement (median of 20 after 3 untimed, the limit
   scaled by tools/calibrate.mjs, judged by tools/benchgate.mjs – as chart.bench.test.ts's pie gate). */
import { expect, it } from "vitest";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";
import { Tabler, tabler, tablerLoaded } from "../src/icons";
import { TABLER } from "../src/icons/data";
import { decode64 } from "../src/text/hb";
import { iconSearch } from "../src/render/icon-search";
import { resizeMarks, snapEdge, snapMove, snapTargets, snapTol } from "../src/render/snap";
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
import type { Design, Heads as LineHeads, Item, LineItem, Op, RuntimeSlide } from "../src/model/types";

const here = path.dirname(fileURLToPath(import.meta.url));

const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * .95) - 1)];

// S15.2: the icon set's first use in the worker, cold (inflate + parse the index) ≤ 150 ms; the picker's keystroke, the
// core's part (search + the first screen's 120 tiles as path data, in the worker) – p95 well inside the 50 ms keypress
// budget, which tools/bench.mjs gates in Chromium from the key to the tiles drawn
const FIRST_MS = 150, KEY_MS = 50;
it("icons: the set's first use (inflate + index) in under 150 ms, cold; the picker's search + 120 tiles per keystroke, p95 under 50 ms (S15.2)", async () => {
  const speed = speedFactor();
  // the process's first use: nothing has inflated the set yet (tests/setup-icons.ts only registers it)
  expect(tablerLoaded()).toBe(false);
  const t0 = performance.now(); tabler(); const cold = performance.now() - t0;
  /** a fresh inflate + index (the repeat on CI: not cold any more, as close as one process gets) */
  const fresh = () => { const t = performance.now(); new Tabler(decode64(TABLER)); return performance.now() - t; };
  /** typing two queries a key at a time, with the category and set switches between them (each answer as the picker asks it) */
  const keys = () => {
    const ms: number[] = [];
    for (const [q, style, category] of [["building bank", "outline", null], ["arrow up right", "outline", "Arrows"], ["star", "filled", null], ["chart pie", "outline", null]] as const)
      for (let k = 1; k <= q.length; k++) { const t = performance.now(); iconSearch({ query: q.slice(0, k), style, category, draw: 120, also: ["tabler:target", "tabler-filled:star"] }); ms.push(performance.now() - t); }
    return ms;
  };
  keys();                                                                       // warm (the decoded icons are cached as in the worker)
  const measure = () => { const k = keys(); return { first_use_ms: fresh(), key_p95_ms: p95(k), key_median: median(k) }; };
  const m = measure();
  const first = { first_use_ms: cold, key_p95_ms: m.key_p95_ms };
  const { gates, bad } = await judge({ limits: { first_use_ms: FIRST_MS * speed.factor, key_p95_ms: KEY_MS * speed.factor }, first, again: () => measure(), strict: true });
  console.log(`bench · icons: first use (cold) ${cold.toFixed(1)} ms, again ${m.first_use_ms.toFixed(1)} ms (limit ${FIRST_MS} ms × ${speed.factor.toFixed(2)}); keystroke search + 120 tiles p95 ${m.key_p95_ms.toFixed(2)} ms, median ${m.key_median.toFixed(2)} ms (limit ${KEY_MS} ms)`);
  expect(bad, gates.map(g => `${g.key} ${describe(g)}`).join(", ")).toEqual([]);
});
// S15.3: 20 lines with heads and labels – their display list ≤ 3 ms: the slide with them less the same slide without
// them (its furniture alone), in Liquid Glass and Excel; every route, filled / open / bar heads, a label on each, five
// of them attached to an item (their ends resolved), median of 20 after 3 untimed
const LINES_MS = 3;
it("lines: 20 lines with heads and labels build in under 3 ms (S15.3; Liquid Glass and Excel)", async () => {
  const speed = speedFactor();
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks/report.xlsx"));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const d = JSON.parse(fs.readFileSync(path.join(here, "../../tests/corpus/decks/report.json"), "utf8")) as { ops: Op[] };
  const base = applyOps(emptyDoc("W.xlsx"), d.ops).doc;
  const M: Metrics = {
    run: (t, font) => { const size = parseFloat(/([\d.]+)px/.exec(font)![1]); return { w: [...t].length * size * .5, asc: size * .8, desc: size * .2 }; },
    lines: t => [t],
  };
  const ROUTES: LineItem["route"][] = ["straight", "elbow", "curve", "bracket", "range"], HEADS: LineHeads[] = [{ b: "triangle" }, { a: "oval", b: "stealth" }, { b: "arrow" }, { a: "bar", b: "bar" }, { a: "diamond", b: "triangle", size: "l" }];
  const lines = (run: number): Record<string, Item> => {
    const out: Record<string, Item> = { k: { kind: "shape", shape: "icon", icon: "target", box: { x: 760, y: 420, w: 64, h: 64 } } };
    for (let i = 0; i < 20; i++) {
      const a = { x: 80 + (i % 5) * 300, y: 120 + Math.floor(i / 5) * 180 }, bb = { x: a.x + 220, y: a.y + 90 };
      out["l" + i] = { kind: "line", route: ROUTES[i % 5], a, b: bb, mid: i % 5 === 1 ? .4 : i % 5 === 2 ? 40 : i % 5 === 3 ? 18 : undefined, style: { w: 1 + (i % 4) * .5, heads: HEADS[i % 5], ...(i % 3 ? {} : { dash: "dashed" }) },
        ...(i % 4 === 0 ? { ends: { b: { to: "i:k", at: "t" } } } : {}), text: `Δ ${run + i} %`, box: { x: a.x - 1, y: a.y - 1, w: 222, h: 92 } } as LineItem;
    }
    return out;
  };
  const measure = () => {
    const ms: Record<string, number> = {};
    for (const design of ["glass", "excel"] as Design[]) {
      const style = resolveStyle({}, { ...base.style, design });
      const ctx: RenderCtx = { style, edits: {}, slides: runtimeSlides(wb, base.preset, "W.xlsx", design), preset: base.preset, workbook: "W.xlsx", logoSrc: "", sheet: n => wb.sheets.find(s => s.name === n) || null, version: null };
      const R0: RuntimeSlide = { ...ctx.slides[0], tables: [], cfg: { ...ctx.slides[0].cfg, tables: [], items: { k: lines(0).k } } };
      const img = { wall: null, logo: null }, times: number[] = [];
      for (let run = 0; run < 23; run++) {
        const R1: RuntimeSlide = { ...R0, cfg: { ...R0.cfg, items: lines(run) } };
        const t0 = performance.now(); slideToDisplayList(R0, 0, ctx, [], [], img, M, "1 October 2026", { sem: true }); const bare = performance.now() - t0;
        const t1 = performance.now(); const dl = slideToDisplayList(R1, 0, ctx, [], [], img, M, "1 October 2026", { sem: true }); const full = performance.now() - t1;
        expect(Object.keys(dl.items)).toHaveLength(21);
        if (run >= 3) times.push(Math.max(0, full - bare));
      }
      ms[design + "_ms"] = median(times);
    }
    return ms;
  };
  const limit = LINES_MS * speed.factor;
  const { gates, bad } = await judge({ limits: { glass_ms: limit, excel_ms: limit }, first: measure(), again: () => measure(), strict: true });
  const report = gates.map(g => `${g.key.replace("_ms", "")} ${describe(g)}`).join(", ");
  console.log(`bench · lines (20 with heads and labels, 5 attached): ${gates.map(g => `${g.key.replace("_ms", "")} ${g.first.toFixed(2)} ms`).join(", ")} (median of 20; limit ${LINES_MS} ms × ${speed.factor.toFixed(2)})${gates.some(g => "repeat" in g) ? " · " + report : ""}`);
  expect(bad, `lines: ${report} (+ 10 %)`).toEqual([]);
});
// S15.4: snapping, the core's part per drag frame with 60 objects ≤ 1 ms (09 §7.4): a busy slide – 44 boxes (text
// boxes, charts, shapes) in rows and columns, 2 tables with 12 columns and 30 rows each (their boxes and cell borders),
// 14 lines (their ends and middles) – the targets collected once at pointer-down (reported, not gated: the pointer-down
// is not a frame), then a move of 24 frames (edges, centres, equal spacing, the marks) and a resize of 24 (an edge with
// equal size, the marks); per frame the slower of the two, median of 20 drags after 3 untimed. The drag frame as a whole
// (16 ms) is tools/bench.mjs's snap_drag_frame_ms, in Chromium
const SNAP_MS = 1;
it("snapping: one drag frame with 60 objects in under 1 ms (S15.4; the core's part)", async () => {
  const speed = speedFactor();
  const boxes = Array.from({ length: 44 }, (_, i) => ({ x: 60 + (i % 11) * 136, y: 90 + Math.floor(i / 11) * 190, w: 96 + (i % 3) * 8, h: 60 + (i % 4) * 10 }));
  const tables = [{ x: 60, y: 120, w: 700, h: 600 }, { x: 820, y: 120, w: 700, h: 600 }];
  const cells = tables.map(t => ({ x: Array.from({ length: 12 }, (_, k) => t.x + (k + 1) * t.w / 12), y: Array.from({ length: 30 }, (_, k) => t.y + (k + 1) * t.h / 30) }));
  const points = Array.from({ length: 14 }, (_, i) => [{ x: 100 + i * 100, y: 780 }, { x: 160 + i * 100, y: 840 }, { x: 130 + i * 100, y: 810 }]).flat();
  let collect = 0;
  const run = () => {
    const t0 = performance.now(), T = snapTargets({ boxes: [...boxes, ...tables], cells, points, top: 120 }); collect = performance.now() - t0;
    let worst = 0, n = 0;
    for (let f = 0; f < 24; f++) {
      const t = performance.now();
      const m = snapMove(T, { x: 300 + f * 13.3, y: 200 + f * 7.1, w: 120, h: 70 }, snapTol(.6));
      const w = 120 + f * 9.7, d = snapEdge(T, true, 300 + w, snapTol(.6), { now: w, sign: 1 });
      const r = resizeMarks(T, { x: 300, y: 200, w: w + d, h: 70 }, { x: ["r"] }, { w: true });
      n += m.marks.guides.length + r.guides.length;
      worst = Math.max(worst, performance.now() - t);
    }
    return { worst, n };
  };
  for (let k = 0; k < 3; k++) run();
  const measure = () => { const w: number[] = []; for (let k = 0; k < 20; k++) w.push(run().worst); return { frame_ms: median(w) }; };
  const first = measure();
  expect(run().n).toBeGreaterThan(0);                                       // it snaps (the marks are there)
  const { gates, bad } = await judge({ limits: { frame_ms: SNAP_MS * speed.factor }, first, again: () => measure(), strict: true });
  console.log(`bench · snapping (60 objects, ${snapTargets({ boxes: [...boxes, ...tables], cells, points }).x.length} x targets): a drag frame's core part ${first.frame_ms.toFixed(3)} ms (median of 20 drags' slowest frame; limit ${SNAP_MS} ms × ${speed.factor.toFixed(2)}); targets collected in ${collect.toFixed(3)} ms`);
  expect(bad, gates.map(g => `${g.key} ${describe(g)}`).join(", ")).toEqual([]);
});
