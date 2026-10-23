/* (B56, 4.14) the one Text control of every part of a KPI card, a chart and a table: font (the deck's font list – the
   library, Windows', Google's: FontPicker), size in points (stored in slide px, 1 pt = 4/3 px, as every slide text),
   colour, bold, italic, alignment, capitals. Collapsed to one line per part ("Aa" opens it); usable at the side panel's
   280 px. Each control is ONE change of the part's whole format (onChange). */
import { useState } from "react";
import type { TextFmt } from "@slide-builder/core/model/types";
import { FontPicker } from "./FontPicker";
import { Field } from "./Field";
import { Input } from "./Input";

export interface TextCan { align?: boolean; color?: boolean; caps?: boolean; size?: boolean }
const px2pt = (px: number) => Math.round(px * .75 * 2) / 2, pt2px = (pt: number) => Math.round(pt * 4 / 3 * 10) / 10;
const HEX = /^#[0-9A-Fa-f]{6}$/;
export function TextFmtBox({ id, label, value, onChange, can = {}, dflt = {}, open: open0 = false }: {
  id: string; label: string; value: TextFmt | undefined | null; onChange: (undoLabel: string, next: TextFmt | null) => void;
  can?: TextCan; /** what the part draws without a format (pressed B / I / Caps, the swatch) */ dflt?: { b?: boolean; i?: boolean; caps?: boolean; color?: string; align?: "left" | "center" | "right" }; open?: boolean }) {
  const [open, setOpen] = useState(open0);
  const f: TextFmt = value && typeof value === "object" ? value : {};
  const set = (what: string, p: Partial<TextFmt>) => {
    const next: Record<string, unknown> = { ...f, ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
    onChange(`${label}: ${what}`, Object.keys(next).length ? next as TextFmt : null);
  };
  const b = f.b ?? !!dflt.b, i = f.i ?? !!dflt.i, caps = f.caps ?? dflt.caps ?? false, align = f.align ?? dflt.align;
  const color = HEX.test(f.color || "") ? f.color! : dflt.color || "#000000", own = Object.keys(f).length > 0;
  return <div className="tfbox" data-tf={id}>
    <div className="row tfhd"><span className="lbl">{label}</span>
      <button className={"btn small tftog" + (own ? " own" : "")} data-a="tf" title={`${label}: font, size, colour, bold, italic${can.align !== false ? ", alignment" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>Aa{own ? " •" : ""} {open ? "▾" : "▸"}</button>
      {own && <button className="btn small" data-a="tfreset" title="The design's text again" onClick={() => onChange(`${label}: the design's text`, null)}>↺</button>}</div>
    {open && <div className="tfbody">
      <div className="row wrap"><FontPicker value={f.font || null} placeholder="Design's font" title={`${label}: font`} onPick={v => set("font", { font: v || undefined })} />
        {can.size !== false && <Field className="num" data-a="tfsize" title={`${label}: size in points (empty = automatic)`} placeholder="auto pt" value={f.size ? String(px2pt(f.size)) : ""}
          onCommit={v => { const n = parseFloat(v.replace(",", ".")); set("size", { size: Number.isFinite(n) && n > 0 ? pt2px(Math.max(4, Math.min(110, n))) : undefined }); }} />}</div>
      <div className="row wrap">
        {can.color !== false && <label className="sw" title={`${label}: colour`}><Input type="color" data-a="tfcolor" value={color} onCommit={e => set("colour", { color: (e.target as HTMLInputElement).value.toUpperCase() })} /><i style={{ background: color }} /></label>}
        <div className="seg small"><button data-a="tfb" className={b ? "on" : ""} title="Bold" onClick={() => set("bold", { b: !b })}><b>B</b></button>
          <button data-a="tfi" className={i ? "on" : ""} title="Italic" onClick={() => set("italic", { i: !i })}><i>I</i></button>
          {can.caps && <button data-a="tfcaps" className={caps ? "on" : ""} title="In capitals" onClick={() => set("capitals", { caps: !caps })}>AB</button>}</div>
        {can.align !== false && <div className="seg small" data-a="tfalign">{(["left", "center", "right"] as const).map(a => <button key={a} data-al={a} className={align === a ? "on" : ""}
          title={a === "left" ? "Left" : a === "center" ? "Centre" : "Right"} onClick={() => set("alignment", { align: a })}>{a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}</button>)}</div>}
      </div>
    </div>}
  </div>;
}
