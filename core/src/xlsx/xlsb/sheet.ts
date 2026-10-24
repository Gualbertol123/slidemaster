/* A worksheet part (sheetN.bin, MS-XLSB 2.1.7.62) into the same columns as the XML scanner (sheetstore.ts), with
   the sheet's format, columns, merges and conditional formats as workbook.ts reads them from the XML. Rows and
   cells come as BrtRowHdr followed by its BrtCell* / BrtFmla* records (values only: the formulas' cached results,
   as the XML's <v>). Resumable like the scanner: run(budget) reads up to `budget` records. */
import { ColumnsBuilder, type RowColumns, type SheetColumns } from "../sheetstore";
import type { Range } from "../util";
import type { CFRule, CFVO, ColInfo, Shared } from "../types";
import { Records, Rt, XlsbError, readColor, readRfx, recName } from "./records";
import { unsupportedOf } from "../cf";
import { asXlsxText, readRichStr } from "./strings";
import { readCfFormula, readParsedFormula } from "./formula";
import type { BinWorkbookInfo } from "./workbook";
import { shiftFormula } from "../../calc/refs";
import { A1 } from "../util";

const ERR: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A", 0x2b: "#GETTING_DATA" };
const CF_OP = ["", "between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
/** CFType (iType) and, for formula rules, CFTemp (iTemplate) → the type and operator styles.xml has for them */
function cfType(iType: number, tpl: number, param: number): { type: string; op: string | null } {
  switch (iType) {
    case 1: return { type: "cellIs", op: CF_OP[param] || null };
    case 3: return { type: "colorScale", op: null };
    case 4: return { type: "dataBar", op: null };
    case 5: return { type: "top10", op: null };
    case 6: return { type: "iconSet", op: null };
  }
  switch (tpl) {
    case 0x07: return { type: "uniqueValues", op: null };
    case 0x08: return [{ type: "containsText", op: "containsText" }, { type: "notContainsText", op: "notContains" }, { type: "beginsWith", op: "beginsWith" }, { type: "endsWith", op: "endsWith" }][param] || { type: "containsText", op: "containsText" };
    case 0x09: return { type: "containsBlanks", op: null };
    case 0x0a: return { type: "notContainsBlanks", op: null };
    case 0x0b: return { type: "containsErrors", op: null };
    case 0x0c: return { type: "notContainsErrors", op: null };
    case 0x19: case 0x1a: case 0x1d: case 0x1e: return { type: "aboveAverage", op: null };
    case 0x1b: return { type: "duplicateValues", op: null };
  }
  if (tpl >= 0x0f && tpl <= 0x18) return { type: "timePeriod", op: null };
  return { type: "expression", op: null };
}

/** what "not reproduced" says of an .xlsb's data bars */
export const XLSB_BAR_LOOK = "the 2010 look of data bars in an .xlsb (drawn as Excel 2007's)";
/** KPISets: the 2007 sets in their ST_IconSetType order, then the 2010 ones */
const KPI_SETS = ["3Arrows", "3ArrowsGray", "3Flags", "3TrafficLights1", "3TrafficLights2", "3Signs", "3Symbols", "3Symbols2", "4Arrows", "4ArrowsGray",
  "4RedToBlack", "4Rating", "4TrafficLights", "5Arrows", "5ArrowsGray", "5Rating", "5Quarters", "3Stars", "3Triangles", "5Boxes"];
/** CFVOtype */
const CFVO_TYPE: Record<number, string> = { 1: "num", 2: "min", 3: "max", 4: "percent", 5: "percentile", 7: "formula" };
/** CFTemp of the time periods (0x0F…0x18) */
const PERIODS = ["today", "tomorrow", "yesterday", "last7Days", "lastMonth", "nextMonth", "thisWeek", "nextWeek", "lastWeek", "thisMonth"];
/** a rule's parameters as the .xlsx reader has them (cf-read.ts ruleParts): BrtBeginCFRule's iParam, flags (fStopTrue 2,
    fAbove 4, fBottom 8, fPercent 16) and strParam */
function cfParams(rule: CFRule, tpl: number, param: number, flags: number, text: string | null) {
  if (text !== null && /^(containsText|notContainsText|beginsWith|endsWith)$/.test(rule.type)) rule.text = text;
  if (rule.type === "top10") { rule.rank = param; rule.percent = !!(flags & 16); rule.bottom = !!(flags & 8); }
  if (rule.type === "aboveAverage") { rule.above = tpl === 0x19 || tpl === 0x1d; rule.equal = tpl === 0x1d || tpl === 0x1e; rule.stdDev = param; }
  if (rule.type === "timePeriod") rule.period = PERIODS[tpl - 0x0f] || "today";
}

export interface BinSheet {
  store: SheetColumns; rows: RowColumns;
  colRanges: { min: number; max: number; info: ColInfo }[];
  merges: Range[]; cfRules: CFRule[]; unsupportedCF: Set<string>;
  defColW: number; defRowH: number; zeroH: boolean;
  /** (4.10.1) what could not be read and was skipped, in words for the Issues panel */
  notRead: string[];
  /** the cells with value metadata (pictures in cells, xlsx/cellimages.ts): [row, column, vm] */
  vms: [number, number, number][];
}

/** the records of a conditional format and its parts */
const CF_RECORDS = new Set<number>([Rt.BeginConditionalFormatting, Rt.BeginCFRule, Rt.BeginColorScale, Rt.BeginDatabar, Rt.BeginIconSet, Rt.CFVO, Rt.Color]);
const CELL_RECORDS = new Set<number>([Rt.CellBlank, Rt.CellRk, Rt.CellError, Rt.CellBool, Rt.CellReal, Rt.CellSt, Rt.CellIsst, Rt.FmlaString, Rt.FmlaNum, Rt.FmlaBool,
  Rt.FmlaError, Rt.CellRString, Rt.ShortBlank, Rt.ShortRk, Rt.ShortError, Rt.ShortBool, Rt.ShortReal, Rt.ShortSt, Rt.ShortIsst]);
const OTHER: Record<number, [string, string]> = {
  [Rt.RowHdr]: ["a row's height and format", "rows' heights and formats"], [Rt.ColInfo]: ["a column's width and format", "columns' widths and formats"],
  [Rt.MergeCell]: ["a merged range", "merged ranges"], [Rt.WsFmtInfo]: ["the default row height and column width", "the default row height and column width"],
};

export class BinSheetReader {
  private readonly r: Records;
  private readonly cols: ColumnsBuilder;
  private row = 0;
  /** the column of the row's last cell (0-based; -1 before the first): BrtShort* cells come right after it */
  private col = -1;
  private defColW = 8.43; private defRowH = 15; private zeroH = false;
  private readonly colRanges: BinSheet["colRanges"] = [];
  private readonly merges: Range[] = [];
  private readonly cfRules: CFRule[] = [];
  private readonly unsupportedCF = new Set<string>();
  private cfRanges: Range[] | null = null;
  /** the rule whose parts (thresholds, colours) follow, and which of them (S16.4) */
  private cfRule: CFRule | null = null;
  private cfPart: "scale" | "bar" | "icons" | null = null;
  private cfBase = { r: 1, c: 1 };
  private seen = false;
  /** the BrtValueMeta before the next cell record (0: none), and the cells that had one */
  private vm = 0;
  private readonly vms: [number, number, number][] = [];
  /* formulas (S7.1): a cell whose formula is a PtgExp waits for the BrtShrFmla / BrtArrFmla record that follows its
     master; the masters' texts, by "r,c", shift to the children */
  private pending: { r: number; c: number } | null = null;
  /** the shared / array formulas seen so far, by the master's row: the range of cells each covers and its text (null:
      it could not be read); a child cell's PtgExp names the master's row, the range says which master */
  private readonly masters = new Map<number, { g: Range; text: string | null; array: boolean }[]>();
  /** formula cells the reader could not decompile (reported by the self-check) */
  unreadable = 0;
  /** (4.10.1) records that could not be read, by type; a rule whose differential format was read only in part */
  private readonly lost = new Map<number, number>();
  private badDxfRule = false;
  /** sss: per font of styles.bin, 1 superscript / 2 subscript (the rich strings' raised parts); info: the workbook's
      names and sheet table for 3D references (without it they read as unreadable) */
  constructor(bytes: Uint8Array, private readonly ctx: Shared, private readonly sss: number[] = [], private readonly info?: BinWorkbookInfo, private readonly name?: string,
    private readonly badDxfs?: ReadonlySet<number>) { this.r = new Records(bytes); this.cols = new ColumnsBuilder(ctx); }
  get progress() { return this.r.progress; }
  /** the formula after a BrtFmla* value: its text goes to the cell just pushed; a PtgExp waits for the master's record */
  private cellFormula(rw: number, c: number) {
    const r = this.r;
    if (r.left < 2) return;
    r.u16();                                                          // grbitFlags
    const f = readParsedFormula(r, { r: rw, c }, this.info, false, this.name);
    if (f.exp) {
      const ms = this.masters.get(f.exp.r);
      if (ms) for (let k = ms.length - 1; k >= 0; k--) {
        const m = ms[k];
        if (rw < m.g.r1 || rw > m.g.r2 || c < m.g.c1 || c > m.g.c2) continue;
        if (m.text === null) this.unreadable++;                        // its master could not be read
        else if (!m.array) this.cols.formula(shiftFormula(m.text, rw - m.g.r1, c - m.g.c1));
        // a cell inside an array formula's range: no text of its own (the .xlsx scanner keeps none either)
        return;
      }
      this.pending = { r: rw, c };                                     // the master itself: BrtShrFmla / BrtArrFmla comes next
    } else if (f.text) this.cols.formula(f.text);
    else this.unreadable++;
  }

  /** reads up to `budget` records; true when the part is done */
  run(budget = Infinity): boolean {
    const r = this.r;
    for (let k = 0; k < budget; k++) {
      if (!r.rec()) return true;
      this.seen = true;
      // a record shorter than its contents is skipped (it loses that record, not the sheet) and named (4.10.1)
      try { this.record(); } catch (e) { if (!(e instanceof XlsbError)) throw e; this.skipped(); }
    }
    return false;
  }

  private skipped() {
    const t = this.r.type;
    if (CF_RECORDS.has(t)) {
      // the rule (or the parts of one) is not drawn: its later parts must not land on another rule
      if (t === Rt.BeginCFRule || this.cfRule) { const R = this.cfRule; if (R) this.cfRules.splice(this.cfRules.indexOf(R), 1); this.cfRule = null; this.cfPart = null; this.lost.set(Rt.BeginCFRule, (this.lost.get(Rt.BeginCFRule) || 0) + 1); }
      else if (t === Rt.BeginConditionalFormatting) { this.cfRanges = []; this.lost.set(Rt.BeginCFRule, (this.lost.get(Rt.BeginCFRule) || 0) + 1); }
      return;
    }
    if (t === Rt.ShrFmla || t === Rt.ArrFmla) { if (this.pending) this.unreadable++; this.pending = null; return; }
    this.lost.set(t, (this.lost.get(t) || 0) + 1);
  }
  /** what was skipped, in words */
  private notRead(): string[] {
    const out: string[] = [];
    const cf = this.lost.get(Rt.BeginCFRule) || 0;
    if (cf) out.push(cf > 1 ? `${cf} conditional formats could not be read and are not drawn` : "a conditional format could not be read and is not drawn");
    if (this.badDxfRule) out.push("the format of a conditional format could not be read entirely (drawn with the part that could)");
    for (const [t, n] of this.lost) {
      if (t === Rt.BeginCFRule) continue;
      if (CELL_RECORDS.has(t)) out.push(n > 1 ? `${n} cells could not be read (${recName(t)}) and are left empty` : `1 cell could not be read (${recName(t)}) and is left empty`);
      else { const w = OTHER[t]; out.push(w ? `${n > 1 && w[1] !== w[0] ? n + " " + w[1] : w[0]} could not be read (${recName(t)})` : `${n} record${n > 1 ? "s" : ""} could not be read (${recName(t)})`); }
    }
    return out;
  }

  private record() {
    const r = this.r, B = this.cols;
    switch (r.type) {
      case Rt.RowHdr: {
        const rw = r.u32() + 1, ixfe = r.u32(), h = r.u16(); r.u8(); const f = r.u8();
        this.row = rw; this.col = -1;
        // fDyZero (hidden), fGhostDirty (a row format: customFormat="1" in the XML)
        B.row(rw, h / 20, !!(f & 0x10), f & 0x40 ? ixfe : null);
        return;
      }
      case Rt.CellBlank: case Rt.CellRk: case Rt.CellError: case Rt.CellBool: case Rt.CellReal: case Rt.CellSt: case Rt.CellIsst:
      case Rt.FmlaString: case Rt.FmlaNum: case Rt.FmlaBool: case Rt.FmlaError: case Rt.CellRString:
      case Rt.ShortBlank: case Rt.ShortRk: case Rt.ShortError: case Rt.ShortBool: case Rt.ShortReal: case Rt.ShortSt: case Rt.ShortIsst: {
        // a short cell (Cell_Short) has no column: it is the one after the row's previous cell
        const short = r.type >= Rt.ShortBlank && r.type <= Rt.ShortIsst;
        const c0 = short ? this.col + 1 : r.u32(), x = B.xf(r.u32() & 0xffffff), rw = this.row, c = c0 + 1;
        this.col = c0;
        const vm = this.vm; this.vm = 0;
        if (c > 65535 || rw < 1) return;
        if (vm) this.vms.push([rw, c, vm]);
        switch (r.type) {
          case Rt.CellBlank: case Rt.ShortBlank: B.blank(rw, c, x); return;
          case Rt.CellRk: case Rt.ShortRk: B.num(rw, c, x, r.rk()); return;
          case Rt.CellReal: case Rt.ShortReal: B.num(rw, c, x, r.f64()); return;
          case Rt.FmlaNum: B.num(rw, c, x, r.f64()); this.cellFormula(rw, c); return;
          case Rt.CellIsst: case Rt.ShortIsst: B.shared(rw, c, x, r.u32()); return;
          case Rt.CellSt: case Rt.ShortSt: B.str(rw, c, x, asXlsxText(r.wstr())); return;
          // an empty result is written <v/> in the XML, which reads as a blank cell
          case Rt.FmlaString: { const s = r.wstr(); if (s) B.str(rw, c, x, asXlsxText(s)); else B.blank(rw, c, x); this.cellFormula(rw, c); return; }
          case Rt.CellRString: { const s = readRichStr(r, this.sss); B.str(rw, c, x, s.text, s.scr); return; }
          case Rt.CellBool: case Rt.ShortBool: B.bool(rw, c, x, r.u8() !== 0); return;
          case Rt.FmlaBool: B.bool(rw, c, x, r.u8() !== 0); this.cellFormula(rw, c); return;
          case Rt.CellError: case Rt.ShortError: { const e = r.u8(); B.err(rw, c, x, ERR[e] ?? "#N/A"); return; }
          case Rt.FmlaError: { const e = r.u8(); B.err(rw, c, x, ERR[e] ?? "#N/A"); this.cellFormula(rw, c); return; }
        }
        return;
      }
      case Rt.ShrFmla: case Rt.ArrFmla: {
        // the master's text: rfx (its range), for an array formula a flags byte, then the formula with the master
        // cell as the base of its relative references
        // (a shared formula's references are offsets from the master; an array formula's are coordinates)
        const g = readRfx(r), array = r.type === Rt.ArrFmla; if (array) r.u8();
        const p = this.pending; this.pending = null;
        const f = readParsedFormula(r, { r: g.r1, c: g.c1 }, this.info, !array, this.name);
        const list = this.masters.get(g.r1); if (list) list.push({ g, text: f.text, array }); else this.masters.set(g.r1, [{ g, text: f.text, array }]);
        if (!f.text) { if (p) this.unreadable++; return; }
        if (p && p.r === g.r1 && p.c === g.c1) this.cols.formula(f.text, array ? A1(g.r1, g.c1) + (g.r2 !== g.r1 || g.c2 !== g.c1 ? ":" + A1(g.r2, g.c2) : "") : undefined);
        else if (p && !array) this.cols.formula(shiftFormula(f.text, p.r - g.r1, p.c - g.c1));
        return;
      }
      case Rt.WsFmtInfo: {
        const dxGCol = r.u32(), base = r.u16(), dy = r.u16(), f = r.u16();
        // as the .xlsx reader takes sheetFormatPr: defaultColWidth when set, else 8.43 – it looks for a
        // "baseColumnWidth" attribute, which Excel never writes (it writes baseColWidth), so a base width alone is
        // not used there either
        void base;
        this.defColW = dxGCol !== 0xffffffff ? dxGCol / 256 : 8.43;
        this.defRowH = dy / 20; this.zeroH = !!(f & 2);
        return;
      }
      case Rt.ColInfo: {
        const first = r.u32() + 1, last = r.u32() + 1, w = r.u32(), ixfe = r.u32(), f = r.u16();
        const min = Math.max(1, first), max = Math.min(16384, last);
        this.colRanges.push({ min, max, info: { w: w / 256, hidden: !!(f & 1), s: ixfe ? ixfe : null } });
        return;
      }
      case Rt.MergeCell: this.merges.push(readRfx(r)); return;
      case Rt.ValueMeta: this.vm = r.u32(); return;
      case Rt.BeginConditionalFormatting: {
        r.u32(); r.u32();
        const n = r.u32(), ranges: Range[] = [];
        // relative references are offsets from the top-left cell of all the ranges (formula.ts)
        let br = Infinity, bc = Infinity;
        for (let k = 0; k < n && r.left >= 16; k++) { const g = readRfx(r); ranges.push(g); if (g.r1 < br) br = g.r1; if (g.c1 < bc) bc = g.c1; }
        this.cfRanges = ranges; this.cfBase = ranges.length ? { r: br, c: bc } : { r: 1, c: 1 };
        return;
      }
      case Rt.EndConditionalFormatting: this.cfRanges = null; this.cfRule = null; this.cfPart = null; return;
      case Rt.BeginCFRule: {
        this.cfRule = null; this.cfPart = null;
        const ranges = this.cfRanges || [], base = this.cfRanges ? this.cfBase : { r: 1, c: 1 };
        const iType = r.u32(), tpl = r.u32(), dxfId = r.i32(), pri = r.u32(), param = r.u32(); r.u32(); r.u32();
        const flags = r.u16(), cb = [r.u32(), r.u32(), r.u32()], text = r.wstrNull();
        const { type, op } = cfType(iType, tpl, param);
        // a formula that cannot be shown keeps its place as an error value: no comparison with it matches (as for
        // the .xlsx text of a name or another sheet's cell), and the next formula stays the second operand
        const formulas: string[] = [];
        for (const n of cb) { if (!n) continue; formulas.push(readCfFormula(r, base, this.info, this.name) ?? "#NAME?"); }
        const rule: CFRule = { ranges, type, op, priority: pri, stop: !!(flags & 2), dxf: this.ctx.dxfs[dxfId] || null, formulas };
        cfParams(rule, tpl, param, flags, text);
        if (this.badDxfs?.has(dxfId)) this.badDxfRule = true;
        this.cfRules.push(rule); this.cfRule = rule;
        return;
      }
      case Rt.EndCFRule: this.cfRule = null; this.cfPart = null; return;
      /* the parts of a colour scale, data bar or icon set (BrtBeginColorScale / Databar / IconSet, BrtCFVO, BrtColor) */
      case Rt.BeginColorScale: if (this.cfRule) { this.cfRule.scale = { cfvo: [], colors: [] }; this.cfPart = "scale"; } return;
      case Rt.BeginDatabar: if (this.cfRule && r.left >= 3) {
        const lo = r.u8(), hi = r.u8(), show = r.u8();
        this.cfRule.bar = { cfvo: [], color: "#638EC6", minLength: lo, maxLength: hi, showValue: !!(show & 1) }; this.cfPart = "bar";
      } return;
      case Rt.BeginIconSet: if (this.cfRule && r.left >= 8) {
        const set = r.i32(), f = r.u32();
        this.cfRule.icons = { set: KPI_SETS[set] || "3TrafficLights1", cfvo: [], reverse: !!(f & 2), showValue: !(f & 1) }; this.cfPart = "icons";
      } return;
      case Rt.EndColorScale: case Rt.EndDatabar: case Rt.EndIconSet: this.cfPart = null; return;
      case Rt.CFVO: {
        const R = this.cfRule, part = this.cfPart; if (!R || !part || r.left < 24) return;
        const t = r.u32(), num = r.f64(); r.u32(); const gte = r.u32(), cbF = r.u32();
        const type = CFVO_TYPE[t] || "min", v: CFVO = { type };
        if (type === "num" || type === "percent" || type === "percentile") v.val = String(num);
        if (type === "formula" && cbF) v.val = readCfFormula(r, this.cfBase, this.info, this.name) ?? "#NAME?";
        if (part === "icons" && !gte) v.gte = false;
        (part === "scale" ? R.scale! : part === "bar" ? R.bar! : R.icons!).cfvo.push(v);
        return;
      }
      case Rt.Color: {
        const R = this.cfRule, part = this.cfPart; if (!R || (part !== "scale" && part !== "bar") || r.left < 8) return;
        const col = this.ctx.color(readColor(r) as never, "#000000") || "#000000";
        if (part === "scale") R.scale!.colors.push(col); else R.bar!.color = col;
        return;
      }
    }
  }
  finish(): BinSheet {
    if (!this.seen) throw new Error("the sheet could not be read");
    const { cells: store, rows } = this.cols.finish();
    this.colRanges.sort((a, b) => a.min - b.min);
    this.cfRules.sort((a, b) => a.priority - b.priority);
    for (const rule of this.cfRules) { const why = unsupportedOf(rule); if (why) this.unsupportedCF.add(why); }
    // (S16.4 review) the 2010 look of a data bar (gradient, border, axis, negative colours: the x14 future records) is
    // not read from an .xlsb: its bars are drawn as Excel 2007's – named, as the same workbook saved as .xlsx differs
    if (this.cfRules.some(r => r.bar)) this.unsupportedCF.add(XLSB_BAR_LOOK);
    return { store, rows, colRanges: this.colRanges, merges: this.merges, cfRules: this.cfRules, unsupportedCF: this.unsupportedCF, defColW: this.defColW, defRowH: this.defRowH, zeroH: this.zeroH, notRead: this.notRead(), vms: this.vms };
  }
}
