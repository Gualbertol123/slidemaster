/* Format painter (like Excel): copy the look of the selected cells, then click or drag over other
   cells – on any table, on any slide – to paste it. A multi-cell source is repeated as a pattern over
   the target. Double-click the button to keep painting; Esc stops. Only formatting is copied, never
   text. Values equal to the target's own Excel formatting are not stored (edits stay minimal). */
import { S, emit, toast } from "../state/store";
import { ctx } from "../state/app";
import type { Item, TableLayout } from "../xlsx/types";
import { effItems } from "../render/edits";
import { applySel, itemAt, selItems, selTable } from "./edit";

export interface Fmt { sz: number; b: boolean; i: boolean; color: string; fill: string | null; bg: string; align: string; role: string | null }

function effOf(T: TableLayout, raw: Item): Item {
  const eff = effItems(T, ctx()), k = T.items.indexOf(raw);
  return k >= 0 ? eff[k] : raw;
}
function fmtOf(e: Item): Fmt {
  return { sz: e.font.sz || 11, b: !!e.font.b, i: !!e.font.i, color: e.userColor || e.font.color || "#000000",
    fill: e.userFill || null, bg: e.noFill ? "none" : (e.baseFill || "none"), align: e.align, role: e.role || null };
}
const paint = (on: boolean) => document.body.classList.toggle("painting", on);

export function startPainter(sticky = false) {
  const T = selTable(), s = S.sel;
  if (!T || !s) { toast("Select the cells whose format you want to copy first."); return; }
  const rows = T.rows.filter(r => r >= s.r1 && r <= s.r2), cols = T.cols.filter(c => c >= s.c1 && c <= s.c2);
  const pattern = rows.map(r => cols.map(c => { const it = itemAt(T, r, c); return it ? fmtOf(effOf(T, it)) : null; }));
  S.painter = { pattern, sticky }; paint(true); emit();
  toast(sticky ? "Format painter on: click or drag over cells to paste the format, as often as you like. Esc stops." : "Click or drag over the cells to paste the format (Esc cancels).");
}
export function stopPainter() { if (S.painter) { S.painter = null; paint(false); emit(); } }

/** called when a mouse selection ends while the painter is on */
export function applyPainter() {
  const p = S.painter, T = selTable(), s = S.sel; if (!p || !T || !s) return;
  const rows = T.rows.filter(r => r >= s.r1 && r <= s.r2), cols = T.cols.filter(c => c >= s.c1 && c <= s.c2);
  const pr = p.pattern.length, pc = p.pattern[0]?.length || 0; if (!pr || !pc) return;
  const fmtFor = new Map<Item, Fmt>();
  rows.forEach((r, i) => cols.forEach((c, j) => {
    const it = itemAt(T, r, c); if (!it || fmtFor.has(it)) return;     // a merged block takes the format of its first cell
    const f = p.pattern[i % pr][j % pc]; if (f) fmtFor.set(it, f);
  }));
  applySel("Paste format", (e, it) => {
    const f = fmtFor.get(it); if (!f) return;
    const own = { sz: it.font.sz || 11, b: !!it.font.b, i: !!it.font.i, color: it.font.color || "#000000", bg: it.baseFill || "none", align: it.align };
    const set = <K extends keyof typeof e>(k: K, v: (typeof e)[K] | undefined, same: boolean) => { if (same || v === undefined) delete e[k]; else e[k] = v; };
    set("sz", f.sz, f.sz === own.sz); set("b", f.b, f.b === own.b); set("i", f.i, f.i === own.i);
    set("color", f.color, f.color.toUpperCase() === own.color.toUpperCase());
    set("bg", f.bg, f.bg.toUpperCase() === own.bg.toUpperCase());
    set("fill", f.fill || undefined, !f.fill);
    set("align", f.align, f.align === own.align);
    set("role", f.role || undefined, !f.role);
  }, [...fmtFor.keys()].length ? [...fmtFor.keys()] : selItems());
  if (!p.sticky) stopPainter();
}
