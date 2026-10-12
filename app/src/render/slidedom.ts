/* A slide in the page: the core's markup (core render/slide.ts slideMarkup) turned into an element, then the
   tables, text boxes and glass surfaces placed on it, and the text boxes' fonts fitted. */
import { glassLevel } from "@slide-builder/core/model/style";
import type { Layout, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { computeLayout, fitNoteSize, slideMarkup, type SlideOpts, type TBox } from "@slide-builder/core/render/slide";
import { platform } from "@slide-builder/core/platform";

export function placeGlass(el: HTMLElement, ex: number, ey: number, ew: number, eh: number, sc: number, gi: number) {
  const LENS = 1 + .06 * gi;
  const cx = ex + ew / 2, cy = ey + eh / 2;
  // layers: contrast veil · tint · blurred wallpaper (only the last one is positioned on the slide)
  el.style.backgroundSize = `100% 100%, 100% 100%, ${(1600 * LENS / sc).toFixed(2)}px ${(900 * LENS / sc).toFixed(2)}px`;
  el.style.backgroundPosition = `0 0, 0 0, ${(-(ex + (LENS - 1) * cx) / sc).toFixed(2)}px ${(-(ey + (LENS - 1) * cy) / sc).toFixed(2)}px`;
}
export type SlideEl = HTMLDivElement & { _rid?: string; /** the text boxes it was drawn with */ _notes?: string };
export function buildSlide(R: RuntimeSlide, idx: number, ctx: RenderCtx, opts: SlideOpts = {}): SlideEl {
  const m = slideMarkup(R, idx, ctx, opts);
  const slide = document.createElement("div") as SlideEl;
  slide.className = m.className;
  for (const [k, v] of m.vars) slide.style.setProperty(k, v);
  slide.innerHTML = m.html;
  slide._rid = R.id; slide._notes = JSON.stringify(R.cfg.notes || {});
  const boxes = applyLayout(slide, R, ctx);
  fitNotes(slide, boxes, ctx.style.design);
  return slide;
}
export function applyLayout(slide: HTMLElement, R: RuntimeSlide, ctx: RenderCtx, w?: number[], lay?: Layout): TBox[] {
  const { boxes } = computeLayout(R, ctx, w, lay);
  const glassy = slide.classList.contains("glass"), gi = glassLevel(ctx.style);
  slide.querySelectorAll<HTMLElement>(":scope > .tw").forEach(el => {
    const b = boxes[+el.dataset.i!]; if (!b) return;
    el.style.left = b.x + "px"; el.style.top = b.y + "px"; el.style.transform = `scale(${b.scale})`;
    if (glassy) el.querySelectorAll<HTMLElement>(".wb").forEach(g => placeGlass(g, b.x + parseFloat(g.style.left) * b.scale, b.y + parseFloat(g.style.top) * b.scale, parseFloat(g.style.width) * b.scale, parseFloat(g.style.height) * b.scale, b.scale, gi));
  });
  slide.querySelectorAll<HTMLElement>(":scope > .tnote:not(.memo)").forEach(el => {
    const nb = boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) { el.style.display = "none"; return; }
    Object.assign(el.style, { display: "", left: nb.x + "px", top: nb.y + "px", width: nb.w + "px", height: nb.h + "px" });
  });
  slide.querySelectorAll<HTMLElement>(":scope > .notebub.memo").forEach(el => { if (glassy) placeGlass(el, parseFloat(el.style.left), parseFloat(el.style.top), parseFloat(el.style.width), parseFloat(el.style.height), 1, gi); });
  slide.querySelectorAll<HTMLElement>(":scope > .notebub:not(.memo)").forEach(el => {
    const nb = boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) { el.style.display = "none"; return; }
    Object.assign(el.style, { display: "", left: nb.x + "px", top: nb.y + "px", width: nb.w + "px", height: nb.h + "px" });
    if (glassy) placeGlass(el, nb.x, nb.y, nb.w, nb.h, 1, gi);
  });
  if (glassy) slide.querySelectorAll<HTMLElement>(":scope > .chrome.wb").forEach(g => placeGlass(g, parseFloat(g.style.left), parseFloat(g.style.top), parseFloat(g.style.width), parseFloat(g.style.height), 1, gi));
  slide.querySelectorAll<HTMLElement>(":scope > .hbox").forEach(el => {
    const b = boxes[+el.dataset.i!]; if (!b) return;
    Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    // handles move outwards past the table's text boxes (not past boxes placed elsewhere on the slide)
    const n = Object.fromEntries(Object.entries(b.notes).filter(([, x]) => x && !x.free)) as TBox["notes"];
    el.style.setProperty("--nt", (n.top ? b.y - n.top.y : 0) + "px"); el.style.setProperty("--nb", (n.bottom ? n.bottom.y + n.bottom.h - b.y - b.h : 0) + "px");
    el.style.setProperty("--nl", (n.left ? b.x - n.left.x : 0) + "px"); el.style.setProperty("--nr", (n.right ? n.right.x + n.right.w - b.x - b.w : 0) + "px");
  });
  return boxes;
}

/* text boxes: the font shrinks (never below 9 px) until the text fits its box – measured by the platform's
   TextMeasurer (app/src/platform: off-screen, so it also works for thumbnails and exports, which are built
   detached from the page) */
function fitNotes(slide: HTMLElement, boxes: TBox[], design: string) {
  const notes = slide.querySelectorAll<HTMLElement>(":scope > .tnote:not(.empty)");
  if (!notes.length) return;
  const m = platform().text;
  for (const el of Array.from(notes)) {
    const nb = el.classList.contains("memo") ? { w: parseFloat(el.style.width), h: parseFloat(el.style.height) } : boxes[+el.dataset.i!]?.notes[el.dataset.side as Side]; if (!nb) continue;
    const size = fitNoteSize({ design, className: el.className, cssText: el.style.cssText, html: el.innerHTML, w: nb.w, h: nb.h }, parseFloat(el.style.fontSize) || 18, m);
    if (el.style.fontSize || document.body) el.style.fontSize = size + "px";      // v3 wrote nothing without a page body
  }
}
