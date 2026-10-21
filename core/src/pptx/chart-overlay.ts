/* A series chart's arrow and line marks in the PowerPoint export (4.7, S14.6; 09 §4.2, plan-M14 S14.6): each one plain
   line shape over the native chart, in the chart's group – `a:prstGeom prst="line"` in the box of its two ends, flipped
   so that its first point is end a (flipH / flipV) – with its stroke (width, colour, dash) on `a:ln` and native ends
   (`a:headEnd` at end a, `a:tailEnd` at end b: triangle, arrow, stealth, oval, diamond; drawingml.ts lineEnd). Never a
   connector shape (p:cxnSp), never a picture. The slide draws the same arrow with render/heads.ts (the line shortened
   under a filled head); PowerPoint draws its own head on the full line, so the tip lands on the same point. A limiter's
   "bar" tick has no native end: it stays a shape of the overlay (render/chart-marks.ts keeps its node). Pure. */
import type { ArrowSem, ChartSem } from "./chart-sem";
import type { DisplayList } from "../dl/types";
import type { El, Line } from "./scene";
import { headEnd } from "./drawingml";

/** what goes over the native chart, in the slide's stacking order (S14.6 review 6): the overlay's nodes as shapes
    (`walk`: scene.ts's walker on a slice of them), each arrow written between them at its place (ArrowSem.at: the count of
    overlay nodes under it – marks in id order, a later id on top), so a text or icon mark of a later id stays over an
    arrow and a limiter's bar tick over its line. A chart without arrows: the overlay walked whole, as before. */
export function overlayEls(overlay: DisplayList, ch: ChartSem, walk: (nodes: DisplayList) => El[]): El[] {
  const A = ch.arrows || [];
  if (!A.length) return overlay.length ? walk(overlay) : [];
  const out: El[] = [], placed = A.map((a, k) => ({ a, k, at: Math.max(0, Math.min(overlay.length, a.at ?? overlay.length)) })).sort((x, y) => x.at - y.at || x.k - y.k);
  let from = 0;
  for (const { a, at } of placed) {
    if (at > from) out.push(...walk(overlay.slice(from, at)));
    from = Math.max(from, at);
    out.push(arrowEl(a));
  }
  if (from < overlay.length) out.push(...walk(overlay.slice(from)));
  return out;
}

/** an arrow or line mark as one line shape: its box, flipped so that its first point is end a, native ends on its a:ln */
function arrowEl(m: ArrowSem): El {
  const { a, b, stroke: st } = m, head = headEnd(m.head, m.size), tail = headEnd(m.tail, m.size);
  const line: Line = { w: st.w, paint: st.paint, ...(st.dash ? { dash: st.dash } : {}), ...(st.cap ? { cap: st.cap } : {}), ...(st.join ? { join: st.join } : {}),
    ...(head ? { head } : {}), ...(tail ? { tail } : {}) };
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  return { k: "sp", box, ...(b.x < a.x ? { flipH: true } : {}), ...(b.y < a.y ? { flipV: true } : {}), geom: { prst: "line" }, fill: null, line, name: head || tail ? "Arrow" : "Line" };
}
