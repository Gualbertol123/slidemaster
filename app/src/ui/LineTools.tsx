/* Lines on ribbon 2 (4.8, M15 S15.3; docs/next/09 §2.3, LN-01): Insert line ▾ – the owner's kinds of line (InsertSlots.tsx,
   below the separator) – and, while a line is selected, its controls: kind (straight, elbow, curve, bracket, range),
   the elbow's direction, colour, weight, dash, the head at each end and their size, the label (it can quote cells,
   {Sheet!C7}), Detach and Reverse. Each change is one item.patch (one undo step); `style` is one key replaced whole
   (editor/lines.ts). Its ends, middle and attachments are dragged on the slide (stage/lines.tsx). */
import type { Head, LineItem, LineRoute, LineStyle } from "@slide-builder/core/model/types";
import { headsOf, lineColor, lineWeight } from "@slide-builder/core/render/line-dl";
import { useStore } from "../state/store";
import { ctx } from "../state/app";
import { itemOf } from "../editor/charts";
import { detachLine, insertLine, LINE_PRESETS, presetLine, reverseLine, setLineBend, setLineFmt, setLineRoute, setLineStyle, setLineText, type LinePreset } from "../editor/lines";
import { Dropdown } from "./Dropdown";
import { Input } from "./Input";
import { useCurSlide } from "./hooks";

/** a preset's little picture (24 × 24): its route and heads, as the slide draws them */
function Preview({ p }: { p: LinePreset }) {
  const it = presetLine(p, 12, 12);
  const a = { x: 2, y: p === "elbow" || p === "callout" ? 6 : 12 }, b = { x: 22, y: p === "elbow" || p === "callout" ? 18 : 12 };
  const h = headsOf(it), dash = it.style?.dash ? "3 2" : undefined;
  const path = it.route === "elbow" ? `M${a.x} ${a.y}H12V${b.y}H${b.x}` : it.route === "curve" ? `M${a.x} ${a.y}Q12 ${a.y - 10} ${b.x} ${b.y}` : it.route === "bracket" ? `M${a.x} 10V15H${b.x}V10` : `M${a.x} ${a.y}L${b.x} ${b.y}`;
  const end = (k: "a" | "b") => { const x = (k === "a" ? h.a : h.b); return x === "bar" ? <path key={k} d={`M${k === "a" ? a.x : b.x} ${(k === "a" ? a.y : b.y) - 4}v8`} /> : x && x !== "none" ? <circle key={k} cx={k === "a" ? a.x : b.x} cy={k === "a" ? a.y : b.y} r={2} fill="currentColor" /> : null; };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={dash}><path d={path} />{end("a")}{end("b")}</svg>;
}
/** Insert line ▾: the ribbon's line entry, one of the Insert slots (InsertSlots.tsx, below M15's separator) */
export function LineInsert() {
  const R = useCurSlide();
  return <Dropdown menuClass="wide" button={(_o, t) => <button className="tb" id="lineBtn" disabled={!R} title="A line, an arrow, a bracket or a range marker – attach its ends to tables, text boxes and shapes with Ctrl while dragging them" onClick={t}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 13 13 3" /><path d="M8.5 3H13v4.5" /></svg>Insert line ▾</button>}>
    {close => <div className="shapemenu linemenu">
      <div className="hd">Lines <small>drag the ends; Ctrl attaches an end to an object</small></div>
      <div className="grid">{LINE_PRESETS.map(p => <button key={p.id} data-line={p.id} title={p.title} onClick={() => { close(); insertLine(p.id); }}><Preview p={p.id} /></button>)}</div>
    </div>}
  </Dropdown>;
}

const INKS = ["#404040", "#0B0D17", "#7F7F7F", "#BFBFBF", "#1C4F8C", "#2251FF", "#1E8E3E", "#C42B1C", "#F28C00", "#FFFFFF"];
const WEIGHTS = [.5, 1, 1.5, 2, 3, 4.5, 6, 8], DASHES: NonNullable<LineStyle["dash"]>[] = ["solid", "dashed", "dotted", "dashdot"];
const HEADS: Head[] = ["none", "arrow", "triangle", "stealth", "oval", "diamond", "bar"];
const HEAD_LABEL: Record<Head, string> = { none: "None", arrow: "Open arrow", triangle: "Arrow", stealth: "Stealth arrow", oval: "Dot", diamond: "Diamond", bar: "Tick (limiter)" };
const ROUTES: [LineRoute, string][] = [["straight", "Straight"], ["elbow", "Elbow"], ["curve", "Curve"], ["bracket", "Bracket"], ["range", "Range marker"]];
/** the selected line's controls (only while a line is selected; ShapeTools.tsx shows them in its place) */
export function LineTools() {
  const itemSel = useStore(s => s.selection.itemSel), R = useCurSlide();
  const it = itemOf(itemSel?.id, R);
  if (!itemSel || !it || it.kind !== "line") return null;
  return <LineControls id={itemSel.id} it={it} />;
}
function LineControls({ id, it }: { id: string; it: LineItem }) {
  const c = ctx(), color = lineColor(it, c), w = lineWeight(it), h = headsOf(it), dash = it.style?.dash || "solid";
  const style = (label: string, p: Parameters<typeof setLineStyle>[3]) => setLineStyle(label, id, it, p);
  const heads = (k: "a" | "b", v: Head) => style(k === "a" ? "Start of line" : "End of line", { heads: { ...h, [k]: v === "none" ? undefined : v } as never });
  const headMenu = (k: "a" | "b") => <Dropdown button={(_o, t) => <button className="tb" id={"lineHead" + k.toUpperCase()} title={k === "a" ? "The line's start (end a)" : "The line's end (end b)"} onClick={t}>{k === "a" ? "Start" : "End"}: {HEAD_LABEL[h[k] || "none"]} ▾</button>}>
    {close => <><div className="hd">{k === "a" ? "Start" : "End"}</div><div className="col">{HEADS.map(x => <button key={x} data-head={x} className={(h[k] || "none") === x ? "on" : ""} onClick={() => { close(); heads(k, x); }}>{HEAD_LABEL[x]}</button>)}</div>
      <div className="hd">Size of both</div><div className="row">{(["s", "m", "l"] as const).map(z => <button key={z} data-hsize={z} className={(h.size || "m") === z ? "on" : ""} onClick={() => { close(); style("Arrow size", { heads: { ...h, size: z === "m" ? undefined : z } as never }); }}>{z === "s" ? "Small" : z === "m" ? "Medium" : "Large"}</button>)}</div></>}
  </Dropdown>;
  return <div className="grp" id="lineTools" data-item={id}>
    <span className="lbl">Line</span>
    <Dropdown button={(_o, t) => <button className="tb" id="lineRoute" title="The kind of line" onClick={t}>{ROUTES.find(r => r[0] === it.route)?.[1] || "Line"} ▾</button>}>
      {close => <div className="col">{ROUTES.map(([r, l]) => <button key={r} data-route={r} className={it.route === r ? "on" : ""} onClick={() => { close(); setLineRoute(id, it, r); }}>{l}</button>)}
        {it.route === "elbow" && <><div className="hd">Elbow</div><button data-bend="hv" className={it.bend !== "vh" ? "on" : ""} onClick={() => { close(); setLineBend(id, "hv"); }}>Across first</button><button data-bend="vh" className={it.bend === "vh" ? "on" : ""} onClick={() => { close(); setLineBend(id, "vh"); }}>Down first</button></>}</div>}
    </Dropdown>
    <Dropdown button={(_o, t) => <button className="tb colorbtn" id="lineColor" title="Colour of the line" onClick={t}><span>▬</span><i className="sw" style={{ background: color }} /></button>}>
      {close => <><div className="hd">Colour</div>
        <div className="swatches">{INKS.map(x => <button key={x} data-lcolor={x} title={x} style={{ background: x }} onClick={() => { close(); style("Line colour", { color: x }); }} />)}</div>
        <div className="wide"><button data-lcolor="" onClick={() => { close(); style("Line colour of the design", { color: undefined }); }}>The design's</button>
          <label className="custom">Custom…<Input type="color" value={color} onCommit={e => { close(); style("Line colour", { color: (e.target as HTMLInputElement).value.toUpperCase() }); }} /></label></div></>}
    </Dropdown>
    <Dropdown button={(_o, t) => <button className="tb" id="lineWeight" title="Weight and style of the line" onClick={t}>{w} px ▾</button>}>
      {close => <><div className="hd">Weight</div><div className="row">{WEIGHTS.map(x => <button key={x} data-lw={x} className={w === x ? "on" : ""} onClick={() => { close(); style("Line weight", { w: x === 2 ? undefined : x }); }}>{x}</button>)}</div>
        <div className="hd">Style</div><div className="row">{DASHES.map(x => <button key={x} data-ldash={x} className={dash === x ? "on" : ""} onClick={() => { close(); style("Line style", { dash: x === "solid" ? undefined : x }); }}>{x === "dashdot" ? "dash-dot" : x}</button>)}</div></>}
    </Dropdown>
    {headMenu("a")}{headMenu("b")}
    <Input className="lineText" id="lineText" value={it.text || ""} placeholder="Label – {Sheet!C7} quotes a cell" title="A label at the middle of the line (a range marker's above it); Enter to set" style={{ width: 150 }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} onCommit={e => setLineText(id, (e.target as HTMLInputElement).value)} />
    <button className={"tb" + (it.fmt?.b ? " on" : "")} id="lineBold" title="Bold label" onClick={() => setLineFmt(id, { b: it.fmt?.b ? null : true })}><b>B</b></button>
    <button className="tb" id="lineDetach" disabled={!it.ends?.a && !it.ends?.b} title="Free both ends from their objects (they stay where they are)" onClick={() => detachLine(id)}>Detach</button>
    <button className="tb" id="lineReverse" title="Swap its start and end" onClick={() => reverseLine(id)}>⇄</button>
  </div>;
}
