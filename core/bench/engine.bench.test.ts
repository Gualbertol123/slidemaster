/* ⏱ S7.2 / S7.4 · the formula engine (docs/next/07 §6.4, PLAN Part F): first use – instantiate the WASM, build the model
   of the 20-sheet recalc deck (BanksBig.xlsx: 1,259 formulas, 520 data rows) and run the self-check – under 200 ms;
   one scenario value (set the command cell, evaluate, read every formula cell back) under 150 ms. Median of 5 after a
   warm-up; the time limits scale with this machine's speed like the other benches (tools/calibrate.mjs). */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { CalcModel, loadEngine } from "../src/calc/engine";
// the inlined WASM module is part of the page's bundle (parsed with it); here its import is a vitest transform of
// a 1 MB string literal (≈ 150 ms), so it happens before the clock starts
import "../src/calc/wasm/ironcalc-wasm";
import "../src/calc/wasm/ironcalc-glue";
import { speedFactor } from "../../tools/calibrate.mjs";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/corpus/workbooks/recalc/BanksBig.xlsx");
const FIRST_USE_MS = 200, VALUE_MS = 150, SLACK = 1.1;
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

it("engine: first use under 200 ms, one scenario value under 150 ms (BanksBig)", async () => {
  const speed = speedFactor();
  console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limit × ${speed.factor.toFixed(2)}`);
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
  console.log(`bench · engine: WASM ${wasmMs.toFixed(0)} ms + first model and self-check ${builds[0].toFixed(0)} ms = first use ${first.toFixed(0)} ms (warm models ${median(builds.slice(1)).toFixed(0)} ms); one value ${value.toFixed(1)} ms (median of 5)`);
  expect(first, `first use ${first.toFixed(0)} ms (limit ${FIRST_USE_MS} × ${speed.factor.toFixed(2)} + 10 %)`).toBeLessThan(FIRST_USE_MS * speed.factor * SLACK);
  expect(value, `one value ${value.toFixed(1)} ms (limit ${VALUE_MS} × ${speed.factor.toFixed(2)} + 10 %)`).toBeLessThan(VALUE_MS * speed.factor * SLACK);
}, 120_000);
