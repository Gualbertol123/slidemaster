/* A chart's words (M14 owns this file; editor/item-text.ts): status line, tooltip, undo step, Issues line. */
import type { ChartItem } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { KindText } from "./item-text";

export const CHART_TEXT: KindText<ChartItem> = {
  name: () => "Chart",
  // (a series chart's point or mark, S14.5: its settings are in the side panel)
  status: (it, sel) => (sel.slice !== null ? `Slice ${sel.slice + 1} of the chart selected` : sel.mark ? "A mark of the chart selected – its settings in the side panel"
    : sel.point ? `Point ${sel.point.i + 1} of ${seriesName(it, sel.point.s)} selected – its colour and label in the side panel` : "Chart selected") + " · drag to move, the corner to resize · Del removes it",
  remove: () => "Remove chart",
  issue: (_it, n, problem) => ({ cls: /not found/.test(problem) ? "err" : "warn", html: `Chart ${n}: ${esc(problem)}` }),
};
const seriesName = (it: ChartItem, s: string) => { const n = it.sers?.[s]?.name; return typeof n === "string" && n ? `'${n}'` : "the series"; };
