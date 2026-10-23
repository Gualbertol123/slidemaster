/* The empty slide's hint (4.13.2, owner's screenshot of 2026-10-23): "No tables on this slide – Add table (Insert) puts one
   here." is drawn across the middle of the stage (DOM over the slide, never exported). Only on a content slide with
   nothing on it at all: no table, no item (KPI card, chart, shape, line, text box, a newer page's kind) and no text box
   beside a table. A slide of KPI cards and charts is not empty: the hint would sit over them. */
import type { RuntimeSlide } from "@slide-builder/core/model/types";

const any = (m: object | null | undefined) => !!m && typeof m === "object" && Object.values(m).some(x => x && typeof x === "object");
/** whether the slide has nothing on it (the hint and the Issues line "No tables on this slide." alike) */
export const emptySlide = (R: Pick<RuntimeSlide, "type" | "tables" | "cfg">): boolean =>
  R.type === "content" && !R.tables.length && !any(R.cfg.items) && !any(R.cfg.notes);
