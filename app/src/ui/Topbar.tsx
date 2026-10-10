import { useState } from "react";
import { patch, toast, useStore } from "../state/store";
import { esc } from "@slide-builder/core/xlsx/util";
import { guard, lookChange, showVersion, openFromFolder, openLocalFile, openWizard, reloadWorkbook, saveStyleAsDefault, setHealth, styleChange, setPrefs } from "../state/app";
import { openInstaller } from "../state/dialogs";
import { backend, type FileInfo } from "../sync/api";
import { doExport, exportVersions, type ExportKind } from "../editor/export";
import { Dropdown } from "./Dropdown";
import { Field } from "./Field";
import { openFontManager } from "./FontPicker";
import type { Footer, PageNumbers, Theme } from "@slide-builder/core/model/types";
import { THEMES, themeOf } from "@slide-builder/core/model/style";
import { Input } from "./Input";
import { useStyle } from "./hooks";

/* sliders: preview the number at once, apply (one operation, one undo step) when the hand rests */
const sliderTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** one timer per slider: moving one slider never cancels another slider's pending change */
function debounced(key: string, fn: () => void, ms = 140) { const t = sliderTimers.get(key); if (t) clearTimeout(t); sliderTimers.set(key, setTimeout(() => { sliderTimers.delete(key); fn(); }, ms)); }
const fmtTime = (s: number) => new Date(s * 1000).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function OpenMenu() {
  const file = useStore(s => s.deck.file);
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const load = () => { setFiles(null); void backend.files().then(setFiles).catch(() => setFiles([])); };
  return (
    <Dropdown onOpen={load} button={(_o, toggle) => (
      <button className="btn" id="openBtn" title="Open a workbook from the folder or browse" onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z" /></svg>Open
      </button>)}>
      {close => <>
        {backend.served && <>
          <div className="hd">Workbooks in the folder</div>
          {files === null ? <div className="empty">Loading…</div> : files.length ? files.map(f => (
            <button key={f.name} data-f={f.name} onClick={() => { close(); void guard(() => openFromFolder(f.name)); }}>
              {f.name}<small>{fmtTime(f.mtime)}{f.updatedBy ? ` · slides by ${f.updatedBy}` : ""}</small>
            </button>)) : <div className="empty">No .xlsx files next to the app</div>}
          <div className="sep" />
        </>}
        <button onClick={() => { close(); (document.getElementById("fileInput") as HTMLInputElement).click(); }}>Browse for a workbook…</button>
        {file?.src === "folder" && <button onClick={() => { close(); void guard(reloadWorkbook); }}>Reload “{file.name}” from disk<small>after saving in Excel</small></button>}
      </>}
    </Dropdown>
  );
}

/* colour theme: built-in themes (incl. the Intesa Sanpaolo corporate colours) or a custom one */
type TKey = "c1" | "c2" | "c3" | "c4" | "a1" | "a2";
export function ThemePicker() {
  const st = useStyle(), cur = themeOf(st);
  const th = (patch: Partial<Theme>, coalesce?: string) => lookChange("Colour theme", { theme: patch }, coalesce);
  const swatch = (t: { c1: string; c2: string; c3: string; c4: string; a1: string }) => <i className="thsw" style={{ background: `linear-gradient(135deg,${t.c1},${t.c2} 40%,${t.c3} 75%,${t.c4})` }}><b style={{ background: t.a1 }} /></i>;
  const custom = () => th({ id: "custom", c1: cur.c1, c2: cur.c2, c3: cur.c3, c4: cur.c4, a1: cur.a1, a2: cur.a2 });
  const pick = (k: TKey, label: string) => <label className="thpick" title={label}><Input type="color" data-tk={k} value={cur[k]}
    onChange={e => { const v = (e.target as HTMLInputElement).value.toUpperCase(); debounced("theme" + k, () => th({ id: "custom", [k]: v }, "theme" + k), 250); }} /><span>{label}</span></label>;
  return <>
    <div className="opthd">Colour theme</div>
    <div className="themes" id="themeList">
      {THEMES.map(t => <button key={t.id} data-theme={t.id} className={cur.id === t.id ? "on" : ""} title={t.name} onClick={() => th({ id: t.id })}>{swatch(t)}<span>{t.name}</span></button>)}
      <button data-theme="custom" className={cur.id === "custom" ? "on" : ""} title="Your own colours" onClick={custom}>{swatch(cur.id === "custom" ? cur : { c1: "#fff", c2: "#ddd", c3: "#bbb", c4: "#999", a1: "#666" })}<span>Custom</span></button>
    </div>
    {cur.id === "custom" && <div className="thcustom" id="themeCustom">
      <span className="lbl">Background</span>{pick("c1", "1")}{pick("c2", "2")}{pick("c3", "3")}{pick("c4", "4")}
      <span className="lbl">Accents</span>{pick("a1", "1")}{pick("a2", "2")}
    </div>}
    <div className="optnote">Background colours of Liquid Glass and the accent colour of titles, cover, index and page numbers (both designs). The “Colour” slider sets how strong the background is.</div>
  </>;
}

function Options() {
  const st = useStyle(), p = st.pn, has = useStore(s => !!s.doc.sync);
  const pn = (patch: Partial<PageNumbers>, coalesce?: string) => styleChange("Page numbers", { pn: patch }, coalesce);
  const ft = st.footer, fo = (patch: Partial<Footer>, coalesce?: string) => styleChange("Footer", { footer: patch }, coalesce);
  return (
    <Dropdown right menuClass="optmenu" button={(_o, toggle) => <button className="btn" id="optBtn" title="Page numbers and logo" disabled={!has} onClick={toggle}>⚙ Options</button>}>
      {() => <>
        <div className="optnote">Colour theme, colours and fonts: <a href="#" onClick={e => { e.preventDefault(); openFontManager("colors"); }}>Design…</a></div>
        <div className="sep" />
        <div className="opthd">Page numbers</div>
        <label className="ck big"><input type="checkbox" id="pnOn" checked={p.on} onChange={e => pn({ on: (e.target as HTMLInputElement).checked })} /> Show page numbers on every slide</label>
        <div className={"optgrid" + (p.on ? "" : " off")} id="pnBox">
          <label>Start at</label><Field id="pnStart" type="number" min="0" step="1" style={{ width: "80px" }} value={String(p.start)} onCommit={v => { const n = parseInt(v, 10); pn({ start: isFinite(n) ? n : 1 }); }} />
          <label>Position</label>
          <div className="posgrid" id="pnPos">
            {([["tl", "◤", "Top left"], ["tc", "▲", "Top centre"], ["tr", "◥", "Top right"], ["bl", "◣", "Bottom left"], ["bc", "▼", "Bottom centre"], ["br", "◢", "Bottom right"]] as const).map(([k, g, t]) =>
              <button key={k} data-pos={k} title={t} className={p.pos === k ? "on" : ""} onClick={() => pn({ pos: k })}>{g}</button>)}
          </div>
          <label>Size</label><div className="row"><Input type="range" id="pnSize" min="10" max="32" step="1" value={p.size} onChange={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v + " px"; debounced("pnsize", () => pn({ size: v }, "pnsize")); }} /><span className="cv">{p.size} px</span></div>
          <label>Format</label>
          <select id="pnFormat" value={p.format} onChange={e => pn({ format: (e.target as HTMLSelectElement).value as PageNumbers["format"] })}><option value="n">3</option><option value="nN">3 / 12</option><option value="page">Page 3</option><option value="p">p. 3</option></select>
          <label>Style</label>
          <div className="seg small" id="pnStyle">{(["capsule", "plain"] as const).map(k => <button key={k} className={p.style === k ? "on" : ""} onClick={() => pn({ style: k })}>{k === "capsule" ? "Glass capsule" : "Plain text"}</button>)}</div>
          <label></label><label className="ck"><input type="checkbox" id="pnCover" checked={p.cover} onChange={e => pn({ cover: (e.target as HTMLInputElement).checked })} /> also on the cover</label>
        </div>
        <div className="optnote">The same style is used on every slide of this deck, in both designs. The index slide always lists these page numbers. Font and colour: <a href="#" onClick={e => { e.preventDefault(); openFontManager("styles"); }}>Text styles</a>.</div>
        <div className="sep" />
        <div className="opthd">Footer</div>
        <label className="ck big"><input type="checkbox" id="ftOn" checked={ft.on} onChange={e => fo({ on: (e.target as HTMLInputElement).checked })} /> Show a footer on every slide</label>
        <div className={"optgrid" + (ft.on ? "" : " off")} id="ftBox">
          <label>Text</label><Field id="ftText" style={{ width: "100%" }} placeholder="e.g. Confidential · {workbook} · {date}" value={ft.text} onCommit={v => fo({ text: v })} />
          <label>Position</label>
          <div className="posgrid" id="ftPos">
            {([["tl", "◤", "Top left"], ["tc", "▲", "Top centre"], ["tr", "◥", "Top right"], ["bl", "◣", "Bottom left"], ["bc", "▼", "Bottom centre"], ["br", "◢", "Bottom right"]] as const).map(([k, g, t]) =>
              <button key={k} data-pos={k} title={t} className={ft.pos === k ? "on" : ""} onClick={() => fo({ pos: k })}>{g}</button>)}
          </div>
          <label>Size</label><div className="row"><Input type="range" id="ftSize" min="9" max="28" step="1" value={ft.size} onChange={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v + " px"; debounced("ftsize", () => fo({ size: v }, "ftsize")); }} /><span className="cv">{ft.size} px</span></div>
          <label>Style</label>
          <div className="seg small" id="ftStyle">{(["plain", "capsule"] as const).map(k => <button key={k} className={ft.style === k ? "on" : ""} onClick={() => fo({ style: k })}>{k === "capsule" ? "Glass capsule" : "Plain text"}</button>)}</div>
          <label></label><label className="ck"><input type="checkbox" id="ftCover" checked={ft.cover} onChange={e => fo({ cover: (e.target as HTMLInputElement).checked })} /> also on the cover</label>
        </div>
        <div className="optnote">{"{date}"} = today, {"{workbook}"} = file name, {"{title}"} = slide title. Next to the page number when both are in the same corner.</div>
        <div className="sep" />
        <div className="opthd">Logo</div>
        <div className="optrow"><label htmlFor="logoInput">Logo file</label>
          <Field id="logoInput" placeholder="logo.png" style={{ width: "150px" }} value={st.logo} onCommit={v => { patch("ui", { logoMissing: false }); styleChange("Logo", { logo: v.trim() }); }} />
          <label className="btn" title="Choose the logo picture – it is copied into the Slide Builder folder for everybody">Choose…<input type="file" id="logoFile" hidden accept=".png,.jpg,.jpeg,.gif,.webp,.bmp" onChange={async e => {
            const t = e.target as HTMLInputElement, f = t.files?.[0]; t.value = ""; if (!f) return;
            try { const name = await backend.uploadLogo(f.name, await f.arrayBuffer()); patch("ui", { logoMissing: false }); styleChange("Logo", { logo: name }); toast(`Logo <b>${esc(name)}</b> saved in the Slide Builder folder.`); }
            catch (err) { toast("⚠ " + esc((err as Error).message), [], true); }
          }} /></label></div>
        <label className="ck big"><input type="checkbox" id="logoBubble" checked={st.logoBubble} onChange={e => styleChange(st.logoBubble ? "Remove logo bubble" : "Logo bubble", { logoBubble: (e.target as HTMLInputElement).checked ? null : false })} /> Bubble around the logo{st.design === "excel" ? " (Liquid Glass)" : ""}</label>
        <div className="optnote">Untick to show the logo on its own, without the glass bubble. Hide the logo on single slides with the Logo button in the toolbar.</div>
        <div className="sep" />
        <div className="opthd">Look</div>
        <div className="optgrid">
          <label>Corners</label><div className="row"><Input type="range" id="radiusRange" min="0" max="200" step="10" value={st.radius}
            onChange={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v === 0 ? "square" : v + " %"; debounced("radius", () => styleChange("Corner roundness", { radius: v }, "radius")); }} /><span className="cv">{st.radius === 0 ? "square" : st.radius + " %"}</span></div>
          {st.design === "glass" && <><label>Contrast</label><div className="row"><Input type="range" id="contrastRange" min="0" max="100" step="5" value={st.contrast}
            onChange={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v < 50 ? "softer" : v > 50 ? "stronger" : "as designed"; debounced("contrast", () => styleChange("Contrast", { contrast: v }, "contrast")); }} /><span className="cv">{st.contrast < 50 ? "softer" : st.contrast > 50 ? "stronger" : "as designed"}</span></div></>}
        </div>
        <div className="optnote">Corners: roundness of tables, bubbles and the logo (0 = square). Contrast: how much the tables and bubbles stand out from the background.</div>
        <div className="sep" />
        <div className="opthd">This deck's style</div>
        <div className="optnote">Design, colour, page numbers and logo are saved with this workbook and shared with everybody who opens it.</div>
        <div className="optrow"><button className="btn" id="styleDefault" onClick={() => void saveStyleAsDefault()}>Use as default for new decks</button></div>
      </>}
    </Dropdown>
  );
}

function ServerPill() {
  const h = useStore(s => s.ui.health);
  if (!backend.served) return <span className="pill err" id="srv"><i className="dot" />Helper not running</span>;
  if (!h) return <span className="pill err" id="srv"><i className="dot" />Helper stopped</span>;
  const e = h.engine, ok = e.state === "ready", st = e.state === "starting" || e.state === "idle";
  const title = (e.engines || []).map(x => `${x.label}: ${x.state}${x.detail ? " – " + x.detail : ""}`).join("\n") + "\n\nClick to retry. Install the recommended engine once with “Install export engine”.";
  const click = async () => {
    if (!ok && !st || !e.local) return openInstaller();
    await backend.engineRestart(); setTimeout(() => void backend.health().then(setHealth), 1500);
  };
  return <span className={"pill " + (ok ? "ok" : st ? "warn" : "err")} id="srv" title={title} style={{ cursor: "pointer" }} onClick={() => void click()}>
    <i className="dot" />{ok ? "Export: " + (e.browser || "ready") : st ? "Testing export engines…" : "Export: in-window only · install engine"}
  </span>;
}

function ExportButton() {
  const health = useStore(s => !!s.ui.health), slides = useStore(s => s.deck.slides.length), exporting = useStore(s => s.ui.exporting);
  const mode = useStore(s => s.prefs.prefs.pdfMode) || "vector", versions = useStore(s => s.doc.view?.preset?.versions) || [];
  const can = backend.served && health && slides > 0 && !exporting;
  const item = (k: ExportKind, label: string, small?: string, close?: () => void) =>
    <button data-x={k} className={k === "pdf-" + mode ? "cur" : ""} onClick={() => { close?.(); void doExport(k); }}>{label}{small && <small>{small}</small>}</button>;
  return (
    <Dropdown right style={{ display: "flex" }} button={(_o, toggle) => <>
      <button className="btn primary split" id="exportBtn" disabled={!can} onClick={() => void doExport("pdf")}>{exporting ? <><span className="spin" />Rendering…</> : "Export PDF"}</button>
      <button className="btn primary caret" id="exportMenuBtn" disabled={!can} onClick={toggle}>▾</button>
    </>}>
      {close => <>
        <div className="hd">PDF – all slides, saved in the export folder</div>
        {item("pdf-vector", "PDF · text & tables", "real text and lines, sharp at any zoom – no pictures", close)}
        {item("pdf-exact", "PDF · as pictures", "each slide as a 480 dpi image", close)}
        {item("pdf-current", "PDF · current slide only", undefined, close)}
        <div className="sep" />
        <div className="hd">Images (4800 × 2700)</div>
        {item("copy", "Copy current slide", "paste into PowerPoint", close)}
        {item("png-current", "PNG · current slide", undefined, close)}
        {item("png-all", "PNG · every slide", undefined, close)}
        <div className="sep" />
        <div className="hd">Versions (✦ Wizard › Versions)</div>
        <button data-x="versions" disabled={!versions.length} onClick={() => { close(); void exportVersions(null); }}>PDF · every version<small>{versions.map(v => v.name).join(", ") || "none yet"} · this design</small></button>
        <button data-x="versions-2" disabled={!versions.length} onClick={() => { close(); void exportVersions(["glass", "excel"]); }}>PDF · every version × Liquid Glass + Excel<small>{2 * versions.length} files</small></button>
        <button data-x="versions-3" disabled={!versions.length} onClick={() => { close(); void exportVersions(["glass", "excel", "clean"]); }}>PDF · every version × all three designs</button>
      </>}
    </Dropdown>
  );
}

/* which version of the deck is on screen: the full deck, or a version with its removed cells empty */
function VersionPicker() {
  const vs = useStore(s => s.doc.view?.preset?.versions) || [], version = useStore(s => s.deck.version);
  if (!vs.length) return null;
  return <label className="verpick" title="Version shown on screen (✦ Wizard › Versions); exports: Export ▾ › every version">
    <span>Version</span><select id="versionSel" value={version} onChange={e => showVersion((e.target as HTMLSelectElement).value)}>
      <option value="">Full deck</option>{vs.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>;
}

function Others() {
  const others = useStore(s => s.ui.others), file = useStore(s => s.deck.file), me = useStore(s => s.prefs.user);
  const here = others.filter(o => file && o.workbook === file.name);
  if (!here.length) return null;
  const names = [...new Set(here.map(o => o.user + (o.user === me ? " (another window)" : "")))];
  return <span className="presence" id="presence" title={"Also editing this workbook: " + names.join(", ") + "\nChanges are merged automatically; the same cell edited by two people keeps the last change."}>
    {names.slice(0, 3).map(n => <i key={n}>{n.slice(0, 2).toUpperCase()}</i>)}<span>{names.length === 1 ? names[0] + " is also here" : names.length + " others here"}</span>
  </span>;
}

export function Topbar() {
  const st = useStyle(), has = useStore(s => !!s.doc.sync), f = useStore(s => s.deck.file), n = useStore(s => s.deck.slides.length);
  const wb = useStore(s => !!s.deck.wb), opening = useStore(s => s.deck.opening);
  return (
    <header className="topbar">
      <div className="brand"><i />Slide Builder</div>
      <OpenMenu />
      <input type="file" id="fileInput" accept=".xlsx,.xlsm,.xlsb,.xls" hidden onChange={e => { const t = e.target as HTMLInputElement; const file = t.files?.[0]; if (file) void guard(() => openLocalFile(file)); t.value = ""; }} />
      <button className="btn icon" id="reloadBtn" title="Reload the workbook from disk (after saving in Excel)" disabled={f?.src !== "folder"} onClick={() => void guard(reloadWorkbook)}>↻</button>
      <button className="btn" id="wizardBtn" disabled={!wb} title="Choose sheets and tables, arrange slides, cover and index" onClick={() => void guard(openWizard)}>✦ Wizard</button>
      <div className="fname" id="fileName">{opening ? <>Opening <b>{opening}</b>…</> : f ? <><b>{f.name}</b> · {n} slide{n === 1 ? "" : "s"}{f.src === "upload" ? " · not in the folder" : f.src === "local" ? " · preview only" : ""}</> : "No workbook"}</div>
      <VersionPicker />
      <Others />
      <div className="spacer" />
      <div className="seg" title="Slide design (saved with this workbook)">
        {([["glass", <><span className="lg">Liquid </span>Glass</>, "Liquid Glass: light glass surfaces over a coloured background"], ["excel", "Excel", "Excel: the workbook's tables exactly as they are – nothing added"], ["clean", <><span className="lg">Excel </span>Refined</>, "Excel Refined: the workbook's tables in one consistent, polished style, with comments and text boxes"]] as const).map(([d, l, t]) =>
          <button key={d} data-design={d} disabled={!has} title={t} className={st.design === d ? "on" : ""} onClick={() => styleChange("Design", { design: d })}>{l}</button>)}
      </div>
      <button className="btn" id="themeBtn" disabled={!has} title="Colour theme, your own colours, text styles and fonts – for every design" onClick={() => openFontManager("colors")}>
        <i className="thdot" style={{ background: `conic-gradient(${themeOf(st).c1},${themeOf(st).c2},${themeOf(st).c3},${themeOf(st).c4},${themeOf(st).c1})` }} /><span className="lbl2">Design…</span></button>
      {st.design === "glass" && <div className="seg" id="glassSeg" title="Strength of the glass effect">
        {(["subtle", "medium", "strong"] as const).map(g => <button key={g} data-glass={g} disabled={!has} className={st.glass === g ? "on" : ""} onClick={() => styleChange("Glass strength", { glass: g })}>{g[0].toUpperCase() + g.slice(1)}</button>)}
      </div>}
      {st.design === "glass" && <div className="colorctl" id="colorCtl" title="Background colour: from plain white to full colour">
        <span className="lbl">Colour</span><Input type="range" id="colorRange" min="0" max="100" step="5" disabled={!has} value={st.color} onChange={e => { const v = +(e.target as HTMLInputElement).value; document.getElementById("colorVal")!.textContent = v + "%"; debounced("color", () => styleChange("Background colour", { color: v }, "color")); }} /><span id="colorVal" className="cv">{st.color}%</span>
      </div>}
      <Options />
      <ServerPill />
      <ExportButton />
    </header>
  );
}
export { setPrefs };
