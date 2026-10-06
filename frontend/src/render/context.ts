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
export const isNumText = (t: unknown) => /^[-+(]?[\d.\s]*\d[\d.,\s]*%?\)?$/.test(String(t).trim());
