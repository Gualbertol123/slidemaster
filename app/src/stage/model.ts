/* What the stage's overlays are made from (PLAN S4.1): the slide the worker drew (its layers) paired with the
   runtime slide the page mirrors. Pure, so the pairing is tested on its own.
   - tables: where each is drawn (its layer's box);
   - text boxes: every text box of the slide, empty ones too (the display list leaves those out; the stage shows
     them with their "Double-click to write" hint), each with the box it is drawn in – a drawn one paired with its
     layer in drawing order (the order slide-dl.ts draws them in: each table's, then the notes section);
   - furniture: every other element the display list has a hit for (title, subtitle, cover, contents, page number,
     footer, logo, bubbles…), in slide px, with its text and the style of its first run – the stage's text layer:
     transparent elements over the pixels that select, edit and read like v3's. */
import type { DisplayList, Matrix, TextNode } from "@slide-builder/core/dl/types";
import type { StageLayer, StageSlide } from "@slide-builder/core/rpc/messages";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { computeLayout, memoPart, noteParts, type NotePart } from "@slide-builder/core/render/slide";

export interface Rect { x: number; y: number; w: number; h: number }
export interface TablePlace { i: number; box: NonNullable<StageLayer["box"]> }
export interface NotePlace { part: NotePart; box: Rect; layer: StageLayer | null; /** the size its text was fitted to */ size: number | null }
export interface FurnitureHit extends Rect { id: string; label?: string; font?: { family: string; size: number; weight: number; italic: boolean } }
export interface StageModel { tables: TablePlace[]; notes: NotePlace[]; hits: FurnitureHit[] }

export function stageModel(shown: StageSlide, R: RuntimeSlide, c: RenderCtx): StageModel {
  const tables: TablePlace[] = shown.layers.flatMap(l => l.table !== null && l.box ? [{ i: l.table, box: l.box }] : []);
  const boxes = computeLayout(R, c).boxes, noteLayers = shown.layers.filter(l => l.note), notes: NotePlace[] = [];
  let k = 0;
  const add = (part: NotePart, nb: Rect | undefined) => {
    if (!nb) return;
    // drawn: non-empty (the display list draws what the PDF has)
    const layer = part.txt.trim() ? noteLayers[k++] ?? null : null;
    notes.push({ part, box: layer?.box ? { x: layer.box.x, y: layer.box.y, w: layer.box.w, h: layer.box.h } : { x: nb.x, y: nb.y, w: nb.w, h: nb.h }, layer, size: layer ? firstText(layer.nodes)?.size ?? null : null });
  };
  R.tables.forEach((_, i) => { for (const p of noteParts(R, i, c, { interactive: true })) add(p, boxes[i]?.notes[p.side]); });
  const memo = memoPart(R, c, { interactive: true });
  if (memo) add(memo, memo.box);
  const hits: FurnitureHit[] = [];
  for (const l of shown.layers) if (l.table === null && !l.note) collect(l.nodes, [1, 0, 0, 1, 0, 0], hits);
  return { tables, notes, hits };
}

const mul = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
/** the furniture's hits in slide px (the bounding box of a hit's corners after every transform), each with the first
    text node after it (until the next hit) */
function collect(nodes: DisplayList, M: Matrix, out: FurnitureHit[]) {
  for (const n of nodes) {
    if (n.t === "hit") {
      if (n.kind !== "f") continue;
      const pts = [[n.x, n.y], [n.x + n.w, n.y], [n.x, n.y + n.h], [n.x + n.w, n.y + n.h]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      out.push({ id: n.id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), ...(n.label !== undefined ? { label: n.label } : {}) });
    } else if (n.t === "text" && !n.decorative) {
      const last = out[out.length - 1];
      if (last && !last.font) last.font = { family: n.css || n.font, size: n.size * Math.hypot(M[0], M[1]), weight: n.weight ?? (n.b ? 700 : 400), italic: !!n.i };
    } else if (n.t === "group") collect(n.children, n.transform ? mul(M, n.transform) : M, out);
  }
}
export function firstText(nodes: DisplayList): TextNode | null {
  for (const n of nodes) {
    if (n.t === "text" && !n.decorative) return n;
    if (n.t === "group") { const t = firstText(n.children); if (t) return t; }
  }
  return null;
}
/** the slide text an element edits (data-edit), by its first class (v3's markup) */
export const EDIT_OF: Record<string, import("@slide-builder/core/model/types").SlideTextKey> = { title: "title", subtitle: "subtitle", "cv-title": "title", "cv-sub": "subtitle", "cv-kicker": "note", "cv-chip": "date", "cvx-date": "date" };
export const editOf = (id: string) => EDIT_OF[id.split(" ").find(c => c in EDIT_OF) || ""] ?? null;
