/* The slide's pixels (PLAN S4.1, ADR-012): the display list's layers as SVG, in the slide's painting order. The core
   worker writes each layer's markup (core/dl/svg.ts); each layer here is one <svg> that takes it through a ref, memoised
   by its key – an edit swaps the one table it changed, and in it only the pieces that changed (patch.ts); React never
   diffs the thousands of nodes inside. Each table is a layer of its own (as the page composited v3's tables, and as the
   parity tools draw them), placed and scaled by its box: <svg class="tw" data-i> keeps v3's .tw. A text box is a layer
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
/** a table where its layer puts it; `to`: where a drag shows it (a resize) – reached by a CSS transform, so the SVG is
    not laid out again on every frame */
export const TableLayer = memo(function TableLayer({ layer, to }: { layer: StageLayer; to: Box | null }) {
  const ref = useMarkup(layer), box = layer.box!;
  const move = to && !sameBox(to, box) ? { transform: `translate3d(${to.x - box.x}px,${to.y - box.y}px,0) scale(${to.scale / box.scale})`, transformOrigin: "0 0" } : {};
  return <svg ref={ref} aria-hidden="true" className="tw" data-i={layer.table!} viewBox={`0 0 ${box.w / box.scale} ${box.h / box.scale}`} width={box.w} height={box.h}
    style={{ position: "absolute", left: box.x, top: box.y, overflow: "visible", pointerEvents: "none", ...move }} />;
}, (a, b) => a.layer.key === b.layer.key && sameBox(a.layer.box, b.layer.box) && sameBox(a.to, b.to));

/** furniture and text boxes: slide px; `dx`, `dy` move it (a text box being dragged) */
export const PlainLayer = memo(function PlainLayer({ layer, dx = 0, dy = 0 }: { layer: StageLayer; dx?: number; dy?: number }) {
  const ref = useMarkup(layer);
  return <svg ref={ref} aria-hidden="true" className={layer.note ? "layer note" : "layer"} viewBox="0 0 1600 900" width={1600} height={900}
    style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", ...(dx || dy ? { transform: `translate(${dx}px,${dy}px)` } : {}) }} />;
}, (a, b) => a.layer.key === b.layer.key && a.dx === b.dx && a.dy === b.dy);

export const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.scale === b.scale);
