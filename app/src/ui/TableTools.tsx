/* Second toolbar row: LAYOUT – table cells (size, role, merge, colour scale), tables on the slide,
   text boxes around tables, slide options. Text formatting lives in the first row only. */
import { useState } from "react";
import { setDialogs, useStore, toast } from "../state/store";
import { change } from "../state/app";
import { applySel, selItems, selTable } from "../editor/edit";
import { effFmt } from "@slide-builder/core/render/edits";
import { sizingOf, sizingPatch, slideHasLogo } from "@slide-builder/core/render/slide";
import { alignTables, canMerge, mergeSel, mergedInSel, unmergeSel, valignTables, currentTableRefs, makeSameSize, selCols, selRows, setColWidth, setRowHeight, shownColW, shownRowH } from "../editor/tables";
import { addSlideNotes, attachNote, noteOf, patchNote } from "../editor/stage";
import { scaleColors } from "@slide-builder/core/render/scales";
import { A1, uid, esc } from "@slide-builder/core/xlsx/util";
import type { Op, ScaleRule, Side } from "@slide-builder/core/model/types";
import { Dropdown } from "./Dropdown";
import { useCtx, useCurSlide, useStyle } from "./hooks";

const uniq = (a: number[]) => [...new Set(a.map(v => Math.round(v)))];

function SizeBox({ label, title, values, disabled, onSet }: { label: string; title: string; values: number[]; disabled: boolean; onSet: (v: number | null) => void }) {
  const u = uniq(values), shown = u.length === 1 ? String(u[0]) : "";
  return <label className="szf" title={title}><span>{label}</span>
    <input key={label + shown + disabled} className="sizebox" disabled={disabled} defaultValue={shown} placeholder={u.length > 1 ? "…" : ""}
      onKeyDown={e => { e.stopPropagation(); const t = e.target as HTMLInputElement; if (e.key === "Enter") { const v = parseFloat(t.value.replace(",", ".")); if (isFinite(v) && v > 0) onSet(v); t.blur(); } if (e.key === "Escape") { t.value = shown; t.blur(); } }} />
    <small>px</small></label>;
}

function ScaleMenu({ close }: { close: () => void }) {
  const T = selTable(), sel = useStore(s => s.selection.sel);
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
  const seg = <V extends string>(v: V, set: (x: V) => void, opts: [V, string][]) => <div className="seg small">{opts.map(([k, l]) => <button key={k} className={v === k ? "on" : ""} onClick={() => set(k)}>{l}</button>)}</div>;
  return <div className="scalemenu">
    <div className="hd">Colour scale {sel ? <>on <b>{range}</b></> : "– select cells first"}</div>
    <div className="optgrid">
      <label>Compare</label>{seg(dir, setDir, [["row", "Across each row"], ["col", "Down each column"], ["all", "Whole selection"]])}
      <label>Colours</label>{seg(mode, setMode, [["zero", "+ green / − red"], ["minmax", "Low red → high green"]])}
      <label>Apply to</label><div className="row"><label className="ck"><input type="checkbox" checked={fill} onChange={e => setFill((e.target as HTMLInputElement).checked)} /> Cell colour</label>
        <label className="ck"><input type="checkbox" checked={ink} onChange={e => setInk((e.target as HTMLInputElement).checked)} /> Number colour</label>
        <label className="ck"><input type="checkbox" checked={invert} onChange={e => setInvert((e.target as HTMLInputElement).checked)} /> Reverse</label></div>
      <label>Preview</label><div className="scaleprev">{[...bar(!invert ? true : false).reverse(), ...bar(!invert ? false : true)].map((c, i) => <i key={i} style={{ background: fill ? c.fill : "#fff", color: ink ? c.ink : "#333" }}>{i < 5 ? "−" : "+"}</i>)}</div>
    </div>
    <div className="row" style={{ justifyContent: "flex-end", marginTop: "8px" }}><button className="btn primary" id="scaleApply" disabled={!sel || (!fill && !ink)} onClick={apply}>Apply to selection</button></div>
    {rules.length > 0 && <><div className="sep" /><div className="hd">On this table</div>
      {rules.map(([id, r]) => <div className="scalerule" key={id}><code>{r.range}</code> · {r.dir === "row" ? "rows" : r.dir === "col" ? "columns" : "whole range"} · {r.mode === "zero" ? "± around zero" : "low → high"} · {[r.fill && "cell", r.ink && "number"].filter(Boolean).join(" + ")}{r.invert ? " · reversed" : ""}
        <button className="btn icon" title="Remove" onClick={() => remove(id)}>✕</button></div>)}</>}
  </div>;
}

/* gridlines of a table: as in Excel, all on, or none – separately for horizontal and vertical lines */
function GridMenu({ close, T }: { close: () => void; T: import("@slide-builder/core/xlsx/types").TableLayout }) {
  const set = (k: "gridH" | "gridV", v: "on" | "off" | null) => { if (!T.def) return; change(v === "on" ? "Add gridlines" : v === "off" ? "Remove gridlines" : "Gridlines from Excel", [{ op: "table.patch", id: T.def.id, patch: { [k]: v } } as Op]); close(); };
  const row = (k: "gridH" | "gridV", label: string) => <><label>{label}</label><div className="seg small" data-grid={k}>
    {([[null, "As in Excel"], ["on", "All"], ["off", "None"]] as const).map(([v, l]) => <button key={String(v)} data-v={String(v)} className={(T.def?.[k] ?? null) === v ? "on" : ""} onClick={() => set(k, v)}>{l}</button>)}</div></>;
  return <div className="scalemenu"><div className="hd">Gridlines of this table</div>
    <div className="optgrid">{row("gridH", "Horizontal")}{row("gridV", "Vertical")}</div></div>;
}

const ROLES = [["auto", "Auto", "Detected from the Excel formatting"], ["header", "Header", "Column/row header"], ["total", "Total", "Highlighted total (tile)"], ["body", "Body", "Normal data"], ["caption", "Note", "Small note"]] as const;

export function TableRibbon() {
  const sel = useStore(s => s.selection.sel), noteSel = useStore(s => s.selection.noteSel), anyTables = useStore(s => s.deck.slides.some(x => x.tables.length));
  const R = useCurSlide(), c = useCtx(), st = useStyle();
  const T = selTable(), cols = selCols(), rows = selRows(), hasSel = !!(T && sel), its = selItems();
  const tIdx = sel ? sel.t : (R && R.tables.length === 1 ? 0 : -1);
  const note = noteSel ? noteOf(noteSel) : null;
  const roles = new Set(its.map(x => effFmt(c, x).role)), role = roles.size === 1 ? [...roles][0] : null;
  const logoOn = !!R && slideHasLogo(R), logoName = st.logo.trim();
  const slidePatch = (label: string, patch: Record<string, unknown>) => R && change(label, [{ op: "slide.patch", id: R.id, patch } as Op]);
  const addNote = (side: Side) => {
    if (!R || tIdx < 0) { toast("Click a cell of the table first."); return; }
    const key = (R.tables[tIdx].id || String(tIdx)) + ":" + side;
    if ((R.cfg.notes || {})[key]) { toast("This table already has a text box there – double-click it to edit."); return; }
    change("Add text box", [{ op: "slide.patch", id: R.id, patch: { notes: { [key]: { text: "" } } } } as Op]);
    setTimeout(() => document.querySelector<HTMLElement>(`#stage .tnote[data-note="${CSS.escape(key)}"]`)?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), 120);
  };
  const sz = R ? sizingOf(R, c) : null, align = sz?.align || "center";
  // raw Excel shows the workbook only: no text boxes, no comments
  const raw = st.design === "excel", rawTip = "Excel shows the workbook as it is – text boxes and comments are in Excel Refined and Liquid Glass";
  return (
    <nav className="ribbon ribbon2">
      <div className="grp" title="Size of the selected columns and rows, in table pixels (Excel at 100 %). Or drag a border on the slide; double-click a border for the Excel size.">
        <span className="lbl">Cells</span>
        <SizeBox label="W" title="Width of the selected columns (Enter to apply)" disabled={!hasSel} values={T ? cols.map(c => shownColW(T, c)) : []} onSet={v => T && setColWidth(T, cols, v)} />
        <SizeBox label="H" title="Height of the selected rows (Enter to apply)" disabled={!hasSel} values={T ? rows.map(r => shownRowH(T, r)) : []} onSet={v => T && setRowHeight(T, rows, v)} />
        <button className="tb" id="sizeReset" disabled={!hasSel} title="Back to the widths and heights from Excel for the selected columns and rows"
          onClick={() => { if (!T?.def) return; change("Excel sizes", [{ op: "table.patch", id: T.def.id, patch: { cols: Object.fromEntries(cols.map(c => [c, null])), rows: Object.fromEntries(rows.map(r => [r, null])) } } as Op]); }}>Excel size</button>
        <Dropdown button={(_o, t) => <button className="tb" id="roleBtn" disabled={!hasSel} title="Role of the selected cells: how Liquid Glass draws them" onClick={t}>Role: {role ? ROLES.find(r => r[0] === role)?.[1] : "–"} ▾</button>}>
          {close => <>{ROLES.map(([k, l, t]) => <button key={k} data-role={k} className={role === k ? "picked" : ""} onClick={() => { close(); applySel("Role: " + l, e => { if (k === "auto") delete e.role; else e.role = k; }); }}>{l}<small>{t}</small></button>)}</>}
        </Dropdown>
        {mergedInSel().length ? <button className="tb mergebtn" id="unmergeBtn" title="Split the merged cells in the selection" onClick={unmergeSel}>Unmerge</button>
          : <button className="tb mergebtn" id="mergeBtn" title="Merge the selected cells (the top-left value is kept)" disabled={!canMerge()} onClick={mergeSel}>Merge</button>}
        <Dropdown menuClass="wide" button={(_o, t) => <button className="tb" id="scaleBtn" disabled={!hasSel} title="Colour scale: deeper green/red the bigger the number" onClick={t}>
          <i className="scaleico" />Colour scale</button>}>{close => <ScaleMenu close={close} />}</Dropdown>
      </div>
      <div className="grp">
        <button className="tb" id="sameSize" disabled={!R || R.tables.length < 2} title="Make the tables on this slide exactly the same size"
          onClick={() => { const r = makeSameSize(currentTableRefs(), { width: true, height: true, target: "largest" }); if (!r.ok) toast(esc(r.why)); }}>⇔ Same size</button>
        <Dropdown button={(_o, t) => <button className="tb" id="posBtn" disabled={!R || !R.tables.length} title="Position of the tables on the slide" onClick={t}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5v13" /><rect x="3" y="3.5" width="10" height="3" /><rect x="4.5" y="9.5" width="7" height="3" /></svg>Position ▾</button>}>
          {close => <div className="posmenu" onClick={e => { if ((e.target as Element).closest("button")) close(); }}><div className="hd">Across the slide</div><div className="row">
        {(["left", "center", "right"] as const).map(a => <button key={a} className={"tb" + (align === a ? " on" : "")} data-talign={a} disabled={!R || !R.tables.length} title={`Align the tables ${a === "center" ? "in the centre" : "to the " + a}`} onClick={() => alignTables(a)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{a === "left" ? <><path d="M2 1.5v13" /><rect x="4" y="3.5" width="9" height="3" /><rect x="4" y="9.5" width="6" height="3" /></> : a === "center" ? <><path d="M8 1.5v13" /><rect x="3" y="3.5" width="10" height="3" /><rect x="4.5" y="9.5" width="7" height="3" /></> : <><path d="M14 1.5v13" /><rect x="3" y="3.5" width="9" height="3" /><rect x="6" y="9.5" width="6" height="3" /></>}</svg></button>)}
          </div><div className="hd">Up and down</div><div className="row">
        {(["top", "middle", "bottom"] as const).map(v => <button key={v} className={"tb" + (sz?.valign === v ? " on" : "")} data-tvalign={v} disabled={!R || !R.tables.length}
          title={sz?.valign === v ? "Back to the default position (click again)" : `Move the tables to the ${v === "middle" ? "middle" : v} of the slide`} onClick={() => valignTables(sz?.valign === v ? null : v)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{v === "top" ? <><path d="M1.5 2h13" /><rect x="3.5" y="4" width="3" height="9" /><rect x="9.5" y="4" width="3" height="6" /></> : v === "middle" ? <><path d="M1.5 8h13" /><rect x="3.5" y="3" width="3" height="10" /><rect x="9.5" y="4.5" width="3" height="7" /></> : <><path d="M1.5 14h13" /><rect x="3.5" y="3" width="3" height="9" /><rect x="9.5" y="6" width="3" height="6" /></>}</svg></button>)}
          </div></div>}
        </Dropdown>
        <Dropdown menuClass="wide" button={(_o, t) => <button className="tb" id="gridBtn" disabled={!(tIdx >= 0 && R?.tables[tIdx]?.def)} title="Add or remove horizontal / vertical gridlines of the table" onClick={t}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1.5" y="2.5" width="13" height="11" /><path d="M1.5 6.2h13M1.5 9.8h13M5.8 2.5v11M10.2 2.5v11" /></svg>Gridlines</button>}>
          {close => R && tIdx >= 0 ? <GridMenu close={close} T={R.tables[tIdx]} /> : null}</Dropdown>
        <button className="tb" id="tablesDlg" disabled={!anyTables} title="Match sizes of tables on several slides, copy column widths between tables" onClick={() => setDialogs({ tables: true })}>Sizes…</button>
        <button className="tb" id="resetLayout" title="Automatic table positions for this slide (in this design)" disabled={!(R && sizingOf(R, c).layout)} onClick={() => R && slidePatch("Reset layout", sizingPatch(R, c, { scale: sizingOf(R, c).scale }))}>Reset layout</button>
      </div>
      <div className="grp">
        <span className="lbl">Text box</span>
        {(["top", "bottom", "left", "right"] as const).map(sd => <button key={sd} className="tb" data-addnote={sd} disabled={!R || tIdx < 0 || raw} title={raw ? rawTip : `Add a text box ${sd === "top" ? "above" : sd === "bottom" ? "below" : "on the " + sd} of the table`} onClick={() => addNote(sd)}>
          {sd === "top" ? "↑" : sd === "bottom" ? "↓" : sd === "left" ? "←" : "→"}</button>)}
        <button className={"tb" + (note?.bubble ? " on" : "")} id="noteBubble" disabled={!note} title="Bubble around the selected text box, like the tables (glass card / framed box)" onClick={() => note && patchNote(note.bubble ? "Text box without bubble" : "Text box in a bubble", { bubble: !note.bubble })}>◯</button>
        <button className={"tb" + (note?.auto ? " on" : "")} id="commentBtn" disabled={!R || !R.tables.length || raw} title={raw ? rawTip : "Automated comment: a commentary written from the table's numbers (headline, main contributors, downside), updated when the numbers change"}
          onClick={() => setDialogs({ comment: { table: noteSel ? Math.max(0, R!.tables.findIndex(t => (t.id || "") === noteSel.split(":")[0])) : Math.max(0, tIdx) } })}>✎ Comment…</button>
        <button className="tb" id="noteAttach" disabled={!(note && note.x != null) || noteSel === "slide:notes"} title="Put the moved text box back next to its table (drag a text box to place it anywhere)" onClick={attachNote}>⤺ Attach</button>
        <button className="tb" id="noteDelete" disabled={!note} title="Delete the selected text box (Del)" onClick={() => patchNote("Remove text box", null)}>🗑</button>
      </div>
      <div className="grp">
        <button className={"tb" + (R?.cfg.notes?.["slide:notes"] ? " on" : "")} id="slideNotes" disabled={!R || raw} title={raw ? rawTip : "Notes section of this slide (sources, footnotes…): starts where the footer is – drag it anywhere, e.g. next to the page number"} onClick={addSlideNotes}>✎ Notes</button>
        <button className={"tb" + (logoOn ? " on" : "")} id="logoToggle" disabled={!R || !logoName} title={R && !logoOn ? "The logo is hidden on this slide – click to show it" : "Hide the logo on this slide"}
          onClick={() => slidePatch(logoOn ? "Hide logo" : "Show logo", { logo: logoOn ? false : null })}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="3.5" width="13" height="9" rx="2" /><path d="m3.5 10.5 3-3 2 2 1.5-1.5 2.5 2.5" /></svg>Logo</button>
        {R?.type === "index" && <button className={"tb" + (R.cfg.subs !== false ? " on" : "")} id="ixSubs" title={R.cfg.subs !== false ? "Hide the slide subtitles in the contents list" : "Show the slide subtitles in the contents list"}
          onClick={() => slidePatch(R.cfg.subs !== false ? "Hide subtitles in contents" : "Show subtitles in contents", { subs: R.cfg.subs !== false ? false : null })}>Subtitles</button>}
      </div>
    </nav>
  );
}
