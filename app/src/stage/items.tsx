/* The stage's slide items (S9.3, B16): over each chart a transparent box that selects it (a click on a slice selects
   that slice too: the worker's pie geometry, core render/chart-dl.ts sliceAt), moves it (a drag of its body) and resizes
   it (its corner; in a free layout, B18, also an edge). The pixels are the item's own layer (Stage.tsx Layers), shifted while it moves. */
import { memo } from "react";
import { useStore, type ItemSel } from "../state/store";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import { sliceAt } from "@slide-builder/core/render/chart-dl";
import { selectItem } from "../editor/charts";
import { paintItem } from "../editor/painter";
import { kindText } from "../editor/item-text";
import { itemMove, itemResize, labelDrag, noteEdge, type DragPreview } from "./drags";
import { slideScale } from "./actions";
import { setStage, useStage } from "./data";
import { chartHitAt, labelHitAt, selectedHit } from "./chart-hits";
import type { StageModel } from "./model";

export function Items({ m, R, drag, free }: { m: StageModel; R: RuntimeSlide; drag: DragPreview | null; free: boolean }) {
  const itemSel = useStore(s => s.selection.itemSel), sc = useStage(st => st.scale), pend = useStore(s => s.selection.painter?.pend?.items);
  // each box drawn again only when its own state changes: a drag's frame redraws the moving one, not all the others
  // (60 objects: S15.4's snap_drag_frame_ms)
  return <>{m.items.map(p => {
    const d = drag?.kind === "item" && drag.id === p.id ? drag : null, on = itemSel?.id === p.id, painted = !!pend?.some(x => x.slide === R.id && x.id === p.id);
    return <ItemBox key={p.id} p={p} m={m} R={R} free={free} d={d} sel={on ? itemSel : null} sc={sc} painted={painted} />;
  })}</>;
}
type ItemPlace = StageModel["items"][number];
/** `sc`: the stage's scale (a selected slice's ring keeps its screen size); `painted`: noted by the format painter's Ctrl+click (4.9) */
const ItemBox = memo(function ItemBox({ p, m, R, free, d, sel, painted }: { p: ItemPlace; m: StageModel; R: RuntimeSlide; free: boolean; d: (DragPreview & { kind: "item" }) | null; sel: ItemSel | null; sc: number; painted: boolean }) {
  // what a moving item snaps to: the tables, the text boxes, the other items
  const others = (self: string) => [...m.tables.map(t => t.box), ...m.notes.map(n => n.box), ...m.items.filter(x => x.id !== self).map(x => x.box)];
  const b = d ? d.box : p.box, on = !!sel, itemSel = sel;
  return <div className={"itembox" + (on ? " sel" : "") + (painted ? " paintpend" : "") + (d?.moved ? " moving" : "") + (p.info?.issue ? " broken" : "")} data-item={p.id} data-kind={R.cfg.items?.[p.id]?.kind}
      title={p.info?.issue ? itemTitle(R, p.id, p.info.issue) : undefined}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(painted ? { outline: "2px dashed #0A66D8" } : {}) }}
      onPointerMove={free ? e => { if (!(e.buttons & 1)) { const ed = noteEdge(e.currentTarget, e.nativeEvent, true, "top"); e.currentTarget.style.cursor = ed ? (ed === "l" || ed === "r" ? "ew-resize" : "ns-resize") : ""; } } : undefined}
      onDoubleClick={e => { const it = R.cfg.items?.[p.id]; if (it?.kind === "shape" && it.shape !== "icon") { e.stopPropagation(); setStage({ editor: { kind: "item", id: p.id } }); } }}
      onPointerDown={e => {
        e.stopPropagation();
        // the format painter holding an object's look (4.9): this one takes it (Ctrl: noted, pasted with the others)
        if (paintItem(p.id, e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
        // the slice under the pointer (slide px from the box on screen)
        const rc = e.currentTarget.getBoundingClientRect(), k = rc.width / b.w;
        const x = b.x + (e.clientX - rc.left) / k, y = b.y + (e.clientY - rc.top) / k, g = p.info?.geom;
        // (B53) the selected chart's label under the pointer: dragged to a place of its own (one undo step)
        // (a series chart: the point or mark under the pointer, from its layer's hits – S14.5)
        const h = !g && p.layer ? chartHitAt(p.layer.nodes, p.id, x, y) : null;
        const lab = on && !g && p.layer && !(e.target as Element).closest(".size") ? labelHitAt(p.layer.nodes, p.id, x, y) : null;
        // (a click on a label without a move selects what is under it – its mark, or the point its label belongs to)
        if (lab) { e.preventDefault(); labelDrag(R, p.id, lab.key, lab.box, b, e.currentTarget, e.nativeEvent, () => selectItem(p.id, null, h ? { point: h.point ?? null, mark: h.mark ?? null } : {})); return; }
        selectItem(p.id, g ? sliceAt(g, x, y) : null, h ? { point: h.point ?? null, mark: h.mark ?? null } : {});
        const ed = free && !(e.target as Element).closest(".size") ? noteEdge(e.currentTarget, e.nativeEvent, true, "top") : null;
        if ((e.target as Element).closest(".size")) { e.preventDefault(); itemResize(R, p.id, p.box, e.nativeEvent, "corner", others(p.id)); }
        else if (ed) { e.preventDefault(); itemResize(R, p.id, p.box, e.nativeEvent, ed, others(p.id)); }
        else itemMove(R, p.id, p.box, others(p.id), e.nativeEvent);
      }}>
      {on && <div className="size" title="Drag to resize" />}
      {on && itemSel?.slice !== null && itemSel?.slice !== undefined && p.info?.geom && <SliceMark g={p.info.geom} i={itemSel.slice} box={b} />}
      {on && (itemSel?.point || itemSel?.mark) && p.layer && !d?.moved && <PointMark nodes={p.layer.nodes} id={p.id} sel={itemSel} box={b} />}
    </div>;
});
/** a broken item's tooltip: its kind's name (editor/item-text.ts) and the problem */
const itemTitle = (R: RuntimeSlide, id: string, issue: string) => { const it = R.cfg.items?.[id]; return (it ? kindText(it).name(it) : "Object") + ": " + issue; };
/** the selected slice: a ring at the edge of its arc */
function SliceMark({ g, i, box }: { g: NonNullable<NonNullable<StageModel["items"][number]["info"]>["geom"]>; i: number; box: { x: number; y: number } }) {
  const s = g.slices.find(x => x.i === i); if (!s) return null;
  const mid = (s.a0 + s.a1) / 2 * Math.PI / 180, r = g.r + 6, inv = 1 / Math.max(.2, slideScale());
  return <div className="slicemark" data-slice={i} style={{ left: g.cx + r * Math.sin(mid) - box.x - 7 * inv, top: g.cy - r * Math.cos(mid) - box.y - 7 * inv, width: 14 * inv, height: 14 * inv }} />;
}
/** the selected point or mark of a series chart (S14.5): a ring round its hit box */
function PointMark({ nodes, id, sel, box }: { nodes: import("@slide-builder/core/dl/types").DisplayList; id: string; sel: { point?: { s: string; i: number } | null; mark?: string | null }; box: { x: number; y: number } }) {
  const h = selectedHit(nodes, id, sel); if (!h) return null;
  return <div className="pointmark" data-point={h.point ? `${h.point.s}:${h.point.i}` : undefined} data-mark={h.mark} style={{ left: h.box.x - box.x - 3, top: h.box.y - box.y - 3, width: h.box.w + 6, height: h.box.h + 6 }} />;
}
