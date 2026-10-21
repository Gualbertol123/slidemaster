/* ⏱ M14's budgets of docs/next/09 §7.4 (S14.P: listed here, skipped until the step that introduces each measures it).
   M14 owns this file: each step replaces its `it.skip` with the measurement (median of 20 after 3 untimed, the limit
   scaled by tools/calibrate.mjs, judged by tools/benchgate.mjs – as chart.bench.test.ts's pie gate). */
import { it } from "vitest";

// S14.2: a column chart, 12 categories × 4 series – its display list ≤ 5 ms
it.skip("chart: a column chart of 12 categories × 4 series builds in under 5 ms (S14.2; skipped until introduced)", () => undefined);
// S14.3: the reference chart (09 §3.3) ≤ 5 ms; a line chart of 12 series × 52 points ≤ 10 ms
it.skip("chart: the reference chart (09 §3.3) builds in under 5 ms (S14.3; skipped until introduced)", () => undefined);
it.skip("chart: a line chart of 12 series × 52 points builds in under 10 ms (S14.3; skipped until introduced)", () => undefined);
// S14.6: the reference chart's PowerPoint semantics + chart XML ≤ 10 ms
it.skip("chart: the reference chart's PowerPoint semantics and XML in under 10 ms (S14.6; skipped until introduced)", () => undefined);
