/* A chart's words (M14 owns this file; editor/item-text.ts): status line, tooltip, undo step, Issues line. */
import type { ChartItem } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { KindText } from "./item-text";

export const CHART_TEXT: KindText<ChartItem> = {
  name: () => "Chart",
  status: (_it, sel) => (sel.slice !== null ? `Slice ${sel.slice + 1} of the chart selected` : "Chart selected") + " · drag to move, the corner to resize · Del removes it",
  remove: () => "Remove chart",
  issue: (_it, n, problem) => ({ cls: /not found/.test(problem) ? "err" : "warn", html: `Chart ${n}: ${esc(problem)}` }),
};
