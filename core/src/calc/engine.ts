/* The formula engine in the core worker (PLAN S7.2, docs/next/07 §1.4, ADR-013): IronCalc (Rust → WASM, MIT or
   Apache-2.0, inlined by tools/vendor-ironcalc.mjs) fed from the SheetStore – constants and the formula text S7.1 reads
   –, so a workbook is read once, by our reader. A CalcModel holds one workbook and its linked workbooks (ADR-014:
   their sheets join the same model under internal names, and the formulas' "[n]Sheet!" references are rewritten to
   them), sets an input cell, evaluates, and reads every formula cell back. Rules of 07 §1.4:
   * whole-column / whole-row references are bounded to the used range of the sheet they name (37× faster on the
     spike deck, exact for the functions that read data), except inside OFFSET, INDIRECT, ROW(S), COLUMN(S);
   * values are read back through a 15-significant-digit format (IronCalc's formatter rounds there; Excel's own
     display precision), so equality with Excel's cached values is checked to 1e-13 relative;
   * the self-check classes every formula cell: exact / volatile / locale (TEXT and date formats) / external (a
     linked workbook that is not available) / unreadable (an .xlsb formula that could not be decompiled) / different.
   The WASM is instantiated on first use (never on the open path, B23). Nothing here touches the DOM. */
import { unzlibSync } from "fflate";
import type { Sheet } from "../xlsx/types";
import { Kind, type SheetColumns } from "../xlsx/sheetstore";
import { numToCol } from "../xlsx/util";
import { tokenize, type FToken } from "./refs";
import { quoteSheet } from "../xlsx/xlsb/formula";
import type { Model as IronModel } from "./wasm/ironcalc-glue";

type Glue = typeof import("./wasm/ironcalc-glue");
let glue: Promise<Glue> | null = null;
/** the engine's WASM, instantiated once per worker (≈ 2 MB inflated from the inlined base64) */
export function loadEngine(): Promise<Glue> {
  return glue ||= Promise.all([import("./wasm/ironcalc-wasm"), import("./wasm/ironcalc-glue")]).then(([w, g]) => {
    const bin = atob(w.IRONCALC_WASM), z = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) z[i] = bin.charCodeAt(i);
    g.initSync({ module: unzlibSync(z) });
    return g;
  });
}

/** a workbook of the model: the deck's (`name` null) or a linked one by file name; `externals` = the file names its
    external links refer to, in the "[n]" order of its formulas */
export interface CalcBook { name: string | null; /** the deck's workbook's own file name (what linked workbooks' formulas call it) */ file?: string; sheets: Sheet[];
  /** the workbook's hidden sheets (never read, WB-18): a formula that names one is classed `hidden` */ hidden?: string[]; externals: string[] }
export type CellValue = number | string | boolean | { err: string } | null;
export interface FormulaCell { book: string | null; sheet: string; r: number; c: number; text: string; array?: string }
export type CheckClass = "exact" | "volatile" | "locale" | "external" | "hidden" | "unreadable" | "different";
export interface SelfCheck {
  counts: Record<CheckClass, number>;
  /** the cells that differ from Excel's cached value (first 200), with both values */
  different: { book: string | null; sheet: string; ref: string; text: string; cached: CellValue; computed: CellValue }[];
}

const VOLATILE = /\b(?:TODAY|NOW|RAND|RANDBETWEEN|RANDARRAY)\s*\(/;
const LOCALE = /\bTEXT\s*\(/;
const UNBOUNDED = new Set(["OFFSET", "INDIRECT", "ROW", "ROWS", "COLUMN", "COLUMNS"]);
/** the read-back format: 15 significant digits (IronCalc rounds its General display to 9 decimals) */
const PRECISE = "0.00000000000000E+00";
const CELL_NUMBER = 1, CELL_TEXT = 2, CELL_BOOL = 4, CELL_ERROR = 16;
export const sameValue = (a: CellValue, b: CellValue): boolean => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-13 * Math.max(1, Math.abs(b));
  if (a && typeof a === "object" && b && typeof b === "object") return a.err === b.err;
  if ((a === null || a === "") && (b === null || b === "")) return true;
  return a === b;
};

/** the sheet's used range from its columns (rows are sorted; the widest column is scanned once) */
export function usedRange(S: Sheet): { rows: number; cols: number } {
  const C = S.cols?.cells; if (!C || !C.n) return { rows: 1, cols: 1 };
  let cols = 1; for (let i = 0; i < C.n; i++) if (C.col[i] > cols) cols = C.col[i];
  return { rows: Math.max(1, C.rows[C.rows.length - 1]), cols };
}

export class CalcModel {
  readonly model: IronModel;
  /** internal sheet index by "<book>\u0000<sheet>" */
  private readonly ix = new Map<string, number>();
  /** internal (engine) sheet names by the same key, quoted for formulas */
  private readonly names = new Map<string, string>();
  readonly formulas: FormulaCell[] = [];
  private readonly books: CalcBook[];
  /** cells whose formula names a linked workbook that is not in the model, and cells that name a hidden sheet */
  private readonly externalCells = new Set<string>();
  private readonly hiddenCells = new Set<string>();
  /** time spent, ms: building the model, the first evaluation */
  readonly ms = { build: 0, evaluate: 0 };
  /** why the 15-digit read-back format could not be applied (values then come in the engine's General format) */
  styleError: string | null = null;

  constructor(g: Glue, books: CalcBook[]) {
    const t0 = now();
    this.books = books;
    this.model = new g.Model("sb", "en", "UTC", "en");
    try { this.build(books); } catch (e) { this.model.free(); throw e; }
    this.ms.build = now() - t0;
    const t1 = now(); this.model.evaluate(); this.ms.evaluate = now() - t1;
  }
  private unreadable = 0;
  private build(books: CalcBook[]) {
    let unreadable = 0, first = true, n = 0;
    const used = new Set<string>();
    for (const [bi, b] of books.entries()) for (const S of b.sheets) {
      if (!first) this.model.newSheet(); first = false;
      let internal = b.name === null ? S.name : mangle(bi, S.name, used);
      try { this.model.renameSheet(n, internal); } catch { internal = mangle(bi, "Sheet" + n, used); this.model.renameSheet(n, internal); }
      used.add(internal.toLowerCase());
      const key = b.name + "\u0000" + S.name;
      this.ix.set(key, n); this.names.set(key, quoteSheet(internal));
      unreadable += S.unreadableFormulas || 0;
      n++;
    }
    this.unreadable = unreadable;
    this.model.pauseEvaluation();
    try {
      const st = this.model.getCellStyle(0, 1, 1).style;
      this.model.createNamedStyle("sbprecise", { ...st, num_fmt: PRECISE }, { number_format: true, font: false, fill: false, border: false, alignment: false, protection: false });
    } catch (e) { this.styleError = String((e as Error)?.message || e); }
    for (const b of books) for (const S of b.sheets) this.load(b, S);
    this.model.resumeEvaluation();
  }

  /** every cell of a sheet into the engine: numbers in one tab-separated paste per used box (fast), everything else cell by cell */
  private load(b: CalcBook, S: Sheet) {
    const C = S.cols?.cells; if (!C || !C.n) return;
    const si = this.ix.get(b.name + "\u0000" + S.name)!, ctx = S.ctx;
    const { rows, cols } = usedRange(S);
    // array formulas own their ranges: the cached values Excel wrote into them are not constants
    const arrays: { r1: number; c1: number; r2: number; c2: number }[] = [];
    for (const [i, ref] of C.arr) { const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref); if (!m) continue; void i; arrays.push({ r1: +m[2], c1: colNum(m[1]), r2: m[4] ? +m[4] : +m[2], c2: m[3] ? colNum(m[3]) : colNum(m[1]) }); }
    const inArray = (r: number, c: number) => arrays.some(a => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2);
    const dense = rows * cols <= 4 * C.n && rows * cols <= 2_000_000;
    const csv: string[] | null = dense ? [] : null;
    let line: string[] = [], lineRow = 1, firstNum: [number, number] | null = null;
    // the engine's "csv" is tab-separated, every line `cols` fields
    const flushLine = () => { if (csv) { while (line.length < cols) line.push(""); csv.push(line.join("\t")); line = []; } };
    const later: [number, number, string][] = [];
    let fmlBox: { r1: number; c1: number; r2: number; c2: number } | null = null;
    for (let k = 0; k < C.rows.length; k++) {
      const r = C.rows[k];
      if (csv) { while (lineRow < r) { flushLine(); lineRow++; } }
      for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) {
        const c = C.col[i], kind = C.kind[i], v = C.num[i], fk = C.fml.get(i);
        if (fk !== undefined) {
          const text = this.prep(C.fmls[fk], b, S);
          const arr = C.arr.get(i);
          this.formulas.push({ book: b.name, sheet: S.name, r, c, text: C.fmls[fk], ...(arr ? { array: arr } : {}) });
          fmlBox = fmlBox ? { r1: Math.min(fmlBox.r1, r), c1: Math.min(fmlBox.c1, c), r2: Math.max(fmlBox.r2, r), c2: Math.max(fmlBox.c2, c) } : { r1: r, c1: c, r2: r, c2: c };
          if (text === null) { (this.lastHidden ? this.hiddenCells : this.externalCells).add(b.name + "\u0000" + S.name + "\u0000" + r + "," + c); continue; }
          if (arr) { const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(arr); const w = m && m[3] ? colNum(m[3]) - colNum(m[1]) + 1 : 1, h = m && m[4] ? +m[4] - +m[2] + 1 : 1; later.push([r, c, "\u0001" + w + "," + h + "," + text]); }
          else later.push([r, c, "=" + text]);
          continue;
        }
        if (inArray(r, c)) continue;
        if (kind === Kind.Num || kind === Kind.Date) {
          if (csv) { while (line.length < c - 1) line.push(""); line.push(String(v)); firstNum ??= [r, c]; }
          else later.push([r, c, String(v)]);
        } else if (kind === Kind.Bool) later.push([r, c, v ? "TRUE" : "FALSE"]);
        else if (kind === Kind.Err) later.push([r, c, C.strs[v]]);
        else if (kind === Kind.Shared || kind === Kind.Str) { const s = kind === Kind.Shared ? ctx.sst[v] ?? "" : C.strs[v]; if (s) later.push([r, c, "'" + s]); }
      }
    }
    if (csv) {
      flushLine();
      let pasted = false;
      try {
        this.model.setSelectedSheet(si); this.model.setSelectedCell(1, 1);
        this.model.pasteCsvText({ sheet: si, row: 1, column: 1, width: cols, height: csv.length }, csv.join("\n"));
        pasted = firstNum === null || this.model.getFormattedCellValue(si, firstNum[0], firstNum[1]) !== "";   // proof: the first number is there
      } catch { pasted = false; }
      if (!pasted) {
        // the paste refused (an odd value): every number cell by cell
        for (let k = 0; k < C.rows.length; k++) for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) if ((C.kind[i] === Kind.Num || C.kind[i] === Kind.Date) && C.fml.get(i) === undefined && !inArray(C.rows[k], C.col[i])) this.model.setUserInput(si, C.rows[k], C.col[i], String(C.num[i]));
      }
    }
    for (const [r, c, text] of later) {
      try {
        if (text.charCodeAt(0) === 1) { const m = /^\u0001(\d+),(\d+),([\s\S]*)$/.exec(text)!; this.model.setUserArrayFormula(si, r, c, +m[1], +m[2], "=" + m[3]); }
        else this.model.setUserInput(si, r, c, text);
      } catch { /* a value the engine refuses stays empty: the self-check reports the cells that read it */ }
    }
    // the read-back format on the formula cells (their bounding box when small, else each cell)
    if (fmlBox) {
      try {
        this.model.setSelectedSheet(si);
        if ((fmlBox.r2 - fmlBox.r1 + 1) * (fmlBox.c2 - fmlBox.c1 + 1) <= 20000) { this.model.setSelectedCell(fmlBox.r1, fmlBox.c1); this.model.setSelectedRange(fmlBox.r1, fmlBox.c1, fmlBox.r2, fmlBox.c2); this.model.onApplyNamedStyle("sbprecise"); }
        else for (const f of this.formulas) if (f.book === b.name && f.sheet === S.name) { this.model.setSelectedCell(f.r, f.c); this.model.onApplyNamedStyle("sbprecise"); }
      } catch (e) { this.styleError = String((e as Error)?.message || e); }
    }
  }

  /** a formula as the engine takes it: Excel's _xlfn./_xlws./_xlpm. prefixes dropped, "[n]Sheet" references renamed to
      the linked workbook's internal sheets (null when that workbook is not in the model), whole columns / rows bounded
      to the used range of their sheet (not inside OFFSET, INDIRECT, ROW(S), COLUMN(S)) */
  /** set by prep(): the last null was a hidden sheet's reference (else a linked workbook's) */
  private lastHidden = false;
  prep(text: string, b: CalcBook, S: Sheet): string | null {
    const toks = tokenize(text);
    const stack: string[] = []; let out = "", external = false, hidden = false;
    this.lastHidden = false;
    for (const t of toks) {
      if (t.kind === "str") { out += t.s; continue; }
      if (t.kind === "text") {
        // function names and parentheses: which call the following references sit in
        const s = t.s.replace(/_xl(?:fn|ws|pm)\./g, "");
        for (const m of s.matchAll(/([A-Za-z_][\w.]*)\s*\(|[()]/g)) { if (m[1]) stack.push(m[1].toUpperCase()); else if (m[0] === "(") stack.push(""); else stack.pop(); }
        out += s; continue;
      }
      out += this.ref(t, b, S, stack.some(f => UNBOUNDED.has(f)), () => { external = true; }, () => { hidden = true; });
    }
    this.lastHidden = hidden && !external;
    return external || hidden ? null : out;
  }
  private ref(t: Extract<FToken, { kind: "ref" }>, b: CalcBook, S: Sheet, unbounded: boolean, markExternal: () => void, markHidden: () => void): string {
    // the sheet the reference names: this one, another of the same book, or a sheet of a linked book
    let book = b, sheetName = S.name, prefix = "";
    if (t.sheet !== null) {
      const m = /^\[(\d+)\](.*)$/.exec(t.sheet);
      if (m) {
        const file = b.externals[+m[1] - 1], linked = file ? this.books.find(x => (x.name ?? x.file ?? "").toLowerCase() === file.toLowerCase()) : undefined;
        if (!linked) { markExternal(); return t.s; }
        book = linked; sheetName = m[2];
      } else sheetName = t.sheet;
      const key = book.name + "\u0000" + sheetName, q = this.names.get(key);
      if (q === undefined) {
        if (book.hidden?.some(h => h.toLowerCase() === sheetName.toLowerCase())) markHidden();   // a hidden sheet: never read (WB-18)
        return t.s;                                                   // an unknown sheet: left as written (#REF! in the engine)
      }
      prefix = q + "!";
    }
    const body = t.s.slice(t.s.length - t.s.replace(/^.*!/, "").length);
    if (unbounded || (t.r1 !== null && t.c1 !== null)) return prefix + body;
    const target = book.sheets.find(x => x.name === sheetName); if (!target) return prefix + body;
    const u = usedRange(target);
    if (t.r1 === null) return prefix + (t.c1Abs ? "$" : "") + numToCol(t.c1!) + "$1:" + (t.c2Abs ? "$" : "") + numToCol(t.c2!) + "$" + u.rows;   // A:A → A$1:A$<rows>
    return prefix + "$A" + (t.r1Abs ? "$" : "") + t.r1 + ":$" + numToCol(u.cols) + (t.r2Abs ? "$" : "") + t.r2;                           // 1:1 → $A1:$<cols>1
  }

  /** a constant into a cell (the scenario's input): a number, a text (kept as text) or a boolean; false when the
      sheet is not in the model */
  set(book: string | null, sheet: string, r: number, c: number, value: number | string | boolean): boolean {
    const si = this.ix.get(book + "\u0000" + sheet); if (si === undefined) return false;
    this.model.setUserInput(si, r, c, typeof value === "number" ? String(value) : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : "'" + value);
    return true;
  }
  evaluate() { this.model.evaluate(); }
  /** the value of a cell as the engine holds it */
  valueOf(book: string | null, sheet: string, r: number, c: number): CellValue {
    const si = this.ix.get(book + "\u0000" + sheet); if (si === undefined) return null;
    const t = this.model.getCellType(si, r, c);
    if (t === CELL_NUMBER) { const s = this.model.getFormattedCellValue(si, r, c); return s === "" ? null : parseFloat(s); }
    if (t === CELL_TEXT) return this.model.getFormattedCellValue(si, r, c);
    if (t === CELL_BOOL) return this.model.getFormattedCellValue(si, r, c) === "TRUE";
    if (t === CELL_ERROR) return { err: this.model.getFormattedCellValue(si, r, c) };
    return null;
  }
  /** every formula cell's value, in `formulas` order */
  values(): CellValue[] { return this.formulas.map(f => this.valueOf(f.book, f.sheet, f.r, f.c)); }

  /** the self-check of 07 §1.4 (4): every formula cell against the workbook's cached value */
  selfCheck(): SelfCheck {
    const counts: Record<CheckClass, number> = { exact: 0, volatile: 0, locale: 0, external: 0, hidden: 0, unreadable: this.unreadable, different: 0 };
    const different: SelfCheck["different"] = [];
    for (const f of this.formulas) {
      const S = this.books.find(b => b.name === f.book)!.sheets.find(s => s.name === f.sheet)!;
      const cell = S.get(f.r, f.c), cached: CellValue = !cell || cell.t === "blank" ? null : cell.t === "e" ? { err: String(cell.v) } : (cell.v as CellValue);
      const computed = this.valueOf(f.book, f.sheet, f.r, f.c);
      const ck = f.book + "\u0000" + f.sheet + "\u0000" + f.r + "," + f.c;
      if (this.externalCells.has(ck)) { counts.external++; continue; }
      if (this.hiddenCells.has(ck)) { counts.hidden++; continue; }
      if (sameValue(computed, cached)) { counts.exact++; continue; }
      if (VOLATILE.test(f.text)) { counts.volatile++; continue; }
      if (LOCALE.test(f.text)) { counts.locale++; continue; }
      counts.different++;
      if (different.length < 200) different.push({ book: f.book, sheet: f.sheet, ref: numToCol(f.c) + f.r, text: f.text, cached, computed });
    }
    return { counts, different };
  }
  dispose() { this.model.free(); }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const colNum = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
/** an internal sheet name for a linked workbook's sheet: "«n»Sheet", at most 31 characters (the engine's limit, as
    Excel's), unique within the model; never saved anywhere */
function mangle(book: number, sheet: string, used: Set<string>): string {
  const head = "«" + book + "»";
  let name = (head + sheet).slice(0, 31), k = 1;
  while (used.has(name.toLowerCase())) { const suffix = "~" + k++; name = (head + sheet).slice(0, 31 - suffix.length) + suffix; }
  return name;
}
export type { SheetColumns };
