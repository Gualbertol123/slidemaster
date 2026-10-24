/* BIFF12 records (MS-XLSB 2.1.4): a record type of 1–2 bytes and a size of 1–4 bytes, both 7 bits per byte with the
   high bit as "more", then the record's data. The .xlsb parts (workbook.bin, styles.bin, sharedStrings.bin,
   worksheets/sheetN.bin) are sequences of them; relationships, the theme and drawings stay XML, as in .xlsx. */

/** record types read by the reader (MS-XLSB 2.3.2) */
export const enum Rt {
  RowHdr = 0, CellBlank = 1, CellRk = 2, CellError = 3, CellBool = 4, CellReal = 5, CellSt = 6, CellIsst = 7,
  FmlaString = 8, FmlaNum = 9, FmlaBool = 10, FmlaError = 11,
  ShortBlank = 12, ShortRk = 13, ShortError = 14, ShortBool = 15, ShortReal = 16, ShortSt = 17, ShortIsst = 18, SSTItem = 19,
  Font = 43, Fmt = 44, Fill = 45, Border = 46, XF = 47, ColInfo = 60, CellRString = 62,
  WbProp = 153, BundleSh = 156, WsFmtInfo = 485, MergeCell = 176,
  BeginCFRule = 463, BeginConditionalFormatting = 461, EndConditionalFormatting = 462,
  /* the parts of a rule (S16.4): icon set, data bar, colour scale, their thresholds and colours */
  EndCFRule = 464, BeginIconSet = 465, EndIconSet = 466, BeginDatabar = 467, EndDatabar = 468, BeginColorScale = 469, EndColorScale = 470, CFVO = 471, Color = 564,
  BeginCellStyleXFs = 626, EndCellStyleXFs = 627, BeginCellXFs = 617, EndCellXFs = 618,
  BeginDXFs = 505, EndDXFs = 506, DXF = 507,
  BeginFonts = 611, EndFonts = 612, BeginFills = 603, EndFills = 604, BeginBorders = 613, EndBorders = 614,
  BeginSheetData = 145, EndSheetData = 146,
  /* formulas (PLAN S7.1): shared and array formulas after their master cell; the workbook's names and supporting
     books / sheet table for 3D references; the sheet names of an external link part */
  ArrFmla = 426, ShrFmla = 427, Name = 39,
  /** the value metadata of the cell record that follows (a picture in the cell, xlsx/cellimages.ts) */
  ValueMeta = 50,
  BeginExternals = 353, EndExternals = 354, SupBookSrc = 355, SupSelf = 357, SupSame = 358, SupTabs = 359, BeginSupBook = 360, ExternSheet = 362, SupAddin = 667,
}

export class XlsbError extends Error {}

/** the spec's names of the records a message can name (MS-XLSB 2.3.2), else the number */
const NAMES: Record<number, string> = {
  0: "BrtRowHdr", 1: "BrtCellBlank", 2: "BrtCellRk", 3: "BrtCellError", 4: "BrtCellBool", 5: "BrtCellReal", 6: "BrtCellSt", 7: "BrtCellIsst",
  8: "BrtFmlaString", 9: "BrtFmlaNum", 10: "BrtFmlaBool", 11: "BrtFmlaError", 12: "BrtShortBlank", 13: "BrtShortRk", 14: "BrtShortError",
  15: "BrtShortBool", 16: "BrtShortReal", 17: "BrtShortSt", 18: "BrtShortIsst", 19: "BrtSSTItem", 39: "BrtName", 43: "BrtFont", 44: "BrtFmt",
  45: "BrtFill", 46: "BrtBorder", 47: "BrtXF", 60: "BrtColInfo", 62: "BrtCellRString", 156: "BrtBundleSh", 176: "BrtMergeCell",
  50: "BrtValueMeta", 355: "BrtSupBookSrc", 359: "BrtSupTabs", 362: "BrtExternSheet", 426: "BrtArrFmla", 427: "BrtShrFmla", 461: "BrtBeginConditionalFormatting",
  463: "BrtBeginCFRule", 465: "BrtBeginIconSet", 467: "BrtBeginDatabar", 469: "BrtBeginColorScale", 471: "BrtCFVO", 485: "BrtWsFmtInfo",
  507: "BrtDXF", 564: "BrtColor",
};
export const recName = (t: number) => NAMES[t] || "record " + t;

/** a little-endian reader over one part's bytes; `rec()` steps from record to record */
export class Records {
  readonly v: DataView;
  /** the current record: type and its data [start, end) */
  type = -1; start = 0; end = 0;
  /** the read position inside the current record */
  p = 0;
  private next = 0;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  /** the share of the part read so far (progress) */
  get progress() { return this.b.length ? this.next / this.b.length : 1; }
  /** moves to the next record; false at the end of the part. A record cut off by the end of the part ends it too
      (Excel writes none; a torn file keeps what was complete, as the XML scanner keeps the rows it could read) */
  rec(): boolean {
    const b = this.b, n = b.length; let i = this.next;
    if (i >= n) return false;
    let t = b[i++] & 0x7f;
    if (b[i - 1] & 0x80) { if (i >= n) return false; t |= (b[i++] & 0x7f) << 7; }
    let size = 0;
    for (let k = 0; k < 4; k++) {
      if (i >= n) return false;
      const c = b[i++]; size |= (c & 0x7f) << (7 * k);
      if (!(c & 0x80)) break;
    }
    size >>>= 0;
    if (i + size > n) { this.next = n; return false; }
    this.type = t; this.start = this.p = i; this.end = i + size; this.next = i + size;
    return true;
  }
  /** bytes left in the current record */
  get left() { return this.end - this.p; }
  private need(k: number) { if (this.p + k > this.end) throw new XlsbError(`a record is shorter than its contents (${recName(this.type)})`); }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.p, true); this.p += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  skip(k: number) { this.need(k); this.p += k; }
  /** RkNumber (2.5.122): a 30-bit integer or the high 30 bits of a double, optionally divided by 100 */
  rk(): number {
    const x = this.u32();
    let v: number;
    if (x & 2) v = x >> 2;
    else { RK.setUint32(0, 0, true); RK.setUint32(4, x & 0xfffffffc, true); v = RK.getFloat64(0, true); }
    return x & 1 ? v / 100 : v;
  }
  /** UTF-16LE characters */
  chars(n: number): string {
    this.need(2 * n);
    const s = UTF16.decode(this.b.subarray(this.p, this.p + 2 * n)); this.p += 2 * n;
    return s;
  }
  /** XLWideString (2.5.168): a 32-bit character count, then the characters */
  wstr(): string { const n = this.u32(); if (n > this.left / 2) throw this.tooLong(n); return this.chars(n); }
  /** XLNullableWideString (2.5.166): as wstr, 0xFFFFFFFF = none */
  wstrNull(): string | null { const n = this.u32(); if (n === 0xffffffff) return null; if (n > this.left / 2) throw this.tooLong(n); return this.chars(n); }
  private tooLong(n: number) { return new XlsbError(`a string is longer than its record (${recName(this.type)}: ${n} characters, ${this.left} bytes left)`); }
}
const RK = new DataView(new ArrayBuffer(8));
const UTF16 = new TextDecoder("utf-16le");

/** BrtColor (2.5.9) as the colour element an .xlsx file would have: the attributes color.ts reads
    (auto, rgb, theme, indexed, tint), so both formats resolve colours with the same code */
export interface ColorAttrs { getAttribute(name: string): string | null }
export function readColor(r: Records): ColorAttrs | null {
  const a = r.u8(), index = r.u8(), tint = r.i16(), red = r.u8(), green = r.u8(), blue = r.u8(); r.u8();
  const type = a >> 1;
  const at: Record<string, string> = {};
  if (type === 0) at.auto = "1";
  else if (type === 1) at.indexed = String(index);
  else if (type === 2) at.rgb = "FF" + hex2(red) + hex2(green) + hex2(blue);
  else if (type === 3) at.theme = String(index);
  else return null;                                                  // 4 – not set
  if (tint) at.tint = String(tint / 32767);
  return { getAttribute: n => at[n] ?? null };
}
const hex2 = (x: number) => (x < 16 ? "0" : "") + x.toString(16).toUpperCase();

/** UncheckedRfX (2.5.155): rows and columns 0-based in the file, 1-based here */
export function readRfx(r: Records) {
  const r1 = r.u32() + 1, r2 = r.u32() + 1, c1 = r.u32() + 1, c2 = r.u32() + 1;
  return { r1, c1, r2, c2 };
}
