/* The side panel of a series chart (S14.5, CT-08; docs/next/09 §2.2, §8 M14 – B30, B31): its series (add from cells of
   any sheet, a deck table's sheet or a linked workbook – PickCells –, remove, reorder, type and axis in a combo, colour,
   cells, x values, targets, name, line and marker, labels), the selected point (colour, marker, label, a waterfall's
   total), the axes (min / max / step, number format, gridlines, shown), the legend (place, hidden entries), category
   groups and their dividers, and the marks (an arrow from the floor, an icon or a text above a point, a line or a band
   to the next point); 4.10 (B52): the targets – reference lines from cells, gap arrows, change pills (ChartTargetsPanel.tsx).
   Each control is ONE item.patch (editor/chart-panel.ts: one undo step, only the entries it
   changes, so two writers on two series both win).
   Not offered: a stack per series (`sers[s].stack`) – PowerPoint's native charts stack a whole chart group, never one
   series apart, so the export could not draw it; the control is shown disabled with that reason (owner's rule: every
   feature works in the PowerPoint export). */
import { memo, useEffect, useState } from "react";
import { setDialogs, useStore } from "../state/store";
import { ctx, style } from "../state/app";
import type { ChartAxis, ChartItem, DataRef, ItemPatch, LegendAt, LineOrNone, SeriesType } from "@slide-builder/core/model/types";
import { chartLook } from "@slide-builder/core/render/chart-dl";
import { seriesData } from "@slide-builder/core/render/chart-data";
import { refText, selectItem } from "../editor/charts";
import type { ItemSel } from "../state/store";
import { isConsult } from "@slide-builder/core/model/designs";
import {
  COMBO_TYPES, addMarkPatch, allGroups, allSeries, axisPatch, groupPatch, labelsPatch, legendAtPatch, legendHidePatch, markAtText,
  markFits, markPatch, moveSeriesPatch, numOrNull, pointPatch, removeGroupPatch, removeMarkPatch, removeSeriesPatch, seriesPatch, stackPatch, type ChartRefWhat, type MarkKind, type PointSet,
} from "../editor/chart-panel";
import { chartChange } from "../editor/chart-send";
import { Input } from "./Input";
import { Field } from "./Field";
import { ChartTargets } from "./ChartTargetsPanel";

const LEGEND_AT: [LegendAt, string][] = [["right", "Right"], ["left", "Left"], ["top", "Top"], ["bottom", "Bottom"], ["top-right", "Top right"], ["inside-tl", "Inside, top left"], ["inside-tr", "Inside, top right"], ["none", "None"]];
const LABEL_SHOW = [["value", "Values"], ["name", "Series"], ["category", "Categories"], ["percent", "Shares"], ["ofTarget", "% of target"]] as const;
const POS_BAR = [["", "Default"], ["outEnd", "Outside end"], ["inEnd", "Inside end"], ["center", "Centre"], ["inBase", "Inside base"]] as const;
const POS_LINE = [["", "Default (right)"], ["above", "Above"], ["below", "Below"], ["left", "Left"], ["right", "Right"], ["center", "Centre"]] as const;
const MARKERS = ["", "circle", "square", "diamond", "triangle", "none"] as const;
const DIVIDERS = [["none", "No line"], ["solid", "Line"], ["dashed", "Dashed"], ["dotted", "Dotted"]] as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const pick = (id: string, ref: ChartRefWhat) => setDialogs({ pick: { kind: "chart-ref", id, ref } });
const refsText = (r: DataRef[] | undefined) => (r || []).map(refText).join(" + ") || "–";
/** how many points series `sid` draws now – its group's categories (a point's index counts from its group's start, as
    the stage's hits do); 0 when it draws none (hidden, its cells not found). Read when the panel draws and again when a
    mark is added: the chart's data (cached by the core) may have changed since (a reload) */
function pointsOf(c: ChartItem, sid: string): number {
  const D = seriesData(c, ctx()); if (!D.ok) return 0;
  const s = D.series.find(x => x.id === sid); if (!s) return 0;
  return D.groups.find(g => g.start === s.start)?.len ?? 0;
}
/** a number box (empty = automatic) */
function Num({ value, onCommit, title, id }: { value: number | undefined; onCommit: (v: number | null) => void; title: string; id?: string }) {
  return <Field className="num" id={id} title={title + " (empty = automatic)"} placeholder="auto" value={value === undefined ? "" : String(value)} onCommit={v => { const n = numOrNull(v); if (n !== undefined) onCommit(n); }} />;
}

/** (a keypress elsewhere on the slide makes a new runtime slide, its items new objects with the same content: the panel
    draws again only when the chart, its selection or the design changed – 09 §7.4 keypress budget) */
export const ChartSeriesPanel = memo(SeriesPanel, (a, b) => a.id === b.id && (a.sel === b.sel || JSON.stringify(a.sel) === JSON.stringify(b.sel)) && (a.c === b.c || JSON.stringify(a.c) === JSON.stringify(b.c)));
function SeriesPanel({ c, id, sel }: { c: ChartItem; id: string; sel: ItemSel }) {
  // the design (its palette: the swatches of series without a colour) – a string, so a new style object with the same
  // design draws nothing again
  const design = useStore(() => style().design);
  const set = (label: string, p: ItemPatch | null) => chartChange(label, id, p);
  const [open, setOpen] = useState<string | null>(null);
  const sers = allSeries(c), groups = allGroups(c), t = c.type, fall = t === "waterfall", scatter = t === "scatter", combo = t === "combo";
  const look = chartLook(ctx(), "Arial"), shown = sers.filter(([, s]) => !s.hide);
  const colorOf = (sid: string) => { const s = c.sers![sid]; if (typeof s.color === "string" && HEX.test(s.color)) return s.color.toUpperCase(); const k = shown.findIndex(([x]) => x === sid); return look.colors[Math.max(0, k) % look.colors.length]; };
  const typeOf = (st: SeriesType | undefined): SeriesType => st || (t === "bar" ? "bar" : t === "line" ? "line" : t === "area" ? "area" : scatter ? "scatter" : "column");
  const stackable = t === "column" || t === "bar" || t === "area" || combo;
  const cur = sel.point ? sers.find(([x]) => x === sel.point!.s) : null, curMark = sel.mark ? c.marks?.[sel.mark] : null;
  const curLen = cur && sel.point ? pointsOf(c, cur[0]) : 0;
  // a selected point or mark that no longer resolves (its series removed – ×, undo, another writer –, the point past its
  // series' end, the mark removed) leaves the selection: nothing may be added at it (S14.5 review 3)
  const stalePoint = !!sel.point && (!cur || !markFits(c, "arrow", sel.point, curLen)), staleMark = !!sel.mark && !curMark;
  useEffect(() => { if (stalePoint || staleMark) selectItem(id, sel.slice, { point: stalePoint ? null : sel.point, mark: staleMark ? null : sel.mark }); }, [id, stalePoint, staleMark, sel]);
  const usesY2 = sers.some(([, s]) => s.axis === "y2");
  return <div className="cser" id="chartSeriesPanel">
    {stackable && <div className="row"><span className="lbl">Stack</span><div className="seg small">
      {(["none", "stacked", "percent"] as const).map(v => <button key={v} data-stack={v} className={(c.stack || "none") === v ? "on" : ""} onClick={() => set("Chart stacking", stackPatch(v))}>{v === "none" ? "Side by side" : v === "stacked" ? "Stacked" : "100 %"}</button>)}</div></div>}
    {(t === "column" || t === "bar" || combo || fall) && <div className="row"><span className="lbl">Gap</span><Num id="chartGap" value={c.gap} title="The gap between the bars, % of a bar" onCommit={v => set("Chart gap", { gap: v === null ? null : Math.max(0, Math.min(500, v)) })} />
      {!fall && <><span className="lbl">Overlap</span><Num id="chartOverlap" value={c.overlap} title="How much the series' bars overlap, % (−100…100)" onCommit={v => set("Chart overlap", { overlap: v === null ? null : Math.max(-100, Math.min(100, v)) })} /></>}</div>}

    <details className="sec" id="chartSeries" open><summary>Series</summary>
      {sers.map(([sid, s], k) => {
        const st = typeOf(s.type), on = open === sid || sel.point?.s === sid, name = typeof s.name === "string" ? s.name : "";
        return <div key={sid} className={"ser" + (on ? " on" : "") + (s.hide ? " hid" : "")} data-ser={sid}>
          <div className="serhd">
            <label className="sw" title="The series' colour"><Input type="color" value={colorOf(sid)} onCommit={e => set("Series colour", seriesPatch(c, sid, { color: (e.target as HTMLInputElement).value.toUpperCase() }))} /><i style={{ background: colorOf(sid) }} /></label>
            {/* (Q3, owner 2026-10-21: the design's colours by default, a colour set here kept in every design – and ↺ back to the design's) */}
            {typeof s.color === "string" && <button className="btn small" data-a="sreset" title="The design's colour again" onClick={() => set("Series colour of the design", seriesPatch(c, sid, { color: null }))}>↺</button>}
            <Field className="nm" data-a="name" title="The series' name (Enter to apply); empty = the text beside its cells" value={name} placeholder={s.name && typeof s.name === "object" ? "From " + refText(s.name) : "From the cells"}
              onCommit={v => set("Series name", seriesPatch(c, sid, { name: v.trim() || null }))} />
            <button className="btn small" data-a="up" disabled={k === 0} title="One place up" onClick={() => set("Series order", moveSeriesPatch(c, sid, -1))}>↑</button>
            <button className="btn small" data-a="down" disabled={k === sers.length - 1} title="One place down" onClick={() => set("Series order", moveSeriesPatch(c, sid, 1))}>↓</button>
            <button className="btn small" data-a="more" title="Its cells, type, axis, line, labels" onClick={() => setOpen(on ? null : sid)}>{on ? "▾" : "▸"}</button>
            <button className="btn small" data-a="remove" title="Remove this series" onClick={() => set("Remove series", removeSeriesPatch(c, sid))}>×</button>
          </div>
          {on && <div className="serbody">
            <div className="row"><span className="lbl">Numbers</span><code>{refsText(s.vals)}</code><button className="btn small" data-a="vals" onClick={() => pick(id, { what: "vals", ser: sid })}>Change…</button></div>
            {scatter && <div className="row"><span className="lbl">X values</span><code>{s.xs ? refsText(s.xs) : "1, 2, 3 …"}</code><button className="btn small" data-a="xs" onClick={() => pick(id, { what: "xs", ser: sid })}>Choose…</button></div>}
            <div className="row"><span className="lbl">Name</span><button className="btn small" data-a="namecell" title="Its name from a cell: the legend follows the workbook" onClick={() => pick(id, { what: "name", ser: sid })}>From a cell…</button></div>
            {combo && <div className="row"><span className="lbl">Type</span><div className="seg small">{COMBO_TYPES.map(x => <button key={x} data-stype={x} className={st === x ? "on" : ""} onClick={() => set("Series type", seriesPatch(c, sid, { type: x }))}>{x === "column" ? "Column" : x === "line" ? "Line" : "Area"}</button>)}</div></div>}
            {!scatter && !fall && t !== "bar" && <div className="row"><span className="lbl">Axis</span><div className="seg small">
              {(["y", "y2"] as const).map(a => <button key={a} data-axis={a} className={(s.axis || "y") === a ? "on" : ""} onClick={() => set(a === "y2" ? "Series on the right axis" : "Series on the left axis", seriesPatch(c, sid, { axis: a === "y" ? null : a }))}>{a === "y" ? "Left" : "Right"}</button>)}</div></div>}
            {(st === "column" || st === "bar") && !fall && <div className="row"><span className="lbl">Target</span><code>{s.target ? refsText(s.target) : "–"}</code>
              <button className="btn small" data-a="target" title="Actual inside target: an outlined bar of each target over the value" onClick={() => pick(id, { what: "target", ser: sid })}>{s.target ? "Change…" : "Choose…"}</button>
              {s.target && <button className="btn small" data-a="notarget" onClick={() => set("Series without targets", seriesPatch(c, sid, { target: null }))}>Remove</button>}</div>}
            {(st === "line" || st === "scatter") && <div className="row"><span className="lbl">Line</span>
              <label className="chk"><Input type="checkbox" data-a="smooth" checked={!!s.smooth} onCommit={e => set("Smoothed line", seriesPatch(c, sid, { smooth: (e.target as HTMLInputElement).checked || null }))} />Smoothed</label>
              <select data-a="marker" value={s.marker?.shape || ""} title="Markers" onChange={e => { const v = (e.target as HTMLSelectElement).value; set("Series markers", seriesPatch(c, sid, { marker: v ? { ...(s.marker || {}), shape: v } : null })); }}>
                {MARKERS.map(m => <option key={m} value={m}>{m ? m[0].toUpperCase() + m.slice(1) : "Markers: default"}</option>)}</select></div>}
            {groups.length > 1 && !scatter && <div className="row"><span className="lbl">Group</span><select data-a="group" value={s.group && c.groups?.[s.group] ? s.group : groups[0][0]} onChange={e => set("Series group", seriesPatch(c, sid, { group: (e.target as HTMLSelectElement).value === groups[0][0] ? null : (e.target as HTMLSelectElement).value }))}>
              {groups.map(([gid, g]) => <option key={gid} value={gid}>{g.label || gid}</option>)}</select></div>}
            <Labels c={c} sid={sid} st={st} set={set} />
            <div className="row"><span className="lbl">Stack</span><select disabled data-a="serstack" title="PowerPoint's native charts stack a whole chart, never one series apart: a stack per series could not be exported, so it is not offered. Use the chart's Stack above."><option>With the chart</option></select>
              <span className="note">A stack per series can't be exported to PowerPoint, so it is off.</span></div>
            <div className="row"><label className="chk"><Input type="checkbox" data-a="hide" checked={!!s.hide} onCommit={e => set((e.target as HTMLInputElement).checked ? "Hide series" : "Show series", seriesPatch(c, sid, { hide: (e.target as HTMLInputElement).checked || null }))} />Hidden (kept, not drawn)</label></div>
          </div>}
        </div>;
      })}
      <div className="row"><button className="btn small" id="chartAddSeries" title="A series of other cells: any sheet, a linked workbook's too" onClick={() => pick(id, { what: "add" })}>+ Add series…</button>
        {fall && sers.length > 1 && <span className="note">A waterfall draws its first series.</span>}</div>
    </details>

    {cur && sel.point && !stalePoint && <PointBox c={c} sid={cur[0]} i={sel.point.i} fall={fall} line={typeOf(cur[1].type) === "line" || scatter} set={set} />}

    <details className="sec" id="chartAxes"><summary>Axes</summary>
      {(scatter ? ["x", "y"] : usesY2 ? ["y", "y2", "x"] : ["y", "x"]).map(ax => <AxisRow key={ax} c={c} ax={ax as "x" | "y" | "y2"} cat={ax === "x" && !scatter} grid={ax === "y" && !isConsult(design)} set={set} />)}
    </details>

    <details className="sec" id="chartLegend"><summary>Legend</summary>
      <div className="row"><span className="lbl">Place</span><select id="chartLegendAt" value={c.legendAt || (c.legend === "bottom" ? "bottom" : c.legend === "none" ? "none" : "right")} onChange={e => set("Chart legend", legendAtPatch((e.target as HTMLSelectElement).value as LegendAt))}>
        {LEGEND_AT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="row hides">{(fall ? [["up", "Increase"], ["down", "Decrease"], ["total", "Total"]] as [string, string][] : sers.filter(([, s]) => !s.hide).map(([sid, s]): [string, string] => [sid, typeof s.name === "string" && s.name ? s.name : sid]))
        .map(([key, l]) => <label key={key} className="chk"><Input type="checkbox" data-hide={key} checked={!c.legendHide?.[key]} onCommit={e => set("Legend entry", legendHidePatch(key, !(e.target as HTMLInputElement).checked))} />{l}</label>)}</div>
    </details>

    {!scatter && <details className="sec" id="chartGroups"><summary>Category groups</summary>
      {groups.map(([gid, g], k) => <div key={gid} className="row grp" data-group={gid}>
        <Field className="nm" data-a="glabel" title="The group's label under its categories (empty = none)" placeholder={gid} value={g.label || ""} onCommit={v => set("Group label", groupPatch(c, gid, { label: v.trim() || null }))} />
        <code>{Array.isArray(g.cats) ? g.cats.join(", ") : refText(g.cats)}</code>
        <button className="btn small" data-a="cats" onClick={() => pick(id, { what: "cats", group: gid })}>Cells…</button>
        {k > 0 && <select data-a="divider" title="The line before this group" value={dividerOf(g.divider)} onChange={e => { const v = (e.target as HTMLSelectElement).value; set("Group divider", groupPatch(c, gid, { divider: v === "none" ? "none" : { ...(typeof g.divider === "object" && g.divider ? g.divider : {}), dash: v } })); }}>
          {DIVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        <button className="btn small" data-a="remove" title="Remove this group (its series go to the first)" onClick={() => set("Remove group", removeGroupPatch(c, gid))}>×</button>
      </div>)}
      <div className="row"><button className="btn small" id="chartAddGroup" title="Categories side by side with these: another table, sheet or workbook" onClick={() => pick(id, { what: "group-add" })}>+ Add category group…</button></div>
    </details>}

    <ChartTargets c={c} id={id} set={set} sel={sel.point && !stalePoint ? sel.point : null} />

    <details className="sec" id="chartMarks" open={!!curMark && !["ref", "gap", "change"].includes(curMark.kind)}><summary>Marks</summary>
      {/* (B52's reference lines, gap arrows and change pills are under Targets) */}
      {Object.entries(c.marks || {}).filter(([, m]) => m && typeof m === "object" && m.kind !== "ref" && m.kind !== "gap" && m.kind !== "change").map(([mid, m]) => <div key={mid} className={"row mark" + (sel.mark === mid ? " on" : "")} data-mark={mid} onClick={() => selectItem(id, null, { mark: mid })}>
        <b>{m.kind}</b><span className="where">{markAtText(c, m.a)}</span>
        {m.kind === "text" && <Field className="nm" data-a="text" title="The mark's text; {Sheet!C7} quotes a cell" value={m.text || ""} onCommit={v => set("Mark text", markPatch(c, mid, { text: v }))} />}
        {m.kind === "icon" && <Field className="nm" data-a="icon" title="The icon's name (a built-in one, or tabler:<name>)" value={m.icon || ""} onCommit={v => set("Mark icon", markPatch(c, mid, { icon: v.trim() || null }))} />}
        <label className="sw" title="The mark's colour"><Input type="color" value={m.style?.color || m.fmt?.color || "#1F3864"} onCommit={e => { const v = (e.target as HTMLInputElement).value.toUpperCase(); set("Mark colour", markPatch(c, mid, m.kind === "text" ? { fmt: { ...(m.fmt || {}), color: v } } : { style: { ...(m.style || {}), color: v } })); }} /><i style={{ background: m.style?.color || m.fmt?.color || "#1F3864" }} /></label>
        {(m.kind === "icon" || m.kind === "text") && <Num value={m.dy} title="Up (−) or down (+) from its point, px" onCommit={v => set("Mark place", markPatch(c, mid, { dy: v }))} />}
        <button className="btn small" data-a="remove" title="Remove this mark" onClick={e => { e.stopPropagation(); set("Remove mark", removeMarkPatch(mid)); }}>×</button>
      </div>)}
      <div className="row adds">{(["arrow", "icon", "text", "line", "band"] as MarkKind[]).map(k => { const fits = !!cur && markFits(c, k, sel.point, curLen); return <button key={k} className="btn small" data-addmark={k} disabled={!fits}
        title={fits ? "At the selected point" : sel.point && cur && !stalePoint ? "The selected point is its series' last: there is no next point" : "Click a point of the chart first"}
        onClick={() => { if (sel.point) set("Add mark", addMarkPatch(c, k, sel.point, pointsOf(c, sel.point.s))); }}>
        {k === "arrow" ? "+ Arrow from the floor" : k === "icon" ? "+ Icon above" : k === "text" ? "+ Text above" : k === "line" ? "+ Line to the next" : "+ Band to the next"}</button>; })}</div>
    </details>

    <div className="row"><label className="chk"><Input type="checkbox" id="chartFrame" checked={!!c.frame && c.frame !== "none"} onCommit={e => set("Chart frame", { frame: (e.target as HTMLInputElement).checked ? { color: "#D9D9D9", w: 1 } : null })} />Frame</label>
      <label className="chk"><Input type="checkbox" id="chartRule" checked={!!c.titleRule && c.titleRule !== "none"} onCommit={e => set("Title rule", { titleRule: (e.target as HTMLInputElement).checked ? { w: 1.5 } : null })} />Line under the title</label></div>
  </div>;
}
const dividerOf = (d: LineOrNone | null | undefined) => !d || d === "none" || typeof d !== "object" ? "none" : d.dash === "dashed" || d.dash === "dotted" ? d.dash : "solid";

function Labels({ c, sid, st, set }: { c: ChartItem; sid: string; st: SeriesType; set: (l: string, p: ItemPatch | null) => void }) {
  const L = c.sers![sid].labels, show = L?.show ?? (c.type === "waterfall" ? ["value"] : []), bar = st === "column" || st === "bar";
  const allowed = LABEL_SHOW.filter(([k]) => (k !== "percent" || c.stack === "percent") && (k !== "ofTarget" || !!c.sers![sid].target));
  return <div className="row"><span className="lbl">Labels</span>
    {allowed.map(([k, l]) => <label key={k} className="chk"><Input type="checkbox" data-lshow={k} checked={show.includes(k)}
      onCommit={e => set("Series labels", labelsPatch(c, sid, { show: (e.target as HTMLInputElement).checked ? [...show.filter(x => x !== k), k] : show.filter(x => x !== k) }))} />{l}</label>)}
    {st !== "area" && <select data-a="lpos" value={L?.pos || ""} onChange={e => set("Label position", labelsPatch(c, sid, { show, pos: (e.target as HTMLSelectElement).value || null }))}>
      {(bar ? POS_BAR : POS_LINE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
  </div>;
}

function PointBox({ c, sid, i, fall, line, set }: { c: ChartItem; sid: string; i: number; fall: boolean; line: boolean; set: (l: string, p: ItemPatch | null) => void }) {
  const p = (c.sers![sid].points?.[String(i)] || {}) as PointSet, name = c.sers![sid].name;
  return <div className="sec pointbox" id="chartPoint" data-ser={sid} data-i={i}>
    <b>Point {i + 1} of {typeof name === "string" && name ? name : sid}</b>
    <div className="row"><span className="lbl">Colour</span><label className="sw"><Input type="color" data-a="pcolor" value={p.color || "#808080"} onCommit={e => set("Point colour", pointPatch(c, sid, i, { color: (e.target as HTMLInputElement).value.toUpperCase() }))} /><i style={{ background: p.color || "transparent" }} /></label>
      {line && <><span className="lbl">Marker</span><label className="sw"><Input type="color" data-a="pmarker" value={p.marker || "#808080"} onCommit={e => set("Point marker colour", pointPatch(c, sid, i, { marker: (e.target as HTMLInputElement).value.toUpperCase() }))} /><i style={{ background: p.marker || "transparent" }} /></label></>}
      {(p.color || p.marker) && <button className="btn small" data-a="preset" title="The series' colours again" onClick={() => set("Point colour of the series", pointPatch(c, sid, i, { color: null, marker: null }))}>↺</button>}</div>
    <div className="row"><span className="lbl">Label</span><Field className="nm" data-a="plabel" title="This point's own label (empty = as the series')" placeholder="As the series'" value={typeof p.label === "string" ? p.label : ""} onCommit={v => set("Point label", pointPatch(c, sid, i, { label: v.trim() ? v : undefined }))} />
      <label className="chk"><Input type="checkbox" data-a="pnolabel" checked={p.label === null} onCommit={e => set((e.target as HTMLInputElement).checked ? "Hide point label" : "Show point label", pointPatch(c, sid, i, { label: (e.target as HTMLInputElement).checked ? null : undefined }))} />No label</label></div>
    {fall && <div className="row"><label className="chk"><Input type="checkbox" data-a="ptotal" checked={p.total === true} onCommit={e => set("Waterfall total", pointPatch(c, sid, i, { total: (e.target as HTMLInputElement).checked || null }))} />A total (stands on the axis)</label></div>}
  </div>;
}

function AxisRow({ c, ax, cat, grid, set }: { c: ChartItem; ax: "x" | "y" | "y2"; cat: boolean; grid: boolean; set: (l: string, p: ItemPatch | null) => void }) {
  const A: ChartAxis = c.axes?.[ax] || {}, name = ax === "x" ? (cat ? "Categories" : "X axis") : ax === "y" ? "Left axis" : "Right axis";
  const up = (label: string, p: Partial<Record<keyof ChartAxis, unknown>>) => set(`${name}: ${label}`, axisPatch(c, ax, p));
  return <div className="axis" data-ax={ax}>
    <div className="row"><b>{name}</b><label className="chk"><Input type="checkbox" data-a="show" checked={A.show !== false} onCommit={e => up("shown", { show: (e.target as HTMLInputElement).checked ? null : false })} />Shown</label>
      {!cat && <label className="chk"><Input type="checkbox" data-a="grid" checked={A.grid ?? grid} onCommit={e => up("gridlines", { grid: (e.target as HTMLInputElement).checked })} />Gridlines</label>}</div>
    {/* (4.10.2) Min / Max / Step: three equal columns, each label above its box – tidy at any panel width */}
    {!cat && <div className="mms">
      <label><span className="lbl">Min</span><Num value={A.min} title="The axis's minimum" onCommit={v => up("minimum", { min: v })} /></label>
      <label><span className="lbl">Max</span><Num value={A.max} title="The axis's maximum" onCommit={v => up("maximum", { max: v })} /></label>
      <label><span className="lbl">Step</span><Num value={A.step} title="The step between its labels" onCommit={v => up("step", { step: v === null || v > 0 ? v : null })} /></label></div>}
    {!cat && <div className="row"><span className="lbl">Format</span><Field className="nm" data-a="num" title="Its number format, as Excel writes it (#,##0 · 0.0% …); empty = its cells'" placeholder="As the cells" value={A.num || ""} onCommit={v => up("number format", { num: v.trim() || null })} /></div>}
  </div>;
}
export type { MarkKind };
