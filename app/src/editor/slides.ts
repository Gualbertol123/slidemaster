/* New slide and Add table (S13.4, B40–B42, F16; docs/next/09 §2.8, §3.9): each one operation (state/app.ts change), so
   one undo step – slide.add after the selected slide; table.add of a mapped table, or of a new range table chosen in the
   sheet view (PickCells.tsx: its definition joins preset.tables with the same op). In a free layout the core places an
   added table at the first empty spot (render/layout.ts freeLayout); nothing is written for it here. */
import { get, toast } from "../state/store";
import { change, focusSlide } from "../state/app";
import { editTitleWhenShown } from "../stage/actions";
import { curSlide } from "./edit";
import type { Preset, SlideDef, TableDef } from "@slide-builder/core/model/types";

/** an id no other page makes: random, 10 base-36 characters after the prefix (a slide.add or a new table.add with an id
    that exists is skipped or lands on the other one – ops.ts – so ids are unique per writer, 09 §2.8) */
export function newId(prefix: string, taken: (id: string) => boolean): string {
  let id = "";
  do id = prefix + Math.random().toString(36).slice(2, 12).padEnd(10, "0"); while (taken(id));
  return id;
}

/** New slide (#newSlide, the slide list's menu, Ctrl+M): a blank content slide titled "New slide" after the selected one
    (no slide: at the end), shown with its title open for typing */
export function newSlide(): string | null {
  const { doc: { open, view } } = get(), p = view?.preset;
  if (!open || !p) return null;
  const R = curSlide(), id = newId("s", x => p.slides.some(s => s.id === x));
  const slide: SlideDef = { id, type: "content", title: "New slide", subtitle: null, tables: [] };
  const after = R && p.slides.some(s => s.id === R.id) ? R.id : p.slides[p.slides.length - 1]?.id ?? null;
  focusSlide(id); editTitleWhenShown(id);
  if (change("New slide", [{ op: "slide.add", slide, after }])) return id;
  focusSlide(null); editTitleWhenShown(null);
  return null;
}

/** the Add table menu's rows: every mapped table, the ones on no slide first, then the others (each group in the deck's
    order) with the numbers of the slides they are on */
export function tableChoices(p: Preset | null | undefined): { def: TableDef; on: number[] }[] {
  if (!p) return [];
  const rows = p.tables.map(def => ({ def, on: p.slides.flatMap((s, i) => (s.tables || []).includes(def.id) ? [i + 1] : []) }));
  return [...rows.filter(r => !r.on.length), ...rows.filter(r => r.on.length)];
}

/** a table of the deck added to the current slide (table.add); false when there is no content slide or it is there */
export function addTable(def: TableDef): boolean {
  const R = curSlide();
  if (!R || R.type !== "content") { toast("Tables go on content slides: select one (or add one with New slide) first."); return false; }
  if ((R.cfg.tables || []).includes(def.id)) { toast("This table is on this slide already."); return false; }
  return change("Add table", [{ op: "table.add", table: JSON.parse(JSON.stringify(def)) as TableDef, slide: R.id }]);
}

/** New table from cells… (PickCells): a range table of `sheet`, its definition and its place on the current slide in one
    operation (one undo step; the definition stays in the deck when it is undone, 09 §2.8) */
export function addRangeTable(sheet: string, range: string): string | null {
  const p = get().doc.view?.preset; if (!p) return null;
  const def: TableDef = { id: newId("t", x => p.tables.some(t => t.id === x)), sheet, kind: "range", range, grow: false };
  return addTable(def) ? def.id : null;
}
