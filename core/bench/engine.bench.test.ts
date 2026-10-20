/* ⏱ S7.2 / S7.4 · the formula engine (docs/next/07 §6.4, PLAN Part F): first use – instantiate the WASM, build the model
   of the 20-sheet recalc deck (BanksBig.xlsx: 1,259 formulas, 520 data rows) and run the self-check, the first time
   ever in this process (the loader's code is cold) – under 300 ms (07 §6.4 said 200 ms with a warm model in mind; the
   cold first build measured 225–235 ms at reference speed, the warm one 85–100 ms; recorded in PROGRESS S7.4);
   one scenario value (set the command cell, evaluate, read every formula cell back) under 150 ms. Median of 5 after a
   warm-up; the time limits scale with this machine's speed like the other benches (tools/calibrate.mjs). On CI a time
   over its limit is measured again – in a fresh process, so the first use is cold again – and fails only if over twice
   (tools/benchgate.mjs, decision 2026-10-20). */
import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine } from "../src/calc/engine";
// the inlined WASM module is part of the page's bundle (parsed with it); here its import is a vitest transform of
// a 1 MB string literal (≈ 150 ms), so it happens before the clock starts
import "../src/calc/wasm/ironcalc-wasm";
import "../src/calc/wasm/ironcalc-glue";
import { MAX_FACTOR, speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";
import { CI_FACTOR_FILE, engineCalibrationMs, engineFactor } from "./wasmcalib";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "../../tests/corpus/workbooks/recalc/BanksBig.xlsx");
const FIRST_USE_MS = 300, VALUE_MS = 150;
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
/** set in the process that measures again (below): it measures, leaves its numbers in this file and gates nothing */
const REPEAT_FILE = process.env.SB_BENCH_REPEAT;

it("engine: first use under 300 ms (cold), one scenario value under 150 ms (BanksBig)", async () => {
  const speed = REPEAT_FILE ? { ms: 0, factor: 1 } : speedFactor();
  if (!REPEAT_FILE) console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limit × ${speed.factor.toFixed(2)}`);
  const wb = await readWorkbook(fs.readFileSync(FILE).buffer.slice(0) as ArrayBuffer);
  const t0 = performance.now(); const g = await loadEngine(); const wasmMs = performance.now() - t0;
  const builds: number[] = [], values: number[] = [];
  for (let run = 0; run < 6; run++) {
    const t1 = performance.now();
    const model = new CalcModel(g, [{ name: null, sheets: wb.sheets, externals: [] }]); model.selfCheck();
    const build = performance.now() - t1;
    const t2 = performance.now(); model.set(null, "Control", 2, 2, "Bank " + "BCDEFG"[run]); model.evaluate(); model.values(); const value = performance.now() - t2;
    builds.push(build); if (run) values.push(value);
    model.dispose();
  }
  // the first use is the cold one: the WASM, then the first model ever built (the JIT is cold too)
  const first = wasmMs + builds[0], value = median(values);
  console.log(`bench · engine${REPEAT_FILE ? " (repeat, a fresh process)" : ""}: WASM ${wasmMs.toFixed(0)} ms + first model and self-check ${builds[0].toFixed(0)} ms = first use ${first.toFixed(0)} ms (warm models ${median(builds.slice(1)).toFixed(0)} ms); one value ${value.toFixed(1)} ms (median of 5)`);
  if (REPEAT_FILE) { fs.writeFileSync(REPEAT_FILE, JSON.stringify({ first_use_ms: first, value_ms: value })); return; }
  // on CI the limits also follow how fast the runner runs the engine (decision 2026-10-18; measured after the timed
  // builds, so the first use stays cold); elsewhere the JS calibration alone, as before
  if (process.env.GITHUB_ACTIONS) {
    const ms = engineCalibrationMs(g), ef = engineFactor(ms);
    speed.factor = Math.min(MAX_FACTOR, Math.max(speed.factor, ef));
    console.log(`bench · CI: engine calibration ${ms.toFixed(1)} ms (reference 64): factor ${ef.toFixed(2)}; time limits × ${speed.factor.toFixed(2)}`);
    fs.writeFileSync(CI_FACTOR_FILE, JSON.stringify({ engine_ms: +ms.toFixed(1), factor: +speed.factor.toFixed(2) }));
  }
  const limits = { first_use_ms: FIRST_USE_MS * speed.factor, value_ms: VALUE_MS * speed.factor };
  const { gates, bad } = await judge({ limits, first: { first_use_ms: first, value_ms: value }, strict: true, again: () => measureAgain() });
  const report = gates.map(x => `${x.key} ${describe(x)}`).join("; ");
  console.log(`bench · engine: ${report} (limits ${FIRST_USE_MS} and ${VALUE_MS} ms × ${speed.factor.toFixed(2)})`);
  expect(bad, report).toEqual([]);
}, 240_000);

/** this bench once more in a fresh process (a cold engine, as the first time): its first use and one value */
function measureAgain(): Record<string, number> {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sb-bench-engine-")), "repeat.json");
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
  const r = spawnSync(process.execPath, [cli, "run", "--config", "vitest.bench.config.ts", "--silent=false", "bench/engine.bench.test.ts"],
    { cwd: path.join(here, ".."), env: { ...process.env, SB_BENCH_REPEAT: out }, encoding: "utf8", timeout: 120_000 });
  for (const line of (r.stdout || "").split("\n")) if (line.startsWith("bench · ")) console.log(line);
  try { return JSON.parse(fs.readFileSync(out, "utf8")); }
  catch {                                                                        // not measured: over (benchgate)
    console.log(`bench · engine: the repeat measured nothing (exit ${r.status}${r.error ? ", " + r.error.message : ""}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-8).join(" | ")}`);
    return {};
  }
  finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
}
