/* ⏱ M15's budgets of docs/next/09 §7.4 (S14.P: listed here, skipped until the step that introduces each measures it).
   M15 owns this file: each step replaces its `it.skip` with the measurement (median of 20 after 3 untimed, the limit
   scaled by tools/calibrate.mjs, judged by tools/benchgate.mjs – as chart.bench.test.ts's pie gate). */
import { it } from "vitest";

// S15.2: the icon set's first use in the worker, cold (inflate + parse the index) ≤ 150 ms
it.skip("icons: the set's first use (inflate + index) in under 150 ms (S15.2; skipped until introduced)", () => undefined);
// S15.3: 20 lines with heads and labels – their display list ≤ 3 ms
it.skip("lines: 20 lines with heads and labels build in under 3 ms (S15.3; skipped until introduced)", () => undefined);
// S15.4: snapping, the core's part per drag frame with 60 objects ≤ 1 ms
it.skip("snapping: one drag frame with 60 objects in under 1 ms (S15.4; skipped until introduced)", () => undefined);
