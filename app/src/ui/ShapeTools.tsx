/* Callouts on ribbon 2 (S9.4, B17; 07 §3): Insert shape ▾ (six shapes, the built-in icons) and, while a shape is
   selected, its fill, border and text – each change one item.patch (one undo step). Its text is edited on the slide
   (double-click, Enter); {Sheet!C7} quotes a cell, which follows reloads and scenarios. */
import { setDialogs, useStore } from "../state/store";
import type { ShapeItem } from "@slide-builder/core/model/types";
import { ICON_NAMES, iconCmds } from "@slide-builder/core/render/icons";
import { arrowCmds, bubbleCmds, ellipseCmds } from "@slide-builder/core/render/shape-dl";
import type { PathCmd } from "@slide-builder/core/dl/types";
import { insertShape, itemOf, itemPatch } from "../editor/charts";
import { setStage } from "../stage/data";
import { Dropdown } from "./Dropdown";
import { Input } from "./Input";
import { useCurSlide, useStyle } from "./hooks";
import { isIsp, ISP_FILLS } from "@slide-builder/core/model/isp";

const SHAPES: [ShapeItem["shape"], string][] = [["rect", "Rectangle"], ["round", "Rounded rectangle"], ["pill", "Pill"], ["circle", "Circle"], ["arrow", "Arrow"], ["bubble", "Speech bubble"]];
const d = (cmds: PathCmd[]) => cmds.map(c => c[0] + c.slice(1).join(" ")).join(" ");
const PREVIEW: Record<string, string> = {
  rect: d([["M", 2, 6], ["L", 22, 6], ["L", 22, 18], ["L", 2, 18], ["Z"]]), round: "M6 6h12a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z",
  pill: "M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z", circle: d(ellipseCmds(3, 3, 18, 18)), arrow: d(arrowCmds(2, 5, 20, 14)), bubble: d(bubbleCmds(2, 3, 20, 13, 3, { x: 7, y: 21 })),
};
/** Insert shape ▾: the ribbon's shape entry, one of the Insert slots (InsertSlots.tsx, S14.P) */
export function ShapeInsert() {
  const R = useCurSlide();
  return <Dropdown menuClass="wide" button={(_o, t) => <button className="tb" id="shapeBtn" disabled={!R} title="A callout: a shape or an icon, with text that can quote cells ({Sheet!C7})" onClick={t}>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="2.5" width="11" height="8" rx="2" /><path d="M4 10.5 3 14l4-3.5" /></svg>Insert shape ▾</button>}>
    {close => <ShapeMenu close={close} />}</Dropdown>;
}
export function ShapeMenu({ close }: { close: () => void }) {
  return <div className="shapemenu">
    <div className="hd">Shapes <small>with text; {"{Sheet!C7}"} quotes a cell</small></div>
    <div className="grid">{SHAPES.map(([s, l]) => <button key={s} data-shape={s} title={l} onClick={() => { close(); insertShape(s); }}>
      <svg viewBox="0 0 24 24"><path d={PREVIEW[s]} fill="#E8EEF8" stroke="#0A66D8" strokeWidth="1.3" /></svg></button>)}</div>
    <div className="hd">Icons</div>
    <div className="grid">{ICON_NAMES.map(n => <button key={n} data-icon={n} title={n.replace("-", " ")} onClick={() => { close(); insertShape("icon", n); }}>
      <svg viewBox="0 0 24 24"><path d={d(iconCmds(n, 0, 0, 1))} fill="#1F2430" fillRule="evenodd" /></svg></button>)}</div>
  </div>;
}

const FILLS = ["#FFFFFF", "#F2F2F2", "#FFF4D6", "#E8F1FF", "#E6F6EC", "#FDE8E6", "#0A2A66", "#2251FF", "#1E8E3E", "#CC0000", "#F28C00", "#1F2430"];
const INKS = ["#0B0D17", "#5B6274", "#FFFFFF", "#1C4F8C", "#2251FF", "#1E8E3E", "#C42B1C", "#B25000"];
/** the selected shape's controls (only while one is selected) */
export function ShapeTools() {
  const itemSel = useStore(s => s.selection.itemSel), R = useCurSlide(), isp = isIsp(useStyle().design);
  const it = itemOf(itemSel?.id, R);
  if (!itemSel || !it || it.kind !== "shape") return null;
  const id = itemSel.id, f = it.fmt || {}, set = (label: string, p: Record<string, unknown>) => itemPatch(label, id, p);
  const sw = (list: string[], pick: (c: string) => void, attr: string, close: () => void) =>
    <div className="swatches">{list.map(c => <button key={c} {...{ [attr]: c }} title={c} style={{ background: c }} onClick={() => { close(); pick(c); }} />)}</div>;
  const icon = it.shape === "icon", size = +(f.size || 18);
  return <div className="grp" id="shapeTools" data-item={id}>
    <span className="lbl">{icon ? "Icon" : "Shape"}</span>
    <Dropdown button={(_o, t) => <button className="tb colorbtn" id="shapeFill" title={icon ? "Colour of the icon" : "Fill of the shape"} onClick={t}><span>◼</span><i className="sw" style={{ background: it.fill && it.fill !== "none" ? it.fill : "linear-gradient(135deg,#fff 45%,#cfd8e6 55%)" }} /></button>}>
      {close => <>
        <div className="hd">{icon ? "Icon colour" : "Fill"}</div>{sw(FILLS, c => set(icon ? "Icon colour" : "Shape fill", { fill: c }), "data-fill", close)}
        {isp && <><div className="hd">Template fills <small>Intesa Sanpaolo: 25, 50 or 75 % transparency</small></div>{sw(ISP_FILLS.map(([c]) => c), c => set(icon ? "Icon colour" : "Shape fill", { fill: c }), "data-fill", close)}</>}
        <div className="wide"><button data-fill="" onClick={() => { close(); set("Fill of the design", { fill: null }); }}>{icon ? "Text colour" : "The design's (glass, card…)"}</button>
          {!icon && <button data-fill="none" onClick={() => { close(); set("No fill", { fill: "none" }); }}>No fill</button>}
          <label className="custom">Custom…<Input type="color" value={it.fill && it.fill !== "none" ? it.fill : "#FFFFFF"} onCommit={e => { close(); set("Shape fill", { fill: (e.target as HTMLInputElement).value.toUpperCase() }); }} /></label></div>
      </>}
    </Dropdown>
    {!icon && <Dropdown button={(_o, t) => <button className="tb" id="shapeBorder" title="Border of the shape" onClick={t}>▢ Border ▾</button>}>
      {close => <div className="bordermenu">
        <div className="hd">Colour</div>{sw(INKS.filter(c => c !== "#FFFFFF").concat("#BFBFBF"), c => set("Shape border", { border: { color: c, w: it.border?.w || 1.5, ...(it.border?.dash ? { dash: it.border.dash } : {}) } }), "data-border", close)}
        <div className="hd">Weight and style</div>
        <div className="row">{[1, 1.5, 2, 3].map(w => <button key={w} data-bw={w} onClick={() => { close(); set("Border weight", { border: { color: it.border?.color || "#1F2430", w, ...(it.border?.dash ? { dash: it.border.dash } : {}) } }); }}>{w} px</button>)}</div>
        <div className="row">{(["solid", "dashed", "dotted"] as const).map(s => <button key={s} data-dash={s} onClick={() => { close(); set("Border style", { border: { color: it.border?.color || "#1F2430", w: it.border?.w || 1.5, ...(s === "solid" ? {} : { dash: s }) } }); }}>{s}</button>)}</div>
        <div className="wide"><button data-border="none" onClick={() => { close(); set("No border", { border: { color: "#000000", w: 0 } }); }}>No border</button><button data-border="" onClick={() => { close(); set("Border of the design", { border: null }); }}>The design's</button></div>
      </div>}
    </Dropdown>}
    {!icon && <>
      <button className="tb" id="shapeSmaller" title="Smaller text" onClick={() => set("Text size", { fmt: { size: Math.max(8, size - 2) } })}>A−</button>
      <button className="tb" id="shapeLarger" title="Larger text" onClick={() => set("Text size", { fmt: { size: Math.min(96, size + 2) } })}>A+</button>
      <button className={"tb" + (f.b ? " on" : "")} id="shapeBold" title="Bold text" onClick={() => set("Bold", { fmt: { b: f.b ? null : true } })}><b>B</b></button>
      <Dropdown button={(_o, t) => <button className="tb colorbtn" id="shapeInk" title="Text colour" onClick={t}><span>A</span><i className="sw" style={{ background: f.color || "#0B0D17" }} /></button>}>
        {close => <><div className="hd">Text colour</div>{sw(INKS, c => set("Text colour", { fmt: { color: c } }), "data-ink", close)}
          <div className="wide"><button data-ink="" onClick={() => { close(); set("Automatic text colour", { fmt: { color: null } }); }}>Automatic</button></div></>}
      </Dropdown>
      {(["left", "center", "right"] as const).map(a => <button key={a} className={"tb" + ((f.align || "center") === a ? " on" : "")} data-salign={a} title={a === "center" ? "Centre" : "Align " + a} onClick={() => set("Alignment", { fmt: { align: a === "center" ? null : a } })}>{a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}</button>)}
      <button className="tb" id="shapeQuote" title="Quote a cell in the text: choose it in the sheet view (it shows what the cell shows, and follows the workbook)" onClick={() => setDialogs({ pick: { kind: "cell", id } })}>⌗ Quote a cell…</button>
      <button className="tb" id="shapeEdit" title="Write the text (double-click the shape, or Enter): {Sheet!C7} quotes a cell" onClick={() => setStage({ editor: { kind: "item", id } })}>✎ Text</button>
    </>}
  </div>;
}
