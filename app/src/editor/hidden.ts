/* Hidden rows and columns per slide (S16.1, B36, docs/next/09 §3.6): the actions of ribbon 2 › Cells › Hide ▾ and of
   the stage's double marks. Each is one slide.patch of the `hidden` map – one undo step; other people's rows on the same
   table are entries of their own (merged per row / column), so two people hiding two rows both win. */
import { patch, toast } from "../state/store";
import { change } from "../state/app";
import { curSlide, selTable } from "./edit";
import { selCols, selRows } from "./tables";
import { hiddenEntries, hiddenKey } from "@slide-builder/core/model/hidden";
import type { Op, RuntimeSlide } from "@slide-builder/core/model/types";
import type { TableLayout } from "@slide-builder/core/xlsx/types";

const op = (R: RuntimeSlide, hidden: Record<string, true | null>): Op => ({ op: "slide.patch", id: R.id, patch: { hidden } } as Op);

/** Hide rows / Hide columns: the selected rows (columns) of the selected table, on this slide only */
export function hideSel(kind: "r" | "c"): boolean {
  const R = curSlide(), T = selTable(), id = T?.def?.id;
  if (!R || !T || !id) { toast("Select cells of a table first."); return false; }
  const keys = kind === "r" ? selRows() : selCols(), left = (kind === "r" ? T.rows : T.cols).length - keys.length;
  if (!keys.length) return false;
  if (left < 1) { toast(kind === "r" ? "A table keeps at least one row: select fewer rows." : "A table keeps at least one column: select fewer columns."); return false; }
  const n = keys.length, what = kind === "r" ? (n === 1 ? "row" : "rows") : (n === 1 ? "column" : "columns");
  const ok = change(`Hide ${n} ${what}`, [op(R, Object.fromEntries(keys.map(k => [hiddenKey(id, kind, k), true])))]);
  if (ok) patch("selection", { sel: null });         // the selected cells are gone from the slide
  return ok;
}
/** the hidden rows / columns of a table on this slide come back (a double mark's click: those keys; Unhide all: every one) */
export function unhide(R: RuntimeSlide, keys: string[], label = "Unhide"): boolean {
  if (!keys.length) return false;
  return change(label, [op(R, Object.fromEntries(keys.map(k => [k, null])))]);
}
/** the table Unhide all acts on: the selected one, else the slide's only table */
export function hideTarget(): TableLayout | undefined {
  const R = curSlide(); if (!R) return undefined;
  return selTable() || (R.tables.length === 1 ? R.tables[0] : undefined);
}
export function unhideAll(): boolean {
  const R = curSlide(), T = hideTarget(), id = T?.def?.id;
  if (!R || !id) return false;
  return unhide(R, hiddenEntries(R.cfg, id), "Unhide all on this table");
}
/** how many rows / columns this slide hides of a table */
export const hiddenCount = (R: RuntimeSlide | null | undefined, T: TableLayout | undefined) => R && T?.def?.id ? hiddenEntries(R.cfg, T.def.id).length : 0;
