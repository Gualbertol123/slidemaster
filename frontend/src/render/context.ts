/* Everything a renderer needs, passed explicitly (v2 read globals). A new context is created
   whenever the document changes; per-table caches compare string keys, so unchanged tables are
   never re-rendered. */
import type { Edits, Preset, RuntimeSlide, Style } from "../model/types";
import type { Sheet } from "../xlsx/types";

export interface RenderCtx {
  style: Style;
  edits: Edits;
  slides: RuntimeSlide[];
  preset: Preset | null;
  workbook: string;
  /** URL of the logo (helper) or "" */
  logoSrc: string;
  /** a loaded sheet of the workbook by name (painted conditional formats refer to their source sheet) */
  sheet?: (name: string) => Sheet | null;
  /** export / thumbnail rendering: hide placeholders for missing pictures */
  forExport?: boolean;
  _keys?: Map<string, string>;
}

/** cache key of one sheet's cell edits within this context */
export function sheetKey(ctx: RenderCtx, S: Sheet): string {
  const m = ctx._keys || (ctx._keys = new Map());
  let k = m.get(S.name);
  if (k === undefined) { k = JSON.stringify(ctx.edits[S.name] || {}); m.set(S.name, k); }
  return k;
}
/** cache key of one table: its sheet's edits + its own sizes/scales + the deck settings that change its HTML */
export function tableKey(ctx: RenderCtx, L: import("../xlsx/types").TableLayout): string {
  const d = L.def;
  return ctx.workbook + "|" + sheetKey(ctx, L.sheet) + "|" + (d ? JSON.stringify([d.cols, d.rows, d.scales, d.merges, d.gridH, d.gridV]) : "") + "|" + ctx.style.radius;
}
export const isNumText = (t: unknown) => /^[-+(]?[\d.\s]*\d[\d.,\s]*%?\)?$/.test(String(t).trim());
