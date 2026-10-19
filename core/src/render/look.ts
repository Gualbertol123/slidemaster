/* A slide's own look (B29, docs/next/08 §2.8): in a consulting design a slide may set parts of the look over the
   deck's. Every slide-level entry of the renderer (layout, slide display list, the worker's stage and export lists,
   the page's hit-testing of the current slide) draws with slideCtx(ctx, R): the style's `consult` is then the slide's
   effective look, so the table functions – which know the table, not the slide (a table may be on two slides) – read
   it from the context as before. Without slide parts the context is returned as it is. */
import type { RuntimeSlide } from "../model/types";
import type { RenderCtx } from "./context";
import { isConsult, slideLook, type ConsultOptions } from "../model/designs";

const MEMO = new WeakMap<RenderCtx, Map<string, RenderCtx>>();
export function slideCtx<C extends RenderCtx>(ctx: C, R: RuntimeSlide | null | undefined): C {
  if (!R || !isConsult(ctx.style.design)) return ctx;
  const own = slideLook(R.cfg, ctx.style.design);
  if (!Object.keys(own).length) return ctx;
  const key = R.id + "|" + JSON.stringify(own);
  let m = MEMO.get(ctx); if (!m) MEMO.set(ctx, m = new Map());
  let c = m.get(key) as C | undefined;
  if (!c) {
    // the parts replace the deck's; a text format (kpiText, panelText) is merged field by field over the deck's
    const deck = (ctx.style.consult || {}) as Partial<ConsultOptions>, consult: Partial<ConsultOptions> = { ...deck, ...own };
    for (const f of ["kpiText", "panelText"] as const) if (own[f] && deck[f]) consult[f] = { ...deck[f], ...own[f] };
    c = { ...ctx, style: { ...ctx.style, consult } }; m.set(key, c);
  }
  return c;
}
