/* The slide's pixels (PLAN S4.1, ADR-012): the display list's layers as SVG, in the slide's painting order. The core
   worker writes each layer's markup (core/dl/svg.ts); each layer here is one <svg> that takes it through a ref, memoised
   by its key – an edit swaps the one table it changed, and in it only the pieces that changed (patch.ts); React never
   diffs the thousands of nodes inside. Each table is a layer of its own (as the page composited v3's tables, and as the
   parity tools draw them), placed and scaled by its box: <div class="tw" data-i> (v3's .tw) holding its <svg>. A text box is a layer
   of its own too, so a drag can move it. */
import { memo, useLayoutEffect, useRef } from "react";
import type { StageLayer } from "@slide-builder/core/rpc/messages";
import { imageHref } from "./data";
import { drawChunks, type Drawn } from "./patch";

/** a piece of markup with the page's URL for each picture */
const withPictures = (svg: string) => svg.includes("sbimg:") ? svg.replace(/"sbimg:([^"]+)"/g, (_, id: string) => `"${imageHref(id) ?? ""}"`) : svg;
/** draws a layer's markup into its element when its key changes (a move or a resize changes the box only) */
function useMarkup(layer: StageLayer) {
  const ref = useRef<SVGSVGElement>(null), drawn = useRef<Drawn | null>(null);
  useLayoutEffect(() => { drawn.current = drawChunks(ref.current!, drawn.current, layer.svg, withPictures); }, [layer.key]);
  return ref;
}

export type Box = NonNullable<StageLayer["box"]>;
/** a table where its layer puts it; `to`: where a drag shows it (a resize) – reached by a CSS transform of the HTML box
    around the SVG: Chromium lays an SVG's text out again whenever the scale of the svg element's own transform changes
    (8–12 ms per table and frame, will-change or not), never for an ancestor's */
export const TableLayer = memo(function TableLayer({ layer, to, armed = false }: { layer: StageLayer; to: Box | null; armed?: boolean }) {
  const ref = useMarkup(layer), box = layer.box!;
  // will-change while it can move (armed: the pointer is on a corner handle, before a drag starts) and moves: the layer is
  // scaled, not rastered again, on every frame; it goes again after (the raster follows the zoom)
  const move = to && !sameBox(to, box) ? { transform: `translate3d(${to.x - box.x}px,${to.y - box.y}px,0) scale(${to.scale / box.scale})`, transformOrigin: "0 0" } : {};
  return <div aria-hidden="true" className="tw" data-i={layer.table!} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: "none", ...move, ...(armed || to ? { willChange: "transform" } : {}) }}>
    <svg ref={ref} viewBox={`0 0 ${box.w / box.scale} ${box.h / box.scale}`} width={box.w} height={box.h} style={{ display: "block", overflow: "visible" }} />
  </div>;
}, (a, b) => a.layer.key === b.layer.key && sameBox(a.layer.box, b.layer.box) && sameBox(a.to, b.to) && a.armed === b.armed);

/** furniture, text boxes and slide items: slide px; `dx`, `dy` move it (a text box or an item being dragged) */
export const PlainLayer = memo(function PlainLayer({ layer, dx = 0, dy = 0, hidden = false }: { layer: StageLayer; dx?: number; dy?: number; hidden?: boolean }) {
  const ref = useMarkup(layer);
  return <svg ref={ref} aria-hidden="true" className={layer.note ? "layer note" : layer.item ? "layer item" : "layer"} {...(layer.item ? { "data-item": layer.item } : {})} viewBox="0 0 1600 900" width={1600} height={900}
    style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", ...(dx || dy ? { transform: `translate(${dx}px,${dy}px)`, willChange: "transform" } : {}), ...(hidden ? { visibility: "hidden" } : {}) }} />;
}, (a, b) => a.layer.key === b.layer.key && a.dx === b.dx && a.dy === b.dy && a.hidden === b.hidden);

export const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.scale === b.scale);
