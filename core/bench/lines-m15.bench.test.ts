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
// S15.3: 20 lines with heads and labels – their display list ≤ 3 ms
it.skip("lines: 20 lines with heads and labels build in under 3 ms (S15.3; skipped until introduced)", () => undefined);
// S15.4: snapping, the core's part per drag frame with 60 objects ≤ 1 ms
it.skip("snapping: one drag frame with 60 objects in under 1 ms (S15.4; skipped until introduced)", () => undefined);
