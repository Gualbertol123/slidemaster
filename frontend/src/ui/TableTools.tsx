/* Second toolbar row: cell sizes, colour scales, table size & alignment, text boxes around tables. */
import { useState } from "preact/hooks";
import { S, useApp, toast } from "../state/store";
import { change } from "../state/app";
import { DLG } from "../state/dialogs";
import { emit } from "../state/store";
import { curSlide, selTable } from "../editor/edit";
import { alignTables, valignTables, currentTableRefs, makeSameSize, selCols, selRows, setColWidth, setRowHeight, shownColW, shownRowH } from "../editor/tables";
import { noteOf, patchNote } from "../editor/stage";
import { scaleColors } from "../render/scales";
import { A1, uid, esc } from "../xlsx/util";
import type { Op, ScaleRule, Side } from "../model/types";
import { Dropdown } from "./Dropdown";

const uniq = (a: number[]) => [...new Set(a.map(v => Math.round(v)))];

function SizeBox({ label, title, values, disabled, onSet }: { label: string; title: string; values: number[]; disabled: boolean; onSet: (v: number | null) => void }) {
  const u = uniq(values), shown = u.length === 1 ? String(u[0]) : "";
  return <label class="szf" title={title}><span>{label}</span>
    <input key={label + shown + disabled} class="sizebox" disabled={disabled} defaultValue={shown} placeholder={u.length > 1 ? "…" : ""}
      onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === "Enter") { const v = parseFloat(t.value.replace(",", ".")); if (isFinite(v) && v > 0) onSet(v); t.blur(); } if (e.key === "Escape") { t.value = shown; t.blur(); } }} />
    <small>px</small></label>;
}

function ScaleMenu({ close }: { close: () => void }) {
  const T = selTable(), sel = S.sel;
  const [dir, setDir] = useState<ScaleRule["dir"]>("col"), [mode, setMode] = useState<ScaleRule["mode"]>("zero");
  const [fill, setFill] = useState(true), [ink, setInk] = useState(false), [invert, setInvert] = useState(false);
  const rules = Object.entries(T?.def?.scales || {});
  const range = sel ? A1(sel.r1, sel.c1) + ":" + A1(sel.r2, sel.c2) : "";
  const apply = () => {
    if (!T?.def || !sel) return;
    const rule: ScaleRule = { range, dir, mode, fill, ink, ...(invert ? { invert: true } : {}) };
    change("Colour scale", [{ op: "table.patch", id: T.def.id, patch: { scales: { [uid()]: rule } } } as Op]); close();
  };
  const remove = (id: string) => T?.def && change("Remove colour scale", [{ op: "table.patch", id: T.def.id, patch: { scales: { [id]: null } } } as Op]);
  const bar = (neg: boolean) => [0, .25, .5, .75, 1].map(t => scaleColors(t, neg));
  const seg = <V extends string>(v: V, set: (x: V) => void, opts: [V, string][]) => <div class="seg small">{opts.map(([k, l]) => <button key={k} class={v === k ? "on" : ""} onClick={() => set(k)}>{l}</button>)}</div>;
  return <div class="scalemenu">
    <div class="hd">Colour scale {sel ? <>on <b>{range}</b></> : "– select cells first"}</div>
    <div class="optgrid">
      <label>Compare</label>{seg(dir, setDir, [["row", "Across each row"], ["col", "Down each column"], ["all", "Whole selection"]])}
      <label>Colours</label>{seg(mode, setMode, [["zero", "+ green / − red"], ["minmax", "Low red → high green"]])}
      <label>Apply to</label><div class="row"><label class="ck"><input type="checkbox" checked={fill} onChange={e => setFill((e.target as HTMLInputElement).checked)} /> Cell colour</label>
        <label class="ck"><input type="checkbox" checked={ink} onChange={e => setInk((e.target as HTMLInputElement).checked)} /> Number colour</label>
        <label class="ck"><input type="checkbox" checked={invert} onChange={e => setInvert((e.target as HTMLInputElement).checked)} /> Reverse</label></div>
      <label>Preview</label><div class="scaleprev">{[...bar(!invert ? true : false).reverse(), ...bar(!invert ? false : true)].map((c, i) => <i key={i} style={{ background: fill ? c.fill : "#fff", color: ink ? c.ink : "#333" }}>{i < 5 ? "−" : "+"}</i>)}</div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn primary" id="scaleApply" disabled={!sel || (!fill && !ink)} onClick={apply}>Apply to selection</button></div>
    {rules.length > 0 && <><div class="sep" /><div class="hd">On this table</div>
      {rules.map(([id, r]) => <div class="scalerule" key={id}><code>{r.range}</code> · {r.dir === "row" ? "rows" : r.dir === "col" ? "columns" : "whole range"} · {r.mode === "zero" ? "± around zero" : "low → high"} · {[r.fill && "cell", r.ink && "number"].filter(Boolean).join(" + ")}{r.invert ? " · reversed" : ""}
        <button class="btn icon" title="Remove" onClick={() => remove(id)}>✕</button></div>)}</>}
  </div>;
}

/* gridlines of a table: as in Excel, all on, or none – separately for horizontal and vertical lines */
function GridMenu({ close, T }: { close: () => void; T: import("../xlsx/types").TableLayout }) {
  const set = (k: "gridH" | "gridV", v: "on" | "off" | null) => { if (!T.def) return; change(v === "on" ? "Add gridlines" : v === "off" ? "Remove gridlines" : "Gridlines from Excel", [{ op: "table.patch", id: T.def.id, patch: { [k]: v } } as Op]); close(); };
  const row = (k: "gridH" | "gridV", label: string) => <><label>{label}</label><div class="seg small" data-grid={k}>
    {([[null, "As in Excel"], ["on", "All"], ["off", "None"]] as const).map(([v, l]) => <button key={String(v)} data-v={String(v)} class={(T.def?.[k] ?? null) === v ? "on" : ""} onClick={() => set(k, v)}>{l}</button>)}</div></>;
  return <div class="scalemenu"><div class="hd">Gridlines of this table</div>
    <div class="optgrid">{row("gridH", "Horizontal")}{row("gridV", "Vertical")}</div></div>;
}

export function TableRibbon() {
  useApp();
  const R = curSlide(), T = selTable(), cols = selCols(), rows = selRows(), hasSel = !!(T && S.sel);
  const tIdx = S.sel ? S.sel.t : (R && R.tables.length === 1 ? 0 : -1);
  const note = S.noteSel ? noteOf(S.noteSel) : null;
  const addNote = (side: Side) => {
    if (!R || tIdx < 0) { toast("Click a cell of the table first."); return; }
    const key = (R.tables[tIdx].id || String(tIdx)) + ":" + side;
    if ((R.cfg.notes || {})[key]) { toast("This table already has a text box there – double-click it to edit."); return; }
    change("Add text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { text: "" } } } } as Op]);
    setTimeout(() => document.querySelector<HTMLElement>(`#stage .tnote[data-note="${CSS.escape(key)}"]`)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), 120);
  };
  const align = R?.cfg.align || "center";
  return (
    <nav class="ribbon ribbon2">
      <div class="grp" title="Size of the selected columns and rows, in table pixels (Excel at 100 %). Or drag a border on the slide; double-click a border for the Excel size.">
        <span class="lbl">Cells</span>
        <SizeBox label="W" title="Width of the selected columns (Enter to apply)" disabled={!hasSel} values={T ? cols.map(c => shownColW(T, c)) : []} onSet={v => T && setColWidth(T, cols, v)} />
        <SizeBox label="H" title="Height of the selected rows (Enter to apply)" disabled={!hasSel} values={T ? rows.map(r => shownRowH(T, r)) : []} onSet={v => T && setRowHeight(T, rows, v)} />
        <button class="tb" id="sizeReset" disabled={!hasSel} title="Back to the widths and heights from Excel for the selected columns and rows"
          onClick={() => { if (!T?.def) return; change("Excel sizes", [{ op: "table.patch", id: T.def.id, patch: { cols: Object.fromEntries(cols.map(c => [c, null])), rows: Object.fromEntries(rows.map(r => [r, null])) } } as Op]); }}>Excel size</button>
      </div>
      <div class="grp">
        <Dropdown menuClass="wide" button={(_o, t) => <button class="tb" id="scaleBtn" disabled={!hasSel} title="Colour scale: deeper green/red the bigger the number" onClick={t}>
          <i class="scaleico" />Colour scale</button>}>{close => <ScaleMenu close={close} />}</Dropdown>
      </div>
      <div class="grp">
        <span class="lbl">Tables</span>
        <button class="tb" id="sameSize" disabled={!R || R.tables.length < 2} title="Make the tables on this slide exactly the same size"
          onClick={() => { const r = makeSameSize(currentTableRefs(), { width: true, height: true, target: "largest" }); if (!r.ok) toast(esc(r.why)); }}>⇔ Same size</button>
        {(["left", "center", "right"] as const).map(a => <button key={a} class={"tb" + (align === a ? " on" : "")} data-talign={a} disabled={!R || !R.tables.length} title={`Align the tables ${a === "center" ? "in the centre" : "to the " + a}`} onClick={() => alignTables(a)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">{a === "left" ? <><path d="M2 1.5v13" /><rect x="4" y="3.5" width="9" height="3" /><rect x="4" y="9.5" width="6" height="3" /></> : a === "center" ? <><path d="M8 1.5v13" /><rect x="3" y="3.5" width="10" height="3" /><rect x="4.5" y="9.5" width="7" height="3" /></> : <><path d="M14 1.5v13" /><rect x="3" y="3.5" width="9" height="3" /><rect x="6" y="9.5" width="6" height="3" /></>}</svg></button>)}
        {(["top", "middle", "bottom"] as const).map(v => <button key={v} class={"tb" + (R?.cfg.valign === v ? " on" : "")} data-tvalign={v} disabled={!R || !R.tables.length}
          title={R?.cfg.valign === v ? "Back to the default position (click again)" : `Move the tables to the ${v === "middle" ? "middle" : v} of the slide`} onClick={() => valignTables(R?.cfg.valign === v ? null : v)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">{v === "top" ? <><path d="M1.5 2h13" /><rect x="3.5" y="4" width="3" height="9" /><rect x="9.5" y="4" width="3" height="6" /></> : v === "middle" ? <><path d="M1.5 8h13" /><rect x="3.5" y="3" width="3" height="10" /><rect x="9.5" y="4.5" width="3" height="7" /></> : <><path d="M1.5 14h13" /><rect x="3.5" y="3" width="3" height="9" /><rect x="9.5" y="6" width="3" height="6" /></>}</svg></button>)}
        <Dropdown menuClass="wide" button={(_o, t) => <button class="tb" id="gridBtn" disabled={!(tIdx >= 0 && R?.tables[tIdx]?.def)} title="Add or remove horizontal / vertical gridlines of the table" onClick={t}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" /><path d="M1.5 6.2h13M1.5 9.8h13M5.8 2.5v11M10.2 2.5v11" /></svg>Gridlines</button>}>
          {close => R && tIdx >= 0 ? <GridMenu close={close} T={R.tables[tIdx]} /> : null}</Dropdown>
        <button class="tb" id="tablesDlg" disabled={!S.slides.some(x => x.tables.length)} title="Match sizes of tables on several slides, copy column widths between tables" onClick={() => { DLG.tables = true; emit(); }}>Sizes…</button>
      </div>
      <div class="grp">
        <span class="lbl">Text box</span>
        {(["top", "bottom", "left", "right"] as const).map(sd => <button key={sd} class="tb" data-addnote={sd} disabled={!R || tIdx < 0} title={`Text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd} of the table`} onClick={() => addNote(sd)}>
          {sd === "top" ? "↑" : sd === "bottom" ? "↓" : sd === "left" ? "←" : "→"}</button>)}
        {note && <>
          <button class="tb" title="Smaller text" onClick={() => patchNote("Text box size", { size: Math.max(8, (note.size || 18) - 2) })}>A−</button>
          <button class="tb" title="Larger text" onClick={() => patchNote("Text box size", { size: Math.min(72, (note.size || 18) + 2) })}>A+</button>
          <button class={"tb" + (note.b ? " on" : "")} title="Bold" onClick={() => patchNote("Text box bold", { b: !note.b })}><b>B</b></button>
          <button class={"tb" + (note.i ? " on" : "")} title="Italic" onClick={() => patchNote("Text box italic", { i: !note.i })}><i style="font-family:Georgia,serif">I</i></button>
          {(["left", "center", "right"] as const).map(a => <button key={a} class={"tb" + (note.align === a ? " on" : "")} data-nalign={a} title={"Align text " + a} onClick={() => patchNote("Text box alignment", { align: a })}>{a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}</button>)}
          {(["top", "middle", "bottom"] as const).map(v => <button key={v} class={"tb" + (note.valign === v ? " on" : "")} data-nvalign={v} title={"Text at the " + v + " of the box"} onClick={() => patchNote("Text box vertical alignment", { valign: v })}>{v === "top" ? "⤒" : v === "middle" ? "↕" : "⤓"}</button>)}
          <button class={"tb" + (note.bubble ? " on" : "")} id="noteBubble" title="Bubble around the text box, like the tables" onClick={() => patchNote(note.bubble ? "Text box without bubble" : "Text box in a bubble", { bubble: !note.bubble })}>◯ Bubble</button>
          <button class="tb" title="Delete the text box (Del)" onClick={() => patchNote("Remove text box", null)}>🗑</button>
        </>}
      </div>
    </nav>
  );
}
