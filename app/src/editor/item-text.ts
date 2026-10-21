/* What the page calls a slide item, per kind (S14.P review, 4): the selection status line (ui/Ribbon.tsx selStatus), the
   stage's tooltip of a broken item (stage/items.tsx), the undo step of Del (editor/charts.ts deleteItem) and the Issues
   line of its drawing problem (editor/issues.ts). Each kind's words are in its milestone's own file – M14 chart-text.ts,
   M15 shape-text.ts and line-text.ts – so the two branches never edit the same lines; a kind this page does not know
   (a newer page's) has the words below and an Issues line of its own. */
import type { Item } from "@slide-builder/core/model/types";
import { esc } from "@slide-builder/core/xlsx/util";
import type { ItemSel } from "../state/store";
import type { Issue } from "./issues";
import { CHART_TEXT } from "./chart-text";
import { SHAPE_TEXT } from "./shape-text";
import { LINE_TEXT } from "./line-text";

export interface KindText<I = Item> {
  /** the tooltip's prefix of a broken item on the stage ("Chart: …") */ name(it: I): string;
  /** the status bar while it is selected */ status(it: I, sel: ItemSel): string;
  /** the undo step of Del / its panel's Delete */ remove(it: I): string;
  /** the Issues line of its drawing problem; `n`: its number among the slide's items of its kind (1, 2, …) */ issue(it: I, n: number, problem: string): Issue;
}
/** every kind this page draws */
export const ITEM_TEXT: Record<string, KindText<never>> = {
  chart: CHART_TEXT,                              // M14
  /* ---- M14 above this line, M15 below it ---- */
  shape: SHAPE_TEXT,                              // M15: callouts and icons
  line: LINE_TEXT,                                // M15
};
/** a kind this page does not know (a newer page's): never drawn, so never selected; kept in the deck */
const LATER: KindText<Item> = {
  name: () => "Object",
  status: () => "Object of a newer Slide Builder selected · Del removes it",
  remove: () => "Remove object",
  issue: (_it, n, problem) => ({ cls: "warn", html: `Object ${n}: ${esc(problem)}` }),
};
export const kindText = (it: Item): KindText<Item> => (ITEM_TEXT[it.kind] as KindText<Item> | undefined) ?? LATER;
export const knownKind = (kind: unknown) => typeof kind === "string" && kind in ITEM_TEXT;
/** the Issues line of a slide's items of kinds this page does not know (09 §2.10: a newer page's items are kept, not
    drawn – the plan's P0.5: said, not skipped silently) */
export function laterKindsIssue(kinds: string[]): Issue | null {
  if (!kinds.length) return null;
  const names = [...new Set(kinds)].map(k => `“${esc(k)}”`).join(", ");
  return { cls: "warn", html: `${kinds.length} object${kinds.length > 1 ? "s" : ""} of a newer Slide Builder (${names}) on this slide: not shown or exported by this version, kept in the deck` };
}
