/* The composable consulting look (B29, docs/next/08 §2.8): the ribbon's part selectors. A change goes to the current
   slide (SlideDef.looks[d], over the deck's designs[d].consult); "Apply to all" makes the slide's parts the deck's and
   clears them on every slide; "Deck's look" clears the slide's own. Each is one undo step (operations only, ADR-002). */
import { get } from "../state/store";
import { change, ctx, style } from "../state/app";
import { curSlide } from "./edit";
import { CONSULT_TEXT, consultOptions, isConsult, slideLook, type ConsultChoice, type ConsultOptions } from "@slide-builder/core/model/designs";
import { slideCtx } from "@slide-builder/core/render/look";
import type { Op, TextFmt } from "@slide-builder/core/model/types";

/** the KPI line and the message panel's lead figure: selectable texts whose format is the look's (not editable) */
export type LookTextKey = "kpi" | "panel";
export const LOOK_TEXT_LABEL: Record<LookTextKey, string> = { kpi: "KPI line", panel: "Message panel" };
export const isLookText = (k: unknown): k is LookTextKey => k === "kpi" || k === "panel";
const FIELD = { kpi: "kpiText", panel: "panelText" } as const;

/** the look of the current slide: the design, the slide's own parts, the effective look and the deck's */
export function lookState() {
  const R = curSlide(), d = style().design;
  if (!R || !isConsult(d)) return null;
  const own = slideLook(R.cfg, d), c = ctx();
  return { R, d, own, eff: consultOptions(slideCtx(c, R)), deck: consultOptions(c) };
}
const writeOwn = (label: string, next: Partial<ConsultOptions>) => {
  const s = lookState(); if (!s) return;
  change(label, [{ op: "slide.patch", id: s.R.id, patch: { looks: { [s.d]: Object.keys(next).length ? next : null } } } as Op]);
};
/** one part on this slide (the deck's value removes the slide's own) */
export function setPart<K extends ConsultChoice>(k: K, v: ConsultOptions[K]) {
  const s = lookState(); if (!s || s.eff[k] === v) return;
  const next: Partial<ConsultOptions> = { ...s.own };
  if (s.deck[k] === v) delete next[k]; else next[k] = v;
  writeOwn(`${CONSULT_TEXT[k].name}: ${(CONSULT_TEXT[k].labels as Record<string, string>)[v]} (this slide)`, next);
}
/** the KPI line's or the panel's text format on this slide */
export function lookTextFmt(key: LookTextKey): TextFmt { return lookState()?.eff[FIELD[key]] || {}; }
export function setLookText(key: LookTextKey, label: string, fmt: TextFmt) {
  const s = lookState(); if (!s) return;
  const next: Partial<ConsultOptions> = { ...s.own }, f = Object.fromEntries(Object.entries(fmt).filter(([, v]) => v !== undefined && v !== null)) as TextFmt;
  if (Object.keys(f).length) next[FIELD[key]] = f; else delete next[FIELD[key]];
  writeOwn(label + " (" + LOOK_TEXT_LABEL[key] + ", this slide)", next);
}
/** the slide's parts become the deck's; every slide's own value of those parts goes */
export function applyLookToAll() {
  const s = lookState(); if (!s || !Object.keys(s.own).length) return;
  const view = get().doc.view!, raw = (view.style?.designs || {}) as Record<string, Record<string, unknown> | undefined>;
  const look = { ...(raw[s.d] || {}) }, consult = { ...((look.consult as Record<string, unknown>) || {}), ...s.own };
  const ops: Op[] = [{ op: "style.patch", patch: { designs: { [s.d]: { ...look, consult } } } } as Op];
  for (const S of view.preset?.slides || []) {
    const mine = (S.looks?.[s.d] || {}) as Record<string, unknown>, rest = Object.fromEntries(Object.entries(mine).filter(([k]) => !(k in s.own)));
    if (Object.keys(mine).length !== Object.keys(rest).length) ops.push({ op: "slide.patch", id: S.id, patch: { looks: { [s.d]: Object.keys(rest).length ? rest : null } } } as Op);
  }
  change("Look: apply to all slides", ops);
}
/** back to the deck's look on this slide */
export function clearSlideLook() { const s = lookState(); if (s && Object.keys(s.own).length) writeOwn("Look: the deck's (this slide)", {}); }
