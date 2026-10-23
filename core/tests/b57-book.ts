/* B57 (4.14): the owner's "I moved cells around in Excel" on the B54 workbook (app/tests/fixtures/B54.xlsx), as Excel would
   save it – 2 rows inserted above both tables (KPI and Volumes), and on Volumes the Volume column cut and inserted after
   the budget column (Excel's Insert Cut Cells at F: the budget slides left into C, the volumes land in E). Used by
   core/tests/repoint.test.ts and the e2e spec B57-01. */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colStr = (n: number) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/** a worksheet's XML with its rows moved down by `dr` and its columns renamed by `cols` ("C" → "E") */
export function moveSheetXml(xml: string, dr: number, cols: Record<string, string> = {}): string {
  const cell = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; return (cols[m[1]] || m[1]) + (+m[2] + dr); };
  return xml
    .replace(/<row r="(\d+)"/g, (_m, r) => `<row r="${+r + dr}"`)
    .replace(/<c r="([A-Z]+\d+)"/g, (_m, r) => `<c r="${cell(r)}"`)
    .replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (_m, c1, r1, c2, r2) => {
      const all = [c1, c2, ...Object.values(cols)].map(colNum);
      return `<dimension ref="${colStr(Math.min(...all))}${+r1 + dr}:${colStr(Math.max(...all))}${+r2 + dr}"/>`;
    })
    // (cells in each row in column order, as Excel writes them)
    .replace(/(<row [^>]*>)(.*?)(<\/row>)/g, (_m, a, body: string, z) => {
      const cs = body.match(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>.*?<\/c>)/g) || [];
      return a + cs.sort((p, q) => colNum(/<c r="([A-Z]+)/.exec(p)![1]) - colNum(/<c r="([A-Z]+)/.exec(q)![1])).join("") + z;
    });
}
/** the workbook's bytes after the move: KPI 2 rows down; Volumes 2 rows down, C → E and D → C */
export function movedB54(buf: Uint8Array, opts: { rows?: number; swap?: boolean } = {}): Uint8Array {
  const z = unzipSync(buf), dr = opts.rows ?? 2;
  // (a copy in this realm: under jsdom TextEncoder's bytes are another realm's Uint8Array, which zipSync takes for a folder)
  const edit = (part: string, f: (x: string) => string) => { z[part] = Uint8Array.from(strToU8(f(strFromU8(z[part])))); };
  edit("xl/worksheets/sheet1.xml", x => moveSheetXml(x, dr));
  edit("xl/worksheets/sheet2.xml", x => moveSheetXml(x, dr, opts.swap === false ? {} : { C: "E", D: "C" }));
  return zipSync(z);
}
