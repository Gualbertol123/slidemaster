/* Text formatting on slides: deck text styles (Style.text, per kind of text) under the formatting of
   single texts (a slide's title, a text box, a cell). */
import type { Note, RuntimeSlide, SlideTextKey, TextFmt, TextRole } from "../model/types";
import type { RenderCtx } from "./context";
import { esc } from "../xlsx/util";
import { isConsult } from "../model/designs";

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

/** title / subtitle sizes the slide's layout is made for; `push` = how far each px of a larger title moves the tables (the consulting designs
    reserve two, 08 §2.0: a larger title pushes the tables by both lines, 2 × 1.1 per px) */
const BASE = { glass: { title: 48, sub: 19, subTop: 82, push: 1.2 }, excel: { title: 44, sub: 18, subTop: 76, push: 1.2 },
  mckinsey: { title: 40, sub: 24, subTop: 124, push: 2.2 }, bain: { title: 40, sub: 22, subTop: 124, push: 2.2 } };
export const titleBase = (ctx: RenderCtx) => BASE[isConsult(ctx.style.design) ? ctx.style.design : ctx.style.design === "glass" ? "glass" : "excel"];
export function titleGeom(R: RuntimeSlide, ctx: RenderCtx) {
  const b = titleBase(ctx);
  const t = slideTextFmt(ctx, R, "title").size || b.title, s = slideTextFmt(ctx, R, "subtitle").size || b.sub;
  const dt = Math.max(0, (t - b.title) * b.push), ds = R.subtitle ? Math.max(0, (s - b.sub) * 1.3) : 0;
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
