/* Free layout of a slide in the current design (4.4, B18; docs/next/07 §5.1, ADR-017): switched on, every table, text
   box and item keeps the box it is drawn in now and is moved and resized on its own; switched off, the automatic layout
   comes back as it was (free mode never changes its sizing) and the boxes stay saved for the next switch-on. Each switch
   is one slide.patch: one undo step. */
import { change, ctx } from "../state/app";
import { confirmBox } from "../state/dialogs";
import type { Op, RuntimeSlide } from "@slide-builder/core/model/types";
import { freeBoxes, freeOf } from "@slide-builder/core/render/layout";

export const isFree = (R: RuntimeSlide | null | undefined) => !!R && !!freeOf(R, ctx());

/** on: the boxes saved last time (and, for what was added since, where it is drawn now), else every box as drawn now */
export function freeLayoutOn(R: RuntimeSlide) {
  const c = ctx(), d = c.style.design, f = R.cfg.free?.[d];
  if (freeOf(R, c)) return;
  const saved = f?.items && typeof f.items === "object" ? f.items : null;
  // drawn as it will be: the saved boxes where there are some
  const items = freeBoxes(saved ? { ...R, cfg: { ...R.cfg, free: { ...R.cfg.free, [d]: { on: true, items: saved } } } } : R, c);
  change("Free layout", [{ op: "slide.patch", id: R.id, patch: { free: { [d]: { on: true, items } } } } as Op]);
}
/** off: the automatic layout, the boxes kept */
export function freeLayoutOff(R: RuntimeSlide) {
  const c = ctx(), d = c.style.design, f = freeOf(R, c);
  if (f) change("Automatic layout", [{ op: "slide.patch", id: R.id, patch: { free: { [d]: { ...f, on: false } } } } as Op]);
}
/** "Reset layout" in free mode (TA-13): asks first */
export async function askAutomatic(R: RuntimeSlide) {
  if (await confirmBox("Back to automatic layout?", "The tables, text boxes, charts and shapes of this slide go back to their automatic places in this design. Their free places are kept: <b>Free layout</b> brings them back.", "Automatic layout")) freeLayoutOff(R);
}
