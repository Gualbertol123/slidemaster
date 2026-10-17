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
     linked workbook that is not available) / unreadable (an .xlsb formula that could not be decompiled) / different;
   * a locale-dependent cell (TEXT with this PC's Excel codes, e.g. Italian "mmmm aaaa") that the engine computes
     otherwise than Excel keeps Excel's cached value as a constant (07 §8 Q8, "keep and mark"): the cells that read it
     get Excel's value, under a scenario too (where it does not follow the input); the self-check counts it `locale`.
   The WASM is instantiated on first use (never on the open path, B23). Nothing here touches the DOM. */
import { unzlibSync } from "fflate";
import type { Sheet } from "../xlsx/types";
import { Kind, type SheetColumns } from "../xlsx/sheetstore";
import { numToCol } from "../xlsx/util";
import { parseSheetId, tokenize, type FToken } from "./refs";
import { quoteSheet } from "../xlsx/xlsb/formula";
import type { Model as IronModel } from "./wasm/ironcalc-glue";
import { excelText, qualify, textCalls } from "./textfmt";
import { rewriteRangeIndex } from "./rangeindex";

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

/** a workbook of the model: the deck's (`name` null) or a linked one by file name. A linked workbook's sheets may be
    named by their plain names or by their sheet ids "[File.xlsx]Sheet" (as the deck's workbook holds them after
    attachLinked): the engine uses the plain name */
export interface CalcBook { name: string | null; /** the deck's workbook's own file name (what linked workbooks' formulas call it) */ file?: string; sheets: Sheet[];
  /** the workbook's hidden sheets (never read, WB-18): a formula that names one is classed `hidden` */ hidden?: string[]; externals: string[];
  /** its defined names (workbook.ts `names`): given to the engine before the cells */ names?: { name: string; scope: string | null; formula: string }[] }
export type CellValue = number | string | boolean | { err: string } | null;
export interface FormulaCell { book: string | null; sheet: string; r: number; c: number; text: string; array?: string }
export type CheckClass = "exact" | "volatile" | "locale" | "external" | "hidden" | "unreadable" | "different";
export interface SelfCheck {
  counts: Record<CheckClass, number>;
  /** the cells that differ from Excel's cached value (first 200), with both values */
  different: { book: string | null; sheet: string; ref: string; text: string; cached: CellValue; computed: CellValue }[];
  /** every different cell (not only the first 200): the run's gate checks the slides against all of them (S8.3) */
  allDifferent: SelfCheck["different"];
  /** formula cells counted exact whose TEXT Slide Builder formats as Italian Excel does (textfmt.ts): shown apart */
  textFormatted: number;
  /** the locale-dependent cells kept at Excel's cached value (07 §8 Q8; first 200): a scenario does not move them */
  pinned: { book: string | null; sheet: string; ref: string; text: string; cached: CellValue }[];
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
    const t1 = now();
    try {
      // TEXT is Slide Builder's from the start (Decisions 2026-10-17): its texts written after the first evaluation (one
      // more), so a workbook made in Italian Excel costs the two evaluations it did before; a cell whose result is not
      // Excel's saved text goes back to its formula (one more), and is kept at that text when the engine differs too
      this.model.pauseEvaluation();
      let own: OwnText[] = [];
      try { own = this.ownTextCells(); } finally { this.model.resumeEvaluation(); }
      this.textCells = own.flatMap(o => o.calls);
      this.evaluate();
      if (this.settleText(own)) this.evaluate();
      if (this.pinLocale()) this.evaluate();
    } catch (e) { this.model.free(); throw e; }
    this.ms.evaluate = now() - t1;
    this.baseline = this.values();
  }
  /** the locale-dependent cells kept at Excel's cached value (keys as externalCells) */
  private readonly pinned = new Set<string>();
  /** Excel's cached value of a formula cell, from the workbook as read */
  private cachedOf(f: FormulaCell): CellValue {
    const S = this.books.find(b => b.name === f.book)!.sheets.find(s => plainName(s) === f.sheet)!;
    const cell = S.get(f.r, f.c);
    return !cell || cell.t === "blank" ? null : cell.t === "e" ? { err: String(cell.v) } : (cell.v as CellValue);
  }
  /** 07 §8 Q8 ("keep and mark"): every TEXT cell whose engine value is not Excel's becomes Excel's cached value, a
      constant; the number of cells pinned (the model is evaluated again when there are any) */
  /** the TEXT cells formatted by Slide Builder whose result is not Excel's saved text (an English-coded workbook, a
      format it does not know) go back to their own formula; how many did (the model is evaluated again then) */
  private settleText(own: OwnText[]): number {
    const back = own.filter(o => !sameValue(this.valueOf(o.f.book, o.f.sheet, o.f.r, o.f.c), this.cachedOf(o.f)));
    if (back.length) {
      const gone = new Set(back.flatMap(o => o.calls));
      this.textCells = this.textCells.filter(t => !gone.has(t));
      this.model.pauseEvaluation();
      try { for (const o of back) this.model.setUserInput(o.si, o.f.r, o.f.c, o.content); } finally { this.model.resumeEvaluation(); }
    }
    for (const o of own) if (!back.includes(o)) this.ownText.add(o.key);
    return back.length;
  }
  /** what still differs from Excel's saved text among the TEXT cells is kept at that text (07 §8 Q8); how many */
  private pinLocale(): number {
    this.model.pauseEvaluation();                                  // (each input would evaluate the whole model)
    try { this.pinCells(); } finally { this.model.resumeEvaluation(); }
    return this.pinned.size;
  }
  /** the TEXT calls Slide Builder formats (helper cells A = the value, B = the format, C = the text the formula reads) */
  private textCells: TextCall[] = [];
  /** the formula cells whose TEXT is Slide Builder's (keys as externalCells): they recompute like Excel */
  private readonly ownText = new Set<string>();
  /** TEXT calls whose texts were still changing after the last round of the last evaluation (0: settled) */
  textUnsettled = 0;
  /** TEXT calls of the last evaluation whose text Slide Builder could not say (kept the one they had) */
  textUnknown = 0;
  /** the locale-dependent cells (TEXT whose engine value is not Excel's): each TEXT call's value and format moved to
      cells of a sheet of the model's own, the formula reading the text Slide Builder writes there (formatTexts) */
  private ownTextCells(): OwnText[] {
    const out: OwnText[] = [];
    let row = 0; const sheet = this.textSheet;
    for (const f of this.formulas) {
      if (!LOCALE.test(f.text) || VOLATILE.test(f.text) || f.array) continue;
      const key = f.book + "\u0000" + f.sheet, ck = key + "\u0000" + f.r + "," + f.c, si = this.ix.get(key);
      if (si === undefined || this.externalCells.has(ck) || this.hiddenCells.has(ck)) continue;
      const calls = textCalls(f.text.replace(/^=/, ""));
      // a format both languages read alike ("00", "0%": no letters, no "." or ",") stays the engine's (no cost)
      if (!calls || !calls.some(c => !/^"[^"]*"$/.test(c.format) || /[aAgGdDyYmM.,]/.test(c.format))) continue;
      const b = this.books.find(x => x.name === f.book)!, S = b.sheets.find(x => plainName(x) === f.sheet)!;
      const own = quoteSheet(f.sheet) + "!", src = f.text.replace(/^=/, "");
      const content = this.model.getCellContent(si, f.r, f.c);
      const made: TextCall[] = []; let text = "", at = 0, ok = true;
      for (const call of calls) {
        const v = this.prep(qualify(call.value, own), b, S), fm = this.prep(qualify(call.format, own), b, S);
        if (v === null || fm === null) { ok = false; break; }
        const sheet = this.textSheet!;
        row++;
        // a cell that is one TEXT call and nothing else: Excel's saved text is the call's text – written at once, so the
        // first evaluation already gives it and no second one is needed when Slide Builder's formatting agrees (BanksBig:
        // the first use within budget again); otherwise the text comes after the first evaluation (formatTexts)
        const cached = this.cachedOf(f), whole = calls.length === 1 && call.start === 0 && call.end === src.length && typeof cached === "string";
        const first = whole ? "'" + cached : "'";
        try { this.model.setUserInput(sheet.index, row, 1, "=" + v); this.model.setUserInput(sheet.index, row, 2, "=" + fm); this.model.setUserInput(sheet.index, row, 3, first); }
        catch { ok = false; break; }
        made.push({ si: sheet.index, row, text: whole ? first : null });
        text += src.slice(at, call.start) + quoteSheet(sheet.name) + "!$C$" + row; at = call.end;
      }
      if (!ok) continue;
      const formula = this.prep(text + src.slice(at), b, S);
      if (formula === null) continue;
      try { this.model.setUserInput(si, f.r, f.c, "=" + formula); } catch { continue; }
      out.push({ f, si, key: ck, content, calls: made });
    }
    // the values and formats read back at 15 significant digits, as the formula cells (the engine's General display
    // rounds large amounts): one range
    if (sheet && row) {
      try { this.model.setSelectedSheet(sheet.index); this.model.setSelectedCell(1, 1); this.model.setSelectedRange(1, 1, row, 2); this.model.onApplyNamedStyle("sbprecise"); }
      catch (e) { this.styleError = String((e as Error)?.message || e); }
    }
    return out;
  }
  /** the texts of the TEXT calls Slide Builder formats, after an evaluation: written where their formulas read them,
      evaluated again until nothing changes (a text that feeds another TEXT: a few rounds) */
  private formatTexts() {
    this.textUnsettled = 0; this.textUnknown = 0;
    for (let round = 0; round < 8; round++) {
      let changed = false; this.textUnknown = 0;
      this.model.pauseEvaluation();
      try {
        for (const t of this.textCells) {
          // the text; an error passed to TEXT is TEXT's result too; what Slide Builder cannot say (a date before March
          // 1900, a logical) keeps the text it had – Excel's at the start – and is counted (textUnknown), never invented
          const v = this.valueAt(t.si, t.row, 1), fm = this.valueAt(t.si, t.row, 2), txt = excelText(v, fm);
          if (txt === null && !(v && typeof v === "object")) { this.textUnknown++; continue; }
          const content = txt !== null ? "'" + txt : (v as { err: string }).err;
          if (content === t.text) continue;
          t.text = content; changed = true;
          this.model.setUserInput(t.si, t.row, 3, content);
        }
      } finally { this.model.resumeEvaluation(); }
      if (!changed) return;
      if (round === 7) this.textUnsettled = this.textCells.length;     // still moving after the last round: said so
      this.model.evaluate();
    }
  }
  /** one pass: a TEXT cell that reads another pinned one is pinned too (it might have been right after the first) */
  private pinCells() {
    for (const f of this.formulas) {
      // not an array formula (the engine refuses a constant inside an array), nor a cell never loaded (external, hidden)
      if (!LOCALE.test(f.text) || VOLATILE.test(f.text) || f.array) continue;
      const key = f.book + "\u0000" + f.sheet, ck = key + "\u0000" + f.r + "," + f.c, si = this.ix.get(key);
      if (si === undefined || this.externalCells.has(ck) || this.hiddenCells.has(ck)) continue;
      const cached = this.cachedOf(f);
      if (sameValue(this.valueOf(f.book, f.sheet, f.r, f.c), cached)) continue;
      try {
        this.model.setUserInput(si, f.r, f.c, cached === null ? "" : typeof cached === "number" ? String(cached)
          : typeof cached === "boolean" ? (cached ? "TRUE" : "FALSE") : typeof cached === "object" ? cached.err : "'" + cached);
      } catch { continue; }                                      // left as the engine computes it (counted locale, as before)
      this.pinned.add(ck);
      this.pinnedCells.push({ book: f.book, sheet: f.sheet, ref: numToCol(f.c) + f.r, text: f.text, cached });
    }
  }
  /** the cells kept at Excel's value: a scenario does not move them (S8.3 marks them in the run's report) */
  readonly pinnedCells: SelfCheck["pinned"] = [];
  /** every formula cell's value right after the build: what a scenario's changes are measured against (a cell the
      self-check classes `different` keeps Excel's cached value in the deck until a scenario moves it) */
  baseline: CellValue[] = [];
  /** the formula cells whose value differs from the baseline, by sheet id ("Sheet" or "[File.xlsx]Sheet") and "r,c" */
  changes(): Map<string, Map<string, CellValue>> {
    const out = new Map<string, Map<string, CellValue>>();
    this.formulas.forEach((f, i) => {
      const v = this.valueOf(f.book, f.sheet, f.r, f.c);
      if (sameValue(v, this.baseline[i])) return;
      const id = f.book === null ? f.sheet : "[" + f.book + "]" + f.sheet;
      let m = out.get(id); if (!m) out.set(id, m = new Map()); m.set(f.r + "," + f.c, v);
    });
    return out;
  }
  /** what a cell holds in the engine, as the engine itself writes it: a constant, a formula ("=…"), or "" for an empty
      cell – what `restore` puts back after a scenario moved the cell */
  contentOf(book: string | null, sheet: string, r: number, c: number): string {
    const si = this.ix.get(book + "\u0000" + sheet); return si === undefined ? "" : this.model.getCellContent(si, r, c);
  }
  restore(book: string | null, sheet: string, r: number, c: number, content: string): boolean {
    const si = this.ix.get(book + "\u0000" + sheet); if (si === undefined) return false;
    this.model.pauseEvaluation();
    try { this.model.setUserInput(si, r, c, content); } finally { this.model.resumeEvaluation(); }
    return true;
  }
  private unreadable = 0;
  /** sheets of the model's own (defined names given through cells, TEXT formatted by Slide Builder): never a Sheet of a
      workbook, so never in `ix`, `formulas`, the self-check or the views */
  private extraSheets = 0;
  /** SHEETS() without a reference counts every sheet of the model: the model's own ones taken off (outside strings) */
  private ownSheetsOut(text: string | null): string | null {
    if (text === null || !this.extraSheets || !/SHEETS\s*\(\s*\)/i.test(text)) return text;
    return text.split('"').map((part, i) => i % 2 ? part : part.replace(/((?:_xlfn\.)?SHEETS\s*\(\s*\))/gi, "($1-" + this.extraSheets + ")")).join('"');
  }
  /** the sheet of the model's own that Slide Builder's TEXT writes into (made with the model) */
  private textSheet: { index: number; name: string } | null = null;
  private helperSheet(base: string): { index: number; name: string } {
    this.model.newSheet(); const index = this.ix.size + this.extraSheets++;
    // a name no sheet of the workbooks has (Excel allows « » in sheet names: tried until one is free)
    for (let k = 0; k <= 50; k++) { const name = "«" + base + (k || "") + "»"; try { this.model.renameSheet(index, name); return { index, name }; } catch { /* taken */ } }
    throw new Error("no sheet name for the model's own " + base);
  }
  private build(books: CalcBook[]) {
    let unreadable = 0, first = true, n = 0;
    const used = new Set<string>();
    for (const [bi, b] of books.entries()) for (const S of b.sheets) {
      if (!first) this.model.newSheet(); first = false;
      const plain = plainName(S);
      let internal = b.name === null ? plain : mangle(bi, plain, used);
      try { this.model.renameSheet(n, internal); } catch { internal = mangle(bi, "Sheet" + n, used); this.model.renameSheet(n, internal); }
      used.add(internal.toLowerCase());
      const key = b.name + "\u0000" + plain;
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
    // the sheet Slide Builder's TEXT writes into, made before any cell is loaded: renaming a sheet makes the engine
    // revisit every formula, which costs ~100 ms once 1,000 formulas are in (BanksBig) and nothing now
    this.textSheet = this.helperSheet("text");
    this.defineNames(books);
    for (const b of books) for (const S of b.sheets) this.load(b, S);
    this.model.resumeEvaluation();
  }

  /** the defined names not given to the engine ("<book>!<name>"): a name another book of the model defines already (its
      cells then read that book's – the self-check reports them if that differs from Excel), or one whose formula names
      a workbook that is not in the model. Known limits of a name given through a cell (a constant or a formula): a name
      that returns a range (OFFSET(…), INDEX(…):INDEX(…)) becomes the value of that range's first cell, a sheet-level
      one reads other names as the workbook does, a relative one is anchored – the self-check reports what differs.
      The .xlsb reader gives no names yet (its formulas that use names differ, and are reported) */
  readonly namesSkipped: string[] = [];
  /** the books' defined names, their references rewritten as cell formulas' are (a linked workbook's sheets by their
      internal names, whole columns bounded); a sheet-level name scoped to that sheet. One namespace for the model: a
      name the deck's workbook defines wins over a linked workbook's of the same name */
  private defineNames(books: CalcBook[]) {
    const seen = new Set<string>();
    // the engine takes a reference only: a constant or a formula ("0.24", "SUMIFS(…)") goes into a cell of a sheet of the
    // model's own, and the name points at that cell (the sheet is never shown: no Sheet of the workbook names it)
    let helper: number | null = null, row = 0, helperName = "«names»";
    const cellFor = (text: string): string => {
      if (helper === null) ({ index: helper, name: helperName } = this.helperSheet("names"));
      this.model.setUserInput(helper, ++row, 1, "=" + text);
      return quoteSheet(helperName) + "!$A$" + row;
    };
    const define = (name: string, scope: number | null, text: string) => {
      try { this.model.newDefinedName(name, scope, text); }                       // (the formula without "=")
      catch { this.model.newDefinedName(name, scope, cellFor(text)); }
    };
    for (const b of books) {
      const S0 = b.sheets[0]; if (!S0) continue;
      for (const n of b.names || []) {
        const scope = n.scope === null ? null : this.ix.get(b.name + "\u0000" + n.scope);
        if (scope === undefined) continue;                               // a hidden or unread sheet's own name
        const key = n.name.toLowerCase() + "|" + (scope ?? "");
        const text = this.prep(n.formula.replace(/^=/, ""), b, S0);
        if (seen.has(key) || text === null) { this.namesSkipped.push((b.name ?? "") + "!" + n.name); continue; }
        try { define(n.name, scope, text); seen.add(key); }
        catch { this.namesSkipped.push((b.name ?? "") + "!" + n.name); }
      }
    }
  }
  /** every cell of a sheet into the engine: numbers in one tab-separated paste per used box (fast), everything else cell by cell */
  private load(b: CalcBook, S: Sheet) {
    const C = S.cols?.cells; if (!C || !C.n) return;
    const sheet = plainName(S), si = this.ix.get(b.name + "\u0000" + sheet)!, ctx = S.ctx;
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
          const text = this.ownSheetsOut(this.prep(C.fmls[fk], b, S));
          const arr = C.arr.get(i);
          this.formulas.push({ book: b.name, sheet, r, c, text: C.fmls[fk], ...(arr ? { array: arr } : {}) });
          fmlBox = fmlBox ? { r1: Math.min(fmlBox.r1, r), c1: Math.min(fmlBox.c1, c), r2: Math.max(fmlBox.r2, r), c2: Math.max(fmlBox.c2, c) } : { r1: r, c1: c, r2: r, c2: c };
          if (text === null) {
            (this.lastHidden ? this.hiddenCells : this.externalCells).add(b.name + "\u0000" + sheet + "\u0000" + r + "," + c);
            // a cell the engine cannot compute (it reads a workbook not in the folder, a hidden sheet not read) keeps
            // Excel's saved value, so the cells that read it compute from that, not from an empty cell (found on the
            // product owner's deck, 2026-10-18: those cells were 0)
            const cached = kind === Kind.Num || kind === Kind.Date ? String(v) : kind === Kind.Bool ? (v ? "TRUE" : "FALSE") : kind === Kind.Err ? C.strs[v]
              : kind === Kind.Shared || kind === Kind.Str ? "'" + ((kind === Kind.Shared ? ctx.sst[v] : C.strs[v]) ?? "") : null;
            if (cached !== null && !arr) later.push([r, c, cached]);
            continue;
          }
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
        else for (const f of this.formulas) if (f.book === b.name && f.sheet === sheet) { this.model.setSelectedCell(f.r, f.c); this.model.onApplyNamedStyle("sbprecise"); }
      } catch (e) { this.styleError = String((e as Error)?.message || e); }
    }
  }

  /** a formula as the engine takes it: Excel's _xlfn./_xlws./_xlpm. prefixes dropped, "[n]Sheet" references renamed to
      the linked workbook's internal sheets (null when that workbook is not in the model), whole columns / rows bounded
      to the used range of their sheet (not inside OFFSET, INDIRECT, ROW(S), COLUMN(S)) */
  /** set by prep(): the last null was a hidden sheet's reference (else a linked workbook's) */
  private lastHidden = false;
  prep(text: string, b: CalcBook, S: Sheet): string | null {
    const toks = tokenize(rewriteRangeIndex(text));                  // (A:INDEX(…) ranges as OFFSET: rangeindex.ts)
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
    let book = b, sheetName = plainName(S), prefix = "";
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
    const target = book.sheets.find(x => plainName(x) === sheetName); if (!target) return prefix + body;
    const u = usedRange(target);
    if (t.r1 === null) return prefix + (t.c1Abs ? "$" : "") + numToCol(t.c1!) + "$1:" + (t.c2Abs ? "$" : "") + numToCol(t.c2!) + "$" + u.rows;   // A:A → A$1:A$<rows>
    return prefix + "$A" + (t.r1Abs ? "$" : "") + t.r1 + ":$" + numToCol(u.cols) + (t.r2Abs ? "$" : "") + t.r2;                           // 1:1 → $A1:$<cols>1
  }

  /** a constant into a cell (the scenario's input): a number, a text (kept as text) or a boolean; false when the
      sheet is not in the model */
  set(book: string | null, sheet: string, r: number, c: number, value: number | string | boolean): boolean {
    const si = this.ix.get(book + "\u0000" + sheet); if (si === undefined) return false;
    // (paused: setUserInput alone evaluates the whole model; the caller evaluates once – found by the large corpus, M8)
    this.model.pauseEvaluation();
    try { this.model.setUserInput(si, r, c, typeof value === "number" ? String(value) : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : "'" + value); }
    finally { this.model.resumeEvaluation(); }
    return true;
  }
  evaluate() { this.model.evaluate(); if (this.textCells.length) this.formatTexts(); }
  /** the value of a cell as the engine holds it */
  valueOf(book: string | null, sheet: string, r: number, c: number): CellValue {
    const si = this.ix.get(book + "\u0000" + sheet); if (si === undefined) return null;
    return this.valueAt(si, r, c);
  }
  private valueAt(si: number, r: number, c: number): CellValue {
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
      const cached = this.cachedOf(f), computed = this.valueOf(f.book, f.sheet, f.r, f.c);
      const ck = f.book + "\u0000" + f.sheet + "\u0000" + f.r + "," + f.c;
      if (this.externalCells.has(ck)) { counts.external++; continue; }
      if (this.hiddenCells.has(ck)) { counts.hidden++; continue; }
      if (this.pinned.has(ck)) { counts.locale++; continue; }
      if (sameValue(computed, cached)) { counts.exact++; continue; }
      if (VOLATILE.test(f.text)) { counts.volatile++; continue; }
      if (LOCALE.test(f.text)) { counts.locale++; continue; }
      counts.different++;
      different.push({ book: f.book, sheet: f.sheet, ref: numToCol(f.c) + f.r, text: f.text, cached, computed });
    }
    return { counts, different: different.slice(0, 200), allDifferent: different, pinned: this.pinnedCells.slice(0, 200), textFormatted: this.ownText.size };
  }
  dispose() { this.model.free(); }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** a sheet's plain name: without the "[File.xlsx]" of a sheet id */
const plainName = (S: Sheet) => parseSheetId(S.name).sheet;
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
/** a TEXT call Slide Builder formats: its row of helper cells, the content written last */
interface TextCall { si: number; row: number; text: string | null }
/** a formula cell whose TEXT calls Slide Builder formats; `content`: what it held before (put back when it does not match) */
interface OwnText { f: FormulaCell; si: number; key: string; content: string; calls: TextCall[] }
