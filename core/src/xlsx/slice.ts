/* Sheet slices: what the page receives of a sheet the core worker read (PLAN S2.4). The worker owns the workbook;
   the page holds read-only slices of the sheets the deck uses and runs the same pure functions on them
   (layouts, hit testing, drags, the format painter, comments) – they read the same cells, so they give the same
   answers. A slice is plain data (typed arrays + strings, transferable) and becomes a Sheet again with
   hydrateSheet. Small sheets travel whole; a big one as the rectangle that holds everything the deck can read in it:
   its "x" regions, the deck's tables on it (grown ranges included), the cells conditional formats of those
   refer to, and cells painted formats take their rules from. */
import { buildLayout } from "./layout";
import { makeColor } from "./color";
import { IMGMETA, type ImgMeta } from "./drawing";
import { makeSheet } from "./workbook";
import { CellMap, Kind, RowMap, type RowColumns, type SheetColumns } from "./sheetstore";
import { parseRange, type Range } from "./util";
import type { CFRule, ColInfo, Drawing, Script, Shared, Sheet, Workbook } from "./types";

/** sheets up to this many cells travel whole */
export const WHOLE_CELLS = 200_000;

export interface SharedSlice { xfs: Shared["xfs"]; dxfs: Shared["dxfs"]; defaultFont: Shared["defaultFont"]; theme: string[]; mdw: number }
export interface SheetSlice {
  name: string; hidden: boolean; error?: string; size?: number; title: string; subtitle: string;
  defColW: number; defRowH: number; zeroH: boolean;
  colRanges: { min: number; max: number; info: ColInfo }[];
  merges: Range[]; cfRules: CFRule[]; unsupportedCF: string[]; unpaired: string[]; drawing: Drawing;
  /** the "x" regions (S.tables), rebuilt on the page over the slice */
  regions: Range[];
  /** the cells it holds: null = the whole sheet, else this rectangle (rows: all rows up to its last one) */
  box: Range | null;
  cells: SheetColumns | null; rows: RowColumns | null;
  /** what Liquid Glass knows about this sheet's pictures (xlsx/drawing.ts analyzeImages) */
  imgmeta: [string, ImgMeta][];
  /** a linked workbook's sheet (S7.3): its own styles, fonts and digit width (the cells' xf indexes point into them,
      not into the deck's workbook's) */
  shared?: SharedSlice;
}

export const sliceShared = (c: Shared): SharedSlice => ({ xfs: c.xfs, dxfs: c.dxfs, defaultFont: c.defaultFont, theme: c.theme, mdw: c.mdw });
export const hydrateShared = (s: SharedSlice): Shared => ({ sst: [], sstRuns: [], xfs: s.xfs, dxfs: s.dxfs, defaultFont: s.defaultFont, theme: s.theme, mdw: s.mdw, color: makeColor(s.theme) });

const cellCount = (S: Sheet) => S.cols?.cells.n ?? 0;
const union = (a: Range | null, b: Range): Range => a ? { r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) } : { ...b };
const meets = (a: Range, b: Range) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
const RANGE_RULES = new Set(["colorScale", "dataBar", "iconSet", "top10", "aboveAverage", "duplicateValues", "uniqueValues"]);

/** the rectangle conditional formats need: every rule meeting `box`, its operands' cells for each cell of
    (rule range ∩ box) – relative references shift with the cell (layout.ts evalCF), absolute ones stay */
export function cfClosure(S: Sheet, box: Range): Range {
  let out = { ...box };
  for (let pass = 0; pass < 4; pass++) {
    let grown = false;
    for (const rule of S.cfRules) {
      const o = rule.ranges[0]; if (!o) continue;
      // (S16.4) a rule on its range's values (scale, bar, icons, top / bottom, average, duplicates) needs all its cells
      if (RANGE_RULES.has(rule.type) && rule.ranges.some(g => meets(g, out))) {
        const C = S.cols?.cells, maxR = C && C.rows.length ? C.rows[C.rows.length - 1] : 1, maxC = C ? C.col.reduce((m, v) => v > m ? v : m, 1) : 1;
        for (const g of rule.ranges) {
          const h = { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, Math.max(g.r1, maxR)), c2: Math.min(g.c2, Math.max(g.c1, maxC)) };
          if (h.r1 < out.r1 || h.c1 < out.c1 || h.r2 > out.r2 || h.c2 > out.c2) { out = union(out, h); grown = true; }
        }
      }
      for (const g of rule.ranges) {
        if (!meets(g, out)) continue;
        const part = { r1: Math.max(g.r1, out.r1), c1: Math.max(g.c1, out.c1), r2: Math.min(g.r2, out.r2), c2: Math.min(g.c2, out.c2) };
        for (const f of [...rule.formulas, ...[...(rule.scale?.cfvo || []), ...(rule.bar?.cfvo || []), ...(rule.icons?.cfvo || [])].map(v => v.val || "")]) for (const m of f.matchAll(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g)) {
          let c = 0; for (const ch of m[2]) c = c * 26 + ch.charCodeAt(0) - 64;
          const r = +m[4];
          const rr = m[3] ? [r, r] : [r + part.r1 - o.r1, r + part.r2 - o.r1], cc = m[1] ? [c, c] : [c + part.c1 - o.c1, c + part.c2 - o.c1];
          const ref = { r1: Math.max(1, rr[0]), c1: Math.max(1, cc[0]), r2: Math.max(1, rr[1]), c2: Math.max(1, cc[1]) };
          if (ref.r1 < out.r1 || ref.c1 < out.c1 || ref.r2 > out.r2 || ref.c2 > out.c2) { out = union(out, ref); grown = true; }
        }
      }
    }
    if (!grown) break;
  }
  return out;
}

/** what the page needs of each loaded sheet, for the tables `layouts` (the deck's, any design) and the painted
    formats in `edits` (cf: "Sheet!A1"): null = whole, else the rectangle */
export function sliceBoxes(wb: Workbook, layouts: { sheet: Sheet; g: Range }[], edits: Record<string, Record<string, { cf?: string }>>, whole = WHOLE_CELLS): Map<string, Range | null> {
  const want = new Map<string, Range | null>();
  const add = (S: Sheet, g: Range | null) => {
    if (cellCount(S) <= whole) { want.set(S.name, null); return; }
    const cur = want.get(S.name);
    if (cur === null && want.has(S.name)) return;
    want.set(S.name, g ? union(cur || null, g) : (cur || null));
  };
  for (const S of wb.sheets) if (cellCount(S) <= whole) add(S, null);
  for (const S of wb.sheets) for (const T of S.tables) add(S, T.g);
  for (const L of layouts) add(L.sheet, L.g);
  for (const sheetEdits of Object.values(edits || {})) for (const e of Object.values(sheetEdits || {})) {
    if (!e || !e.cf) continue;
    const k = e.cf.lastIndexOf("!"); if (k < 0) continue;
    const S = wb.sheets.find(s => s.name === e.cf!.slice(0, k)); if (!S) continue;
    const g = parseRange(e.cf.slice(k + 1)); if (g.r2 < 0) continue;
    add(S, g);
  }
  for (const [name, box] of want) if (box) { const S = wb.sheets.find(s => s.name === name)!; want.set(name, cfClosure(S, box)); }
  return want;
}

/** a slice of S: whole (box null) or the rectangle */
export function sliceSheet(S: Sheet, box: Range | null, mainShared?: Shared | null): SheetSlice {
  const base = {
    ...(mainShared && S.ctx !== mainShared ? { shared: sliceShared(S.ctx) } : {}),
    name: S.name, hidden: S.hidden, ...(S.error !== undefined ? { error: S.error } : {}), ...(S.size !== undefined ? { size: S.size } : {}),
    title: S.title, subtitle: S.subtitle, defColW: S.defColW, defRowH: S.defRowH, zeroH: S.zeroH, colRanges: S.colRanges,
    merges: S.merges, cfRules: S.cfRules, unsupportedCF: [...S.unsupportedCF], unpaired: S.unpaired, drawing: S.drawing,
    regions: S.tables.map(T => T.g), box,
    imgmeta: S.drawing.anchors.flatMap(A => A.objects.flatMap(o => o.kind === "pic" && o.src && IMGMETA.has(o.src) ? [[o.src, IMGMETA.get(o.src)!] as [string, ImgMeta]] : [])),
  };
  if (!S.cols) return { ...base, cells: null, rows: null };
  const { cells: C, rows: R } = S.cols, ctx = S.ctx;
  // the cells: whole or the rectangle; shared strings become the slice's own (the page has no shared string table)
  const strs: string[] = [], ix = new Map<string, number>(), runs = new Map<number, Script[]>();
  const own = (s: string) => { let i = ix.get(s); if (i === undefined) { i = strs.length; strs.push(s); ix.set(s, i); } return i; };
  const pick: number[] = [];
  for (let k = 0; k < C.rows.length; k++) {
    const r = C.rows[k]; if (box && (r < box.r1 || r > box.r2)) continue;
    for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) { const c = C.col[i]; if (!box || (c >= box.c1 && c <= box.c2)) pick.push(i); }
  }
  const n = pick.length, col = new Uint16Array(n), kind = new Uint8Array(n), xf = new Uint16Array(n), num = new Float64Array(n);
  const rowsL: number[] = [], off: number[] = [], newIx = new Int32Array(C.n).fill(-1);
  let lastRow = NaN;
  pick.forEach((i, j) => {
    newIx[i] = j;
    const r = rowOf(C, i); if (r !== lastRow) { rowsL.push(r); off.push(j); lastRow = r; }
    col[j] = C.col[i]; xf[j] = C.xf[i];
    let k = C.kind[i], v = C.num[i];
    if (k === Kind.Shared) { const sc = ctx.sstRuns?.[v]; v = own(ctx.sst[v] ?? ""); k = Kind.Str; if (sc) runs.set(j, sc); }
    else if (k === Kind.Str || k === Kind.Err) { const sc = C.runs.get(i); v = own(C.strs[v]); if (sc) runs.set(j, sc); }
    kind[j] = k; num[j] = v;
  });
  off.push(n);
  // v3's iteration order (only differs from the sorted one in unsorted files)
  const order = C.order ? Int32Array.from([...C.order].map(i => newIx[i]).filter(j => j >= 0)) : null;
  // no formulas in a slice: the page's mirror draws values; the worker (the formula bar's getCell, the engine) has them
  const cells: SheetColumns = { n, col, kind, xf, num, rows: Int32Array.from(rowsL), rowOff: Int32Array.from(off), order, strs, runs, fml: new Map(), fmls: [], arr: new Map() };
  let rn = R.rows.length; if (box) { let lo = 0, hi = R.rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (R.rows[m] <= box.r2) lo = m + 1; else hi = m; } rn = lo; }
  const rows: RowColumns = { rows: R.rows.slice(0, rn), h: R.h.slice(0, rn), hidden: R.hidden.slice(0, rn), hasS: R.hasS.slice(0, rn), s: R.s.slice(0, rn) };
  return { ...base, cells, rows };
}
function rowOf(C: SheetColumns, i: number) {
  let lo = 0, hi = C.rows.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (C.rowOff[m] <= i) lo = m; else hi = m - 1; }
  return C.rows[lo];
}
/** the buffers to transfer with a slice */
export const sliceTransfer = (s: SheetSlice): ArrayBuffer[] => {
  const out: ArrayBuffer[] = [];
  if (s.cells) for (const a of [s.cells.col, s.cells.kind, s.cells.xf, s.cells.num, s.cells.rows, s.cells.rowOff, s.cells.order]) if (a) out.push(a.buffer as ArrayBuffer);
  if (s.rows) for (const a of [s.rows.rows, s.rows.h, s.rows.hidden, s.rows.hasS, s.rows.s]) out.push(a.buffer as ArrayBuffer);
  return out;
};

/** the slice as a Sheet again (read only), over the shared parts `ctx` */
export function hydrateSheet(s: SheetSlice, mainCtx: Shared): Sheet {
  for (const [src, m] of s.imgmeta) if (!IMGMETA.has(src)) IMGMETA.set(src, m);
  const ctx = s.shared ? hydrateShared(s.shared) : mainCtx;       // a linked sheet: its own workbook's styles
  const cells = s.cells ? new CellMap(s.cells, ctx) : new Map(), rowInfo = s.rows ? new RowMap(s.rows) : new Map();
  const S = makeSheet({
    name: s.name, cells, rowInfo, colRanges: s.colRanges, merges: s.merges, cfRules: s.cfRules, unsupportedCF: new Set(s.unsupportedCF),
    drawing: s.drawing, defColW: s.defColW, defRowH: s.defRowH, zeroH: s.zeroH, ctx, ...(s.error !== undefined ? { error: s.error } : {}),
  }, s.cells || undefined);
  if (s.cells && s.rows) S.cols = { cells: s.cells, rows: s.rows };
  S.hidden = s.hidden; if (s.size !== undefined) S.size = s.size;
  S.title = s.title; S.subtitle = s.subtitle; S.unpaired = s.unpaired;
  // the marker tables are laid out when first read: the worker has them already, and opening deck20 laid out all
  // 20 sheets' tables on the page's thread before the wizard (~30 ms, PLAN S2.6)
  let tables: Sheet["tables"] | null = null;
  Object.defineProperty(S, "tables", {
    get: () => tables ??= s.regions.map(g => buildLayout(S, g)).filter((x): x is NonNullable<typeof x> => !!x),
    set: (v: Sheet["tables"]) => { tables = v; }, enumerable: true, configurable: true,
  });
  return S;
}
