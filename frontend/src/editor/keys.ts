/* Excel-like keyboard. */
import { S } from "../state/store";
import { DLG } from "../state/dialogs";
import { gotoSlide, undo } from "../state/app";
import { applySel, clearSel, clearText, moveSel, selectAll } from "./edit";
import { openInline } from "./stage";

export function installKeys() {
  document.addEventListener("keydown", e => {
    if (DLG.dialog || DLG.wizard || DLG.installer) return;
    const t = e.target as HTMLElement;
    const inField = t.matches("input,select,textarea");
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z" && !inField) { e.preventDefault(); undo(e.shiftKey); return; }
    if (mod && k === "y" && !inField) { e.preventDefault(); undo(true); return; }
    if (mod && k === "s") { e.preventDefault(); void S.sync?.flush(); return; }
    if (inField || !S.slides.length) return;
    if (e.key === "PageDown" || (e.key === "ArrowDown" && e.altKey)) { e.preventDefault(); gotoSlide(S.cur + 1); return; }
    if (e.key === "PageUp" || (e.key === "ArrowUp" && e.altKey)) { e.preventDefault(); gotoSlide(S.cur - 1); return; }
    if (!S.sel) return;
    if (mod && k === "b") { e.preventDefault(); const on = !boldAll(); applySel("Bold", ed => { ed.b = on; }); return; }
    if (mod && k === "i") { e.preventDefault(); const on = !italAll(); applySel("Italic", ed => { ed.i = on; }); return; }
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
import { selItems } from "./edit";
import { effFmt } from "../render/edits";
import { ctx } from "../state/app";
export const boldAll = () => { const its = selItems(); return its.length > 0 && its.every(x => effFmt(ctx(), x).b); };
export const italAll = () => { const its = selItems(); return its.length > 0 && its.every(x => effFmt(ctx(), x).i); };
