/* The editors that open on the slide (PLAN S4.1; v3's inline editing): a cell (F2, typing, double-click), a slide
   text – title, subtitle, cover note or date – (double-click, Enter) and a text box (double-click, Enter, a new
   box). Each is placed over what it edits, in screen px inside .stagewrap, and closes on Enter / Escape / leaving
   it; while one is open the slide is not redrawn under it (E8, data.ts). */
import { slideCtx } from "@slide-builder/core/render/look";
import { useLayoutEffect, useRef } from "react";
import { get } from "../state/store";
import { ctx } from "../state/app";
import { effFmt, effText } from "@slide-builder/core/render/edits";
import { todayLabel } from "@slide-builder/core/render/cover";
import { commentText } from "@slide-builder/core/render/comment";
import type { SlideTextKey } from "@slide-builder/core/model/types";
import { activeItem, commitText, curSlide } from "../editor/edit";
import { closeEditor, commitNote, slidePatch } from "./actions";
import { itemPatch } from "../editor/charts";
import { cellBox } from "./hit";
import { exhibitOf } from "@slide-builder/core/render/exhibit";
import { editOf, type StageModel } from "./model";

/** how an editor ends: commit (with a move of the selection for a cell) or cancel; once */
function useFinish(done: (ok: boolean, move?: [number, number]) => void) {
  const over = useRef(false);
  return (ok: boolean, move?: [number, number]) => { if (over.current) return; over.current = true; done(ok, move); closeEditor(); };
}
const focusAll = (el: HTMLInputElement | HTMLTextAreaElement | null, select: boolean) => {
  if (!el) return;
  el.focus();
  if (select) el.select(); else el.setSelectionRange(el.value.length, el.value.length);
};

export function CellEditor({ m, s, initial }: { m: StageModel; s: number; initial?: string }) {
  const ref = useRef<HTMLInputElement>(null), sel = get().selection.sel, it = activeItem(), R0 = curSlide(), c = R0 ? slideCtx(ctx(), R0) : ctx();
  const place = sel ? m.tables.find(t => t.i === sel.t) : null;
  const finish = useFinish((ok, move) => { if (ok) commitText(ref.current!.value, move); });
  useLayoutEffect(() => focusAll(ref.current, initial === undefined), [initial]);
  if (!it || !place) return null;
  // a cell the exhibit does not draw: edited where its row's label is, else at the table's top left
  const g = cellBox(it, c) || cellBox({ ...it, b: { ...it.b, c: it.L ? exhibitOf(it.L, c).labelCol : it.b.c, c2: it.b.c2 } }, c) || { ...it, bx: 0, by: 0, bw: 120, bh: 24 }, b = place.box, k = b.scale * s;
  const left = (b.x + g.bx * b.scale) * s, top = (b.y + g.by * b.scale) * s, w = g.bw * k, h = g.bh * k;
  const fpx = (effFmt(c, it).sz * 96 / 72) * k;
  return <input ref={ref} className="inline-edit" defaultValue={initial !== undefined ? initial : effText(c, it)}
    style={{ left: left - 2, top: top - 2, width: Math.max(120, w + 4), height: Math.max(26, h + 4), fontSize: Math.max(12, fpx), textAlign: it.align === "right" ? "right" : it.align === "center" ? "center" : "left" }}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true, [e.shiftKey ? -1 : 1, 0]); }
      else if (e.key === "Tab") { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); }
      else if (e.key === "Escape") finish(false);
    }} onBlur={() => finish(true)} />;
}

const TEXT_LABEL: Record<SlideTextKey, string> = { title: "Edit title", subtitle: "Edit subtitle", note: "Edit cover note", date: "Edit date" };
export function TextEditor({ m, s, k }: { m: StageModel; s: number; k: SlideTextKey }) {
  const ref = useRef<HTMLInputElement>(null), R = curSlide();
  const finish = useFinish(ok => { const v = ref.current!.value.trim(); if (ok && R) slidePatch(TEXT_LABEL[k], R, { [k]: v || null }); });
  useLayoutEffect(() => focusAll(ref.current, true), []);
  const hit = m.hits.find(h => editOf(h.id) === k);
  if (!R || !hit) return null;
  const value = k === "title" ? R.title : k === "subtitle" ? (R.subtitle || "") : k === "date" ? (R.cfg.date || todayLabel()) : (R.cfg.note || "");
  const f = hit.font;
  return <input ref={ref} className="inline-edit" defaultValue={value}
    style={{ left: hit.x * s - 4, top: hit.y * s - 4, width: Math.max(320, hit.w * s + 40), height: Math.max(28, hit.h * s + 8),
      fontSize: Math.max(14, (f?.size ?? 16) * s), fontWeight: f?.weight, fontStyle: f?.italic ? "italic" : undefined, fontFamily: f?.family }}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); }} onBlur={() => finish(true)} />;
}

/** a callout's text (S9.4): {Sheet!C7} quotes a cell; Ctrl+Enter or leaving it applies, Esc cancels */
export function ItemEditor({ m, s, id }: { m: StageModel; s: number; id: string }) {
  const ref = useRef<HTMLTextAreaElement>(null), R = curSlide(), it = R?.cfg.items?.[id];
  const finish = useFinish(ok => { if (ok && R && it?.kind === "shape" && ref.current!.value !== (it.text || "")) itemPatch("Callout text", id, { text: ref.current!.value || null }); });
  useLayoutEffect(() => focusAll(ref.current, true), []);
  const place = m.items.find(p => p.id === id);
  if (!R || !place || it?.kind !== "shape") return null;
  const b = place.box;
  return <textarea ref={ref} className="inline-edit note-edit" id="itemEdit" defaultValue={it.text || ""} placeholder="Text – {Sheet!C7} quotes a cell"
    style={{ left: b.x * s - 2, top: b.y * s - 2, width: Math.max(200, b.w * s + 4), height: Math.max(48, b.h * s + 4), fontSize: Math.max(12, (it.fmt?.size || 18) * s), textAlign: (it.fmt?.align || "center") as "left" }}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") finish(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true); }} onBlur={() => finish(true)} />;
}

export function NoteEditor({ m, s, k }: { m: StageModel; s: number; k: string }) {
  const ref = useRef<HTMLTextAreaElement>(null), R = curSlide(), c = ctx();
  const place = m.notes.find(n => n.part.key === k), cur = (R?.cfg.notes || {})[k] || { text: "" };
  // an automated comment shows its current text; changing it turns it into fixed text
  const T = place && place.part.i >= 0 ? R?.tables[place.part.i] : undefined, gen = cur.auto && T && R ? commentText(T, cur.auto, c, R) : null;
  const finish = useFinish(ok => { if (ok && R) commitNote(R, k, ref.current!.value, gen); });
  useLayoutEffect(() => focusAll(ref.current, gen === null), [gen]);
  if (!R || !place) return null;
  const b = place.box, n = place.part.n;
  return <textarea ref={ref} className="inline-edit note-edit" defaultValue={gen ?? (cur.text || "")}
    style={{ left: b.x * s - 2, top: b.y * s - 2, width: Math.max(160, b.w * s + 4), height: Math.max(48, b.h * s + 4),
      fontSize: Math.max(12, (place.size ?? (n.size || (place.part.memo ? 13 : 18))) * s), textAlign: (n.align || (place.part.side === "left" ? "right" : "left")) as "left" }}
    onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") finish(false); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true); }} onBlur={() => finish(true)} />;
}
