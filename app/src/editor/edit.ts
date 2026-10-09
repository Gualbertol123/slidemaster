/* Selection (Excel-like) and cell edits expressed as operations. */
import { get, patch } from "../state/store";
import { change, ctx } from "../state/app";
import type { Item, TableLayout } from "../xlsx/types";
import type { CellEdit, Op } from "../model/types";
import { keyOf } from "../render/edits";

/* ---- selection ---- */
type GridLayout = TableLayout & { _grid?: Map<string, Item> };
function gridOf(T: GridLayout) {
  if (T._grid) return T._grid;
  const m = new Map<string, Item>();
  for (const it of T.items) for (const r of T.rows) if (r >= it.b.r && r <= it.b.r2) for (const c of T.cols) if (c >= it.b.c && c <= it.b.c2) m.set(r + "," + c, it);
  return T._grid = m;
}
export function itemAt(T: TableLayout, r: number, c: number) { return gridOf(T).get(r + "," + c) || T.items.find(it => it.b.src.r === r && it.b.src.c === c); }
export const curSlide = () => get().deck.slides[get().deck.cur];
export function selTable() { const { sel } = get().selection; return sel ? curSlide()?.tables[sel.t] : undefined; }
export function selItems(): Item[] {
  const sel = get().selection.sel, T = selTable(); if (!sel || !T) return [];
  return T.items.filter(it => it.b.r <= sel.r2 && it.b.r2 >= sel.r1 && it.b.c <= sel.c2 && it.b.c2 >= sel.c1);
}
export function activeItem(): Item | null { const T = selTable(), { sel } = get().selection; return sel && T ? itemAt(T, sel.ar, sel.ac) || null : null; }
export function setSel(t: number, anchor: { r: number; c: number }, active: { r: number; c: number }) {
  const T = curSlide()?.tables[t]; if (!T) return;
  const a = itemAt(T, anchor.r, anchor.c), b = itemAt(T, active.r, active.c); if (!a || !b) return;
  let r1 = Math.min(a.b.r, b.b.r), r2 = Math.max(a.b.r2, b.b.r2), c1 = Math.min(a.b.c, b.b.c), c2 = Math.max(a.b.c2, b.b.c2);
  for (let k = 0; k < 4; k++) for (const it of T.items) if (it.b.r <= r2 && it.b.r2 >= r1 && it.b.c <= c2 && it.b.c2 >= c1) { r1 = Math.min(r1, it.b.r); r2 = Math.max(r2, it.b.r2); c1 = Math.min(c1, it.b.c); c2 = Math.max(c2, it.b.c2); }
  // one update: the stage paints the cells and takes the mark off a text box that was selected
  patch("selection", { sel: { t, anchor: { r: a.b.r, c: a.b.c }, ar: b.b.r, ac: b.b.c, r1, r2, c1, c2 }, noteSel: null, textSel: null });
}
export function clearSel() { patch("selection", { sel: null }); }
export function moveSel(dr: number, dc: number, extend: boolean) {
  const sel = get().selection.sel, T = selTable(); if (!sel || !T) return;
  const it = itemAt(T, sel.ar, sel.ac); if (!it) return;
  let ri = T.rows.indexOf(dr > 0 ? it.b.r2 : it.b.r), ci = T.cols.indexOf(dc > 0 ? it.b.c2 : it.b.c);
  ri = Math.max(0, Math.min(T.rows.length - 1, ri + dr)); ci = Math.max(0, Math.min(T.cols.length - 1, ci + dc));
  const target = itemAt(T, T.rows[ri], T.cols[ci]); if (!target) return;
  if (extend) setSel(sel.t, sel.anchor, { r: target.b.r, c: target.b.c });
  else setSel(sel.t, { r: target.b.r, c: target.b.c }, { r: target.b.r, c: target.b.c });
}
export function selectAll() { const sel = get().selection.sel, T = selTable(); if (!sel || !T) return; setSel(sel.t, { r: T.rows[0], c: T.cols[0] }, { r: T.rows[T.rows.length - 1], c: T.cols[T.cols.length - 1] }); }

/* ---- edits ---- */
const KEYS = ["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role"] as const;
export function editOf(it: Item): CellEdit { return (ctx().edits[it.L!.sheet.name] || {})[keyOf(it)] || {}; }
/** fn changes a copy of each selected cell's edit; the differences become cell.patch operations */
export function applySel(label: string, fn: (e: CellEdit, it: Item) => void, items = selItems(), extra: Op[] = []) {
  const ops: Op[] = [];
  for (const it of items) {
    const before = editOf(it), after: CellEdit = { ...before };
    fn(after, it);
    const patch: Record<string, unknown> = {};
    for (const k of KEYS) { const a = (before as Record<string, unknown>)[k], b = (after as Record<string, unknown>)[k]; if (a !== b) patch[k] = b === undefined ? null : b; }
    if (Object.keys(patch).length) ops.push({ op: "cell.patch", sheet: it.L!.sheet.name, ref: keyOf(it), patch } as Op);
  }
  if (ops.length || extra.length) change(label, [...ops, ...extra]);
}
export function setText(it: Item, val: string) {
  applySel("Edit text", e => { if (val === it.text) { delete e.text; delete e.orig; } else { e.orig = it.text; e.text = val; } }, [it]);
}
export function commitText(val: string, move?: [number, number]) {
  const it = activeItem(); if (!it) return;
  setText(it, val);
  if (move) moveSel(move[0], move[1], false);
}
export function clearText() { applySel("Clear text", (e, it) => { if (it.text === "") { delete e.text; delete e.orig; } else { e.orig = it.text; e.text = ""; } }); }
export function setSize(f: (cur: number) => number | null) {
  applySel("Text size", (e, it) => { const cur = e.sz || it.font.sz || 11; const v = f(cur); if (v === null) delete e.sz; else e.sz = Math.max(5, Math.min(96, Math.round(v * 2) / 2)); });
}
