/* The side panel of a KPI card (B54): its title (typed, or a cell), its value's cell, good direction and format, and its
   delta rows – add, remove, reorder; each row's source (a cell holding the change, or computed from a reference cell:
   %, absolute or both), label, good direction and number format. Every control is ONE item.patch (one undo step); the
   cells are picked in the sheet view (PickCells "kpi-ref"), never typed. Laid out to fit a 280 px side panel. */
import { useMemo } from "react";
import { setDialogs, useStore } from "../state/store";
import { useStage } from "../stage/data";
import type { ItemPatch, KpiItem } from "@slide-builder/core/model/types";
import type { KpiGood } from "@slide-builder/core/model/kpi";
import { deleteItem, itemOf, itemPatch } from "../editor/charts";
import { moveRow, newRow, refName, rowsPatch, setRow, sourcePatch } from "../editor/kpi";
import { Field } from "./Field";
import { useCurSlide } from "./hooks";
import "./chart-panel.css";

const GOOD: [KpiGood, string, string][] = [["up", "↑", "Up is good: a rise is green, a fall red"], ["down", "↓", "Down is good: a fall is green, a rise red"], ["neutral", "–", "Neutral: always grey"]];
const SRC = [["pct", "%"], ["abs", "Δ"], ["both", "% Δ"], ["cell", "Cell"]] as const;
const ST = { row: { display: "grid", gap: "4px", padding: "6px 0", borderTop: "1px solid var(--line2,#E3E6EC)" }, line: { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" as const, minWidth: 0 } };

function Good({ v, on, id }: { v: KpiGood | undefined; on: (g: KpiGood) => void; id: string }) {
  return <div className="seg small" data-good={id}>{GOOD.map(([g, l, t]) => <button key={g} data-g={g} title={t} className={(v ?? "up") === g ? "on" : ""} onClick={() => on(g)}>{l}</button>)}</div>;
}
export function KpiPanel() {
  const itemSel = useStore(s => s.selection.itemSel), R = useCurSlide();
  const issue = useStage(s => { const x = itemSel && s.shown?.id === R?.id ? s.shown?.items?.[itemSel.id] : null; return x?.issue ?? ""; });
  const it = itemOf(itemSel?.id, R);
  const rows = useMemo(() => it?.kind === "kpi" ? (it as KpiItem).rows || [] : [], [it]);
  if (!itemSel || !it || it.kind !== "kpi" || !R) return null;
  const k = it as KpiItem, id = itemSel.id;
  const set = (label: string, p: ItemPatch | null) => { if (p) itemPatch(label, id, p); };
  const pick = (what: "head" | "cur" | `row:${number}`) => setDialogs({ pick: { kind: "kpi-ref", id, what, ...(what.startsWith("row:") ? { src: JSON.stringify(k.rows?.[+what.slice(4)]?.src) } : {}) } });
  return <div className="chartpanel kpipanel" id="kpiPanel" data-item={id} style={{ maxWidth: "100%", minWidth: 0 }}>
    <h4>KPI card</h4>
    <div className="row"><span className="lbl">Title</span>
      <Field id="kpiTitle" style={{ flex: "1 1 80px" }} title="The card's title (Enter to apply); or pick a cell" value={typeof k.head === "string" ? k.head : ""}
        placeholder={k.head && typeof k.head === "object" ? refName(k.head) : "Title"} onCommit={v => set("KPI card title", { head: v.trim() ? v : null })} />
      <button className="btn small" id="kpiTitleCell" title="The title from a cell" onClick={() => pick("head")}>Cell…</button></div>
    <div className="row"><span className="lbl">Value</span>
      <button className="btn small" id="kpiCur" title="The current value's cell" onClick={() => pick("cur")}><code>{refName(k.cur)}</code></button>
      <Good id="cur" v={k.good} on={g => set("KPI value direction", { good: g })} /></div>
    <div className="row"><span className="lbl">Format</span>
      <Field id="kpiNum" style={{ flex: "1 1 80px" }} placeholder="the cell's" title="The value's number format (e.g. #,##0.0); empty = the cell's" value={k.num || ""} onCommit={v => set("KPI value format", { num: v.trim() || null })} /></div>
    <div id="kpiRows">{rows.map((r, i) => {
      const mode = "cell" in r.src ? "cell" : r.src.mode, at = "cell" in r.src ? r.src.cell : r.src.ref;
      return <div key={i} className="kpirow" data-row={i} style={ST.row}>
        <div style={ST.line}>
          <Field data-a="label" style={{ flex: "1 1 70px", minWidth: 0 }} placeholder="Label" title="The row's label (e.g. vs Bdg)" value={r.label || ""} onCommit={v => set("KPI row label", setRow(k, i, { label: v }))} />
          <button className="btn small" data-a="up" disabled={i === 0} title="Move up" onClick={() => set("Move KPI row", moveRow(k, i, -1))}>▲</button>
          <button className="btn small" data-a="down" disabled={i === rows.length - 1} title="Move down" onClick={() => set("Move KPI row", moveRow(k, i, 1))}>▼</button>
          <button className="btn small" data-a="remove" title="Remove this row" onClick={() => set("Remove KPI row", rowsPatch(k, rs => rs.filter((_, j) => j !== i)))}>✕</button>
        </div>
        <div style={ST.line}>
          <div className="seg small" data-a="src">{SRC.map(([m, l]) => <button key={m} data-src={m} className={mode === m ? "on" : ""}
            title={m === "cell" ? "The cell holds the change (e.g. a %)" : m === "pct" ? "% from a reference cell: (current − ref) / |ref|" : m === "abs" ? "Difference from a reference cell" : "Both"}
            onClick={() => set("KPI row source", sourcePatch(k, i, m))}>{l}</button>)}</div>
          <button className="btn small" data-a="cell" title={mode === "cell" ? "The cell holding the change" : "The reference cell"} onClick={() => pick(`row:${i}`)}><code>{refName(at)}</code></button>
        </div>
        <div style={ST.line}>
          <Good id={String(i)} v={r.good} on={g => set("KPI row direction", setRow(k, i, { good: g }))} />
          <Field data-a="num" style={{ flex: "1 1 60px", minWidth: 0 }} placeholder="format" title={mode === "both" ? "The format of the difference (the % shows 0.0%); empty = the value cell's" : mode === "abs" ? "The difference's number format; empty = the value cell's" : "The number format (e.g. 0.0%); empty = the cell's (computed %: 0.0%)"} value={r.num || ""} onCommit={v => set("KPI row format", setRow(k, i, { num: v.trim() || undefined }))} />
        </div>
      </div>;
    })}</div>
    <div className="row"><button className="btn small" id="kpiAddRow" onClick={() => set("Add KPI row", rowsPatch(k, rs => [...rs, newRow(k)]))}>+ Row</button></div>
    {issue && <div className="err" id="kpiIssue">{issue}</div>}
    <div className="row"><button className="btn small" id="kpiDelete" onClick={deleteItem}>Delete KPI card</button></div>
  </div>;
}
