/* Format painter (like Excel): copy the look of the selected cells, then click or drag over other
   cells – on any table, on any slide – to paste it. A multi-cell source is repeated as a pattern over
   the target. Double-click the button to keep painting; Esc stops. Only formatting is copied, never
   text. Values equal to the target's own Excel formatting are not stored (edits stay minimal).
   Copied: size, bold, italic, text colour, cell colour, highlight, alignment, role – and, like Excel, the
   conditional formatting (the source's rules, applied to the target's values: cell.cf) and colour scales
   (a scale rule over the painted range). */
import { get, patch, toast } from "../state/store";
import { ctx } from "../state/app";
import type { Item, Sheet, TableLayout } from "@slide-builder/core/xlsx/types";
import type { Op, ScaleRule } from "@slide-builder/core/model/types";
import { cellEditOf, effItems } from "@slide-builder/core/render/edits";
import { applySel, itemAt, selItems, selTable } from "./edit";
import { A1, inRange, parseRange, uid } from "@slide-builder/core/xlsx/util";

type ScaleLook = Omit<ScaleRule, "range">;
export interface Fmt { sz: number; b: boolean; i: boolean; color: string; fill: string | null; bg: string; align: string; role: string | null;
  /** conditional formatting: "Sheet!A1" whose rules apply, null = none */ cf: string | null; scale: ScaleLook | null }

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

function effOf(T: TableLayout, raw: Item): Item {
  const eff = effItems(T, ctx()), k = T.items.indexOf(raw);
  return k >= 0 ? eff[k] : raw;
}
function fmtOf(T: TableLayout, raw: Item, e: Item): Fmt {
  // the text colour without the conditional format (that one travels with the rules)
  return { sz: e.font.sz || 11, b: !!e.font.b, i: !!e.font.i, color: e.userColor || raw.baseColor || raw.font.color || "#000000",
    fill: e.userFill || null, bg: e.noFill ? "none" : (e.baseFill || "none"), align: e.align, role: e.role || null, cf: cfRef(T, raw), scale: scaleAt(T, raw) };
}

export function startPainter(sticky = false) {
  const T = selTable(), s = get().selection.sel;
  if (!T || !s) { toast("Select the cells whose format you want to copy first."); return; }
  const rows = T.rows.filter(r => r >= s.r1 && r <= s.r2), cols = T.cols.filter(c => c >= s.c1 && c <= s.c2);
  const pattern = rows.map(r => cols.map(c => { const it = itemAt(T, r, c); return it ? fmtOf(T, it, effOf(T, it)) : null; }));
  patch("selection", { painter: { pattern, sticky } });     // the stage shows the painter cursor
  toast(sticky ? "Format painter on: click or drag over cells to paste the format, as often as you like. Esc stops." : "Click or drag over the cells to paste the format (Esc cancels).");
}
/** colour scales travel as a rule over the painted range (unless that range already has the same rule) */
function scaleOps(T: TableLayout, pattern: (Fmt | null)[]): Op[] {
  const s = get().selection.sel, look = pattern.find(f => f && f.scale)?.scale; if (!T.def || !s || !look) return [];
  const range = A1(s.r1, s.c1) + ":" + A1(s.r2, s.c2);
  const sig = (r: ScaleLook) => [r.dir, r.mode, !!r.fill, !!r.ink, !!r.invert].join();
  if (Object.values(T.def.scales || {}).some(r => r.range === range && sig(r) === sig(look))) return [];
  return [{ op: "table.patch", id: T.def.id, patch: { scales: { [uid()]: { range, ...look } } } } as Op];
}
export function stopPainter() { if (get().selection.painter) patch("selection", { painter: null }); }

/** called when a mouse selection ends while the painter is on */
export function applyPainter() {
  const p = get().selection.painter, T = selTable(), s = get().selection.sel; if (!p || !T || !s) return;
  const rows = T.rows.filter(r => r >= s.r1 && r <= s.r2), cols = T.cols.filter(c => c >= s.c1 && c <= s.c2);
  const pr = p.pattern.length, pc = p.pattern[0]?.length || 0; if (!pr || !pc) return;
  const fmtFor = new Map<Item, Fmt>();
  rows.forEach((r, i) => cols.forEach((c, j) => {
    const it = itemAt(T, r, c); if (!it || fmtFor.has(it)) return;     // a merged block takes the format of its first cell
    const f = p.pattern[i % pr][j % pc]; if (f) fmtFor.set(it, f);
  }));
  applySel("Paste format", (e, it) => {
    const f = fmtFor.get(it); if (!f) return;
    const own = { sz: it.font.sz || 11, b: !!it.font.b, i: !!it.font.i, color: it.baseColor || it.font.color || "#000000", bg: it.baseFill || "none", align: it.align };
    const set = <K extends keyof typeof e>(k: K, v: (typeof e)[K] | undefined, same: boolean) => { if (same || v === undefined) delete e[k]; else e[k] = v; };
    set("sz", f.sz, f.sz === own.sz); set("b", f.b, f.b === own.b); set("i", f.i, f.i === own.i);
    set("color", f.color, f.color.toUpperCase() === own.color.toUpperCase());
    set("bg", f.bg, f.bg.toUpperCase() === own.bg.toUpperCase());
    set("fill", f.fill || undefined, !f.fill);
    set("align", f.align, f.align === own.align);
    set("role", f.role || undefined, !f.role);
    // conditional formatting: nothing stored when the target already has exactly the same rules
    const mine = rulesAt(T.sheet, it.b.src.r, it.b.src.c), ownRef = mine.length ? T.sheet.name + "!" + A1(it.b.src.r, it.b.src.c) : null;
    const k = f.cf ? f.cf.lastIndexOf("!") : -1, srcSheet = f.cf ? f.cf.slice(0, k) : "";
    const same = f.cf ? srcSheet === T.sheet.name && (() => { const at = f.cf!.slice(k + 1).match(/^([A-Z]+)(\d+)$/); if (!at) return false; const g = parseRange(at[0] + ":" + at[0]); const theirs = rulesAt(T.sheet, g.r1, g.c1); return theirs.length === mine.length && theirs.every((x, n) => x === mine[n]); })() : !ownRef;
    if (same) delete e.cf; else e.cf = f.cf || "none";
  }, [...fmtFor.keys()].length ? [...fmtFor.keys()] : selItems(), scaleOps(T, p.pattern.flat()));
  if (!p.sticky) stopPainter();
}
