/* How fast this machine runs the formula engine against the reference PC (decision 2026-10-18, for CI only): GitHub's
   runners run IronCalc's WASM 1.3–1.7× slower than the reference PC while the JS calibration (tools/calibrate.mjs)
   finds them about as fast, so the engine's first use passed or failed there by chance (351 ms vs a limit of 348 on a
   commit that measures 214 ms here). The workload is IronCalc alone – a fixed synthetic model built and evaluated,
   none of Slide Builder's code – so a slower Slide Builder cannot loosen its own limit. Median of 5 after a warm-up.
   On CI the engine's limits are scaled by the larger of this factor and the JS one, at most MAX_FACTOR as those; the
   factor is written to CI_FACTOR_FILE for the page bench (tools/bench.mjs), which runs after this one. On any other
   machine nothing changes: the budgets gate as before. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { loadEngine } from "../src/calc/engine";
import { MAX_FACTOR } from "../../tools/calibrate.mjs";

/** the workload's median on the reference PC (the machine in PROGRESS.md's measurements): 62.4–81 ms over twelve runs
    on 2026-10-18 with the PC busy (its JS calibration 33–54 ms against 32), the quiet runs 62–65 */
export const ENGINE_REFERENCE_MS = 64;
/** where the CI factor is left for the page bench (not committed) */
export const CI_FACTOR_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../bench-calibration.json");
/** how much slower this machine runs the engine than the reference PC (1 … MAX_FACTOR) */
export const engineFactor = (ms: number) => Math.min(MAX_FACTOR, Math.max(1, ms / ENGINE_REFERENCE_MS));

type Glue = Awaited<ReturnType<typeof loadEngine>>;
function workload(g: Glue) {
  const m = new g.Model("sb", "en", "UTC", "en");
  try {
    m.pauseEvaluation();                                            // (each input would evaluate the model otherwise)
    for (let r = 1; r <= 1500; r++) {
      m.setUserInput(0, r, 1, String((r * 7919) % 1009));
      m.setUserInput(0, r, 2, r === 1 ? "=A1" : `=B${r - 1}+A${r}*2`);
      m.setUserInput(0, r, 3, `=IF(MOD(A${r},3)=0,"x"&A${r},ROUND(A${r}/7,2))`);
      if (r % 50 === 0) m.setUserInput(0, r, 4, `=SUMIF(C$1:C${r},">10",A$1:A${r})+VLOOKUP(A${r},A$1:B${r},2,FALSE)`);
    }
    m.resumeEvaluation();
    m.evaluate();
  } finally { m.free(); }
}
/** the workload's median time here, in ms */
export function engineCalibrationMs(g: Glue): number {
  workload(g);
  const t: number[] = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); workload(g); t.push(performance.now() - t0); }
  return t.sort((a, b) => a - b)[2];
}
