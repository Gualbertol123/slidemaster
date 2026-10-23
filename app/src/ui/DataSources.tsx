/* Data sources (B57, 4.14; the owner: "if i move cells around in excel the graphs and tabs will break, i want to be easily
   able to repoint them without having to rebuild the entire graph"): in the side panel of the selected chart, KPI card or
   budget chart – and of a table, from the table ribbon's Data sources – every reference the object reads, its address,
   whether it still looks right (OK, empty, missing sheet, text where numbers were expected, moved?), Change… (the sheet
   view on its own cells: only that reference changes, one undo step), Follow header; and the bulk repoints with a
   preview of every old → new address before one undo step applies them: Move all by…, Change sheet…, Find the block.
   Under the Issues panel, a line per object whose references look wrong, with Repoint…. Usable from 280 px wide. */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useStore, type AppState } from "../state/store";
import { curSlide } from "../editor/edit";
import { itemOf, selectItem } from "../editor/charts";
import { applyPlan, canFollow, isBad, itemRows, openChange, planFind, planMove, planSheetChange, rememberHeaders, setFollow, slideSrcIssues, statusText, tableRow, targetSheets, workbookSheets,
  type Plan, type Scope, type SrcTarget } from "../editor/datasources";
import { colToNum } from "@slide-builder/core/xlsx/util";
import "./datasources.css";

/** what the panel (and the Issues lines) show depends on: the slide's objects (or one), the deck's tables */
function sourcesSig(s: AppState, item: string | null, table: string | null): string {
  const R = s.deck.slides[s.deck.cur], items = R?.cfg.items || {};
  return JSON.stringify([R?.id, item === "*" ? items : item ? items[item] ?? null : null, table ? s.doc.view?.preset?.tables ?? null : null, R?.cfg.tables]);
}
/** the panel's own state: the table shown (the ribbon's Data sources), the panel folded or not per object */
const useSrc = create<{ table: string | null; open: Record<string, boolean> }>(() => ({ table: null, open: {} }));
/** the table ribbon's Data sources: the panel of that table, open */
export const openTableSources = (id: string | null) => useSrc.setState(s => ({ table: id, open: id ? { ...s.open, ["t:" + id]: true } : s.open }));
/** Repoint… (Issues): the object selected, its panel open */
export function repoint(t: SrcTarget) {
  if ("item" in t) { selectItem(t.item); useSrc.setState(s => ({ table: null, open: { ...s.open, ["i:" + t.item]: true } })); }
  else openTableSources(t.table);
  setTimeout(() => document.getElementById("dataSources")?.scrollIntoView({ block: "nearest" }), 0);
}

export function DataSources() {
  const sel = useStore(s => s.selection.itemSel?.id ?? null), table = useSrc(s => s.table);
  // drawn again only when what it shows can change: the object itself, the deck's tables, the workbook (a reload) – not
  // on a cell typed into elsewhere (the chart panel's cost on a keypress, CT-08)
  useStore(s => sourcesSig(s, sel, table)); useStore(s => s.deck.wb);
  const R = curSlide(), it = sel ? itemOf(sel, R) : null;
  if (it && (it.kind === "chart" || it.kind === "kpi")) return <Panel key={"i:" + sel} target={{ item: sel! }} />;
  if (!sel && table && R?.cfg.tables?.includes(table)) return <Panel key={"t:" + table} target={{ table }} />;
  return null;
}

function Panel({ target }: { target: SrcTarget }) {
  const key = "item" in target ? "i:" + target.item : "t:" + target.table;
  const rows = "item" in target ? itemRows(itemOf(target.item)!) : null;
  const trow = "table" in target ? tableRow(useStore.getState().doc.view!.preset!.tables.find(t => t.id === target.table)!) : null;
  const bad = rows ? rows.filter(r => isBad(r.check.status)).length : trow && isBad(trow.status) ? 1 : 0;
  const stored = useSrc(s => s.open[key]), open = stored ?? bad > 0;
  // (opened because something looks wrong: it stays open once fixed, until folded by hand)
  useEffect(() => { if (stored === undefined && bad > 0) useSrc.setState(s => ({ open: { ...s.open, [key]: true } })); }, [stored, bad > 0]);
  const [prev, setPrev] = useState<{ title: string; plan: Plan; make: () => Plan; changed?: boolean } | null>(null);
  const toggle = () => useSrc.setState(s => ({ open: { ...s.open, [key]: !open } }));
  if (!rows && !trow) return null;
  return <div className="srcpanel" id="dataSources" data-target={key}>
    <div className="srchd">
      <button className="srctg" id="srcToggle" aria-expanded={open} onClick={toggle}>{open ? "▾" : "▸"} Data sources{rows ? ` (${rows.length})` : ""}</button>
      {bad > 0 && <span className="st st-bad" id="srcBad">{bad} to check</span>}
      {"table" in target && <button className="btn small srcx" title="Close" onClick={() => openTableSources(null)}>×</button>}
    </div>
    {open && <>
      <div className="srclist" id="srcList">
        {rows && !rows.length && <div className="srcnote">This object reads no cells.</div>}
        {rows && rows.map(r => <div key={r.slot.path} className={"srcrow" + (isBad(r.check.status) ? " bad" : "")} data-path={r.slot.path} data-status={r.check.status}>
          <div className="srcl"><b>{r.slot.label}</b><span className={"st st-" + r.check.status}>{statusText(r.check.status)}</span></div>
          <div className="srca"><code title={r.check.at}>{r.check.at}</code>
            <button className="btn small" data-a="change" title="Choose its cells in the sheet view (only this reference changes)" onClick={() => openChange(target, { path: r.slot.path, label: r.slot.label, ref: r.slot.ref, one: r.slot.one })}>Change…</button></div>
          {r.now && <div className="srcnote" data-a="now">Follows its header: reads <code>{r.now}</code> now</div>}
          {r.check.why && isBad(r.check.status) && <div className="srcwhy">{r.check.why}</div>}
          {r.check.note && <div className="srcnote" data-a="note">{r.check.note}</div>}
          {"item" in target && canFollow(r) && <label className="chk srcfollow" title="Find the cells by their header text whenever they are read: a moved column or rows inserted above need no repoint (the address is kept as the fallback)">
            <input type="checkbox" data-a="follow" checked={r.follow} onChange={e => setFollow(target.item, r.slot.path, e.target.checked)} />Follow header{r.fp?.h ? <> “{r.fp.h}”</> : null}</label>}
        </div>)}
        {trow && <div className={"srcrow" + (isBad(trow.status) ? " bad" : "")} data-path="table" data-status={trow.status}>
          <div className="srcl"><b>Table cells</b><span className={"st st-" + trow.status}>{statusText(trow.status)}</span></div>
          <div className="srca"><code title={trow.at}>{trow.at}</code>
            {trow.def.kind === "range" && <button className="btn small" data-a="change" onClick={() => openChange(target, { path: "range", label: "Table cells", ref: { sheet: trow.def.sheet, range: trow.def.kind === "range" ? trow.def.range : "A1" }, one: false })}>Change…</button>}</div>
          {trow.why && <div className={isBad(trow.status) ? "srcwhy" : "srcnote"}>{trow.why}</div>}
          <div className="srcnote">Its widths, heights, hidden rows, cell edits, versions and the charts reading it move with it.</div>
        </div>}
      </div>
      <Bulk target={target} onPreview={(title, make) => setPrev({ title, plan: make(), make })} />
      {prev && <Preview title={prev.title} plan={prev.plan} changed={!!prev.changed} close={() => setPrev(null)}
        apply={() => {
          // made again on Apply: what changed meanwhile (another writer, a reload) is never overwritten unseen – the preview
          // shows the new plan and asks for a second click
          const fresh = prev.make();
          if (JSON.stringify(fresh.ops) !== JSON.stringify(prev.plan.ops)) { setPrev({ ...prev, plan: fresh, changed: true }); return; }
          applyPlan(prev.title, fresh); setPrev(null);
        }} />}
    </>}
  </div>;
}

function Bulk({ target, onPreview }: { target: SrcTarget; onPreview: (title: string, make: () => Plan) => void }) {
  const isItem = "item" in target, sheets = targetSheets(target), all = workbookSheets();
  const [scope, setScope] = useState<Scope>("item"), [sheet, setSheet] = useState<string>(sheets[0] || ""), [dr, setDr] = useState("0"), [dc, setDc] = useState("0"), [at, setAt] = useState("");
  const [from, setFrom] = useState(sheets[0] || ""), [to, setTo] = useState(all.find(n => n !== sheets[0]) || "");
  const n = (v: string) => Math.trunc(+v.replace(",", ".") || 0);
  // (another scope offers other sheets: the choices start again – a stale "every sheet" would preview nothing)
  useEffect(() => { setSheet(scope === "item" && sheets.length > 1 ? "*" : sheets[0] || ""); setFrom(sheets[0] || ""); }, [scope]);
  const move = () => {
    const rows = n(dr), cols = n(dc), p = at.trim().toUpperCase();
    // (an insertion point: "5" a row, "C" a column – Excel's insert / delete there)
    const s = { dr: rows, dc: cols, ...(/^\d+$/.test(p) ? { row: +p } : /^[A-Z]{1,3}$/.test(p) ? { col: colToNum(p) } : {}) };
    const sh = isItem && scope === "item" ? (sheet === "*" ? null : sheet) : sheet;
    onPreview(`Move by ${rows} row${Math.abs(rows) === 1 ? "" : "s"}, ${cols} column${Math.abs(cols) === 1 ? "" : "s"}${p ? " at " + p : ""}`, () => planMove(target, scope, sh, s));
  };
  return <div className="srcbulk" id="srcBulk">
    {isItem && <div className="row"><span className="lbl">For</span><select id="srcScope" value={scope} onChange={e => setScope(e.target.value as Scope)}>
      <option value="item">this object</option><option value="slide">this slide's objects</option><option value="deck">the whole deck</option></select></div>}
    <details className="srcsec" id="srcMove"><summary>Move all by…</summary>
      <div className="srcgrid">
        <label>Rows<input className="num" id="srcDr" inputMode="numeric" value={dr} onChange={e => setDr(e.target.value)} /></label>
        <label>Columns<input className="num" id="srcDc" inputMode="numeric" value={dc} onChange={e => setDc(e.target.value)} /></label>
        <label title="Excel's insert (or delete, a negative number) at this row (5) or column (C): only cells at or after it move. Empty: everything moves">At<input className="num" id="srcAt" placeholder="all" value={at} onChange={e => setAt(e.target.value)} /></label>
      </div>
      <div className="row"><span className="lbl">On</span><select id="srcSheet" value={sheet} onChange={e => setSheet(e.target.value)}>
        {isItem && scope === "item" && <option value="*">every sheet</option>}{[...new Set([...sheets, ...(scope === "item" ? [] : all)])].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <div className="srcnote">I inserted 2 rows above my table: Rows 2.{!isItem || scope === "deck" ? " The sheet's tables, cell edits and versions move too." : ""}</div>
      <button className="btn small" id="srcMovePrev" disabled={!n(dr) && !n(dc)} onClick={move}>Preview…</button>
    </details>
    <details className="srcsec" id="srcSheetSec"><summary>Change sheet…</summary>
      <div className="row"><span className="lbl">From</span><select id="srcFrom" value={from} onChange={e => setFrom(e.target.value)}>{[...new Set([...sheets, ...(isItem && scope !== "item" ? all : [])])].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <div className="row"><span className="lbl">To</span><select id="srcTo" value={to} onChange={e => setTo(e.target.value)}>{all.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <div className="srcnote">A renamed or copied sheet: every reference to “{from}” reads “{to}” instead, at the same cells.</div>
      <button className="btn small" id="srcSheetPrev" disabled={!from || !to || from === to} onClick={() => onPreview(`Change sheet ${from} → ${to}`, () => planSheetChange(target, scope, from, to))}>Preview…</button>
    </details>
    <div className="row srcbtns">
      <button className="btn small" id="srcFind" title="Look for the headers the references were bound to and propose their new addresses" onClick={() => { const sc: Scope = isItem && scope === "item" ? "item" : "slide"; onPreview("Find the block", () => planFind(target, sc)); }}>Find the block</button>
      <button className="btn small" id="srcRemember" title="Remember each reference's header and label as they are now: a block moved later is seen and found again" onClick={() => rememberHeaders(target)}>Remember headers</button>
    </div>
  </div>;
}

function Preview({ title, plan, close, apply, changed }: { title: string; plan: Plan; close: () => void; apply: () => void; changed: boolean }) {
  const moves = plan.rows.filter(r => r.to !== null && r.to !== r.from), stuck = plan.rows.filter(r => r.to === null);
  return <div className="srcprev" id="srcPreview">
    <div className="srcl"><b>{title}</b><span className="srcnote">{moves.length} reference{moves.length === 1 ? "" : "s"}</span></div>
    {plan.rows.length > 0 && <ol className="srcmoves">{plan.rows.map((r, i) => <li key={i} className={r.to === null ? "stuck" : ""}>
      <span className="what">{r.what}{r.where ? <small> · {r.where}</small> : null}</span>
      <span className="ft"><code>{r.from}</code> → {r.to === null ? <em>stays (it would leave the sheet or be deleted)</em> : <code>{r.to}</code>}</span></li>)}</ol>}
    {changed && <div className="srcwhy" id="srcChanged">Changed meanwhile (another change or a reload): this is the new preview – Apply again to use it.</div>}
    {plan.notes.map((x, i) => <div key={i} className="srcnote">{x}</div>)}
    {stuck.length > 0 && <div className="srcwhy">{stuck.length} reference{stuck.length > 1 ? "s" : ""} cannot move that far: left as {stuck.length > 1 ? "they are" : "it is"}.</div>}
    <div className="row srcbtns">
      <button className="btn small primary" id="srcApply" disabled={!plan.ops.length} onClick={apply}>Apply (one undo step)</button>
      <button className="btn small" id="srcCancel" onClick={close}>Cancel</button>
    </div>
  </div>;
}

/** under the Issues panel: each object of the slide whose references look wrong, with Repoint… */
export function SrcIssues() {
  useStore(s => sourcesSig(s, "*", "*")); useStore(s => s.deck.wb);
  const list = slideSrcIssues();
  if (!list.length) return null;
  return <div className="issues srcissues" id="srcIssues"><h4>Data sources</h4><ul>
    {list.map(x => <li key={JSON.stringify(x.target)} className="warn" data-target={"item" in x.target ? x.target.item : x.target.table}>
      <b>{x.name}</b>: {x.bad.map(b => `${b.label} – ${b.status}`).join("; ")}{" "}
      <button className="btn small" data-a="repoint" onClick={() => repoint(x.target)}>Repoint…</button></li>)}
  </ul></div>;
}
