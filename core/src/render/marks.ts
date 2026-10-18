/* Marked cells of a run (S8.3, RC-06, docs/next/07 §1.4 (4)): a run started with "run anyway, mark these cells" draws
   the cells the self-check classes `different` with a red square in their top-right corner – one rect node, in every
   design, placed after the cell's hit box (each design draws one per cell, kind "t", id "<row>,<col>" of the layout),
   so it sits in the same frame and on top of the cell. A new list: the cached one is not changed. */
import { A1 } from "../xlsx/util";
import type { DisplayList, Node } from "../dl/types";
import type { TableLayout } from "../xlsx/types";

/** the marker's side, table px */
const SIDE = 7;
const RED = { solid: [214, 40, 40] as [number, number, number] };

/** `marked`: cells as "<sheet id>!<A1>"; the layout's cells whose source cell is marked get the corner square */
export function markCells(nodes: DisplayList, L: TableLayout, marked: Set<string>): DisplayList {
  const ids = new Set(L.items.filter(it => marked.has(L.sheet.name + "!" + A1(it.b.src.r, it.b.src.c))).map(it => `${it.b.r},${it.b.c}`));
  if (!ids.size) return nodes;
  const walk = (list: Node[]): Node[] => list.flatMap(n => {
    if (n.t === "group") return [{ ...n, children: walk(n.children) }];
    if (n.t === "hit" && n.kind === "t" && ids.has(n.id)) {
      const s = Math.min(SIDE, n.w / 2, n.h / 2);
      return [n, { t: "rect", x: n.x + n.w - s, y: n.y, w: s, h: s, fill: RED } as Node];
    }
    return [n];
  });
  return walk(nodes);
}
