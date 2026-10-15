/* workbook.bin: the sheets in tab order (BrtBundleSh, MS-XLSB 2.4.304) – the name, whether it is shown and its
   relationship id, as <sheet name state r:id> of workbook.xml. */
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
