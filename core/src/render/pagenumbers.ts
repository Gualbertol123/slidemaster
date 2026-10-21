/* Page numbers: pageNumber(i) = start + the slides before i that are not hidden in the design (the cover counts as a
   page). i is the slide's position in ctx.slides (the runtime slides of preset.slides, worker/host.ts slidesFor), so a
   slide added or removed (slide.add / slide.remove, S13.3) renumbers every slide after it, and the contents slide
   (slide-dl.ts indexNodes / consultIndex) with them. A slide hidden in the design (S13.6, B47: SlideDef.hide) is left
   out of that design's exports (host.ts slideLists), of the numbering and of the contents – on the stage and the
   thumbnails too, which still draw it: it shows no page number, and the others show their exported one (09 §2.8b). */
import type { RenderCtx } from "./context";
import { deckFmt } from "./text";
import type { Design, SlideDef } from "../model/types";

/** a slide definition hidden in design `d` (S13.6, B47) */
export const hiddenIn = (cfg: Pick<SlideDef, "hide"> | null | undefined, d: Design) => cfg?.hide?.[d] === true;
/** slide i of ctx is hidden in ctx's design */
export const isHidden = (ctx: RenderCtx, i: number) => hiddenIn(ctx.slides[i]?.cfg, ctx.style.design);
/** the slides before i that are not hidden */
const shownBefore = (ctx: RenderCtx, i: number) => { let n = 0; for (let j = 0; j < i; j++) if (!isHidden(ctx, j)) n++; return n; };
export function pageNumber(ctx: RenderCtx, i: number) { const p = ctx.style.pn; return (isFinite(+p.start) ? +p.start : 1) + shownBefore(ctx, i); }
/** label shown on slide i, or null (a hidden slide has none) */
export function pageNoFor(ctx: RenderCtx, i: number): string | null {
  const p = ctx.style.pn; if (!p.on || isHidden(ctx, i)) return null;
  if (ctx.slides[i] && ctx.slides[i].type === "cover" && !p.cover) return null;
  const n = pageNumber(ctx, i), N = pageNumber(ctx, 0) + Math.max(0, shownBefore(ctx, ctx.slides.length) - 1);
  return p.format === "nN" ? `${n} / ${N}` : p.format === "page" ? `Page ${n}` : p.format === "p" ? `p. ${n}` : String(n);
}
export const PN_FONTS: Record<string, string | null> = {
  auto: null, segoe: "'Segoe UI',Arial,sans-serif", arial: "Arial,Helvetica,sans-serif", calibri: "Calibri,Carlito,Arial,sans-serif",
  gothic: "'Century Gothic','URW Gothic',Arial,sans-serif", georgia: "Georgia,'Times New Roman',serif", verdana: "Verdana,Geneva,sans-serif", mono: "Consolas,'Cascadia Mono',monospace",
};
export function pageNoBox(ctx: RenderCtx, label: string, glassy: boolean) {
  const p = ctx.style.pn, size = Math.max(9, Math.min(36, +p.size || 16)), capsule = glassy && p.style !== "plain";
  return { size, capsule, w: Math.round(label.length * size * .62 + (capsule ? 34 : 4)), h: Math.round(size * (capsule ? 2.4 : 1.4)) };
}
/** where the page number goes on a slide (slide px) */
export function pageNoGeom(ctx: RenderCtx, label: string, glassy: boolean, hasLogo: boolean, cover: boolean) {
  const p = ctx.style.pn, { size, capsule, w, h } = pageNoBox(ctx, label, glassy);
  const margin = 40, top = p.pos[0] === "t" ? (capsule ? 24 : 28) : 900 - margin + 6 - h;
  let left = p.pos[1] === "l" ? 56 : p.pos[1] === "c" ? (1600 - w) / 2 : 1600 - 44 - w;
  if (p.pos === "br" && hasLogo) left = (glassy ? (cover ? 1150 : 1256) : 1600 - 340) - 22 - w;   // never on top of the logo
  if (p.pos === "bl" && hasLogo && cover) left = 1600 - 44 - w;
  return { left, top, w, h, size, capsule };
}
/** font, weight, style and colour of page numbers and footer: the deck's text style (the older page-number font as fallback) */
export function pnFmt(ctx: RenderCtx): { f: ReturnType<typeof deckFmt>; legacy: string | null } {
  return { f: deckFmt(ctx, "pageno"), legacy: PN_FONTS[ctx.style.pn.font] || null };
}

/* ---- footer: like the page number, with {date}, {workbook}, {title} ---- */
export function footerText(ctx: RenderCtx, i: number, today: string): string {
  const f = ctx.style.footer, R = ctx.slides[i];
  return String(f.text || "").replace(/\{date\}/gi, today).replace(/\{workbook\}/gi, ctx.workbook.replace(/\.[^.]+$/, "")).replace(/\{title\}/gi, R ? R.title : "").trim();
}
/** where the footer goes on slide i (slide px) and its label; null when there is none */
export function footerGeom(ctx: RenderCtx, i: number, glassy: boolean, hasLogo: boolean, cover: boolean, pageLabel: string | null, today: string) {
  const f = ctx.style.footer;
  if (!f.on || (cover && !f.cover)) return null;
  const label = footerText(ctx, i, today); if (!label) return null;
  const size = Math.max(9, Math.min(32, +f.size || 14)), capsule = glassy && f.style === "capsule";
  const w = Math.min(1100, Math.round(label.length * size * .55 + (capsule ? 34 : 6))), h = Math.round(size * (capsule ? 2.4 : 1.4));
  const top = f.pos[0] === "t" ? (capsule ? 24 : 28) : 900 - 40 + 6 - h;
  let left = f.pos[1] === "l" ? 56 : f.pos[1] === "c" ? (1600 - w) / 2 : 1600 - 44 - w;
  if (f.pos[0] === "b" && f.pos[1] === "r" && hasLogo) left = (glassy ? (cover ? 1150 : 1256) : 1600 - 340) - 22 - w;
  if (f.pos === "bl" && hasLogo && cover) left = 1600 - 44 - w;
  let y = top;
  // same corner as the page number: sit next to it (or above it in the centre)
  if (pageLabel !== null && ctx.style.pn.pos === f.pos) {
    const g = pageNoGeom(ctx, pageLabel, glassy, hasLogo, cover);
    if (f.pos[1] === "l") left = g.left + g.w + 16;
    else if (f.pos[1] === "r") left = g.left - 16 - w;
    else y = f.pos[0] === "b" ? g.top - h - 6 : g.top + g.h + 6;
  }
  return { label, left, top: y, w, h, size, capsule };
}
