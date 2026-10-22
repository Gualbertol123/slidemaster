/* Page numbers: pageNumber(i) = start + the slides before i that are not hidden in the design (the cover counts as a
   page). i is the slide's position in ctx.slides (the runtime slides of preset.slides, worker/host.ts slidesFor), so a
   slide added or removed (slide.add / slide.remove, S13.3) renumbers every slide after it, and the contents slide
   (slide-dl.ts indexNodes / consultIndex) with them. A slide hidden in the design (S13.6, B47: SlideDef.hide) is left
   out of that design's exports (host.ts slideLists), of the numbering and of the contents – on the stage and the
   thumbnails too, which still draw it: it shows no page number, and the others show their exported one (09 §2.8b). */
import type { RenderCtx } from "./context";
import { deckFmt } from "./text";
import type { Design, RuntimeSlide, SlideDef } from "../model/types";
import { todayLabel } from "./cover";
import { isIsp } from "../model/isp";
import { ISP } from "./isp";

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
  // Excel and Excel Refined (the Intesa Sanpaolo template, B48): a number on the right – the default bottom right, where
  // the template has its logo, or the top right – sits where the template's master has it, top right
  if (isIsp(ctx.style.design) && (p.pos === "br" || p.pos === "tr")) return { left: ISP.pageno.right - w, top: ISP.pageno.top, w, h, size, capsule };
  // … the bottom left or centre: on the template's bottom row, the logo's (B48 fix), a bottom-left one at the content's margin
  if (isIsp(ctx.style.design) && p.pos[0] === "b") return { left: p.pos === "bl" ? ISP.area.x : (1600 - w) / 2, top: ispRowTop(h), w, h, size, capsule };
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
  // Excel and Excel Refined (B48 fix): a bottom footer on the template's bottom row, the logo's; a bottom-left one at the
  // content's left margin (the cover's logo is not at the bottom: it stays there on the cover too)
  const isp = isIsp(ctx.style.design);
  if (isp && f.pos[0] === "b") { y = ispRowTop(h); if (f.pos === "bl") left = ISP.area.x; }
  // same corner as the page number: sit next to it (or above it in the centre; on the Excel designs' row, left of it)
  // (the Excel designs' bottom-right page number sits at the top right, B48: a bottom-right footer stays where it is)
  if (pageLabel !== null && ctx.style.pn.pos === f.pos && !(isp && f.pos === "br")) {
    const g = pageNoGeom(ctx, pageLabel, glassy, hasLogo, cover);
    if (f.pos[1] === "l") left = g.left + g.w + 16;
    else if (f.pos[1] === "r" || (isp && f.pos === "bc")) left = g.left - 16 - w;
    else y = f.pos[0] === "b" ? g.top - h - 6 : g.top + g.h + 6;
  }
  return { label, left, top: y, w, h, size, capsule };
}
/** the top of a box `h` high centred on the template's bottom row (Excel and Excel Refined, B48 fix) */
const ispRowTop = (h: number) => Math.round(ISP.row.mid - h / 2);

/** Excel and Excel Refined (B48 fix): where the notes section goes by default on slide R – on the template's bottom row,
    in the first stretch of it left free by the footer, a page number at the bottom and the logo (render/isp.ts ISP.row);
    `w` / `h` the box's own size when set. Its text is centred in it, on the row. */
export function ispNoteBox(ctx: RenderCtx, R: RuntimeSlide, w0: number, h: number, today = todayLabel()) {
  const i = Math.max(0, ctx.slides.indexOf(R) >= 0 ? ctx.slides.indexOf(R) : ctx.slides.findIndex(S => S.cfg === R.cfg)), cover = R.type === "cover";
  const hasLogo = !(R.cfg && R.cfg.logo === false) && !!ctx.style.logo, label = pageNoFor(ctx, i), G = ISP.row;
  // what takes the row: the page number and footer when at the bottom (their estimated widths, widened for a wide face),
  // the logo's widest picture at the bottom right (not on the cover: its logo is above the title)
  const taken: [number, number][] = [];
  const add = (g: { left: number; top: number; w: number; size: number } | null, text: string | null, pos: string) => {
    if (!g || g.top < ISP.area.bottom || text === null) return;
    const w = Math.max(g.w, Math.round(text.length * g.size * .65)), l = pos[1] === "l" ? g.left : pos[1] === "c" ? g.left + (g.w - w) / 2 : g.left + g.w - w;
    taken.push([l - G.gap, l + w + G.gap]);
  };
  if (label !== null) add(pageNoGeom(ctx, label, false, hasLogo, cover), label, ctx.style.pn.pos);
  const fg = footerGeom(ctx, i, false, hasLogo, cover, label, today);
  if (fg) add(fg, fg.label, ctx.style.footer.pos);
  if (hasLogo && !cover) taken.push([ISP.logo.right - ISP.logo.maxW - G.gap, 1600]);
  // the free stretches of the row between the content area's edges, left to right
  const free: [number, number][] = [];
  let at = ISP.area.x;
  for (const [a, b] of taken.sort((p, q) => p[0] - q[0])) { if (a > at) free.push([at, a]); at = Math.max(at, b); }
  if (ISP.area.x + ISP.area.w > at) free.push([at, ISP.area.x + ISP.area.w]);
  const span = (s: [number, number]) => s[1] - s[0];
  const pick = free.find(s => span(s) >= w0) || free.find(s => span(s) >= G.minW) || free.sort((p, q) => span(q) - span(p))[0] || [ISP.area.x, ISP.area.x + ISP.area.w];
  const top = Math.min(900 - h, Math.max(ISP.area.bottom, Math.round(G.mid - h / 2)));
  return { x: pick[0], y: top, w: Math.min(w0, span(pick)), h };
}
