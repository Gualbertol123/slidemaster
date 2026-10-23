/* The side panel of the selected chart (S9.3, B16; 07 §2.2): its type, labels, legend, title, a colour per slice, where its
   numbers come from (as text), delete. Each control is one item.patch (one undo step). The slices and their colours are
   the ones the worker drew (the stage's item info): the page has no sheet cells of a chart's source.
   4.7 (S14.5, CT-08): the type switch offers every chart type – a chart without series (a pie of one range) gets its
   first series from its own numbers (editor/chart-panel.ts typePatch) –, and a chart with series shows the series
   panel (ChartSeriesPanel.tsx) in place of the pie's labels, legend and slices. */
import { useMemo } from "react";
import { setDialogs, useStore } from "../state/store";
import { useStage } from "../stage/data";
import type { ChartItem, ItemPatch } from "@slide-builder/core/model/types";
import { deleteItem, itemOf, itemPatch, refText, selectItem } from "../editor/charts";
import { Input } from "./Input";
import { ChartSeriesPanel } from "./ChartSeriesPanel";
import { CHART_TYPES, typePatch } from "../editor/chart-panel";
import { hasSeries } from "@slide-builder/core/render/chart-data";
import "./chart-panel.css";
import { Field } from "./Field";
import { TextFmtBox } from "./TextFmtBox";
import { fmtMapPatch } from "../editor/textparts";
import { useCurSlide } from "./hooks";

const SHOW = [["label", "Names"], ["value", "Values"], ["percent", "Percent"]] as const;
export function ChartPanel() {
  const itemSel = useStore(s => s.selection.itemSel), R = useCurSlide();
  // what the panel shows of the drawn chart (its slices, an Issues line), compared as JSON: another stage answer with
  // the same chart re-renders nothing
  const infoJson = useStage(s => { const x = itemSel && s.shown?.id === R?.id ? s.shown?.items?.[itemSel.id] : null; return x ? JSON.stringify({ issue: x.issue, slices: x.geom?.slices ?? [] }) : ""; });
  const info = useMemo(() => infoJson ? JSON.parse(infoJson) as { issue: string | null; slices: { i: number; label: string; color: string }[] } : null, [infoJson]);
  const it = itemOf(itemSel?.id, R);
  if (!itemSel || !it || it.kind !== "chart" || !R) return null;
  const c = it as ChartItem, id = itemSel.id, show = c.show ?? ["percent"], legend = c.legend ?? "right";
  const set = (label: string, p: ItemPatch) => itemPatch(label, id, p);
  const slices = info?.slices ?? [], series = hasSeries(c);
  // (the type the chart draws as: one without series draws as a pie, whatever its type says – 09 §2.2)
  const drawn = series ? c.type : c.type === "donut" ? "donut" : "pie";
  return <div className="chartpanel" id="chartPanel" data-item={id}>
    <h4>Chart</h4>
    <div className="row typerow"><span className="lbl">Type</span><div className="seg small ctypes">
      {CHART_TYPES.map(({ t, label }) => <button key={t} data-ctype={t} className={drawn === t ? "on" : ""} onClick={() => set(label + " chart", typePatch(c, t))}>{label}</button>)}</div></div>
    <div className="row"><span className="lbl">Title</span>
      <Field className="ctitle" id="chartTitle" title="The chart's title (Enter to apply); empty = no title" value={typeof c.title === "string" ? c.title : ""}
        placeholder={typeof c.title === "string" ? "No title" : "From the data"} onCommit={v => set("Chart title", { title: v.trim() })} />
      <button className="btn small" id="chartTitleAuto" disabled={typeof c.title !== "string"} title="The name of the numbers as the title (the header above them)" onClick={() => set("Chart title from the data", { title: null })}>Auto</button></div>
    {/* (B56) the title's and all labels' text: font, size, colour, bold, italic (the title's alignment too) */}
    {series && <TextFmtBox id="chart-title" label="Title text" value={c.titleFmt} dflt={{ b: true, align: "center" }} onChange={(l, f) => set(l, { titleFmt: fmtMapPatch(c.titleFmt, f) })} />}
    <TextFmtBox id="chart-labels" label="All labels" value={c.fmt} can={{ align: false }} onChange={(l, f) => set(l, { fmt: fmtMapPatch(c.fmt, f) })} />
    {series ? <ChartSeriesPanel c={c} id={id} sel={itemSel} /> : <>
    <div className="row"><span className="lbl">Labels</span>
      {SHOW.map(([k, l]) => <label key={k} className="chk"><Input type="checkbox" data-show={k} checked={show.includes(k)}
        onCommit={e => set("Chart labels", { show: (e.target as HTMLInputElement).checked ? [...SHOW.map(s => s[0]).filter(x => x === k || show.includes(x))] : show.filter(x => x !== k) })} />{l}</label>)}</div>
    <div className="row"><span className="lbl">Legend</span><div className="seg small">
      {(["right", "bottom", "none"] as const).map(v => <button key={v} data-legend={v} className={legend === v ? "on" : ""} onClick={() => set("Chart legend", { legend: v })}>{v === "none" ? "None" : v === "right" ? "Right" : "Below"}</button>)}</div></div>
    {slices.length > 0 && <div className="slices" id="chartSlices">{slices.map(s => {
      const own = c.colors?.[String(s.i)];
      return <div key={s.i} className={"slice" + (itemSel.slice === s.i ? " on" : "")} data-slice={s.i} onClick={() => selectItem(id, s.i)}>
        <label className="sw" title="Colour of this slice"><Input type="color" value={s.color} onCommit={e => set("Slice colour", { colors: { [s.i]: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: s.color }} /></label>
        <span className="nm">{s.label}</span>
        {own && <button className="btn small" data-reset={s.i} title="The design's colour again" onClick={e => { e.stopPropagation(); set("Slice colour of the design", { colors: { [s.i]: null } }); }}>↺</button>}
      </div>;
    })}</div>}
    <div className="row"><button className="btn small" id="chartCells" title="Choose other cells for this chart in the sheet view" onClick={() => setDialogs({ pick: { kind: "chart-cells", id } })}>Change the cells…</button></div>
    <div className="src" id="chartSource">Numbers: <code>{refText(c.values)}</code>{c.labels ? <> · names: <code>{refText(c.labels)}</code></> : null}{c.attach ? " · beside its table" : ""}</div>
    </>}
    {info?.issue && <div className="err" id="chartIssue">{info.issue}</div>}
    <div className="row"><button className="btn small" id="chartDelete" onClick={deleteItem}>Delete chart</button></div>
  </div>;
}
