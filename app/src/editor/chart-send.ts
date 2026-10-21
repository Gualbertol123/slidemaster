/* Sending the chart panel's changes (S14.5): one item.patch each (state/app.ts change – one undo step). The changes
   themselves are editor/chart-panel.ts's pure builders. */
import type { DataRef, ItemPatch } from "@slide-builder/core/model/types";
import { itemOf, itemPatch } from "./charts";
import { REF_TITLE, refPatch, type ChartRefWhat } from "./chart-panel";

/** the change the cells chosen in the sheet view make (PickCells.tsx "chart-ref"), sent */
export function applyRef(id: string, w: ChartRefWhat, ref: DataRef) {
  const it = itemOf(id); if (!it || it.kind !== "chart") return;
  const p = refPatch(it, w, ref);
  if (p) itemPatch(REF_TITLE[w.what].replace(/^Chart: /, "Chart · "), id, p);
}
/** one change of the chart (one undo step); nothing when the builder had nothing to change */
export function chartChange(label: string, id: string, p: ItemPatch | null) { if (p) itemPatch(label, id, p); }
