/* Table suggestions: blocks of filled cells (one empty row is bridged; an empty column separates tables).
   On a columnar sheet (xlsx/sheetstore.ts) both read the columns instead of making a Cell for each of a big sheet's
   million cells (PLAN S2.6: a 130k-row sheet in the wizard under 1 s); the results are the same
   (tests/detect.test.ts keeps v3's code as the reference). */
import { tone } from "./color";
import { A1 } from "./util";
import { Kind, cellAt, rowOfIndex } from "./sheetstore";
import type { Cell, Sheet, Xf } from "./types";

export function usedRange(S: Sheet) {
  let r2 = 1, c2 = 1;
  if (S.cols) {
    const C = S.cols.cells, ctx = S.ctx, fill = new Uint8Array(ctx.xfs.length + 1);
    const memoSst = new Uint8Array(ctx.sst.length), memoOwn = new Uint8Array(C.strs.length);
    const hasFill = (x: number) => { let f = fill[x]; if (!f) f = fill[x] = (ctx.xfs[x] || ctx.xfs[0] || ({} as Xf)).fill ? 2 : 1; return f === 2; };
    /** String(v).trim() !== "" for string index n (memoised; an index out of range is computed) */
    const text = (memo: Uint8Array, n: number, v: string | undefined) => {
      if (!(n >= 0 && n < memo.length && Number.isInteger(n))) return String(v ?? "").trim() !== "";
      let m = memo[n]; if (!m) m = memo[n] = String(v ?? "").trim() !== "" ? 2 : 1; return m === 2;
    };
    for (let k = 0; k < C.rows.length; k++) {
      const r = C.rows[k];
      for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) {
        const kind = C.kind[i], n = C.num[i];
        // v3: (t !== "blank" && String(v ?? "").trim() !== "") || xf.fill – a number, date or boolean is never empty text;
        // a string cell is blank when its text is ""
        const filled = kind === Kind.Num || kind === Kind.Date || kind === Kind.Bool
          || (kind === Kind.Shared && (ctx.sst[n] ?? "") !== "" && text(memoSst, n, ctx.sst[n]))
          || (kind === Kind.Str && C.strs[n] !== "" && text(memoOwn, n, C.strs[n]))
          || (kind === Kind.Err && text(memoOwn, n, C.strs[n]))
          || hasFill(C.xf[i]);
        if (filled) { if (r > r2) r2 = r; if (C.col[i] > c2) c2 = C.col[i]; }
      }
    }
  } else for (const x of S.cells.values()) { if ((x.t !== "blank" && String(x.v ?? "").trim() !== "") || (x.xf && x.xf.fill)) { if (x.r > r2) r2 = x.r; if (x.c > c2) c2 = x.c; } }
  return { r2: Math.min(r2, 400), c2: Math.min(c2, 80), clipped: r2 > 400 || c2 > 80 };
}
/** the cells in rows up to maxRow, in the order S.cells gives them (on columns: only those rows are visited) */
function* cellsUpTo(S: Sheet, maxRow: number): Generator<Cell> {
  const C = S.cols?.cells;
  if (!C) { yield* S.cells.values(); return; }
  if (C.order) { for (const i of C.order) { const r = rowOfIndex(C, i); if (r <= maxRow) yield cellAt(C, S.ctx, i, r); } return; }
  for (let k = 0; k < C.rows.length && C.rows[k] <= maxRow; k++) for (let i = C.rowOff[k]; i < C.rowOff[k + 1]; i++) yield cellAt(C, S.ctx, i, C.rows[k]);
}
export function detectTables(S: Sheet): string[] {
  const occ = new Map<string, Cell>(), U = usedRange(S);
  for (const x of cellsUpTo(S, U.r2)) {
    if (x.r > U.r2 || x.c > U.c2 || S.rowHidden(x.r) || S.colHidden(x.c)) continue;
    const has = (x.t !== "blank" && String(x.v ?? "").trim() !== "" && String(x.v).trim().toLowerCase() !== "x") || (x.xf && x.xf.fill && tone(x.xf.fill));
    if (has && !(x.r === 1 && x.c === 1)) occ.set(x.r + "," + x.c, x);
  }
  const seen = new Set<string>(), boxes: { r1: number; c1: number; r2: number; c2: number; n: number }[] = [];
  for (const [k, x] of occ) {
    if (seen.has(k)) continue;
    const q = [x]; seen.add(k); const b = { r1: x.r, c1: x.c, r2: x.r, c2: x.c, n: 0 };
    while (q.length) {
      const p = q.pop()!; b.n++; b.r1 = Math.min(b.r1, p.r); b.r2 = Math.max(b.r2, p.r); b.c1 = Math.min(b.c1, p.c); b.c2 = Math.max(b.c2, p.c);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const key = (p.r + dr) + "," + (p.c + dc);
        if (occ.has(key) && !seen.has(key)) { seen.add(key); q.push(occ.get(key)!); }
      }
    }
    if (b.r2 - b.r1 >= 1 && b.c2 - b.c1 >= 1 && b.n >= 4) boxes.push(b);
  }
  // merge overlapping boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      if (a.r1 <= c.r2 && a.r2 >= c.r1 && a.c1 <= c.c2 && a.c2 >= c.c1) { boxes[i] = { r1: Math.min(a.r1, c.r1), c1: Math.min(a.c1, c.c1), r2: Math.max(a.r2, c.r2), c2: Math.max(a.c2, c.c2), n: a.n + c.n }; boxes.splice(j, 1); merged = true; break; }
    }
  }
  return boxes.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1).map(b => A1(b.r1, b.c1) + ":" + A1(b.r2, b.c2));
}
