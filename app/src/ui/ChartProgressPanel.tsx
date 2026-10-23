/* The chart panel of a budget-achievement chart (4.14, B55; core render/chart-progress.ts): where its numbers come from
   (a long table – the product, value and budget columns picked in the sheet view – or ranges / cells), its words (the %
   above the bars, the names under them, the gap's words, sign and format), its colours (fill, track, over target) and
   bars (gap, value axis, gridlines), and the card's subtitle, tag and separator. Each control is ONE item.patch (one
   undo step: editor/chart-progress.ts); cells are picked in the sheet view, never typed. Rows wrap at the side panel's
   narrow widths (280 px up). */
import { setDialogs, useStore } from "../state/store";
import type { ChartItem, ChartProgress, DataRef, ItemPatch } from "@slide-builder/core/model/types";
import { refText } from "../editor/charts";
import type { ChartRefWhat } from "../editor/chart-panel";
import { numOrNull } from "../editor/chart-panel";
import { progressFmtPatch, progressPatch, sourcePatch, subtitlePatch, type ProgressRef } from "../editor/chart-progress";
import { tagPatch } from "../editor/chart-card";
import { progressColors, PROGRESS_GAP } from "@slide-builder/core/render/chart-progress";
import { chartLook } from "@slide-builder/core/render/chart-dl";
import { ctx, style } from "../state/app";
import { Input } from "./Input";
import { Field } from "./Field";

type Set = (label: string, p: ItemPatch | null) => void;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const pick = (id: string, what: ProgressRef) => setDialogs({ pick: { kind: "chart-ref", id, ref: { what } as ChartRefWhat } });
const refsText = (r: DataRef[] | undefined) => (r || []).map(refText).join(" + ") || "–";
const SIGN = [["over", "+210 over · 1,700 to go"], ["both", "+210 over · −1,700 to go"], ["none", "No sign"]] as const;
const OVER = [["none", "As any bar"], ["color", "Another fill"], ["mark", "A band at the top"]] as const;

/** a colour swatch: the item's own colour, else the design's (shown); ↺ back to the design's */
function Swatch({ a, own, shown, title, onSet }: { a: string; own: unknown; shown: string; title: string; onSet: (v: string | null) => void }) {
  const has = typeof own === "string" && HEX.test(own), v = has ? (own as string).toUpperCase() : shown;
  return <span className="swrow"><label className="sw" title={title}><Input type="color" data-a={a} value={v} onCommit={e => onSet((e.target as HTMLInputElement).value.toUpperCase())} /><i style={{ background: v }} /></label>
    {has && <button className="btn small" data-a={a + "-reset"} title="The design's colour again" onClick={() => onSet(null)}>↺</button>}</span>;
}
export function ChartProgressPanel({ c, id, set }: { c: ChartItem; id: string; set: Set }) {
  useStore(() => style().design);
  const P: ChartProgress = c.progress && typeof c.progress === "object" ? c.progress : {}, table = !!P.table;
  const look = chartLook(ctx(), "Arial"), col = progressColors(c, ctx(), look.ink), accent = look.colors[0] || "#2F55F4";
  const pp = (label: string, p: Record<string, unknown>, sub?: "pct" | "cat" | "gap") => set(label, progressPatch(c, p, sub));
  const pctC = P.pct?.fmt?.color, ax = c.axes?.y || {};
  return <div id="chartProgress">
    <details className="sec" open><summary>Data</summary>
      <div className="row"><div className="seg small" id="progSource">
        <button data-src="table" className={table ? "on" : ""} title="A long table: one bar per product, its latest row (no helper cells)" onClick={() => !table && set("Budget data from a long table", sourcePatch(c, "table"))}>Long table</button>
        <button data-src="cells" className={!table ? "on" : ""} title="Values and budgets from ranges or single cells" onClick={() => table && set("Budget data from cells", sourcePatch(c, "cells"))}>Cells</button></div></div>
      {table ? <>
        <div className="row wrap"><span className="lbl">Product</span><code id="progBy">{refText(P.table!.by)}</code><button className="btn small" data-a="prog-by" title="The column naming each row's product: one bar per product" onClick={() => pick(id, "prog-by")}>Cells…</button></div>
        <div className="row wrap"><span className="lbl">Value</span><code id="progVal">{refText(P.table!.val)}</code><button className="btn small" data-a="prog-val" title="The value column: each product's latest row is taken" onClick={() => pick(id, "prog-val")}>Cells…</button></div>
        <div className="row wrap"><span className="lbl">Budget</span><code id="progTarget">{refText(P.table!.target)}</code><button className="btn small" data-a="prog-target" title="The budget column (the same row as the value)" onClick={() => pick(id, "prog-target")}>Cells…</button></div>
        <div className="hint">Each product's last row with a number is its latest period.</div>
      </> : <>
        <div className="row wrap"><span className="lbl">Values</span><code id="progVals">{refsText(P.vals)}</code><button className="btn small" data-a="prog-vals" title="The values, one per bar (a range or one cell)" onClick={() => pick(id, "prog-vals")}>Cells…</button></div>
        <div className="row wrap"><span className="lbl">Budgets</span><code id="progTargets">{refsText(P.targets)}</code><button className="btn small" data-a="prog-targets" title="The budgets, one per bar – one cell serves every bar" onClick={() => pick(id, "prog-targets")}>Cells…</button></div>
        <div className="row wrap"><span className="lbl">Names</span><code id="progCats">{Array.isArray(P.cats) ? P.cats.join(", ") : P.cats ? refText(P.cats) : c.labels ? refText(c.labels) : "beside the values"}</code><button className="btn small" data-a="prog-cats" title="The bars' names" onClick={() => pick(id, "prog-cats")}>Cells…</button></div>
      </>}
    </details>

    <details className="sec" open><summary>Labels</summary>
      <div className="row wrap"><label className="chk"><Input type="checkbox" id="progPctOn" checked={!P.pct?.off} onCommit={e => pp((e.target as HTMLInputElement).checked ? "Show the %" : "Hide the %", { off: (e.target as HTMLInputElement).checked ? null : true }, "pct")} />% above</label>
        <Field className="num" id="progPctNum" title="The %'s number format (Enter to apply; empty = 0.0%)" placeholder="0.0%" value={P.pct?.num || ""} onCommit={v => pp("Format of the %", { num: v.trim() || null }, "pct")} />
        <Field className="num" id="progPctSize" title="The %'s size, px (empty = automatic)" placeholder="size" value={P.pct?.fmt?.size ? String(P.pct.fmt.size) : ""} onCommit={v => { const n = numOrNull(v, 6, 72); if (n !== undefined) set("Size of the %", progressFmtPatch(c, "pct", { size: n })); }} />
        <Swatch a="prog-pct-color" own={pctC} shown={HEX.test(pctC || "") ? pctC! : accent} title="The %'s colour" onSet={v => set("Colour of the %", progressFmtPatch(c, "pct", { color: v }))} /></div>
      <div className="row wrap"><label className="chk"><Input type="checkbox" id="progCatOn" checked={!P.cat?.off} onCommit={e => pp((e.target as HTMLInputElement).checked ? "Show the names" : "Hide the names", { off: (e.target as HTMLInputElement).checked ? null : true }, "cat")} />Names under</label>
        <label className="chk"><Input type="checkbox" id="progCaps" checked={P.cat?.caps !== false} onCommit={e => pp("Names in capitals", { caps: (e.target as HTMLInputElement).checked ? null : false }, "cat")} />CAPITALS</label></div>
      <div className="row wrap"><label className="chk"><Input type="checkbox" id="progGapOn" checked={!P.gap?.off} onCommit={e => pp((e.target as HTMLInputElement).checked ? "Show the gap" : "Hide the gap", { off: (e.target as HTMLInputElement).checked ? null : true }, "gap")} />Gap under</label>
        <Field className="nm" id="progOver" title="The word after a gap over the budget (Enter to apply; empty = over)" placeholder="over" value={typeof P.gap?.over === "string" ? P.gap.over : ""} onCommit={v => pp("Words of the gap", { over: v.trim() || null }, "gap")} />
        <Field className="nm" id="progUnder" title="The words after a gap under the budget (Enter to apply; empty = to go)" placeholder="to go" value={typeof P.gap?.under === "string" ? P.gap.under : ""} onCommit={v => pp("Words of the gap", { under: v.trim() || null }, "gap")} /></div>
      <div className="row wrap"><select id="progSign" title="The gap's sign" value={P.gap?.sign || "over"} onChange={e => { const v = (e.target as HTMLSelectElement).value; pp("Sign of the gap", { sign: v === "over" ? null : v }, "gap"); }}>
        {SIGN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Field className="num" id="progGapNum" title="The gap's number format (empty = the value cells')" placeholder="as the cells" value={P.gap?.num || ""} onCommit={v => pp("Format of the gap", { num: v.trim() || null }, "gap")} /></div>
    </details>

    <details className="sec" open><summary>Bars and colours</summary>
      <div className="row wrap"><span className="lbl">Fill</span><Swatch a="prog-fill" own={P.fill} shown={col.fill} title="The bars' fill" onSet={v => pp("Bar fill colour", { fill: v })} />
        <span className="lbl">Track</span><Swatch a="prog-track" own={P.track} shown={col.track} title="The track: 100 % of the budget" onSet={v => pp("Track colour", { track: v })} /></div>
      <div className="row wrap"><span className="lbl">Over</span><select id="progOverMode" title="A bar over its budget" value={P.over || "none"} onChange={e => { const v = (e.target as HTMLSelectElement).value; pp("Over budget", { over: v === "none" ? null : v }); }}>
        {OVER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {P.over && P.over !== "none" && <Swatch a="prog-over" own={P.overFill} shown={col.over} title="The over-budget colour" onSet={v => pp("Over-budget colour", { overFill: v })} />}</div>
      <div className="row wrap"><span className="lbl">Gap</span><Field className="num" id="progBarGap" title={`The gap between the bars, % of a bar (empty = ${PROGRESS_GAP})`} placeholder={String(PROGRESS_GAP)} value={c.gap === undefined ? "" : String(c.gap)}
        onCommit={v => { const n = numOrNull(v, 0, 500); if (n !== undefined) set("Bar gap", { gap: n }); }} />
        <label className="chk"><Input type="checkbox" id="progAxis" checked={ax.show === true} onCommit={e => set("Value axis", { axes: { y: { ...ax, show: (e.target as HTMLInputElement).checked } } })} />Axis</label>
        <label className="chk"><Input type="checkbox" id="progGrid" checked={ax.grid === true} onCommit={e => set("Gridlines", { axes: { y: { ...ax, grid: (e.target as HTMLInputElement).checked } } })} />Gridlines</label></div>
    </details>

    <details className="sec" open><summary>Card</summary>
      <div className="row wrap"><span className="lbl">Subtitle</span><Field className="nm" id="chartSubtitle" title="The grey line under the title (Enter to apply; empty = none)" placeholder={c.subtitle && typeof c.subtitle === "object" ? "From " + refText(c.subtitle) : "e.g. Latest volume / EoM budget"}
        value={typeof c.subtitle === "string" ? c.subtitle : ""} onCommit={v => set("Chart subtitle", subtitlePatch(v))} />
        <button className="btn small" data-a="subtitle-cell" title="The subtitle from a cell" onClick={() => pick(id, "subtitle-cell")}>Cell…</button></div>
      <div className="row wrap"><span className="lbl">Tag</span><Field className="nm" id="chartTag" title="The small text in the title line's corner (Enter to apply; empty = none)" placeholder="e.g. Illustrative"
        value={c.tag && typeof c.tag.text === "string" ? c.tag.text : ""} onCommit={v => set("Chart tag", tagPatch(c, v))} />
        <label className="chk"><Input type="checkbox" id="chartSep" checked={!!c.sep} onCommit={e => set((e.target as HTMLInputElement).checked ? "Chart separator" : "No chart separator", { sep: (e.target as HTMLInputElement).checked ? {} : null })} />Separator</label></div>
    </details>
  </div>;
}
