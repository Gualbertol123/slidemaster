/* Insert chart ▾ › Budget achievement… (4.14, B55): the long table's header row read from the workbook, the chart
   (editor/chart-progress.ts achievementFromTable) inserted in one change – one undo step – and selected. */
import type { Op } from "@slide-builder/core/model/types";
import { parseRange } from "@slide-builder/core/xlsx/util";
import { get, toast } from "../state/store";
import { change, core } from "../state/app";
import { curSlide } from "./edit";
import { newItemId, selectItem } from "./charts";
import { achievementFromTable } from "./chart-progress";

/** Insert chart ▾ › Budget achievement…: the table's header row read from the workbook, the chart inserted (one step) */
export async function insertAchievement(sheet: string, range: string): Promise<string | null> {
  const R = curSlide(), wb = get().deck.wb; if (!R || !wb) return null;
  const slide = R.id, g = parseRange(range);
  let headers: string[] = [];
  try {
    const w = await core().call("getSheetWindow", { book: wb.book, sheet, r0: g.r1, r1: g.r1, c0: g.c1, c1: g.c2 });
    headers = Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => w?.cells.find(x => x.r === g.r1 && x.c === g.c1 + i)?.text ?? "");
  } catch { headers = []; }
  const it = achievementFromTable(sheet, range, headers);
  if (!it) { toast("Choose the table: its header row, then one row per product and period – at least three columns (the product, the value, the budget)."); return null; }
  if (!get().deck.slides.some(x => x.id === slide)) return null;
  const id = newItemId();
  change("Insert budget achievement", [{ op: "item.patch", slide, id, patch: it } as Op]);
  if (curSlide()?.id === slide) selectItem(id);
  return id;
}
