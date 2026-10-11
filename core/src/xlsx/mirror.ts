/* The page's read-only mirror of the workbook the core worker owns (PLAN S2.4): the index, and the sheets as
   hydrated slices (xlsx/slice.ts), replaced whenever the worker sends new ones. It is a Workbook to the pure code
   the page runs (runtimeSlides, layouts, the format painter, the wizard until S2.5); `ensure` asks the worker for
   whole sheets (the wizard's grid reads every cell). */
import { hydrateShared, hydrateSheet, type SharedSlice, type SheetSlice } from "./slice";
import type { Progress, Shared, Sheet, Workbook } from "./types";
import type { WorkbookInfo } from "../rpc/messages";
import type { Zip } from "./zip";

export class MirrorWorkbook implements Workbook {
  readonly zip = null as unknown as Zip;                          // the bytes stay in the worker
  readonly wbRels = {};
  readonly meta; readonly skipped; readonly hiddenSheets; readonly extLinks; readonly total; readonly ssSize; readonly big;
  /** the worker's number for this workbook (its slices carry it) */
  readonly book: number;
  sheets: Sheet[] = [];
  shared: Shared | null = null;
  /** sheets the page holds whole (the wizard's): a later partial slice does not replace them */
  private whole = new Set<string>();
  constructor(info: WorkbookInfo, private readonly fetchWhole: (book: number, names: string[], progress?: Progress) => Promise<{ shared: SharedSlice | null; sheets: SheetSlice[] }>) {
    this.meta = info.meta; this.skipped = info.skipped; this.hiddenSheets = info.hiddenSheets; this.extLinks = info.extLinks;
    this.total = info.total; this.ssSize = info.ssSize; this.big = info.big; this.book = info.book;
  }
  isLoaded(n: string) { return this.sheets.some(S => S.name === n); }
  /** new slices from the worker: returns the sheets that were not here before */
  receive(shared: SharedSlice | null, slices: SheetSlice[]): Sheet[] {
    if (shared && !this.shared) this.shared = hydrateShared(shared);
    if (!this.shared) return [];
    const added: Sheet[] = [];
    for (const s of slices) {
      if (this.whole.has(s.name) && s.box) continue;
      if (!s.box) this.whole.add(s.name);
      const S = hydrateSheet(s, this.shared), i = this.sheets.findIndex(x => x.name === s.name);
      if (i >= 0) this.sheets[i] = S; else { this.sheets.push(S); added.push(S); }
    }
    const order = new Map(this.meta.map((m, i) => [m.name, i]));
    this.sheets.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    return added;
  }
  /** the sheets, whole (read in the worker first if needed); returns the ones that were not here */
  async ensure(names: string[], progress?: Progress): Promise<Sheet[]> {
    const todo = names.filter(n => this.meta.some(m => m.name === n) && !this.whole.has(n));
    if (!todo.length) return [];
    const before = new Set(this.sheets.map(S => S.name));
    const r = await this.fetchWhole(this.book, todo, progress);
    this.receive(r.shared, r.sheets);
    return this.sheets.filter(S => !before.has(S.name));
  }
}
