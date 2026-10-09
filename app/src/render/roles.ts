/* What each row of a table is – header band, total, body, spacer – for the Excel designs. Built on the
   same analysis as the automated comments (model/comment.ts): rows above the first row with a label and
   numbers are the header; rows labelled "Total…" (or fully bold rows with numbers) are totals. */
import type { TableLayout } from "../xlsx/types";
import type { RenderCtx } from "./context";
import { tableKey } from "./context";
import { cache } from "./edits";
import { analysisOf, gridOf } from "./comment";
import { TOTAL } from "../model/comment";

export type RowKind = "header" | "total" | "body" | "spacer" | "other";
export interface Roles { kind: Map<number, RowKind>; labelCol: number; /** sheet column of the labels */ labelC: number; stripe: Map<number, boolean> }

export function rolesOf(L: TableLayout, ctx: RenderCtx): Roles {
  return cache(L, "roles", tableKey(ctx, L), () => {
    const a = analysisOf(L, ctx), g = gridOf(L, ctx), kind = new Map<number, RowKind>(), stripe = new Map<number, boolean>();
    const first = a.rows.length ? a.rows[0].r : L.rows.length, last = a.rows.length ? a.rows[a.rows.length - 1].r : -1;
    const data = new Set(a.rows.map(x => x.r));
    let n = 0;
    L.rows.forEach((r, i) => {
      const empty = g[i].every(c => !c.text.trim());
      let k: RowKind;
      if (i < first) k = empty ? "spacer" : "header";
      else if (empty) k = "spacer";
      else if (data.has(i)) {
        const row = a.rows.find(x => x.r === i)!, cells = g[i].filter(c => c.anchor && c.text.trim());
        k = TOTAL.test(row.label) || (cells.length > 2 && cells.every(c => c.bold)) ? "total" : "body";
      } else k = i > last ? "other" : "body";
      kind.set(r, k);
      if (k === "body") stripe.set(r, n++ % 2 === 1); else if (k !== "spacer") n = 0;
    });
    return { kind, labelCol: a.labelCol, labelC: L.cols[a.labelCol] ?? L.cols[0], stripe };
  });
}
