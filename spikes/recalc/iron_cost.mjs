import { readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { readWorkbook, buildIron } = await import("./eval_lib.mjs");
const mod = await import("@ironcalc/wasm"); mod.initSync({ module: readFileSync(join(here, "node_modules/@ironcalc/wasm/wasm_bg.wasm")) });
const now = () => performance.now();
const variants = { all: () => true, "no rows 11-13 (RANK, SUMPRODUCT, lookups, text, OFFSET, INDIRECT, dynamic arrays)": c => c.row < 11 || c.row > 13, "no row 11 (RANK, SUMPRODUCT, VLOOKUP)": c => c.row !== 11, "no row 12 (CHOOSE, TEXT, OFFSET, INDIRECT, AVERAGEIF…)": c => c.row !== 12, "no row 13 (XLOOKUP, IFS, SWITCH, LET, FILTER, LARGE, SMALL)": c => c.row !== 13, "only rows 5-7 (SUMIFS, deltas, totals)": c => c.row >= 5 && c.row <= 7 };
for (const [name, keep] of Object.entries(variants)) {
  const book = readWorkbook(join(here, "..", "..", "tests", "corpus", "workbooks", "recalc", "BanksBig.xlsx")); let n = 0;
  for (const s of book.sheets) if (s.name.startsWith("SLIDE_")) for (const [k, c] of [...s.cells]) { if (c.f && !keep(c)) s.cells.delete(k); else if (c.f) n++; }
  const m = buildIron(mod, book); const t1 = now(); m.evaluate(); const t2 = now();
  const ci = book.sheets.findIndex(s => s.name === "Control"); const times = [];
  for (const bank of ["Bank B", "Bank C", "Bank D"]) { const a = now(); m.setUserInput(ci, 2, 2, bank); m.evaluate(); times.push(Math.round((now() - a))); }
  console.log(`${name}: ${n} slide formulas, first evaluate ${Math.round(t2 - t1)} ms, per value ${times.join(" ")} ms`);
}
