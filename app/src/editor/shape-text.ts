/* A callout's or an icon's words (M15 owns this file; editor/item-text.ts): status line, tooltip, undo step, Issues line. */
import type { ShapeItem } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { KindText } from "./item-text";

export const SHAPE_TEXT: KindText<ShapeItem> = {
  name: () => "Callout",
  status: it => (it.shape === "icon" ? "Icon selected" : "Shape selected · double-click or Enter to write") + " · drag to move, the corner to resize · Del removes it",
  remove: () => "Remove shape",
  // an icon whose name the set does not have (09 §3.5) shows "info"; a callout's cell that cannot be read shows #REF
  issue: (it, n, problem) => it.shape === "icon" ? { cls: "warn", html: `Icon ${n}: ${esc(problem)} (shown as “info”)` } : { cls: "err", html: `Callout ${n}: ${esc(problem)} (shown as #REF)` },
};
