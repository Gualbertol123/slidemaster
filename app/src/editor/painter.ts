/* Format painter (like Excel): copy the look of the selected cells, then click or drag over other
   cells – on any table, on any slide – to paste it. A multi-cell source is repeated as a pattern over
   the target. Double-click the button to keep painting; Esc stops. Only formatting is copied, never
   text. Values equal to the target's own Excel formatting are not stored (edits stay minimal).
   Copied: font, size, bold, italic, text colour, cell colour, highlight, alignment, vertical alignment and number
   display (4.9, S16.3, B38: CellEdit valign / num), role – and, like Excel, the
   conditional formatting (the source's rules, applied to the target's values: cell.cf), colour scales
   (a scale rule over the painted range), the cells' own gridlines (4.4, B20: TableDef.cellGrid entries) and the borders set on
   the slide (B28: TableDef.borders entries).
   4.9 (S16.3; 09 §9 Q19): with Ctrl held, each click or drag (cells of any table of the slide, or objects) only collects
   a target; letting Ctrl go pastes onto all of them at once – one change, one undo step. A selected chart, callout, icon
   or line copies its look instead (its style keys, never its data, text or place) onto others of the same kind: one
   item.patch per target. */
import { get, patch, toast } from "../state/store";
import { change, ctx } from "../state/app";
import type { Item, Sheet, TableLayout } from "@slide-builder/core/xlsx/types";
import type { CellBorders, CellGrid, CellEdit, Item as SlideItem, Op, RuntimeSlide, ScaleRule } from "@slide-builder/core/model/types";
import { cellEditOf, effItems } from "@slide-builder/core/render/edits";
import { validNum } from "@slide-builder/core/render/numdisplay";
import { itemAt, selOps, selRanges, selTable, type CellRange } from "./edit";
import { A1, inRange, parseRange, uid } from "@slide-builder/core/xlsx/util";

type ScaleLook = Omit<ScaleRule, "range">;
type VAlign = NonNullable<CellEdit["valign"]>;
export interface Fmt { sz: number; b: boolean; i: boolean; color: string; fill: string | null; bg: string; align: string; role: string | null;
  /** conditional formatting: "Sheet!A1" whose rules apply, null = none */ cf: string | null; scale: ScaleLook | null;
  /** the cell's own gridlines (TableDef.cellGrid), null = none */ grid: CellGrid | null;
  /** the borders set on the slide (TableDef.borders), null = the workbook's */ borders: CellBorders | null;
  /** 4.9: the font set on the slide (null: the design's / Excel's), the vertical position, the number format code shown
      (null: not a number) */ font?: string | null; valign?: VAlign | null; num?: string | null }
/** an object's look (4.9): its kind (charts, callouts and shapes, icons, lines) and its style keys */
export interface ObjLook { kind: string; id: string; look: Record<string, unknown> }

const rulesAt = (sh: Sheet, r: number, c: number) => sh.cfRules.filter(rule => rule.ranges.some(g => inRange(g, r, c)));
/** the conditional formatting a cell has now: painted (cell.cf) or its own rules */
function cfRef(T: TableLayout, it: Item): string | null {
  const e = cellEditOf(ctx(), Object.assign({}, it, { L: T }));
  if (e.cf !== undefined) return e.cf === "none" ? null : e.cf;
  return rulesAt(T.sheet, it.b.src.r, it.b.src.c).length ? T.sheet.name + "!" + A1(it.b.src.r, it.b.src.c) : null;
}
function scaleAt(T: TableLayout, it: Item): ScaleLook | null {
  for (const r of Object.values(T.def?.scales || {})) { const g = parseRange(r.range); if (inRange(g, it.b.src.r, it.b.src.c)) { const { range: _r, ...look } = r; return look; } }
  return null;
}
/** Excel's vertical words → the cell edit's (justify / distributed: none of the three) */
const V: Record<string, VAlign> = { top: "top", center: "middle", bottom: "bottom" };
/** the workbook's own number format of a number cell (null: not a number) */
function ownNum(T: TableLayout, raw: Item): string | null {
  const x = T.sheet.get(raw.b.src.r, raw.b.src.c);
  return x && (x.t === "n" || x.t === "d") ? x.fmt || "General" : null;
}

function effOf(T: TableLayout, raw: Item): Item {
  const eff = effItems(T, ctx()), k = T.items.indexOf(raw);
  return k >= 0 ? eff[k] : raw;
}
function fmtOf(T: TableLayout, raw: Item, e: Item): Fmt {
  const own = cellEditOf(ctx(), Object.assign({}, raw, { L: T })), num = ownNum(T, raw);
  // the text colour without the conditional format (that one travels with the rules)
  return { sz: e.font.sz || 11, b: !!e.font.b, i: !!e.font.i, color: e.userColor || raw.baseColor || raw.font.color || "#000000",
    fill: e.userFill || null, bg: e.noFill ? "none" : (e.baseFill || "none"), align: e.align, role: e.role || null, cf: cfRef(T, raw), scale: scaleAt(T, raw),
    grid: T.def?.cellGrid?.[A1(raw.b.src.r, raw.b.src.c)] ?? null, borders: T.def?.borders?.[A1(raw.b.src.r, raw.b.src.c)] ?? null,
    font: e.userFont || null, valign: V[e.valign] || null, num: num === null ? null : validNum(own.num) ? own.num : num };
}

/* ---- objects (4.9): the style keys copied per kind – never the data, the text, the place or the attachment ---- */
const OBJ_KEYS: Record<string, string[]> = {
  chart: ["legend", "legendAt", "show", "colors", "fmt", "titleFmt", "stack", "gap", "overlap", "frame", "titleRule", "startAngle"],
  shape: ["fill", "border", "radius", "fmt"],
  icon: ["fill", "stroke", "border"],
  line: ["style", "fmt"],
};
/** item.patch merges these per entry (core model/ops.ts ITEM_MAPS): a paste sends the source's entries and nulls the rest */
const MAPS = new Set(["colors", "fmt", "titleFmt"]);
const objKind = (it: SlideItem) => it.kind === "shape" ? (it.shape === "icon" ? "icon" : "shape") : it.kind;
const KIND_NAME: Record<string, string> = { chart: "charts", shape: "callouts and shapes", icon: "icons", line: "lines" };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function objLook(id: string, it: SlideItem): ObjLook {
  const look: Record<string, unknown> = {}, src = it as unknown as Record<string, unknown>;
  for (const k of OBJ_KEYS[objKind(it)] || []) if (src[k] !== undefined) look[k] = JSON.parse(JSON.stringify(src[k]));
  return { kind: objKind(it), id, look };
}
/** the item.patch that gives `it` the look (null: it has it already, or it is of another kind) */
function objPatch(o: ObjLook, it: SlideItem): Record<string, unknown> | null {
  if (objKind(it) !== o.kind) return null;
  const cur = it as unknown as Record<string, unknown>, p: Record<string, unknown> = {};
  for (const k of OBJ_KEYS[o.kind]) {
    const want = o.look[k], now = cur[k];
    if (same(want, now)) continue;
    if (want === undefined) { p[k] = null; continue; }
    if (MAPS.has(k) && want && typeof want === "object") {
      const m: Record<string, unknown> = { ...(want as Record<string, unknown>) };
      for (const e of Object.keys(now && typeof now === "object" ? now : {})) if (!(e in m)) m[e] = null;
      p[k] = m;
    } else p[k] = want;
  }
  return Object.keys(p).length ? p : null;
}
function objOps(o: ObjLook, R: RuntimeSlide, ids: string[]): Op[] {
  const ops: Op[] = [];
  for (const id of new Set(ids)) {
    const it = R.cfg.items?.[id]; if (!it) continue;
    const p = objPatch(o, it); if (p) ops.push({ op: "item.patch", slide: R.id, id, patch: p } as Op);
  }
  return ops;
}

export function startPainter(sticky = false) {
  const R = get().deck.slides[get().deck.cur], is = get().selection.itemSel, item = is && R?.cfg.items?.[is.id];
  if (item && is) {
    const obj = objLook(is.id, item);
    patch("selection", { painter: { pattern: [], sticky, obj } });
    toast(`Click ${obj.kind === "chart" ? "another chart" : obj.kind === "line" ? "another line" : obj.kind === "icon" ? "another icon" : "another callout or shape"} to give it this look${sticky ? ", as often as you like. Esc stops." : " (Esc cancels)."} Ctrl+click several ${KIND_NAME[obj.kind]}, then let go of Ctrl, to paste onto all of them at once.`);
    return;
  }
  const T = selTable(), s = get().selection.sel;
  if (!T || !s) { toast("Select the cells (or the chart, callout, icon or line) whose format you want to copy first."); return; }
  const rows = T.rows.filter(r => r >= s.r1 && r <= s.r2), cols = T.cols.filter(c => c >= s.c1 && c <= s.c2);
  const pattern = rows.map(r => cols.map(c => { const it = itemAt(T, r, c); return it ? fmtOf(T, it, effOf(T, it)) : null; }));
  patch("selection", { painter: { pattern, sticky } });     // the stage shows the painter cursor
  toast(sticky ? "Format painter on: click or drag over cells to paste the format, as often as you like. Esc stops." : "Click or drag over the cells to paste the format (Esc cancels). Ctrl+click several ranges, then let go of Ctrl, to paste onto all of them at once.");
}
/** colour scales travel as a rule over the painted range (unless that range already has the same rule) */
function scaleOps(T: TableLayout, g: CellRange, pattern: (Fmt | null)[]): Op[] {
  const look = pattern.find(f => f && f.scale)?.scale; if (!T.def || !look) return [];
  const range = A1(g.r1, g.c1) + ":" + A1(g.r2, g.c2);
  const sig = (r: ScaleLook) => [r.dir, r.mode, !!r.fill, !!r.ink, !!r.invert].join();
  if (Object.values(T.def.scales || {}).some(r => r.range === range && sig(r) === sig(look))) return [];
  return [{ op: "table.patch", id: T.def.id, patch: { scales: { [uid()]: { range, ...look } } } } as Op];
}
/** the cells' own gridlines travel as cellGrid entries of the target table (a cell without any: its entry removed) */
function gridOps(T: TableLayout, fmtFor: Map<Item, Fmt>): Op[] {
  if (!T.def) return [];
  const patch: Record<string, Record<string, unknown>> = {};
  for (const key of ["cellGrid", "borders"] as const) {
    const cur = (T.def[key] || {}) as Record<string, unknown>, m: Record<string, unknown> = {};
    for (const [it, f] of fmtFor) {
      const k = A1(it.b.src.r, it.b.src.c), now = cur[k] ?? null, want = key === "cellGrid" ? f.grid : f.borders;
      if (JSON.stringify(now) !== JSON.stringify(want)) m[k] = want ? JSON.parse(JSON.stringify(want)) : null;
    }
    if (Object.keys(m).length) patch[key] = m;
  }
  return Object.keys(patch).length ? [{ op: "table.patch", id: T.def.id, patch } as Op] : [];
}
export function stopPainter() { if (get().selection.painter) patch("selection", { painter: null }); }

/** the cells of ranges `gs` of table T and the format each takes (the pattern repeated from each range's corner) */
function targets(T: TableLayout, gs: CellRange[], p: { pattern: (Fmt | null)[][] }) {
  const pr = p.pattern.length, pc = p.pattern[0]?.length || 0, fmtFor = new Map<Item, Fmt>(), ops: Op[] = [];
  if (!pr || !pc) return { fmtFor, ops };
  for (const g of gs) {
    const rows = T.rows.filter(r => r >= g.r1 && r <= g.r2), cols = T.cols.filter(c => c >= g.c1 && c <= g.c2);
    rows.forEach((r, i) => cols.forEach((c, j) => {
      const it = itemAt(T, r, c); if (!it || fmtFor.has(it)) return;     // a merged block takes the format of its first cell
      const f = p.pattern[i % pr][j % pc]; if (f) fmtFor.set(it, f);
    }));
    ops.push(...scaleOps(T, g, p.pattern.flat()));
  }
  return { fmtFor, ops };
}
/** the operations that paste the pattern onto ranges `gs` of table T (cell edits, then its table's) */
function paintOps(T: TableLayout, gs: CellRange[], p: { pattern: (Fmt | null)[][] }): Op[] {
  const { fmtFor, ops } = targets(T, gs, p); if (!fmtFor.size) return [];
  const cells = selOps((e, it) => {
    const f = fmtFor.get(it); if (!f) return;
    const own = { sz: it.font.sz || 11, b: !!it.font.b, i: !!it.font.i, color: it.baseColor || it.font.color || "#000000", bg: it.baseFill || "none", align: it.align };
    const set = <K extends keyof typeof e>(k: K, v: (typeof e)[K] | undefined, same: boolean) => { if (same || v === undefined) delete e[k]; else e[k] = v; };
    set("sz", f.sz, f.sz === own.sz); set("b", f.b, f.b === own.b); set("i", f.i, f.i === own.i);
    set("color", f.color, f.color.toUpperCase() === own.color.toUpperCase());
    set("bg", f.bg, f.bg.toUpperCase() === own.bg.toUpperCase());
    set("fill", f.fill || undefined, !f.fill);
    set("align", f.align, f.align === own.align);
    set("role", f.role || undefined, !f.role);
    // 4.9: the font, the vertical position, the number display (a number cell only; the target's own code: nothing stored)
    if (f.font !== undefined) set("font", f.font || undefined, !f.font);
    if (f.valign !== undefined) set("valign", f.valign || undefined, !f.valign || f.valign === V[it.valign]);
    if (f.num !== undefined) { const mine = ownNum(T, it); set("num", f.num || undefined, !f.num || mine === null || f.num === mine); }
    // conditional formatting: nothing stored when the target already has exactly the same rules
    const mine = rulesAt(T.sheet, it.b.src.r, it.b.src.c), ownRef = mine.length ? T.sheet.name + "!" + A1(it.b.src.r, it.b.src.c) : null;
    const k = f.cf ? f.cf.lastIndexOf("!") : -1, srcSheet = f.cf ? f.cf.slice(0, k) : "";
    const same = f.cf ? srcSheet === T.sheet.name && (() => { const at = f.cf!.slice(k + 1).match(/^([A-Z]+)(\d+)$/); if (!at) return false; const g = parseRange(at[0] + ":" + at[0]); const theirs = rulesAt(T.sheet, g.r1, g.c1); return theirs.length === mine.length && theirs.every((x, n) => x === mine[n]); })() : !ownRef;
    if (same) delete e.cf; else e.cf = f.cf || "none";
  }, [...fmtFor.keys()]);
  return [...cells, ...ops, ...gridOps(T, fmtFor)];
}

/** called when a mouse selection ends while the painter is on: pastes onto the selection (all its Ctrl+click ranges) –
    or, with Ctrl held (`collect`), only notes the range as a target, pasted with the others when Ctrl is let go */
export function applyPainter(collect = false) {
  const p = get().selection.painter, T = selTable(), s = get().selection.sel; if (!p || p.obj || !T || !s) return;
  if (collect) {
    const pend = p.pend || { cells: [], items: [] }, g = { slide: get().deck.cur, t: s.t, r1: s.r1, r2: s.r2, c1: s.c1, c2: s.c2 };
    patch("selection", { painter: { ...p, pend: { ...pend, cells: [...pend.cells, g] } } });
    return;
  }
  const ops = paintOps(T, selRanges(s), p);
  if (ops.length) change("Paste format", ops);
  if (!p.sticky) stopPainter();
}
/** a click on an object while the painter is on: true when the painter took it (an object's look onto one of its kind) */
export function paintItem(id: string, collect: boolean): boolean {
  const p = get().selection.painter; if (!p) return false;
  const R = get().deck.slides[get().deck.cur], it = R?.cfg.items?.[id];
  if (!p.obj || !R || !it) return !!p.obj;
  if (objKind(it) !== p.obj.kind) { toast(`The format of ${KIND_NAME[p.obj.kind]} pastes onto ${KIND_NAME[p.obj.kind]} only.`); return true; }
  if (collect) {
    const pend = p.pend || { cells: [], items: [] };
    if (!pend.items.includes(id)) patch("selection", { painter: { ...p, pend: { ...pend, items: [...pend.items, id] } } });
    return true;
  }
  const ops = objOps(p.obj, R, [id]);
  if (ops.length) change("Paste format", ops);
  if (!p.sticky) stopPainter();
  return true;
}
/** Ctrl let go: everything collected gets the format at once – one change, so one Ctrl+Z undoes it all */
export function flushPainter() {
  const p = get().selection.painter, pend = p?.pend; if (!p || !pend || (!pend.cells.length && !pend.items.length)) return;
  const deck = get().deck, ops: Op[] = [];
  if (p.obj) { const R = deck.slides[deck.cur]; if (R) ops.push(...objOps(p.obj, R, pend.items)); }
  else {
    // per table: its ranges together (a cell of two ranges once)
    const by = new Map<TableLayout, CellRange[]>();
    for (const g of pend.cells) { const T = deck.slides[g.slide]?.tables[g.t]; if (T) by.set(T, [...(by.get(T) || []), g]); }
    for (const [T, gs] of by) ops.push(...paintOps(T, gs, p));
  }
  if (ops.length) change("Paste format", ops);
  if (p.sticky) patch("selection", { painter: { ...p, pend: undefined } }); else stopPainter();
}
addEventListener("keyup", e => { if (e.key === "Control" || e.key === "Meta") flushPainter(); });
addEventListener("blur", () => flushPainter());
