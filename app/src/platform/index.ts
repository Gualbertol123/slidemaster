/* The page's implementations of the core's platform (core/src/platform.ts): canvas text metrics, an off-screen
   slide for fitting text boxes and <canvas> surfaces (XML: the core's own tokenizer). Installed once at
   start-up (main.tsx). */
import { setPlatform, type CanvasFactory, type Ctx2D, type NoteMeasure, type TextMeasurer } from "@slide-builder/core/platform";
import { wrapLines } from "@slide-builder/core/text/lines";
import { parseFont } from "@slide-builder/core/text/family";

let measurer: { host: HTMLElement; box: HTMLElement; note: NoteMeasure | null } | null = null;
let runCtx: CanvasRenderingContext2D | null = null, runFont = "";
const ctx2d = () => runCtx ||= document.createElement("canvas").getContext("2d");
/** a run's advance and its font's ascent / descent, with the page's fonts */
function measureRun(c: CanvasRenderingContext2D, text: string, font: string) {
  if (runFont !== font) { c.font = font; runFont = font; }        // (c.font reads back normalised, so it is not compared)
  const m = c.measureText(text || " ");
  return { w: text ? m.width : 0, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
}
/** runs with tabular figures (Liquid Glass numbers): canvas text has no font-variant-numeric, so hidden spans
    measure them – each run and each of its characters – in one contained box, read after a single layout (a span
    per measurement would lay the whole page out each time); ascent and descent as canvas reports them. The cache
    is emptied when fonts finish loading (a web font measured before it loaded would keep its fallback's widths). */
const tabCache = new Map<string, number>();
if (typeof document !== "undefined" && document.fonts) document.fonts.addEventListener("loadingdone", () => tabCache.clear());
function tabularWidths(items: { text: string; font: string }[]): void {
  const seen = new Set<string>();
  const need = items.filter(it => { const key = it.font + "\n" + it.text; if (tabCache.has(key) || seen.has(key)) return false; seen.add(key); return true; });
  if (!need.length) return;
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:absolute;left:-20000px;top:0;width:10000px;height:10px;overflow:hidden;visibility:hidden;contain:strict";
  const spans = need.map(it => {
    const sp = document.createElement("span");
    sp.style.cssText = "position:absolute;left:0;top:0;white-space:pre;letter-spacing:0";
    sp.style.font = it.font; sp.style.fontVariantNumeric = "tabular-nums";        // (after the shorthand, which resets it)
    sp.textContent = it.text;
    box.appendChild(sp);
    return sp;
  });
  document.body.appendChild(box);
  spans.forEach((sp, k) => tabCache.set(need[k].font + "\n" + need[k].text, sp.getBoundingClientRect().width));
  box.remove();
}
function tabularRuns(c: CanvasRenderingContext2D, runs: { text: string; font: string }[]) {
  if (typeof document !== "undefined" && document.body) tabularWidths(runs.flatMap(r => [r, ...[...r.text].map(ch => ({ text: ch, font: r.font }))]).filter(r => r.text));
  return runs.map(r => {
    const m = measureRun(c, r.text, r.font), w = (t: string) => tabCache.get(r.font + "\n" + t);
    if (!r.text || w(r.text) === undefined) return m;
    return { ...m, w: w(r.text)!, adv: [...r.text].map(ch => w(ch) ?? 0) };
  });
}
/** whether the core worker measures a CSS font from a file (state/fontfiles.ts fontReadable): width() answers only for
    those, as the worker's does, so Liquid Glass's columns come out alike (null: not known yet) */
let readableFont: ((families: string[]) => boolean | null) | null = null;
export const setFontGate = (g: (families: string[]) => boolean | null) => { readableFont = g; widthCache.clear(); };
/** widths by font and text, and each font's answer once known (Liquid Glass lays a slide out 22 times a frame in a
    corner drag: the same few fonts and texts) */
const widthCache = new Map<string, number>(), fontOk = new Map<string, boolean>();
export const browserText: TextMeasurer = {
  width(text, font) {
    let ok = fontOk.get(font);
    if (ok === undefined) {
      const fp = parseFont(font), r = fp && readableFont ? readableFont(fp.families) : !!fp;
      if (r === null) return null;                                  // (the catalog is not known yet: asked again)
      fontOk.set(font, ok = !!r);
    }
    if (!ok) return null;
    const k = font + "\n" + text;
    let w = widthCache.get(k);
    if (w === undefined) {
      const c = ctx2d(); if (!c) return null;
      if (widthCache.size > 50_000) widthCache.clear();
      widthCache.set(k, w = measureRun(c, text, font).w);
    }
    return w;
  },
  maxDigitWidth(font) {
    const c = document.createElement("canvas").getContext("2d"); if (!c) return 0;
    c.font = font;
    let m = 0; for (const d of "0123456789") m = Math.max(m, c.measureText(d).width);
    return m;
  },
  measureRuns(runs) {
    const c = ctx2d(); if (!c) return runs.map(() => ({ w: 0, asc: 0, desc: 0 }));
    const tab = runs.filter(r => r.tnum), tabbed = tab.length ? tabularRuns(c, tab) : [];
    let k = 0;
    return runs.map(r => r.tnum ? tabbed[k++] : measureRun(c, r.text, r.font));
  },
  breakLines(reqs) {
    const c = ctx2d(); if (!c) return reqs.map(r => [r.text]);
    return reqs.map(r => wrapLines(r.text, r.width, s => measureRun(c, s, r.font).w));
  },
  noteFits(note, size) {
    if (typeof document === "undefined" || !document.body) return true;
    if (!measurer) {
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:absolute;left:-20000px;top:0;width:1600px;height:900px;visibility:hidden;pointer-events:none;overflow:hidden";
      const box = document.createElement("div"); host.appendChild(box); document.body.appendChild(host);
      measurer = { host, box, note: null };
    }
    const m = measurer.box;
    if (measurer.note !== note) {                 // a new box: copy it in once, then only the font size changes
      measurer.note = note;
      measurer.host.className = "slide " + (note.design === "clean" ? "excel clean" : note.design);
      m.className = note.className; m.style.cssText = note.cssText; m.innerHTML = note.html;
      Object.assign(m.style, { left: "0px", top: "0px", width: note.w + "px", height: "auto", display: "block" });
    }
    m.style.fontSize = size + "px";
    return m.scrollHeight <= note.h + 1 && m.scrollWidth <= note.w + 1;
  },
};

export const browserCanvas: CanvasFactory = {
  create(w, h, opts) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", opts); if (!ctx) return null;
    return { ctx: ctx as unknown as Ctx2D, image: c, toDataURL: (type, q) => Promise.resolve(c.toDataURL(type, q)) };
  },
  async decode(src) {
    const img = new Image(); img.src = src; await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  },
};

export function installBrowserPlatform() {
  setPlatform({ text: browserText, canvas: typeof document !== "undefined" ? browserCanvas : null });
}
