/* ⏱ S16.1 · hidden rows per slide (B36, M16 plan): a table rebuilt with 10 rows hidden on its slide takes at most the
   table's own build + 10 % (the hidden set is the same closing-up path as Excel's hidden rows: no second layout pass).
   A range table of report.xlsx's SLIDE_1 over 400 rows × 9 columns, laid out through resolveTable with the layout cache
   emptied each time; median of 40 after 8 untimed builds, the two in turn; judged by tools/benchgate.mjs (the limit
   is the same machine's own build, so no speed scaling). */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../src/xlsx/workbook";
import { LCACHE, resolveTable } from "../src/model/preset";
import { slideHidden } from "../src/model/hidden";
import type { TableDef } from "../src/model/types";
import { describe, judge } from "../../tools/benchgate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

it("hidden rows: a table rebuilt with 10 rows hidden takes at most its own build + 10 %", async () => {
  const b = fs.readFileSync(path.join(here, "../../tests/corpus/workbooks/report.xlsx"));
  const wb = await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const def: TableDef = { id: "tb", sheet: "SLIDE_1", kind: "range", range: "B3:J402" } as TableDef;
  const hidden = Object.fromEntries([6, 7, 12, 20, 33, 50, 81, 140, 222, 390].map(r => ["tb:r" + r, true])) as Record<string, true>;
  const measure = () => {
    const own: number[] = [], hid: number[] = [];
    const gc = (globalThis as { gc?: () => void }).gc;
    const time = (h: boolean) => {
      LCACHE.clear(); gc?.();
      const t0 = performance.now(); const L = resolveTable(wb, def, "excel", h ? slideHidden({ hidden }, "tb") : null); const ms = performance.now() - t0;
      return { L: L!, ms };
    };
    for (let run = 0; run < 48; run++) {
      // (the two in turn, each one first every other run: neither pays for the other's garbage)
      const [x, y] = run % 2 ? [time(true), time(false)] : [time(false), time(true)];
      const [A, B] = run % 2 ? [y, x] : [x, y];
      expect(A.L.rows.length - B.L.rows.length).toBe(10);
      if (run >= 8) { own.push(A.ms); hid.push(B.ms); }
    }
    return { own: median(own), hidden_ms: median(hid) };
  };
  const first = measure();
  const { gates, bad } = await judge({ limits: { hidden_ms: first.own }, first, again: () => measure(), strict: false });
  console.log(`bench · hidden rows (400 × 9 range table, 10 hidden): own build ${first.own.toFixed(2)} ms, with 10 hidden ${first.hidden_ms.toFixed(2)} ms (limit: the own build + 10 %) · ${gates.map(g => describe(g)).join(", ")}`);
  expect(bad, `hidden rows: ${gates.map(g => describe(g)).join(", ")}`).toEqual([]);
}, 60_000);
