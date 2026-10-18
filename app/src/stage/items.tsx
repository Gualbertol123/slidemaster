/* The stage's slide items (S9.3, B16): over each chart a transparent box that selects it (a click on a slice selects
   that slice too: the worker's pie geometry, core render/chart-dl.ts sliceAt), moves it (a drag of its body) and resizes
   it (its corner). The pixels are the item's own layer (Stage.tsx Layers), shifted while it moves. */
import { useStore } from "../state/store";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import { sliceAt } from "@slide-builder/core/render/chart-dl";
import { selectItem } from "../editor/charts";
import { itemMove, itemResize, type DragPreview } from "./drags";
import { slideScale } from "./actions";
import type { StageModel } from "./model";

export function Items({ m, R, drag }: { m: StageModel; R: RuntimeSlide; drag: DragPreview | null }) {
  const itemSel = useStore(s => s.selection.itemSel);
  // what a moving item snaps to: the tables, the text boxes, the other items
  const others = (self: string) => [...m.tables.map(t => t.box), ...m.notes.map(n => n.box), ...m.items.filter(p => p.id !== self).map(p => p.box)];
  return <>{m.items.map(p => {
    const d = drag?.kind === "item" && drag.id === p.id ? drag : null, b = d ? d.box : p.box, on = itemSel?.id === p.id;
    return <div key={p.id} className={"itembox" + (on ? " sel" : "") + (d?.moved ? " moving" : "") + (p.info?.issue ? " broken" : "")} data-item={p.id} data-kind={R.cfg.items?.[p.id]?.kind}
      title={p.info?.issue ? "Chart: " + p.info.issue : undefined}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
      onPointerDown={e => {
        e.stopPropagation();
        // the slice under the pointer (slide px from the box on screen)
        const rc = e.currentTarget.getBoundingClientRect(), k = rc.width / b.w;
        const x = b.x + (e.clientX - rc.left) / k, y = b.y + (e.clientY - rc.top) / k, g = p.info?.geom;
        selectItem(p.id, g ? sliceAt(g, x, y) : null);
        if ((e.target as Element).closest(".size")) { e.preventDefault(); itemResize(R, p.id, p.box, e.nativeEvent); }
        else itemMove(R, p.id, p.box, others(p.id), e.nativeEvent);
      }}>
      {on && <div className="size" title="Drag to resize" />}
      {on && itemSel?.slice !== null && itemSel?.slice !== undefined && p.info?.geom && <SliceMark g={p.info.geom} i={itemSel.slice} box={b} />}
    </div>;
  })}</>;
}
/** the selected slice: a ring at the edge of its arc */
function SliceMark({ g, i, box }: { g: NonNullable<NonNullable<StageModel["items"][number]["info"]>["geom"]>; i: number; box: { x: number; y: number } }) {
  const s = g.slices.find(x => x.i === i); if (!s) return null;
  const mid = (s.a0 + s.a1) / 2 * Math.PI / 180, r = g.r + 6, inv = 1 / Math.max(.2, slideScale());
  return <div className="slicemark" data-slice={i} style={{ left: g.cx + r * Math.sin(mid) - box.x - 7 * inv, top: g.cy - r * Math.cos(mid) - box.y - 7 * inv, width: 14 * inv, height: 14 * inv }} />;
}
