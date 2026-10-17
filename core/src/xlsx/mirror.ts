/* The page's read-only mirror of the workbook the core worker owns (PLAN S2.4): the index, and the sheets as
   hydrated slices (xlsx/slice.ts), replaced whenever the worker sends new ones. It is a Workbook to the pure code
   the page runs (runtimeSlides, layouts, the format painter, comments); `ensure` asks the worker to read sheets
   (their slices arrive before its answer). The wizard reads sheets through the worker (getSheetMeta, …). */
import { hydrateShared, hydrateSheet, type SharedSlice, type SheetSlice } from "./slice";
import type { Progress, Shared, Sheet, Workbook } from "./types";
import type { WorkbookInfo } from "../rpc/messages";
import type { Zip } from "./zip";

export class MirrorWorkbook implements Workbook {
  readonly zip = null as unknown as Zip;                          // the bytes stay in the worker
  readonly wbRels = {};
  meta; skipped; readonly hiddenSheets; readonly extLinks; readonly total; readonly ssSize; readonly big;
  /** the page's mirror recalculates nothing: no linked workbook names */
  readonly externals: string[] = [];
  readonly linked = new Map<string, Workbook>();
  /** the worker's number for this workbook (its slices carry it) */
  readonly book: number;
  sheets: Sheet[] = [];
  shared: Shared | null = null;
  constructor(info: WorkbookInfo, private readonly read: (book: number, names: string[]) => Promise<void>) {
    this.meta = info.meta; this.skipped = info.skipped; this.hiddenSheets = info.hiddenSheets; this.extLinks = info.extLinks;
    this.total = info.total; this.ssSize = info.ssSize; this.big = info.big; this.book = info.book;
  }
  isLoaded(n: string) { return this.sheets.some(S => S.name === n); }
  /** the index after a linked workbook joined (the worker's answer to `link`): its sheets are in `meta` now */
  extend(info: WorkbookInfo) { this.meta = info.meta; this.skipped = info.skipped; }
  /** new slices from the worker: returns the sheets that were not here before */
  receive(shared: SharedSlice | null, slices: SheetSlice[]): Sheet[] {
    if (shared && !this.shared) this.shared = hydrateShared(shared);
    if (!this.shared) return [];
    const added: Sheet[] = [];
    for (const s of slices) {
      const S = hydrateSheet(s, this.shared), i = this.sheets.findIndex(x => x.name === s.name);
      if (i >= 0) this.sheets[i] = S; else { this.sheets.push(S); added.push(S); }
    }
    const order = new Map(this.meta.map((m, i) => [m.name, i]));
    this.sheets.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    return added;
  }
  /** the worker reads the sheets; returns the ones that were not here before (the Workbook interface; the page's
      code asks the worker directly today) */
  async ensure(names: string[], _progress?: Progress): Promise<Sheet[]> {
    const before = new Set(this.sheets.map(S => S.name));
    await this.read(this.book, names);
    return this.sheets.filter(S => !before.has(S.name));
  }
}
