/* (B56, 4.14; core model/textparts.ts) the item.patch of one text format, one layout setting, the dragged parts' offsets –
   each ONE op (one undo step), only its own entry (two writers on two parts both keep theirs). Pure. */
import type { ItemPatch, TextFmt } from "@slide-builder/core/model/types";
import { isOffKey } from "@slide-builder/core/model/textparts";

/** a format without its unset keys (null: nothing left) */
export function cleanFmt(f: TextFmt | null | undefined): TextFmt | null {
  if (!f) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return Object.keys(out).length ? out as TextFmt : null;
}
/** a part's format in the item's `texts` (null removes it) */
export const textsPatch = (part: string, f: TextFmt | null): ItemPatch => ({ texts: { [part]: cleanFmt(f) } });
/** one layout setting (null: as the design draws it) */
export const layPatch = (key: string, v: string | number | boolean | null): ItemPatch => ({ lay: { [key]: v } });
/** a part dropped `dx`, `dy` px from where it was, as fractions of the item's box (its earlier offset kept); back at its
    place (under half a px) the entry goes */
export function offPatch(cur: { dx: number; dy: number } | undefined, key: string, dx: number, dy: number, box: { w: number; h: number }): ItemPatch {
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  const fx = r((cur?.dx || 0) + dx / Math.max(1, box.w)), fy = r((cur?.dy || 0) + dy / Math.max(1, box.h));
  return { offs: { [key]: Math.abs(fx * box.w) < .5 && Math.abs(fy * box.h) < .5 ? null : { dx: fx, dy: fy } } };
}
/** every part dragged back where the layout puts it */
export const offsResetPatch = (): ItemPatch => ({ offs: null });
export { isOffKey };
/** a format kept as an item MAP (a chart's `titleFmt`, `fmt`: merged per key by item.patch) set to `next` whole: the keys
    it drops sent as null; null / nothing left deletes the map */
export function fmtMapPatch(cur: TextFmt | undefined, next: TextFmt | null): Record<string, unknown> | null {
  const n = cleanFmt(next); if (!n) return null;
  const out: Record<string, unknown> = { ...n };
  for (const k of Object.keys(cur && typeof cur === "object" ? cur : {})) if (!(k in out)) out[k] = null;
  return out;
}
