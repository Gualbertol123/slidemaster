/* ⏱ S2.3 · one big30 sheet (130 000 rows × 12 columns, 75.7 MB of XML) in Node: parsed in under 0.5 s and under
   40 MB retained (PLAN S2.3, Part F; CI fails above the limit + 10 %). "Parsed" = from the inflated XML to the Sheet
   (the scan, the columns, the rest of the sheet, the regions: parseSheet, timed directly); the inflate before it
   is timed and reported apart (as in 06-plan §6 B-2: inflate + parse), and the whole read in the page is S2.6's
   gate (1 s). Needs tests/corpus/workbooks/big30.xlsx:
   python tools/make_corpus.py big30 tests/corpus/workbooks. One untimed run warms the JIT, then three timed runs: the
   median time and the largest retained memory count (decision 2026-10-12: the slower of two runs failed by chance on
   CI's runner, 551 and 558 ms, with no change in the code it times). The time limit is scaled by how much slower
   the machine is than the reference PC (tools/calibrate.mjs, decision 2026-10-12); the memory limit is not. On CI a
   parse over its limit is measured again and fails only if over twice (tools/benchgate.mjs, decision 2026-10-20). */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexWorkbook, parseSheet } from "../src/xlsx/workbook";
import { zget } from "../src/xlsx/util";
import type { Sheet } from "../src/xlsx/types";
import { speedFactor } from "../../tools/calibrate.mjs";
import { describe, judge } from "../../tools/benchgate.mjs";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/corpus/workbooks/big30.xlsx");
const LIMIT_MS = 500, LIMIT_MB = 40;
/** collect, and let freed array buffers be released (their accounting lags a tick behind) */
const gc = async () => { for (let i = 0; i < 3; i++) { (globalThis as { gc?: () => void }).gc?.(); await new Promise(r => setTimeout(r, 30)); } };
const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };

it("big30: one sheet parsed under 0.5 s, under 40 MB retained", async () => {
  expect(fs.existsSync(FILE), "big30.xlsx is missing: python tools/make_corpus.py big30 tests/corpus/workbooks").toBe(true);
  expect(typeof (globalThis as { gc?: unknown }).gc).toBe("function");
  const speed = speedFactor();
  console.log(`bench · calibration ${speed.ms.toFixed(1)} ms: time limit × ${speed.factor.toFixed(2)}`);
  const buf = fs.readFileSync(FILE);
  const wb = await indexWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  await wb.ensure(["DATA_HEADER"]);                                // shared parts once (not part of the sheet read)
  const meta = wb.meta.find(m => m.name === "DATA_1")!, ctx = wb.shared!;
  { const w = await parseSheet(wb.zip, meta, wb.zip.bytes(zget(wb.zip, meta.path)!), ctx); void w; }   // warm-up, not counted
  /** three timed runs: the median time and the largest retained memory */
  const measure = async (label: string) => {
    const res: { ms: number; readMs: number; inflateMs: number; mb: number; cells: number }[] = [];
    for (let run = 0; run < 3; run++) {
      await gc(); const m0 = used();
      const ti = performance.now(); let bytes: Uint8Array | null = wb.zip.bytes(zget(wb.zip, meta.path)!); const inflateMs = performance.now() - ti;
      const t1 = performance.now();
      let S: Sheet | null = await parseSheet(wb.zip, meta, bytes, ctx);
      const ms = performance.now() - t1, readMs = inflateMs + ms;
      bytes = null;
      await gc(); const mb = (used() - m0) / 1048576;
      res.push({ ms, readMs, inflateMs, mb, cells: S.cells.size });
      S = null;
    }
    for (const [i, r] of res.entries()) console.log(`bench · big30 DATA_1 ${label}run ${i + 1}: parse ${r.ms.toFixed(0)} ms (read ${r.readMs.toFixed(0)} ms = inflate ${r.inflateMs.toFixed(0)} ms + parse), retained ${r.mb.toFixed(1)} MB, ${r.cells} cells`);
    expect(res[0].cells).toBe(130001 * 12);
    return { parse_ms: res.map(r => r.ms).sort((a, b) => a - b)[1], retained_mb: Math.max(...res.map(r => r.mb)) };
  };
  // on CI a parse over its limit is measured again (three more runs) and fails only if over again (tools/benchgate.mjs);
  // the memory is never measured again
  const limits = { parse_ms: LIMIT_MS * speed.factor, retained_mb: LIMIT_MB };
  const { gates, bad } = await judge({ limits, first: await measure(""), again: () => measure("repeat "), strict: true });
  const report = gates.map(g => `${g.key} ${describe(g)}`).join("; ");
  console.log(`bench · big30 DATA_1: ${report} (parse: median of 3, limit ${LIMIT_MS} ms × ${speed.factor.toFixed(2)}; retained: the largest)`);
  expect(bad, report).toEqual([]);
});
