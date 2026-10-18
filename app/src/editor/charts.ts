/* Charts and callouts on slides (S9.3, S9.4, B16, B17; docs/next/07 §2.2, §3): insert one from the selected cells or from a range of a sheet the
   wizard lists, select it (and one of its slices), change it, delete it – every change one `item.patch` operation
   (state/app.ts change), so each is one undo step. Moves and resizes are drags (stage/drags.ts itemMove / itemResize). */
import { get, patch, toast } from "../state/store";
import { change } from "../state/app";
import type { ChartItem, DataRef, Item, ItemPatch, Op, RuntimeSlide, ShapeItem } from "@slide-builder/core/model/types";
import { A1 } from "@slide-builder/core/xlsx/util";
import { curSlide } from "./edit";

/** a new item's id: short, random (as table and slide ids) */
export const newItemId = () => "i" + Math.random().toString(36).slice(2, 9);
export const itemOf = (id: string | null | undefined, R: RuntimeSlide | null = curSlide()): Item | null => (id && R?.cfg.items?.[id]) || null;
/** the selected item (and slice) of the current slide */
export const selectedItem = () => { const s = get().selection.itemSel; return s ? { ...s, it: itemOf(s.id) } : null; };
/** selects item `id` (null clears); a slice of a chart with `slice` */
export function selectItem(id: string | null, slice: number | null = null) {
  patch("selection", id ? { itemSel: { id, slice }, sel: null, noteSel: null, textSel: null } : { itemSel: null });
}
/** one change of item `id` of the current slide */
export function itemPatch(label: string, id: string, p: ItemPatch | null) {
  const R = curSlide(); if (!R) return;
  change(label, [{ op: "item.patch", slide: R.id, id, patch: p } as Op]);
}
export function deleteItem() {
  const s = selectedItem(); if (!s?.it) return;
  itemPatch(s.it.kind === "chart" ? "Remove chart" : "Remove shape", s.id, null);
  selectItem(null);
}
/** a new chart: a pie with the shares on the slices and the legend on the right */
function addChart(values: DataRef, labels: DataRef | null, box: ChartItem["box"], attach: ChartItem["attach"] | null) {
  const R = curSlide(); if (!R) return null;
  const id = newItemId(), it: ChartItem = { kind: "chart", type: "pie", values, ...(labels ? { labels } : {}), show: ["percent"], legend: "right", box, ...(attach ? { attach } : {}) };
  change("Insert chart", [{ op: "item.patch", slide: R.id, id, patch: it } as Op]);
  selectItem(id);
  return id;
}
/** a chart of the selected cells, beside their table on the right: the last column's numbers, named by the first
    column when more than one is selected (a column or a row alone: the headers beside it name the values) */
export function insertChartFromSelection() {
  const R = curSlide(), sel = get().selection.sel, T = sel && R ? R.tables[sel.t] : null;
  if (!R || !sel || !T?.def) { toast("Select the cells of a table first (the numbers, and their names on the left if you like)."); return null; }
  const range = (c1: number, c2: number) => A1(sel.r1, c1) + ":" + A1(sel.r2, c2), multi = sel.c2 > sel.c1 && sel.r2 > sel.r1;
  const values: DataRef = { table: T.def.id, range: multi ? range(sel.c2, sel.c2) : range(sel.c1, sel.c2) };
  return addChart(values, multi ? { table: T.def.id, range: range(sel.c1, sel.c1) } : null, { x: 0, y: 0, w: 520, h: 400 }, { table: T.def.id, side: "right" });
}
/** a chart of cells chosen in the sheet view (PickCells.tsx: any sheet the wizard lists, a sheet on no slide too),
    placed on the right half of the slide */
export const insertChartRefs = (values: DataRef, labels: DataRef | null) => addChart(values, labels, { x: 900, y: 200, w: 600, h: 440 }, null);
/** a cell quoted at the end of callout `id`'s text: {Sheet!C7}, a name with spaces or signs in quotes */
export function quoteCell(id: string, sheet: string, ref: string) {
  const it = itemOf(id); if (!it || it.kind !== "shape") return;
  const name = /^[\w.[\]-]+$/.test(sheet) ? sheet : "'" + sheet.replace(/'/g, "''") + "'", cur = it.text || "";
  itemPatch("Quote a cell", id, { text: cur + (cur && !/\s$/.test(cur) ? " " : "") + "{" + name + "!" + ref + "}" });
}
/** a new callout in the middle of the slide (an icon: a small square), selected; a shape opens for typing */
export function insertShape(shape: ShapeItem["shape"], icon?: string) {
  const R = curSlide(); if (!R) return null;
  const id = newItemId(), box = shape === "icon" ? { x: 768, y: 418, w: 64, h: 64 } : shape === "circle" ? { x: 700, y: 350, w: 200, h: 200 } : { x: 640, y: 390, w: 320, h: 120 };
  const it: ShapeItem = { kind: "shape", shape, ...(icon ? { icon } : {}), box, ...(shape === "bubble" ? { tail: { x: box.x + 60, y: box.y + box.h + 50 } } : {}) };
  change(shape === "icon" ? "Insert icon" : "Insert shape", [{ op: "item.patch", slide: R.id, id, patch: it } as Op]);
  selectItem(id);
  return id;
}
/** how the side panel names where a chart's numbers come from ("Summary!C5:C9", a table's sheet for a table's range) */
export function refText(ref: DataRef | undefined): string {
  if (!ref) return "–";
  if ("table" in ref) { const t = get().doc.view?.preset?.tables.find(x => x.id === ref.table); return (t?.sheet || "(table removed)") + "!" + ref.range; }
  return ref.sheet + "!" + ref.range;
}
