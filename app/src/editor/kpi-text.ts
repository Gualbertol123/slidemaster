/* A KPI card's words (B54; editor/item-text.ts): status line, tooltip, undo step, Issues line. */
import type { KpiItem } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { KindText } from "./item-text";

export const KPI_TEXT: KindText<KpiItem> = {
  name: () => "KPI card",
  status: () => "KPI card selected – its title, value and rows in the side panel · drag to move, the corner to resize · Del removes it",
  remove: () => "Remove KPI card",
  issue: (_it, n, problem) => ({ cls: /not found/.test(problem) ? "err" : "warn", html: `KPI card ${n}: ${esc(problem)}` }),
};
