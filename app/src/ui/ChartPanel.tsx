/* The side panel of the selected chart (S9.3, B16; 07 §2.2): its type, labels, legend, title, a colour per slice, where its
   numbers come from (as text), delete. Each control is one item.patch (one undo step). The slices and their colours are
   the ones the worker drew (the stage's item info): the page has no sheet cells of a chart's source. */
import { useStore } from "../state/store";
import { useStage } from "../stage/data";
import type { ChartItem } from "@slide-builder/core/model/types";
import { deleteItem, itemOf, itemPatch, refText, selectItem } from "../editor/charts";
import { Input } from "./Input";
import { Field } from "./Field";
import { useCurSlide } from "./hooks";

const SHOW = [["label", "Names"], ["value", "Values"], ["percent", "Percent"]] as const;
export function ChartPanel() {
  const itemSel = useStore(s => s.selection.itemSel), R = useCurSlide();
  const info = useStage(s => itemSel && s.shown?.id === R?.id ? s.shown?.items?.[itemSel.id] ?? null : null);
  const it = itemOf(itemSel?.id, R);
  if (!itemSel || !it || it.kind !== "chart" || !R) return null;
  const c = it as ChartItem, id = itemSel.id, show = c.show ?? ["percent"], legend = c.legend ?? "right";
  const set = (label: string, p: Record<string, unknown>) => itemPatch(label, id, p);
  const slices = info?.geom?.slices ?? [];
  return <div className="chartpanel" id="chartPanel" data-item={id}>
    <h4>Chart</h4>
    <div className="row"><span className="lbl">Type</span><div className="seg small">
      {(["pie", "donut"] as const).map(t => <button key={t} data-ctype={t} className={(c.type === "donut" ? "donut" : "pie") === t ? "on" : ""} onClick={() => set(t === "pie" ? "Pie chart" : "Donut chart", { type: t })}>{t === "pie" ? "Pie" : "Donut"}</button>)}</div></div>
    <div className="row"><span className="lbl">Labels</span>
      {SHOW.map(([k, l]) => <label key={k} className="chk"><Input type="checkbox" data-show={k} checked={show.includes(k)}
        onCommit={e => set("Chart labels", { show: (e.target as HTMLInputElement).checked ? [...SHOW.map(s => s[0]).filter(x => x === k || show.includes(x))] : show.filter(x => x !== k) })} />{l}</label>)}</div>
    <div className="row"><span className="lbl">Legend</span><div className="seg small">
      {(["right", "bottom", "none"] as const).map(v => <button key={v} data-legend={v} className={legend === v ? "on" : ""} onClick={() => set("Chart legend", { legend: v })}>{v === "none" ? "None" : v === "right" ? "Right" : "Below"}</button>)}</div></div>
    <div className="row"><span className="lbl">Title</span>
      <Field className="ctitle" id="chartTitle" title="The chart's title (Enter to apply); empty = no title" value={typeof c.title === "string" ? c.title : ""}
        placeholder={typeof c.title === "string" ? "No title" : "From the data"} onCommit={v => set("Chart title", { title: v.trim() })} />
      <button className="btn small" id="chartTitleAuto" disabled={typeof c.title !== "string"} title="The name of the numbers as the title (the header above them)" onClick={() => set("Chart title from the data", { title: null })}>Auto</button></div>
    {slices.length > 0 && <div className="slices" id="chartSlices">{slices.map(s => {
      const own = c.colors?.[String(s.i)];
      return <div key={s.i} className={"slice" + (itemSel.slice === s.i ? " on" : "")} data-slice={s.i} onClick={() => selectItem(id, s.i)}>
        <label className="sw" title="Colour of this slice"><Input type="color" value={s.color} onCommit={e => set("Slice colour", { colors: { [s.i]: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: s.color }} /></label>
        <span className="nm">{s.label}</span>
        {own && <button className="btn small" data-reset={s.i} title="The design's colour again" onClick={e => { e.stopPropagation(); set("Slice colour of the design", { colors: { [s.i]: null } }); }}>↺</button>}
      </div>;
    })}</div>}
    <div className="src" id="chartSource">Numbers: <code>{refText(c.values)}</code>{c.labels ? <> · names: <code>{refText(c.labels)}</code></> : null}{c.attach ? " · beside its table" : ""}</div>
    {info?.issue && <div className="err" id="chartIssue">{info.issue}</div>}
    <div className="row"><button className="btn small" id="chartDelete" onClick={deleteItem}>Delete chart</button></div>
  </div>;
}
