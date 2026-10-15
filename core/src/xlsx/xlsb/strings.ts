/* sharedStrings.bin (BrtSSTItem, MS-XLSB 2.4.729) and the rich strings of cells (BrtCellRString): the text and,
   like strings.ts for the XML, the superscript / subscript parts – a run is raised or lowered when its font is
   (BrtFont.sss); phonetic runs are not text. */
import type { Script } from "../types";
import { Records, Rt } from "./records";

/** text as the .xlsx reader has it for the same cell: Excel writes a line feed into the XML as CR LF (and a carriage
    return as _x000D_), which that reader keeps as written (v3's) – so a line feed here becomes CR LF too */
export function asXlsxText(s: string): string { return s.indexOf("\n") < 0 ? s : s.replace(/\n/g, "\r\n"); }

/** RichStr (2.5.125) at the reader's position */
export function readRichStr(r: Records, sss: number[]): { text: string; scr?: Script[] } {
  const flags = r.u8(), raw = r.wstr(), text = asXlsxText(raw);
  if (!(flags & 1)) return { text };
  const n = r.u32();
  if (n > r.left / 4) return { text };
  const starts: number[] = [], fonts: number[] = [];
  for (let k = 0; k < n; k++) { starts.push(r.u16()); fonts.push(r.u16()); }
  // the runs cover [start, next start); the text before the first run has the cell's own font (not raised). The
  // positions count the file's characters: each line feed before them gained a carriage return
  const at = (i: number) => { i = Math.min(i, raw.length); if (text === raw) return i; let x = i; for (let k = 0; k < i; k++) if (raw.charCodeAt(k) === 10) x++; return x; };
  const scr: Script[] = [];
  for (let k = 0; k < n; k++) {
    const s = sss[fonts[k]], a = at(starts[k]), b = at(k + 1 < n ? starts[k + 1] : raw.length);
    if ((s === 1 || s === 2) && b > a) scr.push([a, b, s === 1 ? "sup" : "sub"]);
  }
  return scr.length ? { text, scr } : { text };
}

export function readSstBin(bytes: Uint8Array, sss: number[]): { sst: string[]; runs: (Script[] | undefined)[] } {
  const r = new Records(bytes), sst: string[] = [], runs: (Script[] | undefined)[] = [];
  while (r.rec()) {
    if (r.type !== Rt.SSTItem) continue;
    const x = readRichStr(r, sss);
    sst.push(x.text); runs.push(x.scr);
  }
  return { sst, runs };
}
