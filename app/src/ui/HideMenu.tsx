/* Ribbon 2 › Cells › Hide ▾ (S16.1, B36, docs/next/09 §3.6): Hide rows · Hide columns · Unhide all on this table – on
   this slide only (the same table on another slide keeps its rows); each one undo step (editor/hidden.ts). */
import { useStore } from "../state/store";
import { Dropdown } from "./Dropdown";
import { useCurSlide } from "./hooks";
import { hiddenCount, hideSel, hideTarget, unhideAll } from "../editor/hidden";
import { selTable } from "../editor/edit";

export function HideMenu() {
  const sel = useStore(s => s.selection.sel), R = useCurSlide();
  const T = sel ? selTable() : undefined, can = !!(T?.def && sel), n = hiddenCount(R, hideTarget());
  return (
    <Dropdown button={(_o, t) => <button className="tb" id="hideBtn" disabled={!can && !n} title="Hide the selected rows or columns on this slide only (every export closes them up; the workbook is not changed)" onClick={t}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="2.5" width="13" height="11" /><path d="M1.5 7h13M1.5 8.6h13" /></svg>Hide{n ? ` (${n})` : ""} ▾</button>}>
      {close => <>
        <button id="hideRows" disabled={!can} onClick={() => { close(); hideSel("r"); }}>Hide rows<small>The selected rows, on this slide only</small></button>
        <button id="hideCols" disabled={!can} onClick={() => { close(); hideSel("c"); }}>Hide columns<small>The selected columns, on this slide only</small></button>
        <button id="unhideAll" disabled={!n} onClick={() => { close(); unhideAll(); }}>Unhide all on this table<small>{n ? `${n} hidden on this slide` : "Nothing hidden"} – or click a double mark on the table</small></button>
      </>}
    </Dropdown>
  );
}
