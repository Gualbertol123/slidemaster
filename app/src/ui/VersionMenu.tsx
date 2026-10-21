/* Ribbon 2 › Cells › For this version ▾ (S16.2, B37, docs/next/09 §3.7): Delete rows · Delete columns · Empty cells ·
   Restore selection · Restore all of "<version>" – for the version chosen in the top bar only; each one undo step
   (editor/versions.ts). Disabled with the full deck shown. */
import { useStore } from "../state/store";
import { Dropdown } from "./Dropdown";
import { forVersion } from "../editor/versions";
import { selCols, selRows } from "../editor/tables";
import { dropCount, versionOf } from "@slide-builder/core/model/versions";

export function VersionMenu() {
  const sel = useStore(s => s.selection.sel), vid = useStore(s => s.deck.version), preset = useStore(s => s.doc.view?.preset);
  useStore(s => s.deck.slides);                                       // (the selected table's rows)
  const v = versionOf(preset, vid), n = sel ? { r: selRows().length, c: selCols().length } : { r: 0, c: 0 };
  const d = dropCount(v), cells = Object.values(v?.hide || {}).reduce((k, l) => k + l.length, 0), any = d.rows + d.cols + cells > 0;
  const s = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return (
    <Dropdown button={(_o, t) => <button className="tb" id="versionBtn" disabled={!v} title={v ? `Delete rows or columns, or empty cells, in “${v.name}” only (the full deck and the other versions keep them)` : "Choose a version first (Version in the top bar)"} onClick={t}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="2.5" width="13" height="11" /><path d="M1.5 8h13M5 5.5l6 5M11 5.5l-6 5" /></svg>For this version ▾</button>}>
      {close => v && <>
        <button id="vDropRows" disabled={!n.r} onClick={() => { close(); forVersion("dropRows"); }}>Delete rows<small>{n.r ? `${s(n.r, "row")} selected` : "Select cells first"} – the table closes up in “{v.name}”</small></button>
        <button id="vDropCols" disabled={!n.c} onClick={() => { close(); forVersion("dropCols"); }}>Delete columns<small>{n.c ? `${s(n.c, "column")} selected` : "Select cells first"}</small></button>
        <button id="vEmpty" disabled={!sel} onClick={() => { close(); forVersion("empty"); }}>Empty cells<small>Shown completely empty in “{v.name}”, in place</small></button>
        <div className="sep" />
        <button id="vRestoreSel" disabled={!sel || !any} onClick={() => { close(); forVersion("restoreSel"); }}>Restore selection<small>Rows, columns and cells of the selection (select across a closed-up gap)</small></button>
        <button id="vRestoreAll" disabled={!any} onClick={() => { close(); forVersion("restoreAll"); }}>Restore all of “{v.name}”<small>{any ? [d.rows && s(d.rows, "row"), d.cols && s(d.cols, "column"), cells && s(cells, "emptied range")].filter(Boolean).join(" · ") : "Nothing removed"}</small></button>
      </>}
    </Dropdown>
  );
}
