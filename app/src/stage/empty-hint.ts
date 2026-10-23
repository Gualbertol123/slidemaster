/* The empty slide's hint (4.13.2, owner's screenshot of 2026-10-23): "No tables on this slide – Add table (Insert) puts one
   here." is drawn across the middle of the stage (DOM over the slide, never exported). Only on a content slide with
   nothing on it at all: no table, no item (KPI card, chart, shape, line, text box, a newer page's kind) and no notes
   section. A slide of KPI cards and charts is not empty: the hint would sit over them. A table's text boxes ("<table>:<side>")
   are drawn only beside a table on the slide (render/layout.ts notesOf): those a removed or missing table left behind
   (table.remove keeps them) draw nothing, so they do not count. */
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import { MEMO_KEY } from "@slide-builder/core/render/layout";

const any = (m: object | null | undefined) => !!m && typeof m === "object" && Object.values(m).some(x => x && typeof x === "object");
/** whether the slide has nothing on it (the hint and the Issues line "No tables on this slide." alike) */
export const emptySlide = (R: Pick<RuntimeSlide, "type" | "tables" | "cfg">): boolean =>
  R.type === "content" && !R.tables.length && !any(R.cfg.items) && !(R.cfg.notes?.[MEMO_KEY] && typeof R.cfg.notes[MEMO_KEY] === "object");
