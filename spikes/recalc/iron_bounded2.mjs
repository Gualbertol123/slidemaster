import { readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { readWorkbook, buildIron } = await import("./eval_lib.mjs");
const mod = await import("@ironcalc/wasm"); mod.initSync({ module: readFileSync(join(here, "node_modules/@ironcalc/wasm/wasm_bg.wasm")) });
const now = () => performance.now();
for (const file of ["BanksBig.xlsx", "Banks.xlsx"]) for (const mode of ["whole columns", "all whole-column refs bounded", "bounded, without Control!B8"]) {
  const book = readWorkbook(join(here, "..", "..", "tests", "corpus", "workbooks", "recalc", file)); const data = book.sheets.find(s => s.name === "Data");
  if (mode !== "whole columns") for (const s of book.sheets) for (const c of s.cells.values()) if (c.f) c.f = c.f.replace(/Data!(\$?)([A-Z])\:(\$?)([A-Z])/g, (_, d1, a, d2, b) => `Data!${d1}${a}$1:${d2}${b}$${data.maxRow}`);
  if (mode.endsWith("B8")) book.sheets.find(s => s.name === "Control").cells.set("8,2", { row: 8, col: 2, t: "n", v: 46300, f: null });
  const t0 = now(); const m = buildIron(mod, book); const t1 = now(); m.evaluate(); const t2 = now();
  const ci = book.sheets.findIndex(s => s.name === "Control"); const times = [];
  for (const bank of ["Bank B", "Bank C", "Bank D", "Bank E", "Bank F", "Bank G", "Bank H", "Bank I", "Bank J", "Bank A"]) { const a = now(); m.setUserInput(ci, 2, 2, bank); m.evaluate(); times.push(Math.round((now() - a) * 10) / 10); }
  // the per-value read of every formula cell (what the product does after a recalculation)
  const a = now(); let n = 0; book.sheets.forEach((s, i) => { for (const c of s.cells.values()) if (c.f) { m.getFormattedCellValue(i, c.row, c.col); n++; } }); const tr = now() - a;
  console.log(`${file} · ${mode}: build ${Math.round(t1 - t0)} ms, first evaluate ${Math.round(t2 - t1)} ms, per value ${times.join(" ")} ms, read ${n} cells ${Math.round(tr)} ms`);
}
