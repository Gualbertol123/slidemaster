/* A line's words (M15 owns this file; editor/item-text.ts): status line, tooltip, undo step, Issues line ("Line 3: its
   end lost its object", S15.3). */
import type { LineItem } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { KindText } from "./item-text";

export const LINE_TEXT: KindText<LineItem> = {
  name: () => "Line",
  status: () => "Line selected · Del removes it",
  remove: () => "Remove line",
  issue: (_it, n, problem) => ({ cls: "warn", html: `Line ${n}: ${esc(problem)}` }),
};
