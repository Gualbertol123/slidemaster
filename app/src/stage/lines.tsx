/* The stage's lines (4.8, M15 S15.3; docs/next/09 §5.3, LN-02): over each line the worker drew, a transparent 12 px band
   along its route (an SVG stroke: a click selects it, a drag moves it whole – its ends free again) and, while it is
   selected, its handles: end a, end b and the middle. Dragging an end moves that end; with Ctrl it attaches to the
   nearest anchor point of an object (a table, a text box, another item: shown as a dot), dropped elsewhere it is free;
   Shift keeps a straight line at 0 / 45 / 90°. The middle moves a straight line or a range whole, an elbow's bend, a
   curve's bulge, a bracket's depth. While the pointer moves the line's new route is drawn here (the page computes it
   with the core's own route code); on the drop ONE change is sent (editor/lines.ts), one undo step. Never a table's or
   an item's drag code: stage/items.tsx draws the boxes of the other kinds (Stage.tsx hands it those alone).
   Snapping (S15.4, 09 §5.1 / §5.3): an end, an elbow's bend and the whole line (its bounds) line up with the slide, the
   other objects' edges and centres, the tables' cell borders and the other lines' ends (drags.ts snapTargets, collected
   once per drag); Ctrl's anchor and Shift's angle go first; Alt: no snapping. The preview is on 1/4 px, as the drop. */
import { useMemo, useState } from "react";
import { useStore, patch } from "../state/store";
import { change, ctx } from "../state/app";
import type { Anchor, RuntimeSlide } from "@slide-builder/core/model/types";
import { routeOf, type Pt } from "@slide-builder/core/render/line-dl";
import { computeLayout } from "@slide-builder/core/render/layout";
import { slideCtx } from "@slide-builder/core/render/look";
import { kindText } from "../editor/item-text";
import { selectItem } from "../editor/charts";
import { anchorList, endOps, lineNow, midFor, midOps, moveOps, nearestAnchor, snap45, type LineNow } from "../editor/lines";
import { slideScale } from "./actions";
import { snapTargets } from "./drags";
import { SnapGuides } from "./guides";
import { snapRound } from "@slide-builder/core/render/layout";
import { snapMove, snapPoint, snapTol, type SnapMarks, type SnapTargets } from "@slide-builder/core/render/snap";
import type { StageModel } from "./model";

type Handle = "a" | "b" | "mid" | "body";
interface Live { id: string; handle: Handle; a: Pt; b: Pt; mid?: number; anchor: Pt | null; moved: boolean; marks: SnapMarks | null }
const q = (p: Pt): Pt => ({ x: snapRound(p.x), y: snapRound(p.y) });
const d = (cmds: ReturnType<typeof routeOf>["d"]) => cmds.map(c => c[0] + c.slice(1).join(" ")).join(" ");

export function Lines({ m, R, s }: { m: StageModel; R: RuntimeSlide; s: number }) {
  const itemSel = useStore(st => st.selection.itemSel), [live, setLive] = useState<Live | null>(null);
  const c = ctx();
  // the lines the worker drew (an item of a design not drawn yet waits for its layer), where they are now
  const lines = useMemo(() => {
    const ps = m.items.filter(p => R.cfg.items?.[p.id]?.kind === "line"); if (!ps.length) return [];
    const boxes = computeLayout(R, slideCtx(c, R)).boxes;                       // one layout for all of them
    return ps.flatMap(p => { const L = lineNow(R, p.id, c, boxes); return L ? [{ id: p.id, L, issue: p.info?.issue ?? null }] : []; });
  }, [m, R, c]);
  if (!lines.length) return null;
  const inv = 1 / Math.max(.2, s);

  function start(e: React.PointerEvent, id: string, L: LineNow, handle: Handle) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (handle === "body") selectItem(id); else patch("selection", { itemSel: { id, slice: null, handle } });
    const sc = slideScale(), sx = e.clientX, sy = e.clientY, a0 = L.a, b0 = L.b, mid0 = routeOf(L.it, a0, b0).mid;
    let cur: Live = { id, handle, a: a0, b: b0, anchor: null, moved: false, marks: null }, at: Anchor | null = null, anchors: ReturnType<typeof anchorList> | null = null;
    // what it snaps to, collected at pointer-down (S15.4 review 4: not in the first drag frame): the slide, the tables,
    // the items, the other lines (drags.ts), the text boxes, the page number
    const T: SnapTargets = snapTargets(R, [...m.notes.map(n => n.box), ...m.hits.filter(h => /^pageno\b|^footer\b/.test(h.id))], { item: id });
    const tol = snapTol(sc), targets = () => T;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
      if (!cur.moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;      // a click is not a drag
      at = null;
      let marks: SnapMarks | null = null;
      if (handle === "a" || handle === "b") {
        const other = handle === "a" ? b0 : a0, from = handle === "a" ? a0 : b0;
        let p = { x: from.x + dx, y: from.y + dy };
        const near = ev.ctrlKey || ev.metaKey ? nearestAnchor(anchors ??= anchorList(R, id, c), p, Math.max(16, 16 / sc)) : null;
        if (near) { p = near.at; at = near.anchor; }
        else if (ev.shiftKey && (L.it.route === "straight" || L.it.route === "range")) p = snap45(other, p);
        else if (!ev.altKey) { const s2 = snapPoint(targets(), p, tol); p = s2.p; marks = s2.marks; }
        cur = { ...cur, [handle]: near ? p : q(p), anchor: near ? near.at : null, moved: true, marks };
      } else if (handle === "mid" && L.it.route !== "straight" && L.it.route !== "range") {
        // an elbow's bend lines up too (a curve's bulge and a bracket's depth follow the pointer)
        let p = { x: mid0.x + dx, y: mid0.y + dy };
        if (L.it.route === "elbow" && !ev.altKey) { const s2 = snapPoint(targets(), p, tol); p = s2.p; marks = s2.marks; }
        cur = { ...cur, mid: midFor(L.it, a0, b0, p), moved: true, marks };
      } else {
        // the whole line: its bounds line up (edges and centre), on 1/4 px
        let sx2 = dx, sy2 = dy;
        if (!ev.altKey) {
          const x = Math.min(a0.x, b0.x) + dx, y = Math.min(a0.y, b0.y) + dy, s2 = snapMove(targets(), { x, y, w: Math.abs(b0.x - a0.x), h: Math.abs(b0.y - a0.y) }, tol, null);
          sx2 += s2.box.x - x; sy2 += s2.box.y - y; marks = s2.marks;
        }
        cur = { ...cur, a: q({ x: a0.x + sx2, y: a0.y + sy2 }), b: q({ x: b0.x + sx2, y: b0.y + sy2 }), moved: true, marks };
      }
      setLive(cur);
    };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      setLive(null);
      if (ev.type === "pointercancel" || !cur.moved) return;
      const ops = handle === "a" || handle === "b" ? endOps(R, id, c, handle, cur[handle], at)
        : handle === "mid" ? midOps(R, id, c, routeOf({ ...L.it, ...(cur.mid !== undefined ? { mid: cur.mid } : {}) }, cur.a, cur.b).mid)
        : moveOps(R, id, c, cur.a.x - a0.x, cur.a.y - a0.y);
      if (ops?.length) change(handle === "a" || handle === "b" ? (at ? "Attach line" : "Move line end") : handle === "mid" && L.it.route !== "straight" && L.it.route !== "range" ? "Bend line" : "Move line", ops);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }

  return <>
    {live?.marks && <SnapGuides marks={live.marks} s={s} />}
    <svg className="linehits" viewBox="0 0 1600 900" width={1600} height={900} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 47 }}>
      {lines.map(({ id, L, issue }) => {
        const v = live?.id === id ? live : null, a = v ? v.a : L.a, b = v ? v.b : L.b, it = v?.mid !== undefined ? { ...L.it, mid: v.mid } : L.it;
        const r = routeOf(it, a, b), on = itemSel?.id === id;
        return <g key={id} data-line={id} className={"line" + (on ? " sel" : "") + (issue ? " broken" : "")}>
          {(on || v) && <path d={d(r.d)} fill="none" stroke="#0A66D8" strokeWidth={1.5 * inv} strokeDasharray={v ? `${6 * inv} ${4 * inv}` : undefined} />}
          <path className="linehit" data-item={id} data-kind="line" d={d(r.d)} fill="none" stroke="transparent" strokeWidth={Math.max(12, 12 * inv)} style={{ pointerEvents: "stroke", cursor: "move" }}
            onPointerDown={e => start(e, id, L, "body")}>
            <title>{issue ? kindText(L.it).name(L.it) + ": " + issue : kindText(L.it).status(L.it, { id, slice: null })}</title>
          </path>
        </g>;
      })}
      {live?.anchor && <circle className="lineanchor" cx={live.anchor.x} cy={live.anchor.y} r={6 * inv} fill="#0A66D8" stroke="#fff" strokeWidth={2 * inv} />}
    </svg>
    {lines.filter(x => itemSel?.id === x.id).map(({ id, L }) => {
      const v = live?.id === id ? live : null, a = v ? v.a : L.a, b = v ? v.b : L.b, it = v?.mid !== undefined ? { ...L.it, mid: v.mid } : L.it;
      const mid = routeOf(it, a, b).mid, size = 14 * inv;
      const handle = (k: "a" | "b" | "mid", p: Pt, title: string) => <div key={k} className={"linehandle " + k + (L.attached.includes(k as "a") ? " attached" : "")} data-handle={k} data-item={id} title={title}
        style={{ position: "absolute", left: p.x - size / 2, top: p.y - size / 2, width: size, height: size, zIndex: 48, pointerEvents: "auto", /* (.ovl is pointer-events: none) */ boxSizing: "border-box", borderRadius: k === "mid" ? 3 * inv : "50%",
          background: L.attached.includes(k as "a") ? "#0A66D8" : k === "mid" ? "#FFD84D" : "#fff", border: `${2 * inv}px solid #0A66D8`, boxShadow: `0 ${inv}px ${4 * inv}px rgba(10,102,216,.35)`, cursor: k === "mid" && it.route !== "straight" && it.route !== "range" ? "pointer" : "crosshair", touchAction: "none" }} onPointerDown={e => start(e, id, L, k)} />;
      return [
        handle("a", a, "Drag to move this end · Ctrl: attach it to an object · Shift: 0 / 45 / 90°"),
        handle("b", b, "Drag to move this end · Ctrl: attach it to an object · Shift: 0 / 45 / 90°"),
        handle("mid", mid, it.route === "elbow" ? "Drag to move the bend" : it.route === "curve" ? "Drag to bend the curve" : it.route === "bracket" ? "Drag to change the bracket's depth" : "Drag to move the line (its ends come free)"),
      ];
    })}
  </>;
}
