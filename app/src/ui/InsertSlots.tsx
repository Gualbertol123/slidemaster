/* The ribbon's Insert entries (S14.P): one per kind of object, each a component in its milestone's own file, so M14
   (charts) and M15 (lines, icons) never edit the same lines – each adds or changes only its own entry, on its own side
   of the separator line (git merges two edits only when an unchanged line stands between them). */
import type { ReactElement } from "react";
import { ChartInsert } from "./InsertChart";
import { ShapeInsert } from "./ShapeTools";
import { LineInsert } from "./LineTools";

export const INSERT_SLOTS: (() => ReactElement | null)[] = [
  ChartInsert,                                    // M14: Insert chart ▾
  /* ---- M14 above this line, M15 below it ---- */
  ShapeInsert,                                    // M15: Shapes & icons… (4.12: one window, icons and shapes)
  LineInsert,                                     // M15: Insert line ▾ (S15.3)
];
export function InsertSlots() {
  return <>{INSERT_SLOTS.map((Slot, k) => <Slot key={k} />)}</>;
}
