/* A worksheet part (sheetN.bin, MS-XLSB 2.1.7.62) into the same columns as the XML scanner (sheetstore.ts), with
   the sheet's format, columns, merges and conditional formats as workbook.ts reads them from the XML. Rows and
   cells come as BrtRowHdr followed by its BrtCell* / BrtFmla* records (values only: the formulas' cached results,
   as the XML's <v>). Resumable like the scanner: run(budget) reads up to `budget` records. */
import { ColumnsBuilder, type RowColumns, type SheetColumns } from "../sheetstore";
import type { Range } from "../util";
import type { CFRule, ColInfo, Shared } from "../types";
import { Records, Rt, XlsbError, readRfx } from "./records";
import { asXlsxText, readRichStr } from "./strings";
import { readCfFormula } from "./formula";

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

export interface BinSheet {
  store: SheetColumns; rows: RowColumns;
  colRanges: { min: number; max: number; info: ColInfo }[];
  merges: Range[]; cfRules: CFRule[]; unsupportedCF: Set<string>;
  defColW: number; defRowH: number; zeroH: boolean;
}

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
  private cfBase = { r: 1, c: 1 };
  private seen = false;
  /** sss: per font of styles.bin, 1 superscript / 2 subscript (the rich strings' raised parts) */
  constructor(bytes: Uint8Array, private readonly ctx: Shared, private readonly sss: number[] = []) { this.r = new Records(bytes); this.cols = new ColumnsBuilder(ctx); }
  get progress() { return this.r.progress; }

  /** reads up to `budget` records; true when the part is done */
  run(budget = Infinity): boolean {
    const r = this.r;
    for (let k = 0; k < budget; k++) {
      if (!r.rec()) return true;
      this.seen = true;
      // a record shorter than its contents is skipped (it loses that record, not the sheet)
      try { this.record(); } catch (e) { if (!(e instanceof XlsbError)) throw e; }
    }
    return false;
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
        if (c > 65535 || rw < 1) return;
        switch (r.type) {
          case Rt.CellBlank: case Rt.ShortBlank: B.blank(rw, c, x); return;
          case Rt.CellRk: case Rt.ShortRk: B.num(rw, c, x, r.rk()); return;
          case Rt.CellReal: case Rt.ShortReal: case Rt.FmlaNum: B.num(rw, c, x, r.f64()); return;
          case Rt.CellIsst: case Rt.ShortIsst: B.shared(rw, c, x, r.u32()); return;
          case Rt.CellSt: case Rt.ShortSt: B.str(rw, c, x, asXlsxText(r.wstr())); return;
          // an empty result is written <v/> in the XML, which reads as a blank cell
          case Rt.FmlaString: { const s = r.wstr(); if (s) B.str(rw, c, x, asXlsxText(s)); else B.blank(rw, c, x); return; }
          case Rt.CellRString: { const s = readRichStr(r, this.sss); B.str(rw, c, x, s.text, s.scr); return; }
          case Rt.CellBool: case Rt.ShortBool: case Rt.FmlaBool: B.bool(rw, c, x, r.u8() !== 0); return;
          case Rt.CellError: case Rt.ShortError: case Rt.FmlaError: { const e = r.u8(); B.err(rw, c, x, ERR[e] ?? "#N/A"); return; }
        }
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
      case Rt.BeginConditionalFormatting: {
        r.u32(); r.u32();
        const n = r.u32(), ranges: Range[] = [];
        // relative references are offsets from the top-left cell of all the ranges (formula.ts)
        let br = Infinity, bc = Infinity;
        for (let k = 0; k < n && r.left >= 16; k++) { const g = readRfx(r); ranges.push(g); if (g.r1 < br) br = g.r1; if (g.c1 < bc) bc = g.c1; }
        this.cfRanges = ranges; this.cfBase = ranges.length ? { r: br, c: bc } : { r: 1, c: 1 };
        return;
      }
      case Rt.EndConditionalFormatting: this.cfRanges = null; return;
      case Rt.BeginCFRule: {
        const ranges = this.cfRanges || [], base = this.cfRanges ? this.cfBase : { r: 1, c: 1 };
        const iType = r.u32(), tpl = r.u32(), dxfId = r.i32(), pri = r.u32(), param = r.u32(); r.u32(); r.u32();
        const flags = r.u16(), cb = [r.u32(), r.u32(), r.u32()]; r.wstrNull();
        const { type, op } = cfType(iType, tpl, param);
        if (!["cellIs", "expression"].includes(type)) this.unsupportedCF.add(type);
        // a formula that cannot be shown keeps its place as an error value: no comparison with it matches (as for
        // the .xlsx text of a name or another sheet's cell), and the next formula stays the second operand
        const formulas: string[] = [];
        for (const n of cb) { if (!n) continue; formulas.push(readCfFormula(r, base) ?? "#NAME?"); }
        this.cfRules.push({ ranges, type, op, priority: pri, stop: !!(flags & 2), dxf: this.ctx.dxfs[dxfId] || null, formulas });
        return;
      }
    }
  }
  finish(): BinSheet {
    if (!this.seen) throw new Error("the sheet could not be read");
    const { cells: store, rows } = this.cols.finish();
    this.colRanges.sort((a, b) => a.min - b.min);
    this.cfRules.sort((a, b) => a.priority - b.priority);
    return { store, rows, colRanges: this.colRanges, merges: this.merges, cfRules: this.cfRules, unsupportedCF: this.unsupportedCF, defColW: this.defColW, defRowH: this.defRowH, zeroH: this.zeroH };
  }
}
