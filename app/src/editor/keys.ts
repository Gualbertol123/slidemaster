/* Excel-like keyboard. */
import { get } from "../state/store";
import { gotoSlide, undo } from "../state/app";
import { clearSel, clearText, moveSel, selectAll } from "./edit";
import { editSelectedText, openInline, patchNote, selectNote } from "./stage";
import { selectSlideText, toggleBold, toggleItalic } from "./textfmt";
import { stopPainter } from "./painter";

export function installKeys() {
  document.addEventListener("keydown", e => {
    const D = get().ui.dialogs;
    if (D.dialog || D.wizard || D.installer || D.tables || D.textStyles || D.comment) return;
    const t = e.target as HTMLElement;
    const inField = t.matches("input,select,textarea");
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z" && !inField) { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && k === "y" && !inField) { e.preventDefault(); undo(true); return; }
    if (mod && k === "s") { e.preventDefault(); void get().doc.sync?.flush(); return; }
    if (inField || !get().deck.slides.length) return;
    if (e.key === "Escape" && get().selection.painter) { stopPainter(); return; }
    if (e.key === "PageDown" || (e.key === "ArrowDown" && e.altKey)) { e.preventDefault(); gotoSlide(get().deck.cur + 1); return; }
    if (e.key === "PageUp" || (e.key === "ArrowUp" && e.altKey)) { e.preventDefault(); gotoSlide(get().deck.cur - 1); return; }
    if ((get().selection.noteSel || get().selection.textSel) && !get().selection.sel) {
      if (mod && k === "b") { e.preventDefault(); toggleBold(); return; }
      if (mod && k === "i") { e.preventDefault(); toggleItalic(); return; }
      if (get().selection.textSel) {
        if (e.key === "Escape") { selectSlideText(null); return; }
        if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); editSelectedText(); }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); patchNote("Remove text box", null); return; }
      if (e.key === "Escape") { selectNote(null); return; }
      if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); document.querySelector<HTMLElement>(`#stage .tnote[data-note="${CSS.escape(get().selection.noteSel!)}"]`)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return; }
      return;
    }
    if (!get().selection.sel) return;
    if (mod && k === "b") { e.preventDefault(); toggleBold(); return; }
    if (mod && k === "i") { e.preventDefault(); toggleItalic(); return; }
    if (mod && k === "a") { e.preventDefault(); selectAll(); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); moveSel(arrows[e.key][0], arrows[e.key][1], e.shiftKey); return; }
    if (e.key === "Tab") { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, false); return; }
    if (e.key === "Enter") { e.preventDefault(); moveSel(e.shiftKey ? -1 : 1, 0, false); return; }
    if (e.key === "F2") { e.preventDefault(); openInline(); return; }
    if (e.key === "Escape") { clearSel(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearText(); return; }
    if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); openInline(e.key); }
  });
}
