/* ⏱ S2.3 · one big30 sheet (130 000 rows × 12 columns, 75.7 MB of XML) in Node: parsed in under 0.5 s and under
   40 MB retained (PLAN S2.3, Part F; CI fails above the limit + 10 %). "Parsed" = from the inflated XML to the Sheet
   (the scan, the columns, the rest of the sheet, the regions: parseSheet, timed directly); the inflate before it
   is timed and reported apart (as in 06-plan §6 B-2: inflate + parse), and the whole read in the page is S2.6's
   gate (1 s). Needs tests/corpus/workbooks/big30.xlsx:
   python tools/make_corpus.py big30 tests/corpus/workbooks. Two runs; the slower counts. */
import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexWorkbook, parseSheet } from "../src/xlsx/workbook";
import { zget } from "../src/xlsx/util";
import type { Sheet } from "../src/xlsx/types";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/corpus/workbooks/big30.xlsx");
const LIMIT_MS = 500, LIMIT_MB = 40, SLACK = 1.1;
/** collect, and let freed array buffers be released (their accounting lags a tick behind) */
const gc = async () => { for (let i = 0; i < 3; i++) { (globalThis as { gc?: () => void }).gc?.(); await new Promise(r => setTimeout(r, 30)); } };
const used = () => { const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; };

it("big30: one sheet parsed under 0.5 s, under 40 MB retained", async () => {
  expect(fs.existsSync(FILE), "big30.xlsx is missing: python tools/make_corpus.py big30 tests/corpus/workbooks").toBe(true);
  expect(typeof (globalThis as { gc?: unknown }).gc).toBe("function");
  const buf = fs.readFileSync(FILE);
  const wb = await indexWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  await wb.ensure(["DATA_HEADER"]);                                // shared parts once (not part of the sheet read)
  const meta = wb.meta.find(m => m.name === "DATA_1")!, ctx = wb.shared!;
  const res: { ms: number; readMs: number; inflateMs: number; mb: number; cells: number }[] = [];
  for (let run = 0; run < 2; run++) {
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
  for (const [i, r] of res.entries()) console.log(`bench · big30 DATA_1 run ${i + 1}: parse ${r.ms.toFixed(0)} ms (read ${r.readMs.toFixed(0)} ms = inflate ${r.inflateMs.toFixed(0)} ms + parse), retained ${r.mb.toFixed(1)} MB, ${r.cells} cells`);
  const ms = Math.max(...res.map(r => r.ms)), mb = Math.max(...res.map(r => r.mb));
  expect(res[0].cells).toBe(130001 * 12);
  expect(ms, `parse ${ms.toFixed(0)} ms (limit ${LIMIT_MS} ms + 10 %)`).toBeLessThan(LIMIT_MS * SLACK);
  expect(mb, `retained ${mb.toFixed(1)} MB (limit ${LIMIT_MB} MB + 10 %)`).toBeLessThan(LIMIT_MB * SLACK);
});
