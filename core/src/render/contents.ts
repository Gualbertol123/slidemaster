/* The contents slide's parts in a free layout (4.9, B51; the product owner's 2026-10-22 request): its title (with the
   subtitle under it) and its list of entries move and resize like a table of a free layout – the design's free entry
   holds their boxes under "c:title" and "c:toc" (layout.ts freeKey.part), each with its drawn `scale`. slide-dl.ts draws
   a part where the design puts it, then – moved – the same nodes in a group that takes their box (the hits of the part,
   united) to the saved place at the saved scale: the list still follows the deck (entries, page numbers, hidden slides),
   it is only placed elsewhere. A part never moved draws exactly as before (no group, the same display list). */
import type { RuntimeSlide } from "../model/types";
import type { RenderCtx } from "./context";
import { freeEntry, freeKey, freeOf } from "./layout";

export type ContentsPart = "title" | "toc";
export const CONTENTS_PARTS: readonly ContentsPart[] = ["title", "toc"];
export const PART_LABEL: Record<ContentsPart, string> = { title: "Title", toc: "Contents" };
interface HitBox { id: string; x: number; y: number; w: number; h: number }

/** the part an element of the contents slide belongs to, by its classes: the title and subtitle; what the list draws –
    numbers, entries, pages, leaders, separators, its card (Liquid Glass), its "No content slides yet" line ("ix-…"; a
    row's own box is as wide as its column, not what it shows: left out) */
export function partOf(id: string): ContentsPart | null {
  const cls = id.split(" ");
  if (cls[0] === "title" || cls[0] === "subtitle") return "title";
  return cls[0] !== "ix-row" && cls.some(c => c.startsWith("ix-")) ? "toc" : null;
}
/** the box of a part: its elements' boxes united (null: none drawn). slide-dl.ts gives the title and subtitle the box
    of their text (their element is as wide as the slide allows them) */
export function partBox(hits: readonly HitBox[], part: ContentsPart): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const h of hits) if (partOf(h.id) === part && h.w >= 0 && h.h >= 0) { x0 = Math.min(x0, h.x); y0 = Math.min(y0, h.y); x1 = Math.max(x1, h.x + h.w); y1 = Math.max(y1, h.y + h.h); }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/** the saved place of a part of a contents slide in this design's free layout (on), else null */
export function savedPart(R: RuntimeSlide, ctx: RenderCtx, part: ContentsPart): { x: number; y: number; w: number; h: number; scale?: number } | null {
  if (R.type !== "index") return null;
  const f = freeOf(R, ctx);
  return f ? freeEntry(f.items[freeKey.part(part)]) : null;
}
/** the transform that takes a part drawn in box D to its saved place `e` (its scale: saved, else from the widths;
    0.05–20); null when it stays where it is (nothing moved: the display list unchanged) */
export function partTransform(D: { x: number; y: number; w: number; h: number }, e: { x: number; y: number; w: number; scale?: number }): [number, number, number, number, number, number] | null {
  const s = Math.max(.05, Math.min(20, e.scale ?? e.w / D.w));
  if (!Number.isFinite(s)) return null;
  const dx = e.x - s * D.x, dy = e.y - s * D.y;
  return Math.abs(s - 1) < 1e-9 && Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 ? null : [s, 0, 0, s, dx, dy];
}
