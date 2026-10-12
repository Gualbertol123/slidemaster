/* Text formatting on slides: deck text styles (Style.text, per kind of text) under the formatting of
   single texts (a slide's title, a text box, a cell). One function turns a format into CSS. */
import type { Note, RuntimeSlide, SlideTextKey, TextFmt, TextRole } from "../model/types";
import { fontStack } from "../model/fonts";
import type { RenderCtx } from "./context";
import { esc } from "../xlsx/util";

export const deckFmt = (ctx: RenderCtx, role: TextRole): TextFmt => ctx.style.text?.[role] || {};
const ROLE_OF: Record<SlideTextKey, TextRole | null> = { title: "title", subtitle: "subtitle", note: null, date: null };

/** a slide text's format: the deck style of its kind, then the slide's own formatting */
export function slideTextFmt(ctx: RenderCtx, R: RuntimeSlide, key: SlideTextKey): TextFmt {
  const role = ROLE_OF[key], own = R.cfg.fmt?.[key] || {};
  return { ...(role ? deckFmt(ctx, role) : {}), ...defined(own) };
}
/** a text box's format: the deck's text box style, then the box's own settings */
export function effNote(ctx: RenderCtx, n: Note): Note {
  const d = deckFmt(ctx, "note");
  return { ...defined({ font: d.font, size: d.size, b: d.b, i: d.i, color: d.color, align: d.align, lh: d.lh }), ...defined(n) } as Note;
}
function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** CSS declarations of a format (only what it sets); `size: false` leaves the font size to the caller */
export function fmtCss(f: TextFmt, opts: { size?: boolean; align?: boolean } = {}): string {
  const st: string[] = [];
  if (f.font) st.push(`font-family:${fontStack(f.font)}`);
  if (opts.size !== false && f.size) st.push(`font-size:${+f.size}px`);
  if (f.b !== undefined) st.push(`font-weight:${f.b ? 700 : 400}`);
  if (f.i !== undefined) st.push(`font-style:${f.i ? "italic" : "normal"}`);
  if (f.color) st.push(`color:${f.color}`);
  if (opts.align !== false && f.align) st.push(`text-align:${f.align}`);
  if (f.lh) st.push(`line-height:${+f.lh}`);
  return st.map(x => x.replace(/"/g, "'")).join(";");      // used inside style="…"
}

/* titles: a larger title or subtitle pushes the subtitle and the tables down */
const BASE = { glass: { title: 48, sub: 19, subTop: 82 }, excel: { title: 44, sub: 18, subTop: 76 } };
export function titleGeom(R: RuntimeSlide, ctx: RenderCtx) {
  const b = BASE[ctx.style.design === "glass" ? "glass" : "excel"];
  const t = slideTextFmt(ctx, R, "title").size || b.title, s = slideTextFmt(ctx, R, "subtitle").size || b.sub;
  const dt = Math.max(0, (t - b.title) * 1.2), ds = R.subtitle ? Math.max(0, (s - b.sub) * 1.3) : 0;
  return { subTop: b.subTop + dt, push: dt + ds };
}

/** text box markup (used by automated comments, available to any text box): "# title", "## heading",
    "**bold**", "[[+476]]" = a number coloured by its sign; other lines are paragraphs */
export const hasMarkup = (t: string) => /^#{1,2} |\*\*.+?\*\*|\[\[[^\]]+\]\]/m.test(t);
export function richText(t: string): string {
  return String(t).split("\n").map(line => {
    const h = esc(line).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[\[([^\]]+)\]\]/g, (_m, x: string) => `<span class="${/^\+/.test(x) ? "up" : /^-/.test(x) ? "down" : "flat"}">${x}</span>`);
    if (line.startsWith("## ")) return `<div class="nh">${h.slice(3)}</div>`;
    if (line.startsWith("# ")) return `<div class="nt">${h.slice(2)}</div>`;
    return line.trim() ? `<div class="np">${h}</div>` : `<div class="gap"></div>`;
  }).join("");
}
