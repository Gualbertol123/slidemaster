/* Slide composition: tables arranged in bands, title, cover/index, page number, logo. */
import { esc } from "../xlsx/util";
import type { TableLayout } from "../xlsx/types";
import type { Layout, Note, RuntimeSlide, Side, SlideSizing } from "../model/types";
import { glassLevel, themeOf } from "../model/style";
import { darken, hexRgb } from "../xlsx/color";
import { tableName } from "../model/preset";
import { tableKey, type RenderCtx } from "./context";
import { renderExcel } from "./excel";
import { palette } from "../model/style";
import { glassGeom, renderGlass } from "./glass";
import { coverHtml, indexHtml } from "./cover";
import { footerHtml, pageNoBox, pageNoFor, pageNoHtml } from "./pagenumbers";
import { todayLabel } from "./cover";
import { cache } from "./edits";
import { effNote, fmtCss, hasMarkup, richText, slideTextFmt, titleGeom } from "./text";
import { commentText } from "./comment";
import type { NoteMeasure, TextMeasurer } from "../platform";

import { tableW, MEMO_KEY, memoBox, SIDES, noteKey, notesOf } from "./layout";

/** which HTML of table i a slide shows, and its cache key: "thtml" = shapes only (thumbnails of big tables) */
export function tableHtmlKey(R: RuntimeSlide, i: number, ctx: RenderCtx, thumb = false): { kind: "html" | "thtml"; key: string } {
  const L = R.tables[i], key = ctx.style.design + "|" + glassLevel(ctx.style) + "|" + tableKey(ctx, L) + "|" + (ctx.forExport ? 1 : 0)
    // the layout itself (per-design sizes and grown ranges are not in tableKey: a new layout object had an empty cache)
    + "|" + JSON.stringify(L.g) + "|" + [...L.colW.values()].join() + "|" + [...L.rowH.values()].join();
  return { kind: thumb && L.items.length > 1200 ? "thtml" : "html", key };
}
export function tableHtml(R: RuntimeSlide, i: number, ctx: RenderCtx, thumb = false): string {
  const L = R.tables[i], d = ctx.style.design, { kind, key } = tableHtmlKey(R, i, ctx, thumb);
  const given = ctx.htmlOf?.(L.id || "", kind, key); if (given !== undefined) return given;      // drawn by the core worker
  if (kind === "thtml")                            // thumbnails of big tables: shapes only, no text
    return cache(L, "thtml", key, () => d === "glass" ? renderGlass(L, ctx, { noText: true }) : renderExcel(L, ctx, { noText: true }));
  // Excel Refined = the Excel tables exactly as in the workbook (same colours); it only adds text boxes and comments
  return cache(L, "html", key, () => d === "glass" ? renderGlass(L, ctx) : renderExcel(L, ctx));
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

/** accent colours of the theme as CSS variables (none for the default theme: the CSS has its values) */
export function themeVars(ctx: RenderCtx): Record<string, string> {
  const t = themeOf(ctx.style), o = ctx.style.colors || {}, P = palette(ctx.style), v: Record<string, string> = {};
  if (t.id !== "aurora" || o.accent) {
    const a1 = o.accent || t.a1, x = o.accent || t.x;
    Object.assign(v, { "--a1": a1, "--a2": o.accent ? a1 : t.a2, "--a1rgb": hexRgb(a1).join(","), "--a2rgb": hexRgb(o.accent ? a1 : t.a2).join(","), "--x1": x, "--x2": darken(x, .6), "--ixink": darken(a1, .55) });
  }
  // overrides that every design reads from CSS variables
  if (o.pos) v["--posrgb"] = hexRgb(P.pos).join(",");
  if (o.neg) v["--negrgb"] = hexRgb(P.neg).join(",");
  if (o.bg && ctx.style.design !== "glass") v["--slidebg"] = P.bg;
  return v;
}
export interface SlideOpts { interactive?: boolean; thumb?: boolean }
/** a slide as markup: the slide element's class and CSS variables, and its inner HTML (placed and fitted by the page) */
export interface SlideMarkup { className: string; vars: [string, string][]; html: string }
/** the slide element's classes (design, slide type) and CSS variables (theme, corners, glass): the HTML slide's and
    the stage's (the stage's overlays read the accent colours) */
export function slideFrame(R: RuntimeSlide, ctx: RenderCtx): Omit<SlideMarkup, "html"> {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const className = "slide " + (d === "clean" ? "excel clean" : d) + (R.type !== "content" ? " " + R.type : "");
  const vars: [string, string][] = [["--rk", String(rk)]];
  for (const [k, v] of Object.entries(themeVars(ctx))) vars.push([k, v]);
  if (glassy) {
    vars.push(["--gi", String(glassLevel(ctx.style))], ["--amt", String((+ctx.style.color || 0) / 100)]);
    for (const [k, v] of Object.entries(contrastVars(ctx.style.contrast))) vars.push([k, v]);
  }
  return { className, vars };
}
export function slideMarkup(R: RuntimeSlide, idx: number, ctx: RenderCtx, opts: SlideOpts = {}): SlideMarkup {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const { className, vars } = slideFrame(R, ctx);
  const pageNo = pageNoFor(ctx, idx);
  const logo = slideHasLogo(R) ? ctx.logoSrc : "", cover = R.type === "cover";
  let h = glassy ? `<div class="wall"></div>` : "";
  // a page number in the top-left corner pushes the title to the right
  const shift = pageNo !== null && ctx.style.pn.pos === "tl" ? pageNoBox(ctx, pageNo, glassy).w + 22 : 0, sh = shift ? `left:${56 + shift}px;` : "";
  if (cover) h += coverHtml(R, glassy, rk, ctx);
  else {
    h += `<div class="title" data-edit="title" style="${sh}${fmtCss(slideTextFmt(ctx, R, "title"))}">${esc(R.title)}</div>`;
    if (R.subtitle) h += `<div class="subtitle" data-edit="subtitle" style="${sh}top:${titleGeom(R, ctx).subTop}px;${fmtCss(slideTextFmt(ctx, R, "subtitle"))}">${esc(R.subtitle)}</div>`;
  }
  if (R.type === "index") h += indexHtml(R, ctx, glassy);
  if (pageNo !== null) h += pageNoHtml(ctx, pageNo, glassy, !!logo, cover);
  h += footerHtml(ctx, idx, glassy, !!logo, cover, pageNo, todayLabel());
  R.tables.forEach((t, i) => {
    h += `<div class="tw" data-i="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px">${tableHtml(R, i, ctx, opts.thumb)}${opts.interactive ? `<div class="hits" data-t="${i}" style="width:${tableW(t, ctx)}px;height:${t.H}px"><div class="hov"></div></div>` : ""}</div>`;
    for (const part of noteParts(R, i, ctx, opts)) h += part.bubbleHtml + part.html;
  });
  const memo = memoPart(R, ctx, opts);
  if (memo) h += memo.bubbleHtml + memo.html;
  if (opts.interactive) h += R.tables.map((t, i) => `<div class="hbox" data-i="${i}"><div class="grip" title="Drag to move this table">⠿ ${esc(tableName(t, ctx.preset))}</div><div class="size" title="Drag to resize (keeps the proportions)"></div>${(["l", "r", "t", "b"] as const).map(e => `<div class="edge ${e}" data-edge="${e}" title="Drag to make the table ${e === "l" || e === "r" ? "wider or narrower" : "taller or shorter"}"></div>`).join("")}${d === "excel" ? "" : SIDES.map(sd => `<button class="addnote ${sd}" data-side="${sd}" title="Add a text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd}">+</button>`).join("")}</div>`).join("") + `<div class="dropmark"></div>`;
  if (R.type === "content" && !R.tables.length && opts.interactive) h += `<div class="emptyslide">No tables on this slide – add some with the wizard.</div>`;
  if (logo) {
    const lx = cover ? 1150 : 1256, ly = cover ? 800 : 832, lw = cover ? 400 : 314, lh = cover ? 68 : 52;
    h += glassy
      ? (ctx.style.logoBubble
        ? `<div class="gls wb chrome logowrap" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;border-radius:${Math.min(lh / 2, lh / 2 * rk)}px"><img class="logo" src="${esc(logo)}" alt=""></div>`
        : `<div class="logowrap plain" style="left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px"><img class="logo" src="${esc(logo)}" alt=""></div>`)
      : `<div class="logowrap${cover ? " big" : ""}"><img class="logo" src="${esc(logo)}" alt=""></div>`;
  }
  return { className, vars, html: h };
}

/** a text box of a slide as the page shows it: its effective note, classes, inline style and inner HTML, and its
    bubble (the HTML and the display list, render/slide-dl.ts, draw the same parts) */
export interface NotePart {
  i: number; side: Side; key: string; n: Note; txt: string; memo: boolean;
  /** the tnote's classes and inline style (what fitNoteSize measures), its inner HTML */
  cls: string; style: string; inner: string;
  /** a bubble behind the text: a glass card (Liquid Glass) or a framed box (Excel designs); its radius */
  bubble: { cls: string; r: number } | null;
  html: string; bubbleHtml: string;
}
const noteInner = (txt: string, n: Note, empty: string) => !txt.trim() ? empty : hasMarkup(txt) || n.pgap != null ? richText(txt) : esc(txt);
/** table i's text boxes */
export function noteParts(R: RuntimeSlide, i: number, ctx: RenderCtx, opts: SlideOpts = {}): NotePart[] {
  const glassy = ctx.style.design === "glass", rk = ctx.style.radius / 100, ns = notesOf(R, i, ctx), out: NotePart[] = [];
  for (const side of SIDES) {
    const n = ns[side]; if (!n) continue;
    const txt = String(n.text || "");
    if (!txt.trim() && !opts.interactive) continue;
    const st = [`font-size:${n.size || 18}px`, fmtCss({ font: n.font, b: n.b || undefined, i: n.i || undefined, color: n.color }, { size: false, align: false }), `text-align:${n.align || (side === "left" ? "right" : "left")}`, n.lh ? `line-height:${n.lh}` : "", n.pgap != null ? `--pgap:${n.pgap}em` : "",
      n.valign ? `justify-content:${n.valign === "top" ? "flex-start" : n.valign === "middle" ? "center" : "flex-end"}` : ""].filter(Boolean).join(";");
    // a bubble behind the text: a glass card like the tables' (Liquid Glass) or a framed box (Excel)
    const bubble = n.bubble && txt.trim() ? (glassy ? { cls: "gls wb card notebub", r: Math.round(22 * rk) } : { cls: "notebub x", r: Math.round(8 * rk) }) : null;
    const key = noteKey(R, i, side), cls = `tnote ${side}${n.bubble ? " bub" : ""}${n.auto ? " auto" : ""}${n.x != null && n.y != null ? " free" : ""}${txt.trim() ? "" : " empty"}`, inner = noteInner(txt, n, "Double-click to write");
    out.push({ i, side, key, n, txt, memo: false, cls, style: st, inner, bubble,
      bubbleHtml: bubble ? `<div class="${bubble.cls}" data-i="${i}" data-side="${side}" style="border-radius:${bubble.r}px"></div>` : "",
      html: `<div class="${cls}" data-note="${esc(key)}" data-i="${i}" data-side="${side}" style="${st}">${inner}</div>` });
  }
  return out;
}
/** the slide's notes section (sources, footnotes…): a text box of the slide itself, placed where the user put it –
    by default where the footer is; not in raw Excel */
export function memoPart(R: RuntimeSlide, ctx: RenderCtx, opts: SlideOpts = {}): (NotePart & { box: { x: number; y: number; w: number; h: number } }) | null {
  const d = ctx.style.design, glassy = d === "glass", rk = ctx.style.radius / 100;
  const memo = d === "excel" ? null : (R.cfg.notes || {})[MEMO_KEY];
  if (!memo || !(String(memo.text || "").trim() || opts.interactive)) return null;
  const n = effNote(ctx, memo), txt = String(n.text || ""), mb = memoBox(memo);
  const pos = `left:${mb.x}px;top:${mb.y}px;width:${mb.w}px;height:${mb.h}px`;
  const st = [pos, `font-size:${n.size || 13}px`, fmtCss({ font: n.font, b: n.b || undefined, i: n.i || undefined, color: n.color }, { size: false, align: false }), `text-align:${n.align || "left"}`,
    n.lh ? `line-height:${n.lh}` : "", n.pgap != null ? `--pgap:${n.pgap}em` : "", `justify-content:${n.valign === "top" ? "flex-start" : n.valign === "bottom" ? "flex-end" : "center"}`].filter(Boolean).join(";");
  const bubble = n.bubble && txt.trim() ? (glassy ? { cls: "gls wb card notebub memo", r: Math.round(16 * rk) } : { cls: "notebub x memo", r: Math.round(8 * rk) }) : null;
  const cls = `tnote memo free bottom${n.bubble ? " bub" : ""}${txt.trim() ? "" : " empty"}`, inner = noteInner(txt, n, "Notes – double-click to write");
  return { i: -1, side: "bottom", key: MEMO_KEY, n, txt, memo: true, cls, style: st, inner, bubble, box: mb,
    bubbleHtml: bubble ? `<div class="${bubble.cls}" data-i="-1" data-side="bottom" style="${pos};border-radius:${bubble.r}px"></div>` : "",
    html: `<div class="${cls}" data-note="${MEMO_KEY}" data-i="-1" data-side="bottom" style="${st}">${inner}</div>` };
}

/** text boxes: the font shrinks (never below 9 px) until the text fits its box */
export function fitNoteSize(note: NoteMeasure, start: number, m: TextMeasurer): number {
  let size = start;
  while (size > 9) { if (m.noteFits(note, size)) break; size -= 1; }
  return size;
}
