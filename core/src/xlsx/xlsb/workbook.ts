/* workbook.bin: the sheets in tab order (BrtBundleSh, MS-XLSB 2.4.304) – the name, whether it is shown and its
   relationship id, as <sheet name state r:id> of workbook.xml. For the formulas (PLAN S7.1) also the defined names
   (BrtName, in nameindex order), the supporting books (BrtSupSelf / BrtSupSame / BrtSupBookSrc, in
   iSupBook order) and the XTI table (BrtExternSheet) that 3D references index. */
import { Records, Rt } from "./records";

export interface BinSheetEntry { name: string; state: "visible" | "hidden" | "veryHidden"; relId: string }

export function readWorkbookBin(bytes: Uint8Array): BinSheetEntry[] {
  const r = new Records(bytes), out: BinSheetEntry[] = [];
  while (r.rec()) {
    if (r.type !== Rt.BundleSh) continue;
    const hs = r.u32(); r.u32();
    const relId = r.wstrNull() || "", name = r.wstr();
    out.push({ name, state: hs === 0 ? "visible" : hs === 1 ? "hidden" : "veryHidden", relId });
  }
  return out;
}

/** a supporting book: this workbook (`self`), or an external link part by its relationship id (its sheet names are
    read from that part: readSupTabsBin) */
export type BinSupBook = { kind: "self" } | { kind: "external"; relId: string; sheets: string[] } | { kind: "addin" | "other" };
/** one XTI entry: which supporting book, and the first and last sheet in it (-1 = none / #REF!) */
export interface BinXti { book: number; first: number; last: number }
export interface BinWorkbookInfo {
  /** every sheet's name in tab order (hidden ones too: the XTI indexes count them) */
  sheets: string[];
  /** defined names in nameindex order (1-based in the formulas): the name and its sheet scope (-1 = workbook) */
  names: { name: string; scope: number }[];
  books: BinSupBook[];
  xti: BinXti[];
}
export function readWorkbookInfoBin(bytes: Uint8Array): BinWorkbookInfo {
  const r = new Records(bytes), info: BinWorkbookInfo = { sheets: [], names: [], books: [], xti: [] };
  while (r.rec()) {
    try {
      switch (r.type) {
        case Rt.BundleSh: { r.u32(); r.u32(); r.wstrNull(); info.sheets.push(r.wstr()); break; }
        case Rt.Name: {
          r.u32(); r.u8(); const itab = r.u32(); const name = r.wstr();
          info.names.push({ name, scope: itab === 0xffffffff ? -1 : itab });
          break;
        }
        case Rt.SupSelf: case Rt.SupSame: info.books.push({ kind: "self" }); break;
        case Rt.SupBookSrc: { const relId = r.wstr(); info.books.push({ kind: "external", relId, sheets: [] }); break; }
        case Rt.ExternSheet: {
          const n = r.u32();
          for (let k = 0; k < n && r.left >= 12; k++) { const book = r.u32(), first = r.i32(), last = r.i32(); info.xti.push({ book, first, last }); }
          break;
        }
      }
    } catch { /* a short record loses that entry, not the workbook */ }
  }
  return info;
}
/** the sheet names an external link part declares (BrtSupTabs of externalLinkN.bin) */
export function readSupTabsBin(bytes: Uint8Array): string[] {
  const r = new Records(bytes);
  while (r.rec()) {
    if (r.type !== Rt.SupTabs) continue;
    try { const n = r.u32(), out: string[] = []; for (let k = 0; k < n; k++) out.push(r.wstr()); return out; } catch { return []; }
  }
  return [];
}
