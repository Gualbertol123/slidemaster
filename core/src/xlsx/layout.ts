/* Tables: "x" marker regions and the geometry/style of every visible cell in a region. */
import { A1, parseRange, splitRef } from "./util";
import { cfAt, cfBorders, cfKeys, cfText } from "./cf";
import type { Range } from "./util";
import type { Box, BorderSide, Item, Pic, Rect, Sheet, TableLayout } from "./types";

export const BW: Record<string, number> = { hair: 1, thin: 1, dotted: 1, dashDot: 1, dashDotDot: 1, dashed: 1, mediumDashDot: 2, mediumDashDotDot: 2, mediumDashed: 2, slantDashDot: 2, medium: 2, thick: 3, double: 3 };
const BRANK: Record<string, number> = { hair: 1, dotted: 2, dashDotDot: 3, dashDot: 4, dashed: 5, thin: 6, mediumDashDotDot: 7, slantDashDot: 8, mediumDashDot: 9, mediumDashed: 10, medium: 11, thick: 12, double: 13 };
export const heavier = (a: BorderSide | null | undefined, b: BorderSide | null | undefined): BorderSide | null =>
  !a ? (b || null) : !b ? a : (BRANK[b.style] || 0) > (BRANK[a.style] || 0) ? b : a;

/* ===================== markers → regions ===================== */
export function findRegions(S: Sheet): TableLayout[] {
  const marks: { r: number; c: number; used: boolean }[] = [];
  for (const x of S.cells.values()) if (x.t === "s" && String(x.v).trim().toLowerCase() === "x") marks.push({ r: x.r, c: x.c, used: false });
  marks.sort((a, b) => a.r - b.r || a.c - b.c);
  const regions: Range[] = [];
  for (const m of marks) {
    if (m.used) continue;
    // bottom-right = nearest marker below-right whose rectangle holds no other marker
    const cands = marks.filter(o => !o.used && o !== m && o.r > m.r && o.c > m.c &&
      !marks.some(q => q !== m && q !== o && !q.used && q.r >= m.r && q.r <= o.r && q.c >= m.c && q.c <= o.c));
    if (!cands.length) continue;
    cands.sort((a, b) => ((a.r - m.r) * (a.c - m.c)) - ((b.r - m.r) * (b.c - m.c)));
    const e = cands[0]; m.used = e.used = true;
    regions.push({ r1: m.r, c1: m.c, r2: e.r, c2: e.c });
  }
  S.unpaired = marks.filter(m => !m.used).map(m => A1(m.r, m.c));
  return regions.map(g => buildLayout(S, g)).filter((x): x is TableLayout => !!x);
}

const stripUndef = <T extends object>(o: T): Partial<T> => { const r: Partial<T> = {}; for (const k in o) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; };

/* ===================== layout of one region (g = marker cells, exclusive) ===================== */
/** sizes: user overrides in table pixels, keyed by sheet column / row number (as strings) */
export interface Sizes { cols?: Record<string, number>; rows?: Record<string, number>; merges?: Record<string, "merge" | "split"> }
export const rangeKey = (m: Range) => A1(m.r1, m.c1) + ":" + A1(m.r2, m.c2);
const overlaps = (a: Range, b: Range) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
/** the workbook's merged ranges, minus the ones the user split, plus the ones the user merged
    (a user merge replaces every workbook merge it overlaps; later user merges never overlap earlier ones) */
export function effectiveMerges(S: Sheet, user?: Record<string, "merge" | "split">): Range[] {
  if (!user) return S.merges;
  const split = new Set(Object.entries(user).filter(([, v]) => v === "split").map(([k]) => k));
  const added: Range[] = [];
  for (const [k, v] of Object.entries(user)) {
    if (v !== "merge") continue;
    const g = parseRange(k); if (!(g.r2 >= g.r1 && g.c2 >= g.c1) || (g.r1 === g.r2 && g.c1 === g.c2)) continue;
    if (!added.some(a => overlaps(a, g))) added.push(g);
  }
  return [...S.merges.filter(m => !split.has(rangeKey(m)) && !added.some(a => overlaps(a, m))), ...added];
}
/** hide (4.9, B36, model/hidden.ts): rows / columns a slide hides or a version deletes, closed up as Excel's hidden ones */
export function buildLayout(S: Sheet, g: Range, sizes?: Sizes, hide?: { rows: Set<number>; cols: Set<number> } | null): TableLayout | null {
  const rows: number[] = [], cols: number[] = [];
  let hr = 0, hc = 0;
  const rowOff = (r: number) => S.rowHidden(r) || !!hide?.rows.has(r), colOff = (c: number) => S.colHidden(c) || !!hide?.cols.has(c);
  for (let r = g.r1 + 1; r < g.r2; r++) rowOff(r) ? hr++ : rows.push(r);
  for (let c = g.c1 + 1; c < g.c2; c++) colOff(c) ? hc++ : cols.push(c);
  if (!rows.length || !cols.length) return null;
  const y = new Map<number, number>(), x = new Map<number, number>(), h = new Map<number, number>(), w = new Map<number, number>();
  const oc = sizes?.cols || {}, or = sizes?.rows || {}, fixedCols = new Set<number>();
  const px = (o: Record<string, number>, k: number, d: number) => { const v = +o[k]; return isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : d; };
  let acc = 0; for (const r of rows) { y.set(r, acc); h.set(r, px(or, r, S.rowPx(r))); acc += h.get(r)!; } const H = acc;
  acc = 0; for (const c of cols) { x.set(c, acc); w.set(c, px(oc, c, S.colPx(c))); if (oc[c] !== undefined) fixedCols.add(c); acc += w.get(c)!; } const W = acc;
  const rIdx = new Map(rows.map((r, i) => [r, i])), cIdx = new Map(cols.map((c, i) => [c, i]));

  // merges intersecting region → visible boxes
  const mergeOf = new Map<string, Box>(); const boxes: Box[] = [];
  for (const m of effectiveMerges(S, sizes?.merges)) {
    if (m.r2 <= g.r1 || m.r1 >= g.r2 || m.c2 <= g.c1 || m.c1 >= g.c2) continue;
    const mr = rows.filter(r => r >= m.r1 && r <= m.r2), mc = cols.filter(c => c >= m.c1 && c <= m.c2);
    if (!mr.length || !mc.length) continue;
    const box: Box = { r: mr[0], c: mc[0], r2: mr[mr.length - 1], c2: mc[mc.length - 1], src: { r: m.r1, c: m.c1 }, m };
    for (const r of mr) for (const c of mc) mergeOf.set(r + "," + c, box);
    boxes.push(box);
  }
  for (const r of rows) for (const c of cols) if (!mergeOf.has(r + "," + c)) boxes.push({ r, c, r2: r, c2: c, src: { r, c } });

  const errors: string[] = [];
  const items: Item[] = [];
  for (const b of boxes) {
    const bx = x.get(b.c)!, by = y.get(b.r)!, bw = x.get(b.c2)! + w.get(b.c2)! - bx, bh = y.get(b.r2)! + h.get(b.r2)! - by;
    if (bw <= 0 || bh <= 0) continue;
    const xf = S.xfAt(b.src.r, b.src.c);
    const cell = S.get(b.src.r, b.src.c);
    // borders: each box draws its top/left (merged with neighbour), plus right/bottom at the region edge
    const ri = rIdx.get(b.r)!, ci = cIdx.get(b.c)!, ri2 = rIdx.get(b.r2)!, ci2 = cIdx.get(b.c2)!;
    const own = (side: "top" | "left" | "right" | "bottom") => (side === "right" ? S.xfAt(b.src.r, b.m ? b.m.c2 : b.c) : side === "bottom" ? S.xfAt(b.m ? b.m.r2 : b.r, b.src.c) : xf).border?.[side];
    let top = own("top") || null, left = own("left") || null, right: BorderSide | null = null, bottom: BorderSide | null = null;
    if (ri > 0) top = heavier(top, S.xfAt(rows[ri - 1], b.c).border?.bottom);
    if (ci > 0) left = heavier(left, S.xfAt(b.r, cols[ci - 1]).border?.right);
    if (ci2 === cols.length - 1) right = own("right") || null;
    if (ri2 === rows.length - 1) bottom = own("bottom") || null;
    let fill = xf.fill;
    const font = Object.assign({}, S.ctx.defaultFont, stripUndef(xf.font || {}));
    const baseColor = font.color || "#000000";
    const cfr = cfAt(S, b.src.r, b.src.c), cf = cfr?.dxf || null;
    if (cf) { if (cf.fill) fill = cf.fill; if (cf.color) font.color = cf.color; if (cf.b !== undefined) font.b = cf.b; if (cf.i !== undefined) font.i = cf.i; if (cf.u !== undefined) font.u = cf.u; if (cf.s !== undefined) font.s = cf.s; }
    let text = "", raw = "", nfColor: string | null = null;
    if (cell && cell.t !== "blank") { const f = cfText(cell, cf); text = f.text; raw = cf?.fmt ? cfText(cell, null).text : text; nfColor = f.color || null; if (cell.t === "e") errors.push(A1(b.src.r, b.src.c)); }
    const ck = cfKeys(cfr);
    let align = xf.h || "general";
    if (align === "general") align = cell && (cell.t === "n" || cell.t === "d") ? "right" : cell && (cell.t === "b" || cell.t === "e") ? "center" : "left";
    if (align === "centerContinuous") align = "center";
    if (align === "fill" || align === "justify" || align === "distributed") align = "left";
    items.push({ ...(cell?.scr && cell.t === "s" && text === cell.v ? { scripts: cell.scr } : {}), b, bx, by, bw, bh, fill, top, left, right, bottom, text, font, color: nfColor || font.color || "#000000", align, valign: xf.v || "bottom", wrap: !!xf.wrap, indent: xf.indent || 0, rot: xf.rot || 0, isText: !!cell && cell.t === "s", merged: !!b.m,
      baseFill: xf.fill, baseColor, cf, nfColor, ctype: cell ? cell.t : "blank", ...ck, ...(raw !== (ck.text ?? text) ? { rawText: raw } : {}) });
  }
  cfBorders(items, rows, cols);
  // text overflow into empty neighbours (Excel behaviour for unwrapped text)
  const occupied = new Set(items.filter(i => i.text).map(i => i.b.r + "," + i.b.c));
  for (const it of items) {
    if (!it.text || it.wrap || it.merged || !it.isText) continue;
    if (it.align === "left") {
      let ext = it.bw; let ci = cIdx.get(it.b.c)! + 1;
      while (ci < cols.length && !occupied.has(it.b.r + "," + cols[ci]) && !mergeOf.has(it.b.r + "," + cols[ci])) { ext += w.get(cols[ci])!; ci++; }
      it.tw = ext; if (ci >= cols.length) it.ov = true;
    } else if (it.align === "center") { it.ov = true; }
  }
  // drawings: hidden rows/cols collapse like in Excel ("move and size with cells");
  // "move but don't size" objects keep their size and move to the next visible position
  const cx = (c: number, off: number) => { if (c <= g.c1) return 0; if (c >= g.c2) return W; if (colOff(c)) { const n = cols.find(k => k > c); return n ? x.get(n)! : W; } return x.get(c)! + Math.min(off, w.get(c)!); };
  const cy = (r: number, off: number) => { if (r <= g.r1) return 0; if (r >= g.r2) return H; if (rowOff(r)) { const n = rows.find(k => k > r); return n ? y.get(n)! : H; } return y.get(r)! + Math.min(off, h.get(r)!); };
  const fullX = (c: number, off: number) => S.colStart(c) + off, fullY = (r: number, off: number) => S.rowStart(r) + off;
  const pics: Pic[] = [], rects: Rect[] = [], texts: Rect[] = [];
  for (const A of S.drawing.anchors) {
    let from = A.from;
    if (A.type === "abs" && A.pos) from = S.cellAt(A.pos.x, A.pos.y);
    if (!from || from.r < g.r1 || from.r >= g.r2 || from.c < g.c1 || from.c >= g.c2) continue;
    const x0 = cx(from.c, from.co), y0 = cy(from.r, from.ro);
    let aw = 0, ah = 0;
    if (A.type === "two" && A.editAs === "twoCell" && A.to) { aw = cx(A.to.c, A.to.co) - x0; ah = cy(A.to.r, A.to.ro) - y0; }
    else if (A.ext && A.ext.w) { aw = A.ext.w; ah = A.ext.h; }
    else if (A.to) { aw = fullX(A.to.c, A.to.co) - fullX(from.c, from.co); ah = fullY(A.to.r, A.to.ro) - fullY(from.r, from.ro); }
    if (!(aw > 1.5 && ah > 1.5)) continue;
    for (const o of A.objects) {
      const box = { x: x0 + o.frac.x * aw, y: y0 + o.frac.y * ah, w: o.frac.w * aw, h: o.frac.h * ah, rot: o.rot, flipH: o.flipH, flipV: o.flipV, name: o.name };
      if (box.w < 1 || box.h < 1) continue;
      if (o.kind === "pic") pics.push({ ...box, src: o.src, crop: o.crop, unsupported: o.unsupported });
      else if (o.kind === "box") rects.push({ ...box, fill: o.fill, line: o.line, round: /round/i.test(o.prst), ellipse: o.prst === "ellipse" });
      else if (o.kind === "text") texts.push({ ...box, fill: o.fill, line: o.line, round: /round/i.test(o.prst), paras: o.paras, anchorV: o.anchorV });
    }
  }
  return { g, rows, cols, W, H, items, pics, rects, texts, hiddenRows: hr, hiddenCols: hc, errors, colX: x, colW: w, rowY: y, rowH: h, sheet: S, fixedCols };
}

/* conditional formatting: xlsx/cf.ts (S16.4) */
export { evalCF } from "./cf";
export { splitRef };
