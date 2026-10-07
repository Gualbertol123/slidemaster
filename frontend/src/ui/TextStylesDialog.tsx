/* "Text styles & fonts": the one place to set how ALL text of a kind looks in this deck (every slide
   title, every subtitle, all tables, all text boxes, the contents list, page numbers and footer), and
   the shared font library (Google Fonts and uploaded font files, saved in the Slide Builder folder).
   Formatting set on a single text with the toolbar sits on top of these styles. */
import { useRef, useState } from "preact/hooks";
import { S, emit, useApp } from "../state/store";
import { DLG, confirmBox } from "../state/dialogs";
import { saveStyleAsDefault, style, styleChange } from "../state/app";
import { FONTS, addGoogleFont, inLibrary, removeFont, uploadFontFiles } from "../state/fonts";
import { GOOGLE_POPULAR, fontStack } from "../model/fonts";
import { COLOR_KEYS, palette } from "../model/style";
import { ThemePicker } from "./Topbar";
import type { TextFmt, TextRole } from "../model/types";
import { backend } from "../sync/api";
import { esc } from "../xlsx/util";
import { Field } from "./Field";
import { FontPicker } from "./FontPicker";

type Cap = "size" | "b" | "i" | "color" | "align";
const ROLES: { role: TextRole; name: string; hint: string; caps: Cap[] }[] = [
  { role: "title", name: "Slide titles", hint: "every slide; the cover title keeps its automatic size", caps: ["size", "b", "i", "color", "align"] },
  { role: "subtitle", name: "Subtitles", hint: "under the titles, and on the cover", caps: ["size", "b", "i", "color", "align"] },
  { role: "table", name: "Tables", hint: "all cells; sizes, bold and colours stay as in Excel or as you set them", caps: [] },
  { role: "note", name: "Text boxes", hint: "next to the tables", caps: ["size", "b", "i", "color", "align"] },
  { role: "index", name: "Contents list", hint: "entries of the index slide", caps: ["size", "color"] },
  { role: "pageno", name: "Page numbers & footer", hint: "sizes and positions: Options", caps: ["b", "i", "color"] },
];
const px2pt = (px: number) => Math.round(px * 0.75 * 2) / 2;

function StyleRow({ role, name, hint, caps }: typeof ROLES[number]) {
  const f: TextFmt = style().text[role] || {};
  const set = (patch: Partial<Record<keyof TextFmt, unknown>>, label = "Text style: " + name) => {
    const next: Record<string, unknown> = { ...f };
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete next[k]; else next[k] = v; }
    styleChange(label, { text: { [role]: Object.keys(next).length ? next as TextFmt : null } });
  };
  const has = (c: Cap) => caps.includes(c);
  return <div class="tsrow" data-role={role}>
    <div class="tsname"><b style={{ fontFamily: f.font ? fontStack(f.font) : undefined, fontWeight: f.b === false ? 400 : undefined, fontStyle: f.i ? "italic" : undefined, color: f.color }}>{name}</b><small>{hint}</small></div>
    <FontPicker value={f.font || null} placeholder="Design font" onPick={v => set({ font: v })} />
    {has("size") ? <label class="tssize" title="Size in points (empty = as designed)"><Field class="sizebox" value={f.size ? String(px2pt(f.size)) : ""} placeholder="auto"
      onCommit={v => { const n = parseFloat(v.replace(",", ".")); set({ size: isFinite(n) && n > 0 ? Math.round(n * 4 / 3 * 10) / 10 : null }); }} /><span>pt</span></label> : <span />}
    {has("b") ? <button class={"tb" + (f.b ? " on" : "")} title="Bold (click again: as designed)" onClick={() => set({ b: f.b ? null : true })}><b>B</b></button> : <span class="tbgap" />}
    {has("i") ? <button class={"tb" + (f.i ? " on" : "")} title="Italic" onClick={() => set({ i: f.i ? null : true })}><i style="font-family:Georgia,serif">I</i></button> : <span class="tbgap" />}
    {has("color") ? <label class="tscolor" title="Colour"><input type="color" value={f.color || "#0B0D17"} onChange={e => set({ color: (e.target as HTMLInputElement).value.toUpperCase() })} />
      {f.color ? <button class="btn icon" title="Colour of the design" onClick={() => set({ color: null })}>✕</button> : <small>auto</small>}</label> : <span />}
    {has("align") ? <select class="tsalign" value={f.align || ""} title="Alignment" onChange={e => set({ align: (e.target as HTMLSelectElement).value || null })}>
      <option value="">Align: auto</option><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select> : <span />}
    <button class="btn" disabled={!Object.keys(f).length} title="Back to the design's look for this kind of text" onClick={() => styleChange("Reset text style: " + name, { text: { [role]: null } })}>Reset</button>
  </div>;
}

/* colours: the theme preset, then any colour of it overridden – the same settings for every design */
function ColorsTab() {
  const st = style(), P = palette(st), o = st.colors || {}, d = st.design;
  const set = (k: string, v: string | null) => styleChange(v ? "Colour: " + k : "Theme colour: " + k, { colors: { [k]: v } }, v ? "color" + k : undefined);
  const any = Object.keys(o).length > 0;
  return <div class="colorstab">
    <ThemePicker />
    <div class="sep" />
    <div class="opthd">Your colours <small>override the theme · empty = from the theme</small></div>
    <div class="colgrid" id="colorOverrides">
      {COLOR_KEYS.map(c => {
        const on = c.designs.includes(d), set_ = !!o[c.key];
        return <div class={"colrow" + (on ? "" : " off")} key={c.key} data-color={c.key} title={on ? "" : "Not used by this design"}>
          <label class="colsw"><input type="color" value={P[c.key]} onChange={e => set(c.key, (e.target as HTMLInputElement).value.toUpperCase())} /></label>
          <div class="colname"><b>{c.name}</b><small>{c.hint}{on ? "" : " · " + c.designs.map(x => x === "glass" ? "Liquid Glass" : x === "excel" ? "Excel" : "Refined").join(", ") + " only"}</small></div>
          {set_ ? <button class="btn" title="Back to the theme's colour" onClick={() => set(c.key, null)}>Theme</button> : <small class="from">theme</small>}
        </div>;
      })}
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="btn" id="colorsReset" disabled={!any} onClick={() => styleChange("Theme colours", { colors: null })}>Reset all to the theme</button>
      <span class="optnote" style="margin:0">Excel keeps the workbook's colours except the ones you set here. Excel Refined and Liquid Glass use all of them.</span>
    </div>
  </div>;
}

function FontsTab() {
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const add = async () => { if (await addGoogleFont(name)) setName(""); };
  const remove = async (family: string) => {
    if (await confirmBox("Remove font", `Remove <b>${esc(family)}</b> from the shared font library? Slides that use it show the fallback font instead.`, "Remove", true)) await removeFont(family);
  };
  const suggestions = GOOGLE_POPULAR.filter(f => !inLibrary(f)).slice(0, 14);
  return <div class="fontstab">
    <div class="optnote">{backend.served ? "Fonts added here are saved in the Slide Builder folder: everybody who uses the folder has them, in every deck and in exports – also on PCs that cannot reach Google." : "Opened from disk: Google fonts are remembered in this browser only. Start Slide Builder with Start Slide Builder.bat to save fonts for everybody and to upload your own."}</div>
    <div class="opthd">Font library {FONTS.busy && <span class="busyfont"><span class="spin" /> adding {FONTS.busy}…</span>}</div>
    <div class="fontlib" id="fontLib">
      {!FONTS.lib.length && <div class="none">No fonts yet – add a Google font or upload font files below.</div>}
      {FONTS.lib.map(f => <div class="fontrow" key={f.family} data-family={f.family}>
        <span class="sample" style={{ fontFamily: fontStack(f.family) }}>{f.family} <span>Aa 1.234,5 %</span></span>
        <small>{f.source === "google" ? "Google Fonts" : "uploaded"}{f.faces.length ? ` · ${new Set(f.faces.map(x => x.weight + x.style)).size} style${new Set(f.faces.map(x => x.weight + x.style)).size === 1 ? "" : "s"}` : ""}{f.by ? " · " + f.by : ""}</small>
        <button class="btn icon" title="Remove from the library" onClick={() => void remove(f.family)}>✕</button>
      </div>)}
    </div>
    <div class="opthd" style="margin-top:14px">Add a Google font</div>
    <div class="row">
      <input id="gfName" class="txt" placeholder="Name on fonts.google.com, e.g. Montserrat" value={name} onInput={e => setName((e.target as HTMLInputElement).value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") void add(); }} />
      <button class="btn primary" id="gfAdd" disabled={!name.trim() || !!FONTS.busy} onClick={() => void add()}>Add</button>
    </div>
    <div class="chips">{suggestions.map(f => <button key={f} class="chip" style={{ fontFamily: fontStack(f) }} disabled={!!FONTS.busy} onClick={() => void addGoogleFont(f)}>+ {f}</button>)}</div>
    <div class="opthd" style="margin-top:14px">Your own fonts</div>
    <div class="row">
      <button class="btn" id="fontUpload" disabled={!backend.served || !!FONTS.busy} onClick={() => fileRef.current?.click()}>⤒ Upload font files…</button>
      <span class="optnote" style="margin:0">.ttf · .otf · .woff · .woff2 – choose all styles of a family at once (regular, bold, italic…). Name and style are read from the files.</span>
    </div>
    <input type="file" ref={fileRef} hidden multiple accept=".ttf,.otf,.woff,.woff2" onChange={e => { const t = e.target as HTMLInputElement, files = Array.from(t.files || []); t.value = ""; if (files.length) void uploadFontFiles(files); }} />
  </div>;
}

export function TextStylesDialog() {
  useApp();
  const tab = DLG.textStyles || "styles";
  const close = () => { DLG.textStyles = null; emit(); };
  const setTab = (t: "colors" | "styles" | "fonts") => { DLG.textStyles = t; emit(); };
  return (
    <div class="modal" onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <div class="dlg tsdlg">
        <div class="dlghd"><b>Design: colours, text &amp; fonts</b><span>Start from a theme, then change any colour, font or size – for the whole deck and every design. Formatting you give a single cell, text box or title with the toolbar stays on top.</span></div>
        <div class="seg tabs"><button class={tab === "colors" ? "on" : ""} id="tabColors" onClick={() => setTab("colors")}>Colours</button><button class={tab === "styles" ? "on" : ""} id="tabStyles" onClick={() => setTab("styles")}>Text styles</button><button class={tab === "fonts" ? "on" : ""} id="tabFonts" onClick={() => setTab("fonts")}>Fonts ({FONTS.lib.length})</button></div>
        <div class="dlgbody">
          {tab === "colors" ? <ColorsTab /> : tab === "styles" ? <>
            <div class="tsgrid">{ROLES.map(r => <StyleRow key={r.role} {...r} />)}</div>
            <div class="optnote" style="margin-top:10px">Saved with this workbook and shared with everybody who opens it. More fonts: the Fonts tab.</div>
          </> : <FontsTab />}
        </div>
        <div class="dlgft">
          {tab !== "fonts" && <button class="btn" id="tsDefault" disabled={!S.sync} title="New decks start with this deck's style, including these text styles" onClick={() => void saveStyleAsDefault()}>Use as default for new decks</button>}
          <span style="flex:1" />
          <button class="btn primary" data-a="close" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
