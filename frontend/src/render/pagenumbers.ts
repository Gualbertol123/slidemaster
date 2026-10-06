/* Page numbers: pageNumber(i) = start + i (the cover counts as a page). */
import { esc } from "../xlsx/util";
import type { RenderCtx } from "./context";

export function pageNumber(ctx: RenderCtx, i: number) { const p = ctx.style.pn; return (isFinite(+p.start) ? +p.start : 1) + i; }
/** label shown on slide i, or null */
export function pageNoFor(ctx: RenderCtx, i: number): string | null {
  const p = ctx.style.pn; if (!p.on) return null;
  if (ctx.slides[i] && ctx.slides[i].type === "cover" && !p.cover) return null;
  const n = pageNumber(ctx, i), N = pageNumber(ctx, Math.max(0, ctx.slides.length - 1));
  return p.format === "nN" ? `${n} / ${N}` : p.format === "page" ? `Page ${n}` : p.format === "p" ? `p. ${n}` : String(n);
}
export const PN_FONTS: Record<string, string | null> = {
  auto: null, segoe: "'Segoe UI Variable Text','Segoe UI',Arial,sans-serif", arial: "Arial,Helvetica,sans-serif", calibri: "Calibri,Carlito,Arial,sans-serif",
  gothic: "'Century Gothic','URW Gothic',Arial,sans-serif", georgia: "Georgia,'Times New Roman',serif", verdana: "Verdana,Geneva,sans-serif", mono: "Consolas,'Cascadia Mono',monospace",
};
export function pageNoBox(ctx: RenderCtx, label: string, glassy: boolean) {
  const p = ctx.style.pn, size = Math.max(9, Math.min(36, +p.size || 16)), capsule = glassy && p.style !== "plain";
  return { size, capsule, w: Math.round(label.length * size * .62 + (capsule ? 34 : 4)), h: Math.round(size * (capsule ? 2.4 : 1.4)) };
}
export function pageNoHtml(ctx: RenderCtx, label: string, glassy: boolean, hasLogo: boolean, cover: boolean): string {
  const p = ctx.style.pn, font = PN_FONTS[p.font] || null, { size, capsule, w, h } = pageNoBox(ctx, label, glassy);
  const margin = 40, top = p.pos[0] === "t" ? (capsule ? 24 : 28) : 900 - margin + 6 - h;
  let left = p.pos[1] === "l" ? 56 : p.pos[1] === "c" ? (1600 - w) / 2 : 1600 - 44 - w;
  if (p.pos === "br" && hasLogo) left = (glassy ? (cover ? 1150 : 1256) : 1600 - 340) - 22 - w;   // never on top of the logo
  if (p.pos === "bl" && hasLogo && cover) left = 1600 - 44 - w;
  const st = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;font-size:${size}px;${font ? `font-family:${font};` : ""}`;
  return capsule ? `<div class="gls wb chrome pageno" style="${st}border-radius:${Math.min(h / 2, h / 2 * ctx.style.radius / 100)}px"><span>${esc(label)}</span></div>`
    : `<div class="pageno plain" style="${st}line-height:${h}px;text-align:${p.pos[1] === "l" ? "left" : p.pos[1] === "c" ? "center" : "right"}">${esc(label)}</div>`;
}
