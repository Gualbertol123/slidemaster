/* Formulas of an .xlsb (MS-XLSB 2.5.97.x Rgce) back to the A1 text an .xlsx file holds: conditional-format formulas
   (CFParsedFormula: relative references are offsets from the top-left cell of the rule's ranges) and, since PLAN
   S7.1, cell formulas (CellParsedFormula), shared formulas (BrtShrFmla: decompiled for the master cell, shifted to
   each child by calc/refs.ts) and array formulas (BrtArrFmla). Covered: constants, references on this sheet, on other
   sheets and in linked workbooks (PtgRef3d / PtgArea3d through the XTI table), defined names (incl. the `_xlfn.`
   names that carry Excel 2007+ functions as PtgFuncVar 255), the operators, parentheses and the built-in function
   table. Anything else (array constants, tables, unknown function ids) gives null: the cell is then "a formula that
   cannot be read" (no text) – it keeps its cached value, and the self-check reports it. */
import { numToCol } from "../util";
import { Records } from "./records";
import type { BinWorkbookInfo } from "./workbook";

const BIN = ["", "", "", "+", "-", "*", "/", "^", "&", "<", "<=", "=", ">=", ">", "<>", " ", ",", ":"];
const ERR: Record<number, string> = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
/** the built-in functions (Ftab, MS-XLS 2.5.198.17): name and, for those with a fixed number of arguments (PtgFunc),
    how many; -1 = called with a count (PtgFuncVar) only */
export const FN: Record<number, [string, number]> = {
  0: ["COUNT", -1], 1: ["IF", -1], 2: ["ISNA", 1], 3: ["ISERROR", 1], 4: ["SUM", -1], 5: ["AVERAGE", -1], 6: ["MIN", -1], 7: ["MAX", -1],
  8: ["ROW", -1], 9: ["COLUMN", -1], 10: ["NA", 0], 11: ["NPV", -1], 12: ["STDEV", -1], 13: ["DOLLAR", -1], 14: ["FIXED", -1], 15: ["SIN", 1], 16: ["COS", 1],
  17: ["TAN", 1], 18: ["ATAN", 1], 19: ["PI", 0], 20: ["SQRT", 1], 21: ["EXP", 1], 22: ["LN", 1], 23: ["LOG10", 1], 24: ["ABS", 1],
  25: ["INT", 1], 26: ["SIGN", 1], 27: ["ROUND", 2], 28: ["LOOKUP", -1], 29: ["INDEX", -1], 30: ["REPT", 2], 31: ["MID", 3], 32: ["LEN", 1], 33: ["VALUE", 1], 34: ["TRUE", 0], 35: ["FALSE", 0],
  36: ["AND", -1], 37: ["OR", -1], 38: ["NOT", 1], 39: ["MOD", 2], 40: ["DCOUNT", 3], 41: ["DSUM", 3], 42: ["DAVERAGE", 3], 43: ["DMIN", 3], 44: ["DMAX", 3], 45: ["DSTDEV", 3],
  46: ["VAR", -1], 47: ["DVAR", 3], 48: ["TEXT", 2], 49: ["LINEST", -1], 50: ["TREND", -1], 51: ["LOGEST", -1], 52: ["GROWTH", -1], 56: ["PV", -1], 57: ["FV", -1], 58: ["NPER", -1],
  59: ["PMT", -1], 60: ["RATE", -1], 61: ["MIRR", 3], 62: ["IRR", -1], 63: ["RAND", 0], 64: ["MATCH", -1], 65: ["DATE", 3], 66: ["TIME", 3], 67: ["DAY", 1], 68: ["MONTH", 1], 69: ["YEAR", 1],
  70: ["WEEKDAY", -1], 71: ["HOUR", 1], 72: ["MINUTE", 1], 73: ["SECOND", 1], 74: ["NOW", 0], 75: ["AREAS", 1], 76: ["ROWS", 1], 77: ["COLUMNS", 1], 78: ["OFFSET", -1], 82: ["SEARCH", -1],
  83: ["TRANSPOSE", 1], 86: ["TYPE", 1], 97: ["ATAN2", 2], 98: ["ASIN", 1], 99: ["ACOS", 1], 100: ["CHOOSE", -1], 101: ["HLOOKUP", -1], 102: ["VLOOKUP", -1], 105: ["ISREF", 1],
  109: ["LOG", -1], 111: ["CHAR", 1], 112: ["LOWER", 1], 113: ["UPPER", 1], 114: ["PROPER", 1], 115: ["LEFT", -1], 116: ["RIGHT", -1], 117: ["EXACT", 2], 118: ["TRIM", 1], 119: ["REPLACE", 4],
  120: ["SUBSTITUTE", -1], 121: ["CODE", 1], 124: ["FIND", -1], 125: ["CELL", -1], 126: ["ISERR", 1], 127: ["ISTEXT", 1], 128: ["ISNUMBER", 1], 129: ["ISBLANK", 1], 130: ["T", 1], 131: ["N", 1],
  140: ["DATEVALUE", 1], 141: ["TIMEVALUE", 1], 142: ["SLN", 3], 143: ["SYD", 4], 144: ["DDB", -1], 148: ["INDIRECT", -1], 162: ["CLEAN", 1], 163: ["MDETERM", 1], 164: ["MINVERSE", 1], 165: ["MMULT", 2],
  167: ["IPMT", -1], 168: ["PPMT", -1], 169: ["COUNTA", -1], 183: ["PRODUCT", -1], 184: ["FACT", 1], 189: ["DPRODUCT", 3], 190: ["ISNONTEXT", 1], 193: ["STDEVP", -1], 194: ["VARP", -1],
  195: ["DSTDEVP", 3], 196: ["DVARP", 3], 197: ["TRUNC", -1], 198: ["ISLOGICAL", 1], 199: ["DCOUNTA", 3], 204: ["USDOLLAR", -1], 205: ["FINDB", -1], 206: ["SEARCHB", -1], 207: ["REPLACEB", 4],
  208: ["LEFTB", -1], 209: ["RIGHTB", -1], 210: ["MIDB", 3], 211: ["LENB", 1], 212: ["ROUNDUP", 2], 213: ["ROUNDDOWN", 2], 214: ["ASC", 1], 215: ["DBCS", 1], 216: ["RANK", -1], 219: ["ADDRESS", -1],
  220: ["DAYS360", -1], 221: ["TODAY", 0], 222: ["VDB", -1], 227: ["MEDIAN", -1], 228: ["SUMPRODUCT", -1], 229: ["SINH", 1], 230: ["COSH", 1], 231: ["TANH", 1], 232: ["ASINH", 1], 233: ["ACOSH", 1],
  234: ["ATANH", 1], 235: ["DGET", 3], 244: ["INFO", 1], 247: ["DB", -1], 252: ["FREQUENCY", 2], 261: ["ERROR.TYPE", 1], 269: ["AVEDEV", -1], 270: ["BETADIST", -1], 271: ["GAMMALN", 1],
  272: ["BETAINV", -1], 273: ["BINOMDIST", 4], 274: ["CHIDIST", 2], 275: ["CHIINV", 2], 276: ["COMBIN", 2], 277: ["CONFIDENCE", 3], 278: ["CRITBINOM", 3], 279: ["EVEN", 1], 280: ["EXPONDIST", 3],
  281: ["FDIST", 3], 282: ["FINV", 3], 283: ["FISHER", 1], 284: ["FISHERINV", 1], 285: ["FLOOR", 2], 286: ["GAMMADIST", 4], 287: ["GAMMAINV", 3], 288: ["CEILING", 2], 289: ["HYPGEOMDIST", 4],
  290: ["LOGNORMDIST", 3], 291: ["LOGINV", 3], 292: ["NEGBINOMDIST", 3], 293: ["NORMDIST", 4], 294: ["NORMSDIST", 1], 295: ["NORMINV", 3], 296: ["NORMSINV", 1], 297: ["STANDARDIZE", 3], 298: ["ODD", 1],
  299: ["PERMUT", 2], 300: ["POISSON", 3], 301: ["TDIST", 3], 302: ["WEIBULL", 4], 303: ["SUMXMY2", 2], 304: ["SUMX2MY2", 2], 305: ["SUMX2PY2", 2], 306: ["CHITEST", 2], 307: ["CORREL", 2], 308: ["COVAR", 2],
  309: ["FORECAST", 3], 310: ["FTEST", 2], 311: ["INTERCEPT", 2], 312: ["PEARSON", 2], 313: ["RSQ", 2], 314: ["STEYX", 2], 315: ["SLOPE", 2], 316: ["TTEST", 4], 317: ["PROB", -1], 318: ["DEVSQ", -1],
  319: ["GEOMEAN", -1], 320: ["HARMEAN", -1], 321: ["SUMSQ", -1], 322: ["KURT", -1], 323: ["SKEW", -1], 324: ["ZTEST", -1], 325: ["LARGE", 2], 326: ["SMALL", 2], 327: ["QUARTILE", 2], 328: ["PERCENTILE", 2],
  329: ["PERCENTRANK", -1], 330: ["MODE", -1], 331: ["TRIMMEAN", 2], 332: ["TINV", 2], 336: ["CONCATENATE", -1], 337: ["POWER", 2], 342: ["RADIANS", 1], 343: ["DEGREES", 1], 344: ["SUBTOTAL", -1],
  345: ["SUMIF", -1], 346: ["COUNTIF", 2], 347: ["COUNTBLANK", 1], 350: ["ISPMT", 4], 351: ["DATEDIF", 3], 352: ["DATESTRING", 1], 353: ["NUMBERSTRING", 2], 354: ["ROMAN", -1], 358: ["GETPIVOTDATA", -1],
  359: ["HYPERLINK", -1], 360: ["PHONETIC", 1], 361: ["AVERAGEA", -1], 362: ["MAXA", -1], 363: ["MINA", -1], 364: ["STDEVPA", -1], 365: ["VARPA", -1], 366: ["STDEVA", -1], 367: ["VARA", -1],
  // Excel 2007+ built-ins and the former Analysis ToolPak functions, learnt from Excel's own .xlsb files (tests/corpus/
  // workbooks/recalc/xlsb/Functions.xlsb; checked by core/tests/formulas.test.ts)
  385: ["HEX2DEC", 1], 387: ["DEC2BIN", -1], 388: ["DEC2HEX", -1], 389: ["DEC2OCT", -1], 392: ["OCT2DEC", 1], 393: ["BIN2DEC", 1], 410: ["IMREAL", 1], 411: ["COMPLEX", -1], 412: ["IMSUM", -1],
  414: ["SERIESSUM", 4], 415: ["FACTDOUBLE", 1], 416: ["SQRTPI", 1], 417: ["QUOTIENT", 2], 418: ["DELTA", -1], 419: ["GESTEP", -1], 420: ["ISEVEN", 1], 421: ["ISODD", 1], 422: ["MROUND", 2],
  423: ["ERF", -1], 424: ["ERFC", 1], 425: ["BESSELJ", 2], 429: ["XIRR", -1], 430: ["XNPV", 3], 435: ["DISC", -1], 439: ["TBILLPRICE", 3], 441: ["PRICE", -1], 442: ["YIELD", -1], 445: ["NOMINAL", 2],
  446: ["EFFECT", 2], 447: ["CUMPRINC", 6], 448: ["CUMIPMT", 6], 449: ["EDATE", 2], 450: ["EOMONTH", 2], 451: ["YEARFRAC", -1], 458: ["DURATION", -1], 464: ["RANDBETWEEN", 2], 465: ["WEEKNUM", -1],
  468: ["CONVERT", 3], 469: ["ACCRINT", -1], 471: ["WORKDAY", -1], 472: ["NETWORKDAYS", -1], 473: ["GCD", -1], 474: ["MULTINOMIAL", -1], 475: ["LCM", -1], 480: ["IFERROR", 2], 481: ["COUNTIFS", -1],
  482: ["SUMIFS", -1], 483: ["AVERAGEIF", -1], 484: ["AVERAGEIFS", -1],
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
/** an area's text: whole columns ("C:C", every row) and whole rows ("3:3", every column) as Excel writes them */
function area(r1: number, c1: number, r2: number, c2: number, base: { r: number; c: number } | null): string {
  const a = ref(r1, c1, base), b = ref(r2, c2, base);
  // every row (0 … 1048575, absolute rows: coordinates also in a shared formula) = a whole column; every column = a
  // whole row (absolute columns)
  if (!(c1 & 0x8000) && !(c2 & 0x8000) && (r1 >>> 0) === 0 && (r2 >>> 0) === 1048575) return a.replace(/\$?\d+$/, "") + ":" + b.replace(/\$?\d+$/, "");
  if (!(c1 & 0x4000) && !(c2 & 0x4000) && (c1 & 0x3fff) === 0 && (c2 & 0x3fff) === 16383) return a.replace(/^\$?[A-Z]+/, "") + ":" + b.replace(/^\$?[A-Z]+/, "");
  return a + ":" + b;
}
/** a sheet name as a formula writes it: quoted when it has anything but word characters, or starts with a digit */
export function quoteSheet(name: string): string { return /^[A-Za-z_][\w.]*$/.test(name) && !/^(?:[A-Z]{1,3}\d+|R\d*C\d*|TRUE|FALSE)$/i.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"; }
/** the "Sheet!" / "[n]Sheet!" / "First:Last!" prefix of XTI entry ixti; null when it cannot be named */
function prefix3d(ixti: number, info: BinWorkbookInfo | undefined): string | null {
  const x = info?.xti[ixti]; if (!x) return null;
  const book = info!.books[x.book]; if (!book) return null;
  if (x.first < 0) return "#REF!!";
  if (book.kind === "self") {
    const a = info!.sheets[x.first], b = info!.sheets[x.last];
    if (a === undefined) return "#REF!!";
    return quoteSheet(x.last !== x.first && b !== undefined ? a + ":" + b : a) + "!";
  }
  if (book.kind !== "external") return null;
  // the .xlsx text names an external book by its number among the workbook's external links: "[1]Peer!F7"
  let n = 0; for (let k = 0; k <= x.book; k++) if (info!.books[k]?.kind === "external") n++;
  const a = book.sheets[x.first]; if (a === undefined) return null;
  const nm = "[" + n + "]" + (x.last !== x.first && book.sheets[x.last] !== undefined ? a + ":" + book.sheets[x.last] : a);
  return (/^[\w.[\]]+$/.test(nm) ? nm : "'" + nm.replace(/'/g, "''") + "'") + "!";
}

/** CFParsedFormula at the reader's position (cce, rgce, cb, rgcb) → its text, or null when it cannot be shown */
export function readCfFormula(r: Records, base: { r: number; c: number }, info?: BinWorkbookInfo, sheetName?: string): string | null {
  return readParsedFormula(r, base, info, true, sheetName).text;
}
/** a cell's CellParsedFormula (BrtFmla*: after the value and grbitFlags), an array's or a shared formula's: the
    text, or `exp` = the master cell a PtgExp points at (the BrtShrFmla / BrtArrFmla that follows the master holds the
    text), or neither when the formula cannot be read. `relative`: a shared or conditional-format formula, whose
    relative references (PtgRefN, PtgAreaN, and the 3D ones) are offsets from `base`; a cell's own formula holds
    coordinates */
export function readParsedFormula(r: Records, base: { r: number; c: number }, info: BinWorkbookInfo | undefined, relative = false, sheetName?: string): { text: string | null; exp?: { r: number; c: number } } {
  if (r.left < 4) return { text: null };
  const cce = r.u32();
  if (cce > r.left) { r.p = r.end; return { text: null }; }
  const end = r.p + cce;
  let out: { text: string | null; exp?: { r: number; c: number } };
  try { out = decompile(r, end, base, info, relative, sheetName); } catch { out = { text: null }; }
  r.p = end;
  if (r.left >= 4) { const cb = r.u32(); r.p = Math.min(r.end, r.p + cb); }
  return out;
}

function decompile(r: Records, end: number, base: { r: number; c: number }, info: BinWorkbookInfo | undefined, relative: boolean, sheetName?: string): { text: string | null; exp?: { r: number; c: number } } {
  const b3 = relative ? base : null;                                 // 3D references: offsets only in shared formulas
  const st: string[] = [];
  const pop = () => { const x = st.pop(); if (x === undefined) throw new Error("stack"); return x; };
  const call = (name: string, n: number) => { if (st.length < n) throw new Error("stack"); const a = st.splice(st.length - n, n); st.push(name + "(" + a.join(",") + ")"); };
  const nameOf = (ix: number) => { const n = info?.names[ix - 1]; return n && n.name ? n.name : null; };   // "": a name that could not be read
  while (r.p < end) {
    const ptg = r.u8(), base5 = ptg & 0x1f, cls = ptg & 0x60;
    if (ptg >= 0x03 && ptg <= 0x11) { const b = pop(), a = pop(); st.push(a + BIN[ptg] + b); continue; }
    switch (ptg) {
      case 0x01: { const row = r.u32(); return { text: null, exp: { r: row + 1, c: base.c } }; }   // PtgExp: a cell of a shared / array formula (the master's row; the BrtShrFmla / BrtArrFmla range names the cells)
      case 0x02: return { text: null };                                                              // PtgTbl: a data table
      case 0x12: st.push("+" + pop()); continue;
      case 0x13: st.push("-" + pop()); continue;
      case 0x14: st.push(pop() + "%"); continue;
      case 0x15: st.push("(" + pop() + ")"); continue;
      case 0x16: st.push(""); continue;
      case 0x17: { const n = r.u16(); st.push('"' + r.chars(n).replace(/"/g, '""') + '"'); continue; }
      case 0x18: return { text: null };                                                            // PtgList (a table's structured reference) / PtgSxName: not read (07 §1.4 rule 5)
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
    if (!cls) return { text: null };
    switch (base5) {
      case 0x00: return { text: null };                                                              // PtgArray: constants in rgcb (not decompiled)
      case 0x01: { const f = FN[r.u16()]; if (!f || f[1] < 0) return { text: null }; call(f[0], f[1]); break; }      // PtgFunc
      case 0x02: {                                                                                   // PtgFuncVar
        const n = r.u8(), raw = r.u16(), tab = raw & 0x7fff;
        if (raw & 0x8000) return { text: null };                                                     // fCeFunc (macro-sheet functions): not read
        if (tab === 255) { if (st.length < n || n < 1) throw new Error("stack"); const a = st.splice(st.length - n, n); const nm = a.shift()!; st.push(nm + "(" + a.join(",") + ")"); break; }   // a future function: its _xlfn. name is the first argument (kept, as the .xlsx text keeps it)
        const f = FN[tab]; if (!f) return { text: null }; call(f[0], n); break;
      }
      case 0x03: {                                                                                 // PtgName (LET parameters are _xlpm. names, kept as the .xlsx text keeps them)
        const ix = r.u32(), n = info?.names[ix - 1]; if (!n || !n.name) return { text: null };
        // a sheet-scoped name used from another sheet is written "Sheet!Name" in the .xlsx text
        const scopeName = n.scope >= 0 ? info!.sheets[n.scope] : undefined;
        st.push(scopeName !== undefined && scopeName !== sheetName ? quoteSheet(scopeName) + "!" + n.name : n.name); break;
      }
      case 0x04: { const row = r.u32(); st.push(ref(row, r.u16(), null)); break; }                         // PtgRef
      case 0x05: { const r1 = r.u32(), r2 = r.u32(), c1 = r.u16(), c2 = r.u16(); st.push(area(r1, c1, r2, c2, null)); break; }   // PtgArea
      case 0x06: case 0x07: case 0x08: { r.skip(6); break; }                                          // PtgMemArea / MemErr / MemNoMem: the sub-expression follows
      case 0x09: { r.skip(2); break; }                                                                // PtgMemFunc
      case 0x0a: r.skip(6); st.push("#REF!"); break;
      case 0x0b: r.skip(12); st.push("#REF!"); break;
      case 0x0c: { const row = r.i32(); st.push(ref(row, r.u16(), base)); break; }                         // PtgRefN
      case 0x0d: { const r1 = r.i32(), r2 = r.i32(), c1 = r.u16(), c2 = r.u16(); st.push(area(r1, c1, r2, c2, base)); break; }   // PtgAreaN
      case 0x19: {                                                                                 // PtgNameX: a name through the XTI table (this workbook's: incl. the _xlfn. future functions)
        const x = info?.xti[r.u16()], nm = nameOf(r.u32());
        if (nm === null || !x || info!.books[x.book]?.kind !== "self") return { text: null };          // a linked workbook's own names are not read
        st.push(nm); break;
      }
      case 0x1a: { const p = prefix3d(r.u16(), info); if (p === null) return { text: null }; const row = b3 ? r.i32() : r.u32(); st.push(p + ref(row, r.u16(), b3)); break; }   // PtgRef3d
      case 0x1b: { const p = prefix3d(r.u16(), info); if (p === null) return { text: null }; const r1 = b3 ? r.i32() : r.u32(), r2 = b3 ? r.i32() : r.u32(), c1 = r.u16(), c2 = r.u16(); st.push(p + area(r1, c1, r2, c2, b3)); break; }   // PtgArea3d
      case 0x1c: { const p = prefix3d(r.u16(), info); r.skip(6); st.push((p ?? "") + "#REF!"); break; }
      case 0x1d: { const p = prefix3d(r.u16(), info); r.skip(12); st.push((p ?? "") + "#REF!"); break; }
      default: return { text: null };
    }
  }
  return { text: st.length === 1 ? st[0] : null };
}
