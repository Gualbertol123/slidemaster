/* What the keyboard, the toolbars and the stage's own handlers do on the slide (ported from v3's editor/stage.ts):
   open an editor, select, add, change or remove a text box, zoom. Everything that changes the document is an
   operation (state/app.ts change); the selection and the editor are store state that the stage draws. */
import { isLookText } from "../editor/look";
import { get, patch, patchAll, toast } from "../state/store";
import { change, setZoom } from "../state/app";
import type { Note, Op, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { MEMO_KEY } from "@slide-builder/core/render/layout";
import { activeItem, curSlide } from "../editor/edit";
import { editorClosed, setStage, stage } from "./data";

/** the zoom factor of the slide on screen */
export const slideScale = () => stage().scale;
export function zoomBy(f: number) { setZoom(Math.max(.2, Math.min(3, slideScale() * f))); }

/* ---- editors */
/** types into the active cell (F2, or a typed character that starts the text) */
export function openInline(initial?: string) {
  if (stage().editor || !get().selection.sel || !activeItem()) return;
  setStage({ editor: initial === undefined ? { kind: "cell" } : { kind: "cell", initial } });
}
/** edits the selected title, subtitle, cover note or date (Enter, F2) */
export function editSelectedText() {
  const key = get().selection.textSel;
  if (key && !isLookText(key) && !stage().editor && curSlide()) setStage({ editor: { kind: "text", key } });   // a look text is not edited
}
/** edits text box `key` (double-click, Enter) */
export function editNote(key: string) {
  if (stage().editor || !curSlide()) return;
  selectNote(key);
  setStage({ editor: { kind: "note", key } });
}
/** an editor closed: what changed meanwhile is drawn now (E8) */
export const closeEditor = () => editorClosed();

/* ---- text boxes */
export const slidePatch = (label: string, R: RuntimeSlide, p: Record<string, unknown>) => change(label, [{ op: "slide.patch", id: R.id, patch: p } as Op]);
/** the title of a slide New slide added (S13.4): opened for typing as soon as the stage shows that slide */
let pendingTitleEdit: string | null = null;
export function editTitleWhenShown(slideId: string | null) { pendingTitleEdit = slideId; }
export function takePendingTitle(slideId: string): boolean { if (pendingTitleEdit !== slideId) return false; pendingTitleEdit = null; return true; }
export const pendingTitle = () => pendingTitleEdit;
/** a text box added by the + button or "Notes" opens for typing as soon as the slide shows it */
let pendingNoteEdit: string | null = null;
export function takePendingNote(): string | null { const k = pendingNoteEdit; pendingNoteEdit = null; return k; }
export const pendingNote = () => pendingNoteEdit;
export const noteKeyOf = (R: RuntimeSlide, i: number, side: Side) => (R.tables[i].id || String(i)) + ":" + side;
/** the + button beside table i: a new text box on that side (or the one there, opened for typing) */
export function addNote(i: number, side: Side) {
  const R = curSlide(); if (!R) return;
  const key = noteKeyOf(R, i, side);
  pendingNoteEdit = key;
  if ((R.cfg.notes || {})[key]) { editNote(takePendingNote()!); return; }
  change("Add text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { text: "" } } } } as Op]);
}
/** adds the slide's notes section (where the footer is) and opens it for typing; selects it when it exists */
export function addSlideNotes() {
  const R = curSlide(); if (!R) return;
  if ((R.cfg.notes || {})[MEMO_KEY]) { selectNote(MEMO_KEY); return; }
  pendingNoteEdit = MEMO_KEY;
  change("Add notes", [{ op: "slide.patch", id: R.id, patch: { notes: { [MEMO_KEY]: { text: "", size: 13, color: "#5B6274" } } } } as Op]);
}
/** puts a moved text box back next to its table */
export function attachNote() {
  const R = curSlide(), key = get().selection.noteSel, cur = key && R?.cfg.notes?.[key]; if (!R || !key || !cur) return;
  const { x: _x, y: _y, ...rest } = cur;
  change("Text box back next to the table", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: rest } } } as Op]);
}
export function noteOf(key: string): Note | null { return (curSlide()?.cfg.notes || {})[key] || null; }
/** selects a text box (null: none) */
export function selectNote(key: string | null) {
  patch("selection", key ? { noteSel: key, sel: null, textSel: null, itemSel: null } : { noteSel: null });
}
export function patchNote(label: string, p: Partial<Note> | null) {
  const R = curSlide(), key = get().selection.noteSel; if (!R || !key) return;
  const cur = noteOf(key); if (!cur && p) return;
  change(label, [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: p === null ? null : { ...cur, ...p } } } } as Op]);
  if (p === null) patchAll({ selection: { noteSel: null } });
}
/** a text box's editor closed with `v` (`gen`: the automated comment's text it showed, null for written text) */
export function commitNote(R: RuntimeSlide, key: string, v: string, gen: string | null) {
  const cur = (R.cfg.notes || {})[key] || { text: "" };
  // an empty box that was never written is removed again
  if (!v.trim()) { change("Remove text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: null } } } as Op]); patch("selection", { noteSel: null }); return; }
  if (gen !== null) {
    if (v === gen) return;
    const { auto: _a, ...rest } = cur;
    change("Edit comment", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...rest, text: v } } } } as Op]);
    toast("The comment is now fixed text – it no longer follows the numbers. Use <b>Comment…</b> to write it automatically again.");
    return;
  }
  if (v !== cur.text) change("Edit text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { ...cur, text: v } } } } as Op]);
}
