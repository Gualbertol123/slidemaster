/* B55 (4.14): the owner's "BUDGET ACHIEVEMENT" card (image 19 of 2026-10-23) on the B54 workbook
   (app/tests/fixtures/B54.xlsx): straight from the Volumes long table – per product (column A) its last row's volume
   (column C, the latest week W39) against that row's EoM budget (column D). And the B54 slide with the card added at the
   right, the B54 cards narrowed to make room as in the owner's layout. Used by core/tests/chart-progress.test.ts and the
   e2e spec B55-01. */
import type { ChartItem, DataRef, ItemPatch, Op } from "../src/model/types";
import { b54Ops } from "./b54-deck";

const V = (range: string): DataRef => ({ sheet: "Volumes", range });
/** the card as Insert chart ▾ › Budget achievement… makes it from Volumes!A1:D9 */
export function achievementCard(box: ChartItem["box"]): ChartItem {
  return { kind: "chart", type: "progress", title: "BUDGET ACHIEVEMENT", titleFmt: { align: "left" }, subtitle: "Latest volume / EoM budget",
    values: V("C2:C9"), labels: V("A2:A9"), legendAt: "none", box,
    progress: { table: { by: V("A2:A9"), val: V("C2:C9"), target: V("D2:D9") } } };
}
/** the same card from cells: the two W39 volumes and their budgets (C5, C9; D5, D9), the names typed */
export function achievementCells(box: ChartItem["box"]): ChartItem {
  return { kind: "chart", type: "progress", title: "BUDGET ACHIEVEMENT", subtitle: "Latest volume / EoM budget", values: V("C5"), box,
    progress: { vals: [V("C5"), V("C9")], targets: [V("D5"), V("D9")], cats: ["Loans", "Deposits"] } };
}
/** the B54 slide, its cards narrowed to the left 1,240 px, the achievement card (id "ba") at the right */
export function b55Ops(slide = "b54"): Op[] {
  const gap = 26, x0 = 61, kw = 280, cw = (4 * kw + 3 * gap - gap) / 2;
  return b54Ops(slide).map((o): Op => {
    if (o.op !== "item.patch" || !o.patch || !o.patch.box) return o;
    const b = o.patch.box, k = ["k1", "k2", "k3", "k4"].indexOf(o.id);
    const box = k >= 0 ? { ...b, x: x0 + k * (kw + gap), w: kw } : o.id === "cl" ? { ...b, x: x0, w: cw } : { ...b, x: x0 + cw + gap, w: cw };
    return { ...o, patch: { ...o.patch, box } };
  }).concat([{ op: "item.patch", slide, id: "ba", patch: achievementCard({ x: x0 + 4 * kw + 4 * gap, y: 180, w: 1600 - 61 - (x0 + 4 * kw + 4 * gap), h: 680 }) as unknown as ItemPatch }]);
}
