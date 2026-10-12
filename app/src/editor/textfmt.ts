/* One set of text controls for every text on a slide. Whatever is selected – table cells, a text box,
   the title, the subtitle, the cover note or date – is a "text target" with the same formatting
   actions; the toolbar never changes shape depending on the selection. Sizes are shown in points
   (as in Excel and PowerPoint): cells store points, slide texts store slide pixels (1 pt = 4/3 px). */
import { get, patch } from "../state/store";
import { change, ctx } from "../state/app";
import type { Note, Op, SlideTextKey, TextFmt } from "@slide-builder/core/model/types";
import { effFmt } from "@slide-builder/core/render/edits";
import { effNote, slideTextFmt } from "@slide-builder/core/render/text";
import { A1 } from "@slide-builder/core/xlsx/util";
import { applySel, curSlide, selItems } from "./edit";

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
/** current formatting of the target; null = not set / mixed */
export interface Shown { font: string | null; pt: number | null; b: boolean; i: boolean; color: string | null; align: Align | null; valign: VAlign | null; lh?: number | null; pgap?: number | null }
export interface FmtPatch { lh?: number | null; pgap?: number | null; font?: string | null; pt?: number | null; b?: boolean; i?: boolean; color?: string | null; align?: Align | null; valign?: VAlign | null }
export interface TextTarget {
  kind: "cells" | "note" | "slide";
  /** what the controls act on, e.g. "Cells B4:D9", "Text box", "Title" */
  label: string;
  shown: Shown;
  /** controls that do not apply to this kind of text */
  can: { valign: boolean; fill: boolean; spacing?: boolean };
  apply(label: string, p: FmtPatch): void;
  clear(): void;
}

export const SLIDE_TEXT_LABEL: Record<SlideTextKey, string> = { title: "Title", subtitle: "Subtitle", note: "Cover note", date: "Date" };
const px2pt = (px: number) => Math.round(px * 0.75 * 2) / 2;
const pt2px = (pt: number) => Math.round(pt * 4 / 3 * 10) / 10;
const clampPt = (pt: number) => Math.max(5, Math.min(150, Math.round(pt * 2) / 2));
/** the next size up/down: 1 pt steps below 12 pt, 2 pt above (as before) */
export const stepPt = (pt: number, dir: 1 | -1) => clampPt(dir > 0 ? (pt >= 12 ? pt + 2 : pt + 1) : (pt > 12 ? pt - 2 : pt - 1));
const one = <T>(xs: T[]): T | null => xs.length && xs.every(x => x === xs[0]) ? xs[0] : null;

/* ---- slide texts (title, subtitle, cover note, date) ---- */
export function selectSlideText(key: SlideTextKey | null) {
  patch("selection", key ? { textSel: key, sel: null, noteSel: null } : { textSel: key });     // the stage paints it
}
function domOf(key: SlideTextKey) { return document.querySelector<HTMLElement>(`#stage .slide [data-edit="${key}"]`); }

function slideTarget(key: SlideTextKey): TextTarget | null {
  const R = curSlide(); if (!R) return null;
  const own = R.cfg.fmt?.[key] || {}, f = slideTextFmt(ctx(), R, key), el = domOf(key);
  const cs = el ? getComputedStyle(el) : null;               // what the design uses when nothing is set
  const shown: Shown = { font: f.font || null, pt: f.size ? px2pt(f.size) : cs ? px2pt(parseFloat(cs.fontSize)) : null,
    b: f.b ?? (cs ? parseInt(cs.fontWeight, 10) >= 600 : false), i: f.i ?? (cs ? cs.fontStyle === "italic" : false),
    color: f.color || null, align: f.align || null, valign: null };
  const write = (label: string, next: TextFmt) => change(label, [{ op: "slide.patch", id: R.id, patch: { fmt: { [key]: Object.keys(next).length ? next : null } } } as Op]);
  return {
    kind: "slide", label: SLIDE_TEXT_LABEL[key], shown, can: { valign: false, fill: false },
    apply(label, p) {
      const next: TextFmt = { ...own };
      if ("font" in p) { if (p.font) next.font = p.font; else delete next.font; }
      if ("pt" in p) { if (p.pt) next.size = pt2px(clampPt(p.pt)); else delete next.size; }
      if (p.b !== undefined) next.b = p.b;
      if (p.i !== undefined) next.i = p.i;
      if ("color" in p) { if (p.color) next.color = p.color; else delete next.color; }
      if ("align" in p) { if (p.align) next.align = p.align; else delete next.align; }
      write(label, next);
    },
    clear() { write("Clear formatting", {}); },
  };
}

/* ---- text boxes ---- */
function noteTarget(key: string): TextTarget | null {
  const R = curSlide(), cur = R?.cfg.notes?.[key]; if (!R || !cur) return null;
  const e = effNote(ctx(), cur);
  const shown: Shown = { font: e.font || null, pt: px2pt(e.size || 18), b: !!e.b, i: !!e.i, color: e.color || null, align: e.align || null, valign: e.valign || null, lh: e.lh ?? null, pgap: e.pgap ?? null };
  const write = (label: string, next: Note) => change(label, [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: next } } } as Op]);
  return {
    kind: "note", label: key === "slide:notes" ? "Notes" : "Text box", shown, can: { valign: true, fill: false, spacing: true },
    apply(label, p) {
      const next: Note = { ...cur };
      const set = <K extends keyof Note>(k: K, v: Note[K] | null | undefined) => { if (v === null || v === undefined || v === "") delete next[k]; else next[k] = v; };
      if ("font" in p) set("font", p.font);
      if ("pt" in p) set("size", p.pt ? pt2px(clampPt(p.pt)) : null);
      if (p.b !== undefined) next.b = p.b;
      if (p.i !== undefined) next.i = p.i;
      if ("color" in p) set("color", p.color);
      if ("align" in p) set("align", p.align);
      if ("valign" in p) set("valign", p.valign);
      if ("lh" in p) set("lh", p.lh);
      if ("pgap" in p) set("pgap", p.pgap);
      write(label, next);
    },
    clear() { write("Clear formatting", { text: cur.text, ...(cur.bubble ? { bubble: true } : {}), ...(cur.w ? { w: cur.w } : {}), ...(cur.h ? { h: cur.h } : {}) }); },
  };
}

/* ---- table cells ---- */
function cellTarget(): TextTarget | null {
  const its = selItems(), sel = get().selection.sel, T = curSlide()?.tables[sel?.t ?? -1]; if (!its.length || !sel || !T) return null;
  const c = ctx(), fs = its.map(x => effFmt(c, x)), deck = c.style.text?.table?.font || null;
  const shown: Shown = { font: one(fs.map(f => f.font || deck)), pt: one(fs.map(f => f.sz)), b: fs.every(f => f.b), i: fs.every(f => f.i),
    color: one(fs.map(f => f.color)), align: one(fs.map(f => f.align)) as Align | null, valign: null };
  const range = its.length > 1 ? `${A1(sel.r1, sel.c1)}:${A1(sel.r2, sel.c2)}` : A1(its[0].b.src.r, its[0].b.src.c);
  return {
    kind: "cells", label: (its.length > 1 ? "Cells " : "Cell ") + range, shown, can: { valign: false, fill: true },
    apply(label, p) {
      applySel(label, (e, it) => {
        if ("font" in p) { if (p.font) e.font = p.font; else delete e.font; }
        if ("pt" in p) { if (p.pt) { const v = clampPt(p.pt); if (v === (it.font.sz || 11)) delete e.sz; else e.sz = v; } else delete e.sz; }
        if (p.b !== undefined) e.b = p.b;
        if (p.i !== undefined) e.i = p.i;
        if ("color" in p) { if (p.color) e.color = p.color; else delete e.color; }
        if ("align" in p) { if (p.align) e.align = p.align; else delete e.align; }
      });
    },
    clear() { applySel("Clear formatting", e => { for (const k of ["font", "sz", "b", "i", "color", "fill", "bg", "align", "role"] as const) delete e[k]; }); },
  };
}

/** the text the formatting controls act on, or null when nothing is selected */
export function textTarget(): TextTarget | null {
  const { sel, noteSel, textSel } = get().selection;
  if (sel) return cellTarget();
  if (noteSel) return noteTarget(noteSel);
  if (textSel) return slideTarget(textSel);
  return null;
}
/** A−/A+: cells change one by one (each keeps its own size relation), other texts as one */
export function stepSize(dir: 1 | -1) {
  const t = textTarget(); if (!t) return;
  if (t.kind === "cells") { applySel("Text size", (e, it) => { const cur = e.sz || it.font.sz || 11; e.sz = stepPt(cur, dir); }); return; }
  t.apply("Text size", { pt: stepPt(t.shown.pt || 12, dir) });
}
export const toggleBold = () => { const t = textTarget(); if (t) t.apply("Bold", { b: !t.shown.b }); };
export const toggleItalic = () => { const t = textTarget(); if (t) t.apply("Italic", { i: !t.shown.i }); };
