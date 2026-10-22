/* The chart panel's targets (4.10, B52; ADR-015 amendment of 2026-10-22): reference lines whose value comes from a cell
   of any sheet (picked in the sheet view, as a series' cells are – PickCells "chart-ref"; a typed number only as the
   fallback), gap arrows from a point to a line, change pills between consecutive points – each switched on / off and
   styled here, each control ONE item.patch of one marks entry (editor/chart-panel.ts: one undo step; two writers on two
   lines both keep theirs). The point value labels are the series' own (M14's Labels), offered here too for the series
   the extras stand on. */
import { ctx } from "../state/app";
import { setDialogs } from "../state/store";
import type { ChartItem, ChartMark, ItemPatch } from "@slide-builder/core/model/types";
import { chartLook } from "@slide-builder/core/render/chart-dl";
import { seriesData } from "@slide-builder/core/render/chart-data";
import { targetLook } from "@slide-builder/core/render/chart-targets";
import { refText } from "../editor/charts";
import { addChangePatch, addGapPatch, addRefPatch, allSeries, labelsPatch, markOnPatch, markPatch, numOrNull, refMarks, removeMarkPatch, removeRefPatch, type ChartRefWhat } from "../editor/chart-panel";
import { Input } from "./Input";
import { Field } from "./Field";

const HEX = /^#[0-9A-Fa-f]{6}$/;
type Set = (label: string, p: ItemPatch | null) => void;
const pick = (id: string, ref: ChartRefWhat) => setDialogs({ pick: { kind: "chart-ref", id, ref } });
const DASHES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]] as const;
const SHOW = [["both", "Name and value"], ["name", "Name"], ["value", "Value"], ["none", "No label"]] as const;
const RPOS = [["right", "Right, outside the plot"], ["inside", "Right, on the line"], ["above", "Above the right end"], ["below", "Below the right end"], ["left", "Above the left end"]] as const;
/* (B53) more places: the gap label's side and caption, the arrow's direction; the pills' rows and caption */
const GLAB = [["", "Label beside the arrow"], ["right", "Label right of the arrow"], ["left", "Label left of the arrow"]] as const;
const GFROM = [["", "From the line to the point"], ["point", "From the point to the line"]] as const;
const GCAP = [["", "Caption under"], ["above", "Caption over"]] as const;
const CPOS = [["axis", "Above the axis"], ["line", "Under the line"], ["point", "Under each point"], ["above", "Along the top"], ["below", "Below the axis labels"]] as const;
const CCAP = [["", "Caption left"], ["right", "Caption right"], ["below", "Caption under the row"]] as const;
const HEADS = [["end", "Head at the point"], ["start", "Head at the line"], ["both", "Both heads"], ["none", "No head"]] as const;
const headsOf = (k: ChartMark) => { const h = k.style?.heads; if (!h) return "end"; return h.a && h.a !== "none" ? h.b && h.b !== "none" ? "both" : "start" : h.b && h.b !== "none" ? "end" : "none"; };
const headsVal = (v: string) => v === "end" ? null : v === "start" ? { a: "triangle" as const } : v === "both" ? { a: "triangle" as const, b: "triangle" as const } : { a: "none" as const, b: "none" as const };
const nameOf = (k: ChartMark, mid: string) => typeof k.name === "string" && k.name ? k.name : k.name && typeof k.name === "object" ? refText(k.name) : mid;

/** whether this chart draws targets (column, line, area and combo charts: chart-series.ts refOk) */
export const targetsDrawn = (c: ChartItem) => c.type === "column" || c.type === "line" || c.type === "area" || c.type === "combo";

export function ChartTargets({ c, id, set, sel }: { c: ChartItem; id: string; set: Set; sel: { s: string; i: number } | null }) {
  const marks = Object.entries(c.marks && typeof c.marks === "object" ? c.marks : {}).filter(([, k]) => k && typeof k === "object");
  const refs = refMarks(c), gaps = marks.filter(([, k]) => k.kind === "gap"), chgs = marks.filter(([, k]) => k.kind === "change");
  const sers = allSeries(c).filter(([, s]) => !s.hide), look = targetLook(ctx(), chartLook(ctx(), "Arial").ink);
  const mp = (label: string, mid: string, p: Partial<Record<keyof ChartMark, unknown>>) => set(label, markPatch(c, mid, p));
  const on = (mid: string, k: ChartMark, what: string) => <label className="chk" title="Shown (off: kept, not drawn)"><Input type="checkbox" data-a="on" checked={!k.off} onCommit={e => set(((e.target as HTMLInputElement).checked ? "Show " : "Hide ") + what, markOnPatch(c, mid, (e.target as HTMLInputElement).checked))} /></label>;
  // (a reference line goes with its gap arrows: one step)
  const del = (mid: string, what: string) => <button className="btn small" data-a="remove" title={"Remove this " + what + (what === "reference line" ? " (and its gap arrows)" : "")}
    onClick={() => set("Remove " + what, what === "reference line" ? removeRefPatch(c, mid) : removeMarkPatch(mid))}>×</button>;
  const serSel = (mid: string, k: ChartMark, a: string, what: string) => <select data-a={a} title="The series it stands on" value={k.a && "s" in k.a ? k.a.s : ""} onChange={e => mp(what + " series", mid, { a: { s: (e.target as HTMLSelectElement).value, i: k.a && "s" in k.a ? k.a.i : -1 } })}>
    {sers.map(([sid, s]) => <option key={sid} value={sid}>{typeof s.name === "string" && s.name ? s.name : sid}</option>)}</select>;
  // (the first value of the first series: a typed line's starting value)
  const firstValue = () => { const D = seriesData(c, ctx()); return D.ok ? D.series[0]?.vals.find(v => v !== null) ?? 0 : 0; };
  const valueSer = sers.find(([, s]) => s.type === "line") || sers[0];
  if (!targetsDrawn(c)) return <details className="sec" id="chartTargets"><summary>Targets</summary><span className="note">Reference lines, gap arrows and change pills are drawn on column, line, area and combo charts.</span></details>;
  return <details className="sec" id="chartTargets" open={marks.some(([, k]) => k.kind === "ref" || k.kind === "gap" || k.kind === "change")}><summary>Targets</summary>
    {valueSer && <div className="row"><label className="chk"><Input type="checkbox" data-a="tvalues" checked={(c.sers![valueSer[0]].labels?.show || []).includes("value")}
      onCommit={e => { const show = c.sers![valueSer[0]].labels?.show || [], v = (e.target as HTMLInputElement).checked; set(v ? "Point values" : "No point values", labelsPatch(c, valueSer[0], { show: v ? [...show.filter(x => x !== "value"), "value"] : show.filter(x => x !== "value"), ...(v && !c.sers![valueSer[0]].labels?.pos && (c.type === "line" || c.sers![valueSer[0]].type === "line") ? { pos: "above" } : {}) })); }} />Point values</label></div>}

    <b className="sub">Reference lines</b>
    {refs.map(([mid, k]) => {
      const st = k.style || {}, color = HEX.test(st.color || "") ? st.color! : look.refs[refs[0][0] === mid ? 0 : 1];
      return <div key={mid} className={"ref" + (k.off ? " hid" : "")} data-ref={mid}>
        <div className="row">{on(mid, k, "reference line")}
          <Field className="nm" data-a="rname" title="The line's name (Enter to apply); empty = none" placeholder={k.name && typeof k.name === "object" ? "From " + refText(k.name) : "Name"} value={typeof k.name === "string" ? k.name : ""}
            onCommit={v => mp("Reference line name", mid, { name: v.trim() || null })} />
          <button className="btn small" data-a="rnamecell" title="Its name from a cell: the label follows the workbook" onClick={() => pick(id, { what: "ref-name", mark: mid })}>Name cell…</button>
          {del(mid, "reference line")}</div>
        <div className="row"><span className="lbl">Value</span><code>{k.value && typeof k.value === "object" ? refText(k.value) : typeof k.value === "number" ? "typed" : "–"}</code>
          <button className="btn small" data-a="rvalue" title="The cell holding the line's value: the line follows the workbook, a reload and a scenario" onClick={() => pick(id, { what: "ref-value", mark: mid })}>Cell…</button>
          <Field className="num" data-a="rtyped" title="A typed value instead of a cell (the fallback; Enter to apply)" placeholder="typed" value={typeof k.value === "number" ? String(k.value) : ""}
            onCommit={v => { const n = numOrNull(v); if (n !== undefined && n !== null) mp("Reference line typed value", mid, { value: n }); }} /></div>
        <div className="row"><span className="lbl">Line</span>
          <select data-a="rdash" value={st.dash === "dotted" || st.dash === "solid" ? st.dash : st.dash === "dashdot" ? "dashed" : "dashed"} onChange={e => mp("Reference line dash", mid, { style: { ...st, dash: (e.target as HTMLSelectElement).value } })}>
            {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label className="sw" title="The line's colour"><Input type="color" data-a="rcolor" value={color} onCommit={e => mp("Reference line colour", mid, { style: { ...st, color: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: color }} /></label>
          <Field className="num" data-a="rw" title="Its width, px (empty = 1.5)" placeholder="1.5" value={st.w === undefined ? "" : String(st.w)} onCommit={v => { const n = numOrNull(v, .25, 20); if (n !== undefined) mp("Reference line width", mid, { style: { ...st, w: n ?? undefined } }); }} /></div>
        <div className="row"><span className="lbl">Label</span>
          <select data-a="rshow" value={k.show || "both"} onChange={e => { const v = (e.target as HTMLSelectElement).value; mp("Reference line label", mid, { show: v === "both" ? null : v }); }}>{SHOW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select data-a="rpos" value={RPOS.some(([v]) => v === k.pos) ? k.pos : "right"} onChange={e => { const v = (e.target as HTMLSelectElement).value; mp("Reference line label place", mid, { pos: v === "right" ? null : v }); }}>{RPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>;
    })}
    <div className="row"><button className="btn small" id="chartAddRef" title="A line across the plot at a cell's value (a budget, an ambition): it follows the workbook" onClick={() => pick(id, { what: "ref-add" })}>+ Reference line from a cell…</button>
      <button className="btn small" id="chartAddRefTyped" title="A line at a typed value (the fallback: it does not follow the workbook)" onClick={() => set("Add reference line", addRefPatch(c, firstValue()))}>+ Typed</button></div>

    <b className="sub">Gap arrows</b>
    {gaps.map(([mid, k]) => {
      const S = k.signs, fixed = S === "fixed", own = HEX.test(k.style?.color || "") ? k.style!.color! : look.neg;
      const i = k.a && "s" in k.a ? k.a.i : -1, D = seriesData(c, ctx()), sd = D.ok ? D.series.find(x => x.id === (k.a && "s" in k.a ? k.a.s : "")) : null;
      const n = sd && D.ok ? D.groups.find(g => g.start === sd.start)?.len ?? 0 : 0;
      return <div key={mid} className={"gap" + (k.off ? " hid" : "")} data-gap={mid}>
        <div className="row">{on(mid, k, "gap arrow")}
          <select data-a="gref" title="The reference line it points to" value={k.ref || ""} onChange={e => mp("Gap arrow line", mid, { ref: (e.target as HTMLSelectElement).value })}>
            {refs.map(([rid, r]) => <option key={rid} value={rid}>{nameOf(r, rid)}</option>)}</select>
          {serSel(mid, k, "gser", "Gap arrow")}
          <select data-a="gpoint" title="The point it starts from" value={String(i)} onChange={e => mp("Gap arrow point", mid, { a: { s: k.a && "s" in k.a ? k.a.s : sers[0]?.[0], i: +(e.target as HTMLSelectElement).value } })}>
            <option value="-1">Last point</option>{Array.from({ length: n }, (_, j) => <option key={j} value={j}>{"Point " + (j + 1)}</option>)}</select>
          {del(mid, "gap arrow")}</div>
        <div className="row"><span className="lbl">Label</span>
          <Field className="nm" data-a="gcaption" title="The small text under the difference (Enter to apply)" placeholder="no caption" value={typeof k.caption === "string" ? k.caption : "gap"} onCommit={v => mp("Gap arrow caption", mid, { caption: v })} />
          <label className="chk"><Input type="checkbox" data-a="gpct" checked={!!k.pct} onCommit={e => mp("Gap arrow %", mid, { pct: (e.target as HTMLInputElement).checked || null })} />%</label>
          <Field className="num" data-a="gnum" title="The difference's number format (empty = the line's cell's)" placeholder="as the cell" value={k.num || ""} onCommit={v => mp("Gap arrow format", mid, { num: v.trim() || null })} /></div>
        <div className="row"><span className="lbl">Arrow</span>
          <select data-a="gside" value={k.pos === "left" ? "left" : "right"} onChange={e => mp("Gap arrow side", mid, { pos: (e.target as HTMLSelectElement).value === "left" ? "left" : null })}><option value="right">Right of the point</option><option value="left">Left of the point</option></select>
          <select data-a="gheads" value={headsOf(k)} onChange={e => { const h = headsVal((e.target as HTMLSelectElement).value), st = { ...(k.style || {}) }; if (h) st.heads = h; else delete st.heads; mp("Gap arrow heads", mid, { style: Object.keys(st).length ? st : null }); }}>
            {HEADS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select data-a="gsigns" value={fixed ? "fixed" : "sign"} onChange={e => mp("Gap arrow colours", mid, { signs: (e.target as HTMLSelectElement).value === "fixed" ? "fixed" : null })}><option value="sign">Colour by sign</option><option value="fixed">One colour</option></select>
          {fixed && <label className="sw" title="Its colour"><Input type="color" data-a="gcolor" value={own} onCommit={e => mp("Gap arrow colour", mid, { style: { ...(k.style || {}), color: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: own }} /></label>}</div>
        <div className="row"><span className="lbl">Places</span>
          <select data-a="gfrom" title="The arrow's direction" value={k.from === "point" ? "point" : ""} onChange={e => mp("Gap arrow direction", mid, { from: (e.target as HTMLSelectElement).value || null })}>{GFROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select data-a="glabel" title="Where its label stands" value={k.labelSide === "left" || k.labelSide === "right" ? k.labelSide : ""} onChange={e => mp("Gap label side", mid, { labelSide: (e.target as HTMLSelectElement).value || null })}>{GLAB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select data-a="gcap" title="The caption under or over the difference" value={k.capPos === "above" ? "above" : ""} onChange={e => mp("Gap caption place", mid, { capPos: (e.target as HTMLSelectElement).value || null })}>{GCAP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>;
    })}
    <div className="row"><button className="btn small" id="chartAddGap" disabled={!refs.length || !sers.length} title={refs.length ? "An arrow from a point (the selected one, else the last) to the first reference line, with the live difference" : "Add a reference line first"}
      onClick={() => set("Add gap arrow", addGapPatch(c, sel))}>+ Gap arrow</button></div>

    <b className="sub">Change pills</b>
    {chgs.map(([mid, k]) => {
      const S = k.signs && typeof k.signs === "object" ? k.signs : {}, fixed = k.signs === "fixed";
      const sw = (key: "pos" | "neg" | "zero", dflt: string, title: string) => { const v = HEX.test(S[key] || "") ? S[key]! : dflt;
        return <label className="sw" title={title}><Input type="color" data-a={"c" + key} value={v} onCommit={e => mp("Change pill colours", mid, { signs: { ...S, [key]: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: v }} /></label>; };
      return <div key={mid} className={"chg" + (k.off ? " hid" : "")} data-chg={mid}>
        <div className="row">{on(mid, k, "change pills")}{serSel(mid, k, "cser", "Change pills")}
          <label className="chk"><Input type="checkbox" data-a="cabs" checked={k.abs !== false} onCommit={e => mp("Change pills: absolute", mid, { abs: (e.target as HTMLInputElement).checked ? null : false })} />Change</label>
          <label className="chk"><Input type="checkbox" data-a="cpct" checked={k.pct !== false} onCommit={e => mp("Change pills: %", mid, { pct: (e.target as HTMLInputElement).checked ? null : false })} />%</label>
          {del(mid, "change pills")}</div>
        <div className="row"><select data-a="cpairs" value={k.pairs === "last" ? "last" : "all"} onChange={e => mp("Change pills: pairs", mid, { pairs: (e.target as HTMLSelectElement).value === "last" ? "last" : null })}><option value="all">Every pair</option><option value="last">The last pair</option></select>
          <select data-a="cposition" value={CPOS.some(([v]) => v === k.pos) ? k.pos : "axis"} onChange={e => { const v = (e.target as HTMLSelectElement).value; mp("Change pills: place", mid, { pos: v === "axis" ? null : v }); }}>{CPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <Field className="num" data-a="cnum" title="The change's number format (empty = the series' cells')" placeholder="as the cells" value={k.num || ""} onCommit={v => mp("Change pills: format", mid, { num: v.trim() || null })} /></div>
        <div className="row"><Field className="nm" data-a="ccaption" title="The caption above the pills (Enter to apply; empty = none)" placeholder="no caption" value={k.caption || ""} onCommit={v => mp("Change pills: caption", mid, { caption: v.trim() || null })} />
          <select data-a="csigns" value={fixed ? "fixed" : "sign"} onChange={e => mp("Change pill colours", mid, { signs: (e.target as HTMLSelectElement).value === "fixed" ? "fixed" : null })}><option value="sign">Colour by sign</option><option value="fixed">One colour</option></select>
          <select data-a="ccap" title="Where the caption stands" value={k.capPos === "right" || k.capPos === "below" ? k.capPos : ""} onChange={e => mp("Change pills: caption place", mid, { capPos: (e.target as HTMLSelectElement).value || null })}>{CCAP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {!fixed && <>{sw("pos", look.pos, "A rise")}{sw("neg", look.neg, "A fall")}{sw("zero", look.zero, "No change")}</>}
          {fixed && <label className="sw" title="Their colour"><Input type="color" data-a="ccolor" value={HEX.test(k.style?.color || "") ? k.style!.color! : look.zero} onCommit={e => mp("Change pill colours", mid, { style: { ...(k.style || {}), color: (e.target as HTMLInputElement).value.toUpperCase() } })} /><i style={{ background: k.style?.color || look.zero }} /></label>}</div>
      </div>;
    })}
    <div className="row"><button className="btn small" id="chartAddChange" disabled={!sers.length} title="Pills between consecutive points: the change and its %, coloured by sign" onClick={() => set("Add change pills", addChangePatch(c, sel?.s))}>+ Change pills</button></div>
  </details>;
}
