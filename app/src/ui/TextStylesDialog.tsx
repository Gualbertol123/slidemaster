/* "Text styles & fonts": the one place to set how ALL text of a kind looks in this deck (every slide
   title, every subtitle, all tables, all text boxes, the contents list, page numbers and footer), and
   the shared font library (Google Fonts and uploaded font files, saved in the Slide Builder folder).
   Formatting set on a single text with the toolbar sits on top of these styles. */
import { useRef, useState } from "react";
import { patch, setDialogs, useStore } from "../state/store";
import { confirmBox } from "../state/dialogs";
import { lookAt, lookChange, saveStyleAsDefault } from "../state/app";
import { addGoogleFont, inLibrary, removeFont, uploadFontFiles } from "../state/fonts";
import { GOOGLE_POPULAR, fontStack } from "../model/fonts";
import { COLOR_KEYS, palette } from "../model/style";
import { ThemePicker } from "./Topbar";
import type { TextFmt, TextRole } from "../model/types";
import { backend } from "../sync/api";
import { esc } from "../xlsx/util";
import { Field } from "./Field";
import { FontPicker } from "./FontPicker";
import { Input } from "./Input";
import { useStyle } from "./hooks";

const DESIGN_NAME = { glass: "Liquid Glass", excel: "Excel", clean: "Excel Refined" } as const;
type Cap = "size" | "b" | "i" | "color" | "align" | "lh";
const ROLES: { role: TextRole; name: string; hint: string; caps: Cap[] }[] = [
  { role: "title", name: "Slide titles", hint: "every slide; the cover title keeps its automatic size", caps: ["size", "b", "i", "color", "align"] },
  { role: "subtitle", name: "Subtitles", hint: "under the titles, and on the cover", caps: ["size", "b", "i", "color", "align"] },
  { role: "table", name: "Tables", hint: "all cells; sizes, bold and colours stay as in Excel or as you set them", caps: [] },
  { role: "note", name: "Text boxes", hint: "next to the tables · line spacing", caps: ["size", "b", "i", "color", "align", "lh"] },
  { role: "index", name: "Contents list", hint: "entries of the index slide", caps: ["size", "color"] },
  { role: "pageno", name: "Page numbers & footer", hint: "sizes and positions: Options", caps: ["b", "i", "color"] },
];
const px2pt = (px: number) => Math.round(px * 0.75 * 2) / 2;

function StyleRow({ role, name, hint, caps }: typeof ROLES[number]) {
  const st = useStyle(); useStore(s => s.ui.lookScope);         // lookAt() reads the scope
  const f: TextFmt = st.text[role] || {};
  const set = (patch: Partial<Record<keyof TextFmt, unknown>>, label = "Text style: " + name) => {
    const next: Record<string, unknown> = { ...f };
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete next[k]; else next[k] = v; }
    lookChange(label, { text: { [role]: Object.keys(next).length ? next as TextFmt : null } });
  };
  const has = (c: Cap) => caps.includes(c);
  return <div className="tsrow" data-role={role}>
    <div className="tsname"><b style={{ fontFamily: f.font ? fontStack(f.font) : undefined, fontWeight: f.b === false ? 400 : undefined, fontStyle: f.i ? "italic" : undefined, color: f.color }}>{name}</b><small>{hint}</small></div>
    <FontPicker value={f.font || null} placeholder="Design font" onPick={v => set({ font: v })} />
    {has("size") ? <label className="tssize" title="Size in points (empty = as designed)"><Field className="sizebox" value={f.size ? String(px2pt(f.size)) : ""} placeholder="auto"
      onCommit={v => { const n = parseFloat(v.replace(",", ".")); set({ size: isFinite(n) && n > 0 ? Math.round(n * 4 / 3 * 10) / 10 : null }); }} /><span>pt</span></label> : <span />}
    {has("b") ? <button className={"tb" + (f.b ? " on" : "")} title="Bold (click again: as designed)" onClick={() => set({ b: f.b ? null : true })}><b>B</b></button> : <span className="tbgap" />}
    {has("i") ? <button className={"tb" + (f.i ? " on" : "")} title="Italic" onClick={() => set({ i: f.i ? null : true })}><i style={{ fontFamily: "Georgia,serif" }}>I</i></button> : <span className="tbgap" />}
    {has("color") ? <label className="tscolor" title="Colour"><Input type="color" value={f.color || "#0B0D17"} onCommit={e => set({ color: (e.target as HTMLInputElement).value.toUpperCase() })} />
      {f.color ? <button className="btn icon" title="Colour of the design" onClick={() => set({ color: null })}>✕</button> : <small>auto</small>}</label> : <span />}
    {has("align") ? <select className="tsalign" value={f.align || ""} title="Alignment" onChange={e => set({ align: (e.target as HTMLSelectElement).value || null })}>
      <option value="">Align: auto</option><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select> : <span />}
    {has("lh") ? <select className="tsalign" value={f.lh ? String(f.lh) : ""} title="Line spacing" data-lh="" onChange={e => set({ lh: parseFloat((e.target as HTMLSelectElement).value) || null })}>
      <option value="">Lines: auto</option>{[1, 1.15, 1.3, 1.5, 1.75, 2].map(v => <option key={v} value={String(v)}>Lines {v}</option>)}</select> : <span />}
    <button className="btn" disabled={!(lookAt().text || {})[role]} title="Back to the design's look for this kind of text (at this scope)" onClick={() => lookChange("Reset text style: " + name, { text: { [role]: null } })}>Reset</button>
  </div>;
}

/* colours: the theme preset, then any colour of it overridden – the same settings for every design */
function ColorsTab() {
  const st = useStyle(); useStore(s => s.ui.lookScope);
  const P = palette(st), o = (lookAt().colors || {}) as Record<string, string>, d = st.design;
  const set = (k: string, v: string | null) => lookChange(v ? "Colour: " + k : "Theme colour: " + k, { colors: { [k]: v } }, v ? "color" + k : undefined);
  const any = Object.keys(o).length > 0;
  return <div className="colorstab">
    <ThemePicker />
    <div className="sep" />
    <div className="opthd">Your colours <small>override the theme · empty = from the theme</small></div>
    <div className="colgrid" id="colorOverrides">
      {COLOR_KEYS.map(c => {
        const on = c.designs.includes(d), set_ = !!o[c.key];
        return <div className={"colrow" + (on ? "" : " off")} key={c.key} data-color={c.key} title={on ? "" : "Not used by this design"}>
          <label className="colsw"><Input type="color" value={P[c.key]} onCommit={e => set(c.key, (e.target as HTMLInputElement).value.toUpperCase())} /></label>
          <div className="colname"><b>{c.name}</b><small>{c.hint}{on ? "" : " · " + c.designs.map(x => x === "glass" ? "Liquid Glass" : x === "excel" ? "Excel" : "Refined").join(", ") + " only"}</small></div>
          {set_ ? <button className="btn" title="Back to the theme's colour" onClick={() => set(c.key, null)}>Theme</button> : <small className="from">theme</small>}
        </div>;
      })}
    </div>
    <div className="row" style={{ marginTop: "10px", gap: "8px" }}>
      <button className="btn" id="colorsReset" disabled={!any} onClick={() => lookChange("Theme colours", { colors: null })}>Reset all to the theme</button>
      <span className="optnote" style={{ margin: "0" }}>Excel and Excel Refined keep the workbook's table colours; Liquid Glass uses all of them.</span>
    </div>
  </div>;
}

function FontsTab() {
  const lib = useStore(s => s.doc.fonts), busy = useStore(s => s.ui.fontBusy);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const add = async () => { if (await addGoogleFont(name)) setName(""); };
  const remove = async (family: string) => {
    if (await confirmBox("Remove font", `Remove <b>${esc(family)}</b> from the shared font library? Slides that use it show the fallback font instead.`, "Remove", true)) await removeFont(family);
  };
  const suggestions = GOOGLE_POPULAR.filter(f => !inLibrary(f)).slice(0, 14);
  return <div className="fontstab">
    <div className="optnote">{backend.served ? "Fonts added here are saved in the Slide Builder folder: everybody who uses the folder has them, in every deck and in exports – also on PCs that cannot reach Google." : "Opened from disk: Google fonts are remembered in this browser only. Start Slide Builder with Start Slide Builder.bat to save fonts for everybody and to upload your own."}</div>
    <div className="opthd">Font library {busy && <span className="busyfont"><span className="spin" /> adding {busy}…</span>}</div>
    <div className="fontlib" id="fontLib">
      {!lib.length && <div className="none">No fonts yet – add a Google font or upload font files below.</div>}
      {lib.map(f => <div className="fontrow" key={f.family} data-family={f.family}>
        <span className="sample" style={{ fontFamily: fontStack(f.family) }}>{f.family} <span>Aa 1.234,5 %</span></span>
        <small>{f.source === "google" ? "Google Fonts" : "uploaded"}{f.faces.length ? ` · ${new Set(f.faces.map(x => x.weight + x.style)).size} style${new Set(f.faces.map(x => x.weight + x.style)).size === 1 ? "" : "s"}` : ""}{f.by ? " · " + f.by : ""}</small>
        <button className="btn icon" title="Remove from the library" onClick={() => void remove(f.family)}>✕</button>
      </div>)}
    </div>
    <div className="opthd" style={{ marginTop: "14px" }}>Add a Google font</div>
    <div className="row">
      <input id="gfName" className="txt" placeholder="Name on fonts.google.com, e.g. Montserrat" value={name} onChange={e => setName((e.target as HTMLInputElement).value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") void add(); }} />
      <button className="btn primary" id="gfAdd" disabled={!name.trim() || !!busy} onClick={() => void add()}>Add</button>
    </div>
    <div className="chips">{suggestions.map(f => <button key={f} className="chip" style={{ fontFamily: fontStack(f) }} disabled={!!busy} onClick={() => void addGoogleFont(f)}>+ {f}</button>)}</div>
    <div className="opthd" style={{ marginTop: "14px" }}>Your own fonts</div>
    <div className="row">
      <button className="btn" id="fontUpload" disabled={!backend.served || !!busy} onClick={() => fileRef.current?.click()}>⤒ Upload font files…</button>
      <span className="optnote" style={{ margin: "0" }}>.ttf · .otf · .woff · .woff2 – choose all styles of a family at once (regular, bold, italic…). Name and style are read from the files.</span>
    </div>
    <input type="file" ref={fileRef} hidden multiple accept=".ttf,.otf,.woff,.woff2" onChange={e => { const t = e.target as HTMLInputElement, files = Array.from(t.files || []); t.value = ""; if (files.length) void uploadFontFiles(files); }} />
  </div>;
}

export function TextStylesDialog() {
  const tab = useStore(s => s.ui.dialogs.textStyles) || "styles", scope = useStore(s => s.ui.lookScope), open = useStore(s => !!s.doc.sync);
  const fonts = useStore(s => s.doc.fonts.length), design = useStyle().design;
  const close = () => setDialogs({ textStyles: null });
  const setTab = (t: "colors" | "styles" | "fonts") => setDialogs({ textStyles: t });
  return (
    <div className="modal" onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <div className="dlg tsdlg">
        <div className="dlghd"><b>Design: colours, text &amp; fonts</b><span>Start from a theme, then change any colour, font or size – for the whole deck and every design. Formatting you give a single cell, text box or title with the toolbar stays on top.</span></div>
        {tab !== "fonts" && <div className="scope"><span>Apply to</span><div className="seg small" id="lookScope">
          <button data-scope="design" className={scope === "design" ? "on" : ""} onClick={() => patch("ui", { lookScope: "design" })}>This design only – {DESIGN_NAME[design]}</button>
          <button data-scope="all" className={scope === "all" ? "on" : ""} onClick={() => patch("ui", { lookScope: "all" })}>All designs</button></div>
          <small>{scope === "design" ? "Changes here apply only when this design is chosen; switch design at the top to give the others their own look." : "Changes here apply to every design (and replace what a design had set for itself)."}</small></div>}
        <div className="seg tabs"><button className={tab === "colors" ? "on" : ""} id="tabColors" onClick={() => setTab("colors")}>Colours</button><button className={tab === "styles" ? "on" : ""} id="tabStyles" onClick={() => setTab("styles")}>Text styles</button><button className={tab === "fonts" ? "on" : ""} id="tabFonts" onClick={() => setTab("fonts")}>Fonts ({fonts})</button></div>
        <div className="dlgbody">
          {tab === "colors" ? <ColorsTab /> : tab === "styles" ? <>
            <div className="tsgrid">{ROLES.map(r => <StyleRow key={r.role} {...r} />)}</div>
            <div className="optnote" style={{ marginTop: "10px" }}>Saved with this workbook and shared with everybody who opens it. More fonts: the Fonts tab.</div>
          </> : <FontsTab />}
        </div>
        <div className="dlgft">
          {tab !== "fonts" && <button className="btn" id="tsDefault" disabled={!open} title="New decks start with this deck's style, including these text styles" onClick={() => void saveStyleAsDefault()}>Use as default for new decks</button>}
          <span style={{ flex: "1" }} />
          <button className="btn primary" data-a="close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
