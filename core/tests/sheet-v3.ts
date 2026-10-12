/* v3's sheet parser (app/src/xlsx/workbook.ts readSheet at v3.5.0, regular expressions over the XML string),
   kept verbatim as the reference of the byte scanner (sheetstore.test.ts): cells and row information. */
import { isDateFmt } from "../src/xlsx/numfmt";
import { richRuns, xattrs, xdec } from "../src/xlsx/strings";
import { splitRef } from "../src/xlsx/util";
import type { Cell, CellType, RowInfo, Script, Shared, Xf } from "../src/xlsx/types";

export function cellsV3(xml: string, ctx: Shared, defRowH: number): { cells: Map<string, Cell>; rowInfo: Map<number, RowInfo> } {
  const rowInfo = new Map<number, RowInfo>(), cells = new Map<string, Cell>();
  const sd0 = xml.search(/<(?:\w+:)?sheetData\b/), sd1 = xml.search(/<\/(?:\w+:)?sheetData>/);
  const data = sd0 >= 0 ? xml.slice(sd0, sd1 >= 0 ? sd1 : undefined) : "";
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  const vRe = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/, isRe = /<(?:\w+:)?is(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?is>/, tRe = /<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null, lastRow = 0, n = 0;
  while ((m = rowRe.exec(data))) {
    const ra = xattrs(m[1]);
    const r = ra.r ? +ra.r : lastRow + 1; lastRow = r;
    rowInfo.set(r, { h: ra.ht ? +ra.ht : defRowH, hidden: ra.hidden === "1" || ra.hidden === "true", s: ra.customFormat === "1" ? +(ra.s || 0) : null });
    if (m[2]) {
      let c: RegExpExecArray | null, lastCol = 0; cRe.lastIndex = 0;
      while ((c = cRe.exec(m[2]))) {
        const a = xattrs(c[1]);
        const ref = a.r ? splitRef(a.r) : { r, c: lastCol + 1 }; if (!ref) continue; lastCol = ref.c;
        const t = a.t || "n", body = c[2] || "";
        const vm = body ? vRe.exec(body) : null, vt = vm ? vm[1] : null;
        const xf = ctx.xfs[+(a.s || 0)] || ctx.xfs[0] || ({} as Xf);
        let v: Cell["v"] = null, type: CellType = "blank";
        let scr: Script[] | undefined;
        if (t === "s" && vt != null) { v = ctx.sst[+vt] ?? ""; type = "s"; scr = ctx.sstRuns?.[+vt]; }
        else if (t === "inlineStr") { const im = isRe.exec(body); if (im) { const x = richRuns(im[1]); v = x.text; scr = x.scr; type = "s"; } }
        else if (t === "str" && vt != null) { v = xdec(vt); type = "s"; }
        else if (t === "b" && vt != null) { v = vt === "1"; type = "b"; }
        else if (t === "e" && vt != null) { v = vt; type = "e"; }
        else if (t === "d" && vt != null) { v = (Date.parse(vt) / 86400000) + 25569; type = "d"; }
        else if (vt != null && vt !== "") { v = +vt; type = isDateFmt(xf.fmt) ? "d" : "n"; }
        if (type === "s" && v === "") type = "blank";
        cells.set(r + "," + ref.c, scr ? { r, c: ref.c, v, t: type, xf, fmt: xf.fmt, scr } : { r, c: ref.c, v, t: type, xf, fmt: xf.fmt });
      }
    }
  }
  return { cells, rowInfo };
}
