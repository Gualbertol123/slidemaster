/* The chart panel's card (4.13, B54; ADR-015 amendment of 2026-10-23): the parts a series chart draws inside its box –
   the stats row's chips (a label over the last / first / previous / lowest / highest value, a cell, the reference line's
   value, the gap to it), the corner tag (text or a cell, its colour), the separator, the momentum row (vs the first
   value, since the trough / peak, vs the previous value, vs a cell; abs / % / both; the good direction) and the long
   table's filter (a column and the value to keep, typed or from a cell). Each control is ONE item.patch (one undo step);
   cells are picked in the sheet view (PickCells "chart-ref"), never typed. The rows wrap at the side panel's narrow
   widths (4.10.2: 280 px up). */
import { setDialogs } from "../state/store";
import type { ChartItem, ChartMom, ChartStat, ItemPatch } from "@slide-builder/core/model/types";
import { refText } from "../editor/charts";
import type { ChartRefWhat } from "../editor/chart-panel";
import { addMomPatch, addStatPatch, cardPresetPatch, filterPatch, momPatch, removeMomPatch, removeStatPatch, statPatch, tagPatch } from "../editor/chart-card";
import { MAX_MOMS, MAX_STATS } from "@slide-builder/core/render/chart-card";
import { Input } from "./Input";
import { Field } from "./Field";
import { TextFmtBox } from "./TextFmtBox";
import { layPatch, textsPatch } from "../editor/textparts";
import { layNum, layWord } from "@slide-builder/core/model/textparts";

type Set = (label: string, p: ItemPatch | null) => void;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const pick = (id: string, ref: ChartRefWhat) => setDialogs({ pick: { kind: "chart-ref", id, ref } });
const SRC: [ChartStat["src"], string][] = [["last", "Last value"], ["first", "First value"], ["prev", "Previous value"], ["min", "Lowest"], ["max", "Highest"], ["cell", "A cell"], ["ref", "Reference line"], ["gap", "Gap to the line"], ["gapPct", "Gap to the line, %"]];
const VS: [ChartMom["vs"], string][] = [["first", "vs the first"], ["trough", "Since the trough"], ["peak", "Since the peak"], ["prev", "vs the previous"], ["cell", "vs a cell"]];
const SHOW = [["both", "Abs and %"], ["abs", "Absolute"], ["pct", "%"]] as const;
const GOOD = [["up", "Up is good"], ["down", "Down is good"], ["neutral", "Neutral"]] as const;
const byN = <T extends { n: number }>(m: Record<string, T> | undefined) => Object.entries(m || {}).filter(([, x]) => x && typeof x === "object").sort(([a, p], [b, q]) => (+p.n || 0) - (+q.n || 0) || (a < b ? -1 : 1));

export function ChartCard({ c, id, set }: { c: ChartItem; id: string; set: Set }) {
  const stats = byN(c.stats), moms = byN(c.moms), refs = Object.entries(c.marks || {}).filter(([, k]) => k && k.kind === "ref").map(([rid, k]) => [rid, typeof k.name === "string" && k.name ? k.name : rid] as const);
  const sers = Object.entries(c.sers || {}).filter(([, s]) => s && !s.hide);
  const any = stats.length > 0 || moms.length > 0 || !!c.tag || !!c.sep || !!c.filter;
  const on = (k: { off?: boolean }, what: string, p: (on: boolean) => ItemPatch | null) => <label className="chk" title="Shown (off: kept, not drawn)"><Input type="checkbox" data-a="on" checked={!k.off} onCommit={e => set(((e.target as HTMLInputElement).checked ? "Show " : "Hide ") + what, p((e.target as HTMLInputElement).checked))} /></label>;
  const serSel = (cur: string | undefined, f: (v: string | null) => void) => sers.length > 1 ? <select data-a="ser" title="The series it reads" value={cur || ""} onChange={e => f((e.target as HTMLSelectElement).value || null)}>
    <option value="">First series</option>{sers.map(([sid, s]) => <option key={sid} value={sid}>{typeof s.name === "string" && s.name ? s.name : sid}</option>)}</select> : null;
  const good = (cur: string | undefined, f: (v: string | null) => void) => <select data-a="good" title="Which way is good: the colour of a rise and a fall" value={cur || "up"} onChange={e => { const v = (e.target as HTMLSelectElement).value; f(v === "up" ? null : v); }}>
    {GOOD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  const tagColor = HEX.test(c.tag?.color || "") ? c.tag!.color! : "#6B7280";
  return <details className="sec" id="chartCard" open={any}><summary>Card</summary>
    {!any && <div className="row"><button className="btn small" id="chartCardPreset" title="Latest value, the reference line and the gap to it, a separator, and the momentum row" onClick={() => set("Chart card", cardPresetPatch(c))}>+ Stats and momentum</button></div>}

    <b className="sub">Filter (a long table)</b>
    <div className="row wrap"><span className="lbl">Column</span><code id="chartFilterBy">{c.filter?.by ? refText(c.filter.by) : "–"}</code>
      <button className="btn small" data-a="filterby" title="The column whose value picks the rows (e.g. Product) – as many rows as the numbers" onClick={() => pick(id, { what: "filter-by" })}>Cells…</button>
      {c.filter && <button className="btn small" data-a="filteroff" title="No filter: every row" onClick={() => set("Chart filter off", { filter: null })}>×</button>}</div>
    {c.filter && <div className="row wrap"><span className="lbl">Value</span>
      <Field className="nm" id="chartFilterEq" title="The value to keep (Enter to apply)" placeholder={typeof c.filter.eq === "object" ? "From " + refText(c.filter.eq) : "e.g. Deposits"} value={typeof c.filter.eq === "string" ? c.filter.eq : ""}
        onCommit={v => set("Chart filter value", filterPatch(c, { eq: v.trim() }))} />
      <button className="btn small" data-a="filtereq" title="The value from a cell: a scenario or Run for each value can change it" onClick={() => pick(id, { what: "filter-eq" })}>Cell…</button></div>}

    <b className="sub">Tag</b>
    <div className="row wrap"><Field className="nm" id="chartTag" title="The small text in the title line's corner (Enter to apply; empty = none)" placeholder={c.tag && typeof c.tag.text === "object" ? "From " + refText(c.tag.text) : "e.g. Illustrative"}
      value={c.tag && typeof c.tag.text === "string" ? c.tag.text : ""} onCommit={v => set("Chart tag", tagPatch(c, v))} />
      <button className="btn small" data-a="tagcell" title="The tag's text from a cell" onClick={() => pick(id, { what: "tag-cell" })}>Cell…</button>
      {c.tag && <label className="sw" title="The tag's colour"><Input type="color" data-a="tagcolor" value={tagColor} onCommit={e => set("Chart tag colour", tagPatch(c, c.tag!.text, (e.target as HTMLInputElement).value.toUpperCase()))} /><i style={{ background: tagColor }} /></label>}</div>

    <b className="sub">Stats row</b>
    {stats.map(([sid, k]) => <div key={sid} className={"stat" + (k.off ? " hid" : "")} data-stat={sid}>
      <div className="row wrap">{on(k, "stat", v => statPatch(c, sid, { off: v ? null : true }))}
        <Field className="nm" data-a="slabel" title="The chip's label (Enter to apply)" placeholder="Label" value={typeof k.label === "string" ? k.label : ""} onCommit={v => set("Stat label", statPatch(c, sid, { label: v }))} />
        <button className="btn small" data-a="remove" title="Remove this stat" onClick={() => set("Remove stat", removeStatPatch(sid))}>×</button></div>
      <div className="row wrap"><select data-a="ssrc" title="What it shows" value={k.src} onChange={e => { const v = (e.target as HTMLSelectElement).value as ChartStat["src"]; if (v === "cell" && !k.cell) pick(id, { what: "stat-cell", stat: sid }); else set("Stat value", statPatch(c, sid, { src: v, ...((v === "ref" || v === "gap" || v === "gapPct") && !k.ref && refs[0] ? { ref: refs[0][0] } : {}) })); }}>
        {SRC.map(([v, l]) => <option key={v} value={v} disabled={(v === "ref" || v === "gap" || v === "gapPct") && !refs.length}>{l}</option>)}</select>
        {k.src === "cell" && <><code>{k.cell ? refText(k.cell) : "–"}</code><button className="btn small" data-a="scell" onClick={() => pick(id, { what: "stat-cell", stat: sid })}>Cell…</button></>}
        {(k.src === "ref" || k.src === "gap" || k.src === "gapPct") && refs.length > 1 && <select data-a="sref" title="The reference line" value={k.ref || ""} onChange={e => set("Stat line", statPatch(c, sid, { ref: (e.target as HTMLSelectElement).value }))}>{refs.map(([rid, n]) => <option key={rid} value={rid}>{n}</option>)}</select>}
        {serSel(k.s, v => set("Stat series", statPatch(c, sid, { s: v })))}</div>
      <div className="row wrap"><label className="chk"><Input type="checkbox" data-a="ssigns" checked={typeof k.signs === "boolean" ? k.signs : k.src === "gap" || k.src === "gapPct"} onCommit={e => set("Stat colours", statPatch(c, sid, { signs: (e.target as HTMLInputElement).checked }))} />Colour by sign</label>
        {good(k.good, v => set("Stat direction", statPatch(c, sid, { good: v })))}
        <Field className="num" data-a="snum" title="Its number format (empty = the cells')" placeholder="as the cells" value={k.num || ""} onCommit={v => set("Stat format", statPatch(c, sid, { num: v.trim() || null }))} /></div>
    </div>)}
    <div className="row"><button className="btn small" id="chartAddStat" disabled={stats.filter(([, k]) => !k.off).length >= MAX_STATS} title="A chip of the stats row (up to 4)" onClick={() => set("Add stat", addStatPatch(c))}>+ Stat</button>
      <label className="chk"><Input type="checkbox" id="chartSep" checked={!!c.sep} onCommit={e => set((e.target as HTMLInputElement).checked ? "Chart separator" : "No chart separator", { sep: (e.target as HTMLInputElement).checked ? {} : null })} />Separator</label></div>

    <b className="sub">Momentum row</b>
    {moms.length > 0 && <div className="row wrap"><span className="lbl">Label</span><Field className="nm" id="chartMomLabel" title="The row's label (Enter to apply; empty = none)" placeholder="MOMENTUM" value={typeof c.momLabel === "string" ? c.momLabel : ""} onCommit={v => set("Momentum label", { momLabel: v.trim() === "" && typeof c.momLabel !== "string" ? null : v.trim() })} /></div>}
    {moms.map(([mid, k]) => <div key={mid} className={"mom" + (k.off ? " hid" : "")} data-mom={mid}>
      <div className="row wrap">{on(k, "momentum chip", v => momPatch(c, mid, { off: v ? null : true }))}
        <select data-a="mvs" title="What the last value is compared with" value={k.vs} onChange={e => { const v = (e.target as HTMLSelectElement).value as ChartMom["vs"]; if (v === "cell" && !k.cell) pick(id, { what: "mom-cell", mom: mid }); else set("Momentum basis", momPatch(c, mid, { vs: v })); }}>
          {VS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {k.vs === "cell" && <button className="btn small" data-a="mcell" title={k.cell ? refText(k.cell) : "The cell"} onClick={() => pick(id, { what: "mom-cell", mom: mid })}>Cell…</button>}
        <button className="btn small" data-a="remove" title="Remove this chip" onClick={() => set("Remove momentum chip", removeMomPatch(mid))}>×</button></div>
      <div className="row wrap"><select data-a="mshow" value={k.show || "both"} onChange={e => { const v = (e.target as HTMLSelectElement).value; set("Momentum shows", momPatch(c, mid, { show: v === "both" ? null : v })); }}>{SHOW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {good(k.good, v => set("Momentum direction", momPatch(c, mid, { good: v })))}
        {serSel(k.s, v => set("Momentum series", momPatch(c, mid, { s: v })))}</div>
      <div className="row wrap"><Field className="nm" data-a="mcap" title="The caption under it (Enter to apply; empty = automatic: vs Q3, since trough …)" placeholder="automatic" value={typeof k.caption === "string" ? k.caption : ""} onCommit={v => set("Momentum caption", momPatch(c, mid, { caption: v.trim() || null }))} />
        <Field className="num" data-a="mnum" title="Its number format (empty = the cells')" placeholder="as the cells" value={k.num || ""} onCommit={v => set("Momentum format", momPatch(c, mid, { num: v.trim() || null }))} /></div>
    </div>)}
    <div className="row"><button className="btn small" id="chartAddMom" disabled={moms.filter(([, k]) => !k.off).length >= MAX_MOMS} title="A chip of the momentum row: the last value's change (up to 6)" onClick={() => set("Add momentum chip", addMomPatch(c, moms.length ? "prev" : "first"))}>+ Momentum</button></div>
    {any && <CardText c={c} set={set} />}
    <CardLayout c={c} set={set} />
  </details>;
}

/* (B56, 4.14) the card's texts: a stat's label and value, the tag, the momentum row's label, changes and captions, the
   subtitle – each its own font, size, colour, weight (and, in a chip, its alignment) – `texts`, one entry per part */
const CARD_TEXT: [string, string, { b?: boolean; caps?: boolean }, { caps?: boolean; align?: boolean; color?: boolean }][] = [
  ["statLabel", "Stat label", { b: true, caps: true }, { caps: true }], ["statValue", "Stat value", { b: true }, {}],
  ["tag", "Tag", { b: true, caps: true }, { caps: true, color: false }], ["momHead", "Momentum label", { b: true, caps: true }, { caps: true, align: false }],
  ["momVal", "Momentum change", { b: true }, {}], ["momCap", "Momentum caption", {}, {}], ["sub", "Subtitle", {}, { align: false }]];
function CardText({ c, set }: { c: ChartItem; set: Set }) {
  return <><b className="sub">Text</b>
    {CARD_TEXT.filter(([p]) => p !== "sub" || !!c.subtitle).map(([part, name, dflt, can]) => <TextFmtBox key={part} id={"card-" + part} label={name} value={c.texts?.[part as keyof NonNullable<ChartItem["texts"]>]} dflt={dflt} can={can}
      onChange={(l, f) => set(l, textsPatch(part, f))} />)}</>;
}
const ROW_AL = [["left", "Left", "From the left (in thirds)"], ["center", "Centre", "Centred as a group"], ["spread", "Spread", "Spread to both edges"]] as const;
/** a number of the card's layout (empty = automatic) */
function LayNum({ id, c, k, min, max, unit, title, set }: { id: string; c: ChartItem; k: string; min: number; max: number; unit: string; title: string; set: Set }) {
  const v = layNum(c, k, min, max);
  return <label className="layrow" title={`${title} (${min}–${max} ${unit}; empty = automatic)`}><Field className="num" id={id} placeholder="auto" value={v === undefined ? "" : String(v)}
    onCommit={t => { const n = parseFloat(t.replace(",", ".")); set(title, layPatch(k, Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null)); }} /><small>{unit}</small></label>;
}
/* (B56, 4.14) sizing and positioning inside the card (`lay`): the stats and momentum rows' alignment and chip width, the
   tag's place, the spacing between the header, the plot and the footer, the plot's margins. The chips, the tag and the
   momentum label are dragged on the slide (`offs`; Reset under the chart's Moved labels) */
function CardLayout({ c, set }: { c: ChartItem; set: Set }) {
  const row = (k: "stats" | "moms", w: "statW" | "momW", name: string) => {
    const cur = layWord(c, k, ["left", "center", "spread"] as const) || "left";
    return <div className="row wrap"><span className="lbl">{name}</span>
      <div className="seg small" id={k === "stats" ? "chartStatsAlign" : "chartMomsAlign"}>{ROW_AL.map(([v, l, t]) => <button key={v} data-v={v} title={t} className={cur === v ? "on" : ""} onClick={() => set(`${name} alignment`, layPatch(k, v === "left" ? null : v))}>{l}</button>)}</div>
      <LayNum id={k === "stats" ? "chartStatW" : "chartMomW"} c={c} k={w} min={5} max={100} unit="% each" title={`${name} chip width`} set={set} /></div>;
  };
  const tag = layWord(c, "tag", ["right", "below"] as const) || "right";
  return <><b className="sub">Layout</b>
    {Object.keys(c.stats || {}).length > 0 && row("stats", "statW", "Stats row")}
    {Object.keys(c.moms || {}).length > 0 && row("moms", "momW", "Momentum row")}
    {c.tag && <div className="row wrap"><span className="lbl">Tag</span><div className="seg small" id="chartTagPos">
      {([["right", "Title corner"], ["below", "Under the title"]] as const).map(([v, l]) => <button key={v} data-v={v} className={tag === v ? "on" : ""} onClick={() => set("Tag place", layPatch("tag", v === "right" ? null : v))}>{l}</button>)}</div></div>}
    <div className="row wrap"><span className="lbl">Spacing</span>
      <LayNum id="chartGapH" c={c} k="gapH" min={0} max={80} unit="px under the title" title="Space under the title" set={set} />
      <LayNum id="chartGapP" c={c} k="gapP" min={0} max={120} unit="px above the plot" title="Space above the plot" set={set} />
      <LayNum id="chartGapF" c={c} k="gapF" min={0} max={120} unit="px above the momentum row" title="Space above the momentum row" set={set} /></div>
    <div className="row wrap"><span className="lbl">Plot margins</span>
      {([["padL", "left"], ["padR", "right"], ["padT", "top"], ["padB", "bottom"]] as const).map(([k, n]) => <LayNum key={k} id={"chart" + k[0].toUpperCase() + k.slice(1)} c={c} k={k} min={0} max={400} unit={"px " + n} title={`Plot margin, ${n}`} set={set} />)}</div>
  </>;
}
