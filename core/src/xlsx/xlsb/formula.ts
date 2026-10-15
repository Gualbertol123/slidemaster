/* Conditional-format formulas (CFParsedFormula, MS-XLSB 2.5.97.x Rgce) back to the A1 text an .xlsx file holds,
   which is what the rules are evaluated from (layout.ts evalCF) and sliced by (slice.ts). Relative references
   (PtgRefN / PtgAreaN) are offsets, modulo the sheet's size, from the top-left cell of all the rule's ranges – the
   cell Excel writes the .xlsx text for. Covered: constants, references, the operators,
   parentheses and the common functions; anything else (names, other sheets, tables, unknown functions) gives null
   and the rule keeps no formula – it then never matches, as an unreadable rule. */
import { numToCol } from "../util";
import { Records } from "./records";

const BIN = ["", "", "", "+", "-", "*", "/", "^", "&", "<", "<=", "=", ">=", ">", "<>", " ", ",", ":"];
const ERR: Record<number, string> = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
/** the built-in functions (Ftab, 2.5.98.10): name and, for those with a fixed number of arguments (PtgFunc), how many;
    -1 = called with a count (PtgFuncVar) only */
const FN: Record<number, [string, number]> = {
  0: ["COUNT", -1], 1: ["IF", -1], 2: ["ISNA", 1], 3: ["ISERROR", 1], 4: ["SUM", -1], 5: ["AVERAGE", -1], 6: ["MIN", -1], 7: ["MAX", -1],
  8: ["ROW", -1], 9: ["COLUMN", -1], 10: ["NA", 0], 15: ["SIN", 1], 16: ["COS", 1], 19: ["PI", 0], 20: ["SQRT", 1], 24: ["ABS", 1],
  25: ["INT", 1], 26: ["SIGN", 1], 27: ["ROUND", 2], 31: ["MID", 3], 32: ["LEN", 1], 33: ["VALUE", 1], 34: ["TRUE", 0], 35: ["FALSE", 0],
  36: ["AND", -1], 37: ["OR", -1], 38: ["NOT", 1], 39: ["MOD", 2], 65: ["DATE", 3], 67: ["DAY", 1], 68: ["MONTH", 1], 69: ["YEAR", 1],
  70: ["WEEKDAY", -1], 74: ["NOW", 0], 82: ["SEARCH", -1], 100: ["CHOOSE", -1], 111: ["CHAR", 1], 112: ["LOWER", 1], 113: ["UPPER", 1],
  115: ["LEFT", -1], 116: ["RIGHT", -1], 117: ["EXACT", 2], 118: ["TRIM", 1], 120: ["SUBSTITUTE", -1], 124: ["FIND", -1], 126: ["ISERR", 1],
  127: ["ISTEXT", 1], 128: ["ISNUMBER", 1], 129: ["ISBLANK", 1], 130: ["T", 1], 131: ["N", 1], 169: ["COUNTA", -1], 190: ["ISNONTEXT", 1],
  197: ["TRUNC", -1], 198: ["ISLOGICAL", 1], 212: ["ROUNDUP", 2], 213: ["ROUNDDOWN", 2], 221: ["TODAY", 0], 344: ["SUBTOTAL", -1],
  345: ["SUMIF", -1], 346: ["COUNTIF", 2], 347: ["COUNTBLANK", 1],
};
const wrapRow = (r: number) => ((r - 1) % 1048576 + 1048576) % 1048576 + 1, wrapCol = (c: number) => ((c - 1) % 16384 + 16384) % 16384 + 1;
const numText = (n: number) => String(n).replace("e+", "E+").replace("e-", "E-");

/** the reference text of a row and a 16-bit column field (ColRelShort: column in 14 bits, then fColRel, fRwRel) */
function ref(row: number, colField: number, base: { r: number; c: number } | null): string {
  const colRel = !!(colField & 0x4000), rowRel = !!(colField & 0x8000);
  let c = colField & 0x3fff, r = row;
  if (base && colRel) c = wrapCol(base.c + ((c << 18) >> 18)); else c += 1;
  if (base && rowRel) r = wrapRow(base.r + row); else r = (row >>> 0) + 1;
  return (colRel ? "" : "$") + numToCol(c) + (rowRel ? "" : "$") + r;
}

/** CFParsedFormula at the reader's position (cce, rgce, cb, rgcb) → its text, or null when it cannot be shown */
export function readCfFormula(r: Records, base: { r: number; c: number }): string | null {
  const cce = r.u32();
  if (cce > r.left) return null;
  const end = r.p + cce;
  let text: string | null;
  try { text = decompile(r, end, base); } catch { text = null; }
  r.p = end;
  if (r.left >= 4) { const cb = r.u32(); r.p = Math.min(r.end, r.p + cb); }
  return text;
}

function decompile(r: Records, end: number, base: { r: number; c: number }): string | null {
  const st: string[] = [];
  const pop = () => { const x = st.pop(); if (x === undefined) throw new Error("stack"); return x; };
  const call = (name: string, n: number) => { if (st.length < n) throw new Error("stack"); const a = st.splice(st.length - n, n); st.push(name + "(" + a.join(",") + ")"); };
  while (r.p < end) {
    const ptg = r.u8(), base5 = ptg & 0x1f, cls = ptg & 0x60;
    if (ptg >= 0x03 && ptg <= 0x11) { const b = pop(), a = pop(); st.push(a + BIN[ptg] + b); continue; }
    switch (ptg) {
      case 0x12: st.push("+" + pop()); continue;
      case 0x13: st.push("-" + pop()); continue;
      case 0x14: st.push(pop() + "%"); continue;
      case 0x15: st.push("(" + pop() + ")"); continue;
      case 0x16: st.push(""); continue;
      case 0x17: { const n = r.u16(); st.push('"' + r.chars(n).replace(/"/g, '""') + '"'); continue; }
      case 0x19: {                                                    // PtgAttr: layout and optimisation hints
        const t = r.u8();
        if (t & 0x04) { const n = r.u16(); r.skip(2 * (n + 1)); }
        else r.skip(2);
        if (t & 0x10) st.push("SUM(" + pop() + ")");
        continue;
      }
      case 0x1c: st.push(ERR[r.u8()] ?? "#N/A"); continue;
      case 0x1d: st.push(r.u8() ? "TRUE" : "FALSE"); continue;
      case 0x1e: st.push(String(r.u16())); continue;
      case 0x1f: st.push(numText(r.f64())); continue;
    }
    if (!cls) return null;
    switch (base5) {
      case 0x01: { const f = FN[r.u16()]; if (!f || f[1] < 0) return null; call(f[0], f[1]); break; }      // PtgFunc
      case 0x02: { const n = r.u8(), f = FN[r.u16() & 0x7fff]; if (!f) return null; call(f[0], n); break; }  // PtgFuncVar
      case 0x04: { const row = r.u32(); st.push(ref(row, r.u16(), null)); break; }                         // PtgRef
      case 0x05: { const r1 = r.u32(), r2 = r.u32(), c1 = r.u16(), c2 = r.u16(); st.push(ref(r1, c1, null) + ":" + ref(r2, c2, null)); break; }   // PtgArea
      case 0x0a: r.skip(6); st.push("#REF!"); break;
      case 0x0b: r.skip(12); st.push("#REF!"); break;
      case 0x0c: { const row = r.i32(); st.push(ref(row, r.u16(), base)); break; }                         // PtgRefN
      case 0x0d: { const r1 = r.i32(), r2 = r.i32(), c1 = r.u16(), c2 = r.u16(); st.push(ref(r1, c1, base) + ":" + ref(r2, c2, base)); break; }   // PtgAreaN
      default: return null;
    }
  }
  return st.length === 1 ? st[0] : null;
}
