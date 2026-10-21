/* The stage (PLAN S4.1, Part B §1, ADR-012): the slide on screen, drawn from its display list, with the editing
   overlays above it. React places the pixels (SlideSvg.tsx: one memoised SVG layer per table, text box and run of
   furniture) and draws the overlays as ordinary components:
   - the text layer: a transparent element for each element of the slide (title, subtitle, cover, contents, page
     number, footer, logo, text boxes, bubbles) – what is selected, double-clicked and read, with v3's classes;
   - per table its hit area (.hits: the cell under the pointer, hover, border drags) and its handles (.hbox: grip,
     corner, borders, + buttons);
   - the selection, the drop mark, the snapping guides, the size guides;
   - the editor open on the slide (editors.tsx).
   Element ids, classes and data-* are v3's, so tests and the toolbars find the same things. */
import { isLookText } from "../editor/look";
import { slideCtx } from "@slide-builder/core/render/look";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { get, patch, STAGE, useStore } from "../state/store";
import { ctx, pendingTitle, takePendingTitle } from "../state/app";
import type { RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { slideFrame } from "@slide-builder/core/render/slide";
import { freeOf, tableH, tableW } from "@slide-builder/core/render/layout";
import { tableName } from "@slide-builder/core/model/preset";
import { hiddenIn } from "@slide-builder/core/render/pagenumbers";
import { DESIGN_LABEL } from "@slide-builder/core/model/designs";
import type { RenderCtx } from "@slide-builder/core/render/context";
import { selItems, activeItem, setSel, curSlide } from "../editor/edit";
import { setColWidth, setRowHeight } from "../editor/tables";
import { applyPainter } from "../editor/painter";
import { selectSlideText } from "../editor/textfmt";
import { setStage, useStage } from "./data";
import { addNote, editNote, openInline, pendingNote, selectNote, takePendingNote } from "./actions";
import { borderAt, cellBox, cellFromPoint, tablePoint } from "./hit";
import { borderDrag, freeTable, gripDrag, noteEdge, noteMove, noteStretch, resizeDrag, stretchDrag, type DragPreview } from "./drags";
import { editOf, stageModel, type NotePlace, type Rect, type StageModel } from "./model";
import { PlainLayer, TableLayer, type Box } from "./SlideSvg";
import { CellEditor, ItemEditor, NoteEditor, TextEditor } from "./editors";
import { Items } from "./items";

const SIDES: Side[] = ["top", "bottom", "left", "right"];

/** the stage's frame: fits the slide into the space (or shows it at the chosen zoom) */
export function Stage() {
  const host = useRef<HTMLDivElement>(null);
  const zoom = useStore(s => s.ui.zoom), fitTick = useStage(s => s.fitTick);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const el = host.current!, measure = () => setSize(z => z[0] === el.clientWidth && z[1] === el.clientHeight ? z : [el.clientWidth, el.clientHeight]);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure); ro?.observe(el);
    addEventListener("resize", measure);
    return () => { ro?.disconnect(); removeEventListener("resize", measure); };
  }, [fitTick]);
  const [cw, ch] = size, fit = Math.min((cw - 56) / 1600, (ch - 64) / 900), s = zoom === "fit" ? (fit > 0 ? fit : 1) : zoom;
  useEffect(() => { if (useStage.getState().scale !== s) setStage({ scale: s }); }, [s]);
  return (
    <div id="stage" ref={host} style={{ position: "absolute", inset: "0", overflow: zoom === "fit" ? "hidden" : "auto" }}>
      <Wrap s={s} left={Math.max(16, (cw - 1600 * s) / 2)} top={Math.max(16, (ch - 900 * s) / 2)} />
      <PainterCursor />
    </div>
  );
}
STAGE.fit = () => setStage({ fitTick: useStage.getState().fitTick + 1 });

const Wrap = memo(function Wrap({ s, left, top }: { s: number; left: number; top: number }) {
  // a border drag's preview is drawn by its table's hit area alone (TableHits): not a reason to draw the rest again
  const shown = useStage(st => st.shown), drag = useStage(st => st.drag?.kind === "border" ? null : st.drag), editor = useStage(st => st.editor), armed = useStage(st => st.armed);
  // the slide the stage shows – while another one is on its way (a slide switch) the stage keeps showing it, so nothing
  // flashes empty – and the render context as it is when that changes: the mirror alone changing (an edit before the
  // worker draws it) redraws nothing here
  const slides = useStore(st => st.deck.slides), c0 = ctx();
  const R = shown ? slides.find(x => x.id === shown.id) ?? null : null;
  const c = R ? slideCtx(c0, R) : c0;                         // the slide's own look (B29): its tables' geometry
  const slideRef = useRef<HTMLDivElement>(null);
  const live = shown && R ? shown : null;
  const m = useMemo(() => live && R ? stageModel(live, R, c) : null, [live, R]);
  // a text box just added opens for typing as soon as it is on the slide
  useEffect(() => { const k = pendingNote(); if (k && m?.notes.some(n => n.part.key === k)) { takePendingNote(); editNote(k); } }, [m]);
  // the title of a slide New slide added opens for typing as soon as the stage shows it
  useEffect(() => {
    if (live && pendingTitle() === live.id && m?.hits.some(h => editOf(h.id) === "title") && !useStage.getState().editor && takePendingTitle(live.id)) {
      selectSlideText("title"); setStage({ editor: { kind: "text", key: "title" } });
    }
  }, [m]);
  if (!live || !R || !m) return null;
  const frame = slideFrame(R, c), vars = Object.fromEntries(frame.vars);
  return (
    <div className="stagewrap" style={{ left, top, width: 1600 * s, height: 900 * s }}>
      <div ref={slideRef} className={frame.className} style={{ transform: `scale(${s})`, ...vars }}
        onPointerDown={e => {
          // a click on the empty slide clears every selection
          if ((e.target as Element).closest(".hits,.tnote,.hbox,.itembox,[data-edit]")) return;
          const { sel, noteSel, textSel, itemSel } = get().selection;
          if (sel || noteSel || textSel || itemSel) patch("selection", { sel: null, textSel: null, noteSel: null, itemSel: null });
        }}>
        <Layers m={m} layers={live.layers} drag={drag} armed={armed} />
        <div className="ovl">
          <TextLayer hits={m.hits} />
          <Notes m={m} R={R} drag={drag} freeLayout={!!freeOf(R, c)} />
          <Items m={m} R={R} drag={drag} free={!!freeOf(R, c)} />
          {m.tables.map(t => <TableHits key={t.i} i={t.i} R={R} c={c} box={boxOf(t.i, t.box, drag)} s={s} />)}
          {m.tables.map(t => <HBox key={t.i} i={t.i} R={R} c={c} m={m} box={boxOf(t.i, t.box, drag)} drag={drag} slide={slideRef} />)}
          <Selection m={m} s={s} drag={drag} />
          <Guides drag={drag} s={s} />
          {R.type === "content" && !R.tables.length && <div className="emptyslide">No tables on this slide – Add table (Insert) puts one here.</div>}
        </div>
      </div>
      {/* a slide hidden in this design (S13.6): still drawn and edited here, marked (DOM, never exported) */}
      {hiddenIn(R.cfg, c0.style.design) && <div className="stagehid" id="stageHidden">Hidden in {DESIGN_LABEL[c0.style.design]} – not exported</div>}
      {editor?.kind === "cell" && <CellEditor m={m} s={s} initial={editor.initial} />}
      {editor?.kind === "text" && <TextEditor m={m} s={s} k={editor.key} />}
      {editor?.kind === "note" && <NoteEditor m={m} s={s} k={editor.key} />}
      {editor?.kind === "item" && <ItemEditor m={m} s={s} id={editor.id} />}
    </div>
  );
});

/** a table's box: where it is drawn, or where a resize drag shows it */
function boxOf(i: number, box: Box, drag: DragPreview | null): Box {
  if (drag?.kind !== "resize") return box;
  const b = drag.boxes[i]; return b ? { x: b.x, y: b.y, w: b.w, h: b.h, scale: b.scale } : box;
}

/* ---- the pixels, in painting order */
function Layers({ m, layers, drag, armed }: { m: StageModel; layers: import("@slide-builder/core/rpc/messages").StageLayer[]; drag: DragPreview | null; armed: boolean }) {
  let f = 0, nk = 0;
  return <>{layers.map(l => {
    if (l.table !== null && l.box) return <TableLayer key={"t" + l.table} layer={l} to={drag?.kind === "resize" ? boxOf(l.table, l.box, drag) : null} armed={armed} />;
    if (l.item) {
      // a slide item: shifted while it is dragged (its new place is drawn on the drop)
      const d = drag?.kind === "item" && drag.id === l.item && drag.moved && l.box ? drag : null;
      return <PlainLayer key={"i" + l.item} layer={l} dx={d ? d.box.x - l.box!.x : 0} dy={d ? d.box.y - l.box!.y : 0} />;
    }
    if (l.note) {
      const k = nk++, place = m.notes.find(n => n.layer === l), [dx, dy] = place ? noteShift(place, drag) : [0, 0];
      // a text box being stretched shows its text itself (Notes), until the slide drawn with the change replaces the drop's preview
      const hidden = !!place && drag?.kind === "note" && drag.key === place.part.key && !drag.moved && !!place.look && !!place.part.txt.trim();
      return <PlainLayer key={"n" + k} layer={l} dx={dx} dy={dy} hidden={hidden} />;
    }
    const k = f++;
    return <PlainLayer key={"f" + k} layer={l} />;
  })}</>;
}
/** how far a drag moves a text box: dragged itself, or beside a table being resized */
function noteShift(p: NotePlace, drag: DragPreview | null): [number, number] {
  if (drag?.kind === "note" && drag.key === p.part.key && drag.moved) return [drag.box.x - p.box.x, drag.box.y - p.box.y];
  if (drag?.kind === "resize" && p.part.i >= 0) { const nb = drag.boxes[p.part.i]?.notes[p.part.side]; if (nb && !p.part.memo) return [nb.x - p.box.x, nb.y - p.box.y]; }
  return [0, 0];
}

/* ---- the text layer: furniture */
const TextLayer = memo(function TextLayer({ hits }: { hits: StageModel["hits"] }) {
  const textSel = useStore(s => s.selection.textSel);
  return <>{hits.map((h, k) => {
    const key = editOf(h.id), f = h.font;
    return <div key={k} className={"tx " + h.id + (key && key === textSel ? " tsel" : "")} {...(key ? { "data-edit": key } : {})}
      style={{ left: h.x, top: h.y, width: h.w, height: h.h, ...(f ? { fontFamily: f.family, fontSize: f.size, fontWeight: f.weight, fontStyle: f.italic ? "italic" : undefined } : {}) }}
      onPointerDown={key ? e => { e.stopPropagation(); selectSlideText(key); } : undefined}
      onDoubleClick={key && !isLookText(key) ? () => setStage({ editor: { kind: "text", key } }) : undefined}>{h.label}</div>;
  })}</>;
}, (a, b) => a.hits === b.hits || a.hits.length === b.hits.length && a.hits.every((h, i) => JSON.stringify(h) === JSON.stringify(b.hits[i])));   // the furniture as it was: nothing to draw

/* ---- text boxes: the box to select, move, stretch and double-click; its bubble; the hint of an empty one */
function Notes({ m, R, drag, freeLayout }: { m: StageModel; R: RuntimeSlide; drag: DragPreview | null; freeLayout: boolean }) {
  const noteSel = useStore(s => s.selection.noteSel);
  const others = (self: string) => [...m.notes.filter(n => n.part.key !== self).map(n => n.box), ...m.hits.filter(h => /^pageno\b|^footer\b/.test(h.id)), ...m.items.map(p => p.box)];
  return <>{m.notes.map(p => {
    const key = p.part.key, d = drag?.kind === "note" && drag.key === key ? drag : null, b = d ? d.box : resized(p, drag);
    // a free layout (B18): every text box but the notes section has its own box, stretched by any edge
    const free = p.part.cls.includes(" free") || freeLayout && !p.part.memo, empty = !p.part.txt.trim();
    // being stretched: the box shows its text itself (the page re-wraps it as the box changes); the drawn layer waits –
    // after the drop too, until the slide drawn with the new size arrives (else the old wrap shows for a moment)
    const live = !!d && !d.moved && !empty && p.look ? p.look : null;
    const label = p.layer ? p.layer.nodes.find(n => n.t === "hit" && /^tnote\b/.test(n.id)) : null;
    return [
      p.part.bubble && !empty ? <div key={key + "|b"} className={p.part.bubble.cls + (live ? " live" : "")} data-i={p.part.i} data-side={p.part.side} style={{ left: b.x, top: b.y, width: b.w, height: b.h }} /> : null,
      <div key={key} className={p.part.cls + (noteSel === key ? " sel" : "") + (d?.moved ? " moving" : "") + (live ? " live" : "")} data-note={key} data-i={p.part.i} data-side={p.part.side}
        style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...(empty ? { justifyContent: p.part.side === "top" ? "flex-end" : "flex-start", fontSize: p.part.n.size || (p.part.memo ? 13 : 18) } : {}),
          ...(live ? { color: live.color, fontFamily: live.family, fontWeight: live.weight, fontStyle: live.italic ? "italic" : undefined, fontSize: p.size ?? p.part.n.size ?? 18, textAlign: (p.part.n.align || (p.part.side === "left" ? "right" : "left")) as "left" } : {}) }}
        onPointerMove={e => { if (!(e.buttons & 1)) { const ed = noteEdge(e.currentTarget, e.nativeEvent, free, p.part.side); e.currentTarget.style.cursor = ed ? (ed === "l" || ed === "r" ? "ew-resize" : "ns-resize") : ""; } }}
        onPointerDown={e => {
          e.stopPropagation(); selectNote(key);
          const ed = noteEdge(e.currentTarget, e.nativeEvent, free, p.part.side);
          if (ed) { e.preventDefault(); noteStretch(R, key, p.box, ed, free, others(key), e.nativeEvent); } else noteMove(R, key, p.box, others(key), e.nativeEvent);
        }}
        onDoubleClick={e => { e.stopPropagation(); editNote(key); }}>
        {empty ? (p.part.memo ? "Notes – double-click to write" : "Double-click to write") : label && label.t === "hit" ? label.label : p.part.txt}
      </div>,
    ];
  })}</>;
}
/** a text box beside a table being resized moves with it */
function resized(p: NotePlace, drag: DragPreview | null): Rect {
  if (drag?.kind === "resize" && p.part.i >= 0 && !p.part.memo) { const nb = drag.boxes[p.part.i]?.notes[p.part.side]; if (nb) return nb; }
  return p.box;
}

/* ---- a table's hit area: select cells (click, Shift+click, drag), hover, column / row borders */
let cellDrag: { t: number } | null = null;
addEventListener("pointerup", () => { const was = cellDrag; cellDrag = null; if (was && get().selection.painter) applyPainter(); });
const TableHits = memo(function TableHits({ i, R, c, box, s }: { i: number; R: RuntimeSlide; c: RenderCtx; box: Box; s: number }) {
  const T = R.tables[i], hov = useRef<HTMLDivElement>(null), border = useStage(st => st.drag?.kind === "border" && st.drag.t === i ? st.drag : null);
  const last = useRef(0);
  if (!T) return null;
  const W = tableW(T, c);
  return (
    <div className="hits" data-t={i} style={{ left: box.x, top: box.y, width: W, height: tableH(T, c), transform: `scale(${box.scale})`, transformOrigin: "0 0" }}
      onPointerDown={e => {
        const h = e.currentTarget, { lx, ly, k } = tablePoint(h, T, c, e);
        const edge = borderAt(T, c, lx, ly, k);
        if (edge) { e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId); borderDrag(i, e.nativeEvent, edge, k); return; }
        const it = cellFromPoint(T, c, lx, ly); if (!it) return;
        e.preventDefault(); (document.getElementById("fxInput") as HTMLInputElement | null)?.blur();
        const cell = { r: it.b.r, c: it.b.c }, cur = get().selection.sel;
        if (e.shiftKey && cur && cur.t === i) setSel(i, cur.anchor, cell); else setSel(i, cell, cell);
        cellDrag = { t: i };
      }}
      onPointerMove={e => {
        const now = performance.now(); if (now - last.current < 16 && !(cellDrag && (e.buttons & 1))) return; last.current = now;
        const h = e.currentTarget, { lx, ly, k } = tablePoint(h, T, c, e);
        if (!(e.buttons & 1)) { const ed = borderAt(T, c, lx, ly, k); h.style.cursor = ed ? (ed.kind === "col" ? "col-resize" : "row-resize") : ""; }
        const it = cellFromPoint(T, c, lx, ly); if (!it) return;
        const g = cellBox(it, c); if (!g) return;
        Object.assign(hov.current!.style, { display: "block", left: g.bx + "px", top: g.by + "px", width: g.bw + "px", height: g.bh + "px" });
        const cur = get().selection.sel;
        if (cellDrag && (e.buttons & 1) && cellDrag.t === i && cur && (cur.ar !== it.b.r || cur.ac !== it.b.c)) setSel(i, cur.anchor, { r: it.b.r, c: it.b.c });
      }}
      onPointerLeave={() => { if (hov.current) hov.current.style.display = "none"; }}
      onDoubleClick={e => {
        const { lx, ly, k } = tablePoint(e.currentTarget, T, c, e), ed = borderAt(T, c, lx, ly, k);
        // double-click on a border: back to the Excel size
        if (ed) { if (ed.kind === "col") setColWidth(T, [ed.key], null, "Column width: Excel"); else setRowHeight(T, [ed.key], null, "Row height: Excel"); return; }
        openInline();
      }}>
      <div className="hov" ref={hov} />
      {border && <SizeGuide d={border} T={T} c={c} inv={1 / (box.scale * s)} />}
    </div>
  );
});
function SizeGuide({ d, T, c, inv }: { d: Extract<DragPreview, { kind: "border" }>; T: RuntimeSlide["tables"][number]; c: RenderCtx; inv: number }) {
  const p = d.edge.start + d.size, col = d.edge.kind === "col";
  return <>
    <div className={"sizeguide " + d.edge.kind} style={col ? { left: p, top: 0, height: tableH(T, c), width: 2 * inv } : { top: p, left: 0, width: tableW(T, c), height: 2 * inv }} />
    <div className="sizetip" style={{ ...(col ? { left: p + 6 * inv, top: 0 } : { left: 0, top: p + 6 * inv }), fontSize: 12 * inv, padding: `${2 * inv}px ${6 * inv}px`, borderRadius: 4 * inv }}>{Math.round(d.size)} px</div>
  </>;
}

/* ---- a table's handles: grip (move), corner (resize), borders (stretch), + buttons (text boxes); in a free layout (B18)
   the grip moves the table anywhere, the corner and the borders scale it (its proportions kept) */
function HBox({ i, R, c, m, box, drag, slide }: { i: number; R: RuntimeSlide; c: RenderCtx; m: StageModel; box: Box; drag: DragPreview | null; slide: React.RefObject<HTMLDivElement | null> }) {
  const T = R.tables[i]; if (!T) return null;
  const free = !!freeOf(R, c);
  const st = drag?.kind === "stretch" && drag.i === i ? drag : null, b = st ? st.box : box, active = !!st || ((drag?.kind === "resize" || drag?.kind === "grip") && drag.i === i);
  // handles move outwards past the table's own text boxes (not past boxes placed elsewhere on the slide – in a free layout
  // every box is placed on its own)
  const n: Partial<Record<Side, Rect>> = {};
  if (!free) for (const p of m.notes) if (p.part.i === i && !p.part.memo && !p.part.cls.includes(" free")) n[p.part.side] = p.box;
  const vars = { "--nt": (n.top ? b.y - n.top.y : 0) + "px", "--nb": (n.bottom ? n.bottom.y + n.bottom.h - b.y - b.h : 0) + "px", "--nl": (n.left ? b.x - n.left.x : 0) + "px", "--nr": (n.right ? n.right.x + n.right.w - b.x - b.w : 0) + "px" } as React.CSSProperties;
  return (
    <div className={"hbox" + (active ? " active" : "") + (free ? " free" : "")} data-i={i} style={{ left: b.x, top: b.y, width: b.w, height: b.h, ...vars }}>
      <div className="grip" title={free ? "Drag to move this table anywhere (Alt: no snapping)" : "Drag to move this table"} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); if (free) freeTable(R, i, "move", e.nativeEvent); else gripDrag(R, i, e.nativeEvent, slide.current!); }}>⠿ {tableName(T, c.preset)}</div>
      <div className="size" title="Drag to resize (keeps the proportions)" onPointerEnter={() => setStage({ armed: true })} onPointerLeave={() => { const d = useStage.getState().drag; if (d?.kind !== "resize" || d.done) setStage({ armed: false }); }} onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); if (free) freeTable(R, i, "corner", e.nativeEvent); else resizeDrag(R, i, e.nativeEvent); }} />
      {(["l", "r", "t", "b"] as const).map(ed => <div key={ed} className={"edge " + ed} data-edge={ed} title={free ? "Drag to make the table larger or smaller (its proportions kept)" : `Drag to make the table ${ed === "l" || ed === "r" ? "wider or narrower" : "taller or shorter"}`}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (free) { e.currentTarget.setPointerCapture(e.pointerId); freeTable(R, i, ed, e.nativeEvent); } else stretchDrag(R, i, ed, e.nativeEvent); }} />)}
      {st && <div className="edgetip">{Math.round(st.f * 100)} %</div>}
      {SIDES.map(sd => <button key={sd} className={"addnote " + sd} data-side={sd} title={`Add a text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd}`}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); addNote(i, sd); }}>+</button>)}
    </div>
  );
}

/* ---- the selection: the selected cells and the active one, in slide px */
function Selection({ m, s, drag }: { m: StageModel; s: number; drag: DragPreview | null }) {
  const sel = useStore(st => st.selection.sel), R = curSlide(), c = R ? slideCtx(ctx(), R) : ctx();
  if (!sel) return null;
  const place = m.tables.find(t => t.i === sel.t); if (!place) return null;
  const b = boxOf(sel.t, place.box, drag), its = selItems().map(it => cellBox(it, c)).filter((x): x is NonNullable<typeof x> => !!x); if (!its.length) return null;
  const x0 = Math.min(...its.map(a => a.bx)), y0 = Math.min(...its.map(a => a.by)), x1 = Math.max(...its.map(a => a.bx + a.bw)), y1 = Math.max(...its.map(a => a.by + a.bh));
  const at = (x: number, y: number, w: number, h: number) => ({ left: b.x + x * b.scale, top: b.y + y * b.scale, width: w * b.scale, height: h * b.scale });
  const a0 = activeItem(), a = a0 && cellBox(a0, c);
  return <>
    {its.length > 1 && <div className="selbox" style={{ ...at(x0, y0, x1 - x0, y1 - y0), boxShadow: `inset 0 0 0 ${1.5 / s}px rgba(10,102,216,.9)` }} />}
    {a && <div className="actbox" style={{ ...at(a.bx, a.by, a.bw, a.bh), boxShadow: `inset 0 0 0 ${2.5 / s}px #0A66D8,0 0 0 ${1 / s}px rgba(255,255,255,.9)` }} />}
  </>;
}

/* ---- guides: where a table will go (grip), what a text box lines up with */
function Guides({ drag, s }: { drag: DragPreview | null; s: number }) {
  if (drag?.kind === "grip") return <div className="dropmark" style={drag.mark ? { display: "block", left: drag.mark.x, top: drag.mark.y, width: drag.mark.w, height: drag.mark.h } : undefined} />;
  if (drag?.kind === "resize" && !drag.done && (drag.v != null || drag.h != null)) return <>
    {drag.v != null && <div className="snapline v" style={{ display: "block", left: drag.v, width: 1.5 / Math.min(1, s) }} />}
    {drag.h != null && <div className="snapline h" style={{ display: "block", top: drag.h, height: 1.5 / Math.min(1, s) }} />}
  </>;
  if ((drag?.kind === "note" || drag?.kind === "item") && !drag.done) return <>
    {drag.kind === "item" && !drag.moved && <div className="itemguide" style={{ left: drag.box.x, top: drag.box.y, width: drag.box.w, height: drag.box.h }} />}
    {drag.v !== null && <div className="snapline v" style={{ display: "block", left: drag.v, width: 1.5 / Math.min(1, s) }} />}
    {drag.h !== null && <div className="snapline h" style={{ display: "block", top: drag.h, height: 1.5 / Math.min(1, s) }} />}
  </>;
  return <div className="dropmark" />;
}

/** the format painter's cursor on the page */
function PainterCursor() {
  const on = useStore(s => !!s.selection.painter);
  useEffect(() => { document.body.classList.toggle("painting", on); }, [on]);
  return null;
}
