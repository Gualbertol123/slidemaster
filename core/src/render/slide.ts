/* Slide composition shared by the display list (slide-dl.ts) and the stage: the slide's classes and CSS variables,
   its text boxes and notes section, the key of what a table is drawn from. (Until S4.5 this file also wrote the
   slide as HTML for v3's page; the screen and the exports draw display lists since M4.) */
import type { Note, RuntimeSlide, Side } from "../model/types";
import { glassLevel, themeOf } from "../model/style";
import { darken, hexRgb } from "../xlsx/color";
import { tableKey, type RenderCtx } from "./context";
import { palette } from "../model/style";
import { effNote } from "./text";
import { designClass } from "../model/designs";
import { wallBase } from "./wallpaper";
import { MEMO_KEY, memoBox, SIDES, noteKey, notesOf } from "./layout";

/** what table i of a slide is drawn from (design, glass level, its content and edits, the export flag, its layout):
    the same key, the same drawing (the stage's table cache, core/worker/host.ts) */
export function tableDrawKey(R: RuntimeSlide, i: number, ctx: RenderCtx): string {
  const L = R.tables[i];
  return ctx.style.design + "|" + glassLevel(ctx.style) + "|" + tableKey(ctx, L) + "|" + (ctx.forExport ? 1 : 0)
    // the layout itself (per-design sizes and grown ranges are not in tableKey)
    + "|" + JSON.stringify(L.g) + "|" + [...L.colW.values()].join() + "|" + [...L.rowH.values()].join();
}
export const slideHasLogo = (R: RuntimeSlide) => !(R.cfg && R.cfg.logo === false);
/** contrast 0…100 (50 = as designed): lower fades the wallpaper (and glass) towards white,
    higher deepens the wallpaper and whitens the glass surfaces */
export function contrastVars(contrast: number): Record<string, string> {
  const ct = Math.max(0, Math.min(100, contrast)) / 100;
  if (ct < .5) { const f = (.5 - ct) * 1.4; return { "--wfade": f.toFixed(3), "--gfade": (f * .6).toFixed(3) }; }
  const u = ct - .5;
  return { "--wfade": "0", "--gfade": (u * .9).toFixed(3) };              // the deeper wallpaper itself: render/wallpaper.ts
}

/** accent colours of the theme as CSS variables (none for the default theme: the designs have their values) */
export function themeVars(ctx: RenderCtx): Record<string, string> {
  const t = themeOf(ctx.style), o = ctx.style.colors || {}, P = palette(ctx.style), v: Record<string, string> = {};
  if (t.id !== "aurora" || o.accent) {
    const a1 = o.accent || t.a1, x = o.accent || t.x;
    Object.assign(v, { "--a1": a1, "--a2": o.accent ? a1 : t.a2, "--a1rgb": hexRgb(a1).join(","), "--a2rgb": hexRgb(o.accent ? a1 : t.a2).join(","), "--x1": x, "--x2": darken(x, .6), "--ixink": darken(a1, .55) });
  }
  // overrides that every design reads from the variables
  if (o.pos) v["--posrgb"] = hexRgb(P.pos).join(",");
  if (o.neg) v["--negrgb"] = hexRgb(P.neg).join(",");
  if (o.bg && ctx.style.design !== "glass") v["--slidebg"] = P.bg;
  return v;
}
export interface SlideOpts { interactive?: boolean }
/** the slide element (the stage, the comment preview): its classes (design, slide type) and CSS variables (theme,
    corners, glass, the colour under the wallpaper) – the overlays read the accent colours */
export function slideFrame(R: RuntimeSlide, ctx: RenderCtx): { className: string; vars: [string, string][] } {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const className = "slide " + designClass(d) + (R.type !== "content" ? " " + R.type : "");
  const vars: [string, string][] = [["--rk", String(rk)]];
  for (const [k, v] of Object.entries(themeVars(ctx))) vars.push([k, v]);
  if (glassy) {
    vars.push(["--gi", String(glassLevel(ctx.style))], ["--amt", String((+ctx.style.color || 0) / 100)], ["--wallbase", wallBase(ctx.style)]);
    for (const [k, v] of Object.entries(contrastVars(ctx.style.contrast))) vars.push([k, v]);
  }
  return { className, vars };
}

/** a text box of a slide: its effective note, its classes (side, bubble, automated, free, empty) and its bubble – the
    display list (slide-dl.ts) draws it, the stage's overlay lets it be selected, moved and edited */
export interface NotePart {
  i: number; side: Side; key: string; n: Note; txt: string; memo: boolean;
  cls: string;
  /** a bubble behind the text: a glass card (Liquid Glass) or a framed box (Excel designs); its radius */
  bubble: { cls: string; r: number } | null;
  /** every line in this colour, headings too (a callout's text on a dark fill or on Consulting Red's panel) */ ink?: string;
}
/** table i's text boxes (empty ones only where they can be edited) */
export function noteParts(R: RuntimeSlide, i: number, ctx: RenderCtx, opts: SlideOpts = {}): NotePart[] {
  const glassy = ctx.style.design === "glass", rk = ctx.style.radius / 100, ns = notesOf(R, i, ctx), out: NotePart[] = [];
  for (const side of SIDES) {
    const n = ns[side]; if (!n) continue;
    const txt = String(n.text || "");
    if (!txt.trim() && !opts.interactive) continue;
    // a bubble behind the text: a glass card like the tables' (Liquid Glass) or a framed box (Excel)
    const bubble = n.bubble && txt.trim() ? (glassy ? { cls: "gls wb card notebub", r: Math.round(22 * rk) } : { cls: "notebub x", r: Math.round(8 * rk) }) : null;
    const key = noteKey(R, i, side), cls = `tnote ${side}${n.bubble ? " bub" : ""}${n.auto ? " auto" : ""}${n.x != null && n.y != null ? " free" : ""}${txt.trim() ? "" : " empty"}`;
    out.push({ i, side, key, n, txt, memo: false, cls, bubble });
  }
  return out;
}
/** the slide's notes section (sources, footnotes…): a text box of the slide itself, placed where the user put it –
    by default where the footer is; in every design (B19) */
export function memoPart(R: RuntimeSlide, ctx: RenderCtx, opts: SlideOpts = {}): (NotePart & { box: { x: number; y: number; w: number; h: number } }) | null {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const memo = (R.cfg.notes || {})[MEMO_KEY];
  if (!memo || !(String(memo.text || "").trim() || opts.interactive)) return null;
  const n = effNote(ctx, memo), txt = String(n.text || ""), mb = memoBox(memo);
  const bubble = n.bubble && txt.trim() ? (glassy ? { cls: "gls wb card notebub memo", r: Math.round(16 * rk) } : { cls: "notebub x memo", r: Math.round(8 * rk) }) : null;
  const cls = `tnote memo free bottom${n.bubble ? " bub" : ""}${txt.trim() ? "" : " empty"}`;
  return { i: -1, side: "bottom", key: MEMO_KEY, n, txt, memo: true, cls, bubble, box: mb };
}
