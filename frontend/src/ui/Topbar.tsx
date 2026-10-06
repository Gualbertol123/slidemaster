import { useState } from "preact/hooks";
import { S, useApp } from "../state/store";
import { guard, openFromFolder, openLocalFile, openWizard, reloadWorkbook, saveStyleAsDefault, style, styleChange, setPrefs } from "../state/app";
import { openInstaller } from "../state/dialogs";
import { backend, type FileInfo } from "../sync/api";
import { doExport, type ExportKind } from "../editor/export";
import { Dropdown } from "./Dropdown";
import { PN_FONTS } from "../render/pagenumbers";
import type { Footer, PageNumbers } from "../model/types";

/* sliders: preview the number at once, apply (one operation, one undo step) when the hand rests */
const sliderTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** one timer per slider: moving one slider never cancels another slider's pending change */
function debounced(key: string, fn: () => void, ms = 140) { const t = sliderTimers.get(key); if (t) clearTimeout(t); sliderTimers.set(key, setTimeout(() => { sliderTimers.delete(key); fn(); }, ms)); }
const fmtTime = (s: number) => new Date(s * 1000).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function OpenMenu() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const load = () => { setFiles(null); void backend.files().then(setFiles).catch(() => setFiles([])); };
  return (
    <Dropdown onOpen={load} button={(_o, toggle) => (
      <button class="btn" id="openBtn" title="Open a workbook from the folder or browse" onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.5h5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z" /></svg>Open
      </button>)}>
      {close => <>
        {backend.served && <>
          <div class="hd">Workbooks in the folder</div>
          {files === null ? <div class="empty">Loading…</div> : files.length ? files.map(f => (
            <button key={f.name} data-f={f.name} onClick={() => { close(); void guard(() => openFromFolder(f.name)); }}>
              {f.name}<small>{fmtTime(f.mtime)}{f.updatedBy ? ` · slides by ${f.updatedBy}` : ""}</small>
            </button>)) : <div class="empty">No .xlsx files next to the app</div>}
          <div class="sep" />
        </>}
        <button onClick={() => { close(); (document.getElementById("fileInput") as HTMLInputElement).click(); }}>Browse for a workbook…</button>
        {S.file?.src === "folder" && <button onClick={() => { close(); void guard(reloadWorkbook); }}>Reload “{S.file.name}” from disk<small>after saving in Excel</small></button>}
      </>}
    </Dropdown>
  );
}

function Options() {
  const st = style(), p = st.pn, has = !!S.sync;
  const pn = (patch: Partial<PageNumbers>, coalesce?: string) => styleChange("Page numbers", { pn: patch }, coalesce);
  const ft = st.footer, fo = (patch: Partial<Footer>, coalesce?: string) => styleChange("Footer", { footer: patch }, coalesce);
  return (
    <Dropdown right menuClass="optmenu" button={(_o, toggle) => <button class="btn" id="optBtn" title="Page numbers and logo" disabled={!has} onClick={toggle}>⚙ Options</button>}>
      {() => <>
        <div class="opthd">Page numbers</div>
        <label class="ck big"><input type="checkbox" id="pnOn" checked={p.on} onChange={e => pn({ on: (e.target as HTMLInputElement).checked })} /> Show page numbers on every slide</label>
        <div class={"optgrid" + (p.on ? "" : " off")} id="pnBox">
          <label>Start at</label><input id="pnStart" type="number" min="0" step="1" style="width:80px" value={p.start} onKeyDown={e => e.stopPropagation()} onChange={e => { const v = parseInt((e.target as HTMLInputElement).value, 10); pn({ start: isFinite(v) ? v : 1 }); }} />
          <label>Position</label>
          <div class="posgrid" id="pnPos">
            {([["tl", "◤", "Top left"], ["tc", "▲", "Top centre"], ["tr", "◥", "Top right"], ["bl", "◣", "Bottom left"], ["bc", "▼", "Bottom centre"], ["br", "◢", "Bottom right"]] as const).map(([k, g, t]) =>
              <button key={k} data-pos={k} title={t} class={p.pos === k ? "on" : ""} onClick={() => pn({ pos: k })}>{g}</button>)}
          </div>
          <label>Font</label>
          <select id="pnFont" value={p.font} onChange={e => pn({ font: (e.target as HTMLSelectElement).value })}>
            {Object.keys(PN_FONTS).map(k => <option key={k} value={k}>{({ auto: "Same as the slide", segoe: "Segoe UI", arial: "Arial", calibri: "Calibri", gothic: "Century Gothic", georgia: "Georgia", verdana: "Verdana", mono: "Consolas" } as Record<string, string>)[k]}</option>)}
          </select>
          <label>Size</label><div class="row"><input type="range" id="pnSize" min="10" max="32" step="1" value={p.size} onInput={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v + " px"; debounced("pnsize", () => pn({ size: v }, "pnsize")); }} /><span class="cv">{p.size} px</span></div>
          <label>Format</label>
          <select id="pnFormat" value={p.format} onChange={e => pn({ format: (e.target as HTMLSelectElement).value as PageNumbers["format"] })}><option value="n">3</option><option value="nN">3 / 12</option><option value="page">Page 3</option><option value="p">p. 3</option></select>
          <label>Style</label>
          <div class="seg small" id="pnStyle">{(["capsule", "plain"] as const).map(k => <button key={k} class={p.style === k ? "on" : ""} onClick={() => pn({ style: k })}>{k === "capsule" ? "Glass capsule" : "Plain text"}</button>)}</div>
          <label></label><label class="ck"><input type="checkbox" id="pnCover" checked={p.cover} onChange={e => pn({ cover: (e.target as HTMLInputElement).checked })} /> also on the cover</label>
        </div>
        <div class="optnote">The same style is used on every slide of this deck, in both designs. The index slide always lists these page numbers.</div>
        <div class="sep" />
        <div class="opthd">Footer</div>
        <label class="ck big"><input type="checkbox" id="ftOn" checked={ft.on} onChange={e => fo({ on: (e.target as HTMLInputElement).checked })} /> Show a footer on every slide</label>
        <div class={"optgrid" + (ft.on ? "" : " off")} id="ftBox">
          <label>Text</label><input id="ftText" style="width:100%" placeholder="e.g. Confidential · {workbook} · {date}" value={ft.text}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} onChange={e => fo({ text: (e.target as HTMLInputElement).value })} />
          <label>Position</label>
          <div class="posgrid" id="ftPos">
            {([["tl", "◤", "Top left"], ["tc", "▲", "Top centre"], ["tr", "◥", "Top right"], ["bl", "◣", "Bottom left"], ["bc", "▼", "Bottom centre"], ["br", "◢", "Bottom right"]] as const).map(([k, g, t]) =>
              <button key={k} data-pos={k} title={t} class={ft.pos === k ? "on" : ""} onClick={() => fo({ pos: k })}>{g}</button>)}
          </div>
          <label>Size</label><div class="row"><input type="range" id="ftSize" min="9" max="28" step="1" value={ft.size} onInput={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v + " px"; debounced("ftsize", () => fo({ size: v }, "ftsize")); }} /><span class="cv">{ft.size} px</span></div>
          <label>Style</label>
          <div class="seg small" id="ftStyle">{(["plain", "capsule"] as const).map(k => <button key={k} class={ft.style === k ? "on" : ""} onClick={() => fo({ style: k })}>{k === "capsule" ? "Glass capsule" : "Plain text"}</button>)}</div>
          <label></label><label class="ck"><input type="checkbox" id="ftCover" checked={ft.cover} onChange={e => fo({ cover: (e.target as HTMLInputElement).checked })} /> also on the cover</label>
        </div>
        <div class="optnote">{"{date}"} = today, {"{workbook}"} = file name, {"{title}"} = slide title. Next to the page number when both are in the same corner.</div>
        <div class="sep" />
        <div class="opthd">Logo</div>
        <div class="optrow"><label for="logoInput">Logo file (backend folder)</label>
          <input id="logoInput" placeholder="logo.png" style="width:150px" value={st.logo} onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onChange={e => { S.logoMissing = false; styleChange("Logo", { logo: (e.target as HTMLInputElement).value.trim() }); }} /></div>
        <div class="optnote">Hide it on single slides with the Logo button in the toolbar.</div>
        <div class="sep" />
        <div class="opthd">Look</div>
        <div class="optgrid">
          <label>Corners</label><div class="row"><input type="range" id="radiusRange" min="0" max="200" step="10" value={st.radius}
            onInput={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v === 0 ? "square" : v + " %"; debounced("radius", () => styleChange("Corner roundness", { radius: v }, "radius")); }} /><span class="cv">{st.radius === 0 ? "square" : st.radius + " %"}</span></div>
          {st.design === "glass" && <><label>Contrast</label><div class="row"><input type="range" id="contrastRange" min="0" max="100" step="5" value={st.contrast}
            onInput={e => { const v = +(e.target as HTMLInputElement).value, el = (e.target as HTMLElement).nextElementSibling; if (el) el.textContent = v < 50 ? "softer" : v > 50 ? "stronger" : "as designed"; debounced("contrast", () => styleChange("Contrast", { contrast: v }, "contrast")); }} /><span class="cv">{st.contrast < 50 ? "softer" : st.contrast > 50 ? "stronger" : "as designed"}</span></div></>}
          {st.design === "glass" && <><label></label><label class="ck"><input type="checkbox" id="logoBubble" checked={st.logoBubble} onChange={e => styleChange("Logo bubble", { logoBubble: (e.target as HTMLInputElement).checked ? null : false })} /> glass bubble around the logo</label></>}
        </div>
        <div class="optnote">Corners: roundness of tables, bubbles and the logo (0 = square). Contrast: how much the tables and bubbles stand out from the background.</div>
        <div class="sep" />
        <div class="opthd">This deck's style</div>
        <div class="optnote">Design, colour, page numbers and logo are saved with this workbook and shared with everybody who opens it.</div>
        <div class="optrow"><button class="btn" id="styleDefault" onClick={() => void saveStyleAsDefault()}>Use as default for new decks</button></div>
      </>}
    </Dropdown>
  );
}

function ServerPill() {
  const h = S.health;
  if (!backend.served) return <span class="pill err" id="srv"><i class="dot" />Helper not running</span>;
  if (!h) return <span class="pill err" id="srv"><i class="dot" />Helper stopped</span>;
  const e = h.engine, ok = e.state === "ready", st = e.state === "starting" || e.state === "idle";
  const title = (e.engines || []).map(x => `${x.label}: ${x.state}${x.detail ? " – " + x.detail : ""}`).join("\n") + "\n\nClick to retry. Install the recommended engine once with “Install export engine”.";
  const click = async () => {
    if (!ok && !st || !e.local) return openInstaller();
    await backend.engineRestart(); setTimeout(() => void backend.health().then(x => { S.health = x; }), 1500);
  };
  return <span class={"pill " + (ok ? "ok" : st ? "warn" : "err")} id="srv" title={title} style="cursor:pointer" onClick={() => void click()}>
    <i class="dot" />{ok ? "Export: " + (e.browser || "ready") : st ? "Testing export engines…" : "Export: in-window only · install engine"}
  </span>;
}

function ExportButton() {
  const can = backend.served && !!S.health && S.slides.length > 0 && !S.exporting;
  const mode = S.prefs.pdfMode || "exact";
  const item = (k: ExportKind, label: string, small?: string, close?: () => void) =>
    <button data-x={k} class={k === "pdf-" + mode ? "cur" : ""} onClick={() => { close?.(); void doExport(k); }}>{label}{small && <small>{small}</small>}</button>;
  return (
    <Dropdown right style={{ display: "flex" }} button={(_o, toggle) => <>
      <button class="btn primary split" id="exportBtn" disabled={!can} onClick={() => void doExport("pdf")}>{S.exporting ? <><span class="spin" />Rendering…</> : "Export PDF"}</button>
      <button class="btn primary caret" id="exportMenuBtn" disabled={!can} onClick={toggle}>▾</button>
    </>}>
      {close => <>
        <div class="hd">PDF – all slides, saved in the export folder</div>
        {item("pdf-exact", "PDF · exact", "identical to screen, 360 dpi", close)}
        {item("pdf-vector", "PDF · vector", "selectable text", close)}
        {item("pdf-current", "PDF · current slide only", undefined, close)}
        <div class="sep" />
        <div class="hd">Images (4800 × 2700)</div>
        {item("copy", "Copy current slide", "paste into PowerPoint", close)}
        {item("png-current", "PNG · current slide", undefined, close)}
        {item("png-all", "PNG · every slide", undefined, close)}
      </>}
    </Dropdown>
  );
}

function Others() {
  const here = S.others.filter(o => S.file && o.workbook === S.file.name);
  if (!here.length) return null;
  const names = [...new Set(here.map(o => o.user + (o.user === S.user ? " (another window)" : "")))];
  return <span class="presence" id="presence" title={"Also editing this workbook: " + names.join(", ") + "\nChanges are merged automatically; the same cell edited by two people keeps the last change."}>
    {names.slice(0, 3).map(n => <i key={n}>{n.slice(0, 2).toUpperCase()}</i>)}<span>{names.length === 1 ? names[0] + " is also here" : names.length + " others here"}</span>
  </span>;
}

export function Topbar() {
  useApp();
  const st = style(), has = !!S.sync, f = S.file, n = S.slides.length;
  return (
    <header class="topbar">
      <div class="brand"><i />Slide Builder</div>
      <OpenMenu />
      <input type="file" id="fileInput" accept=".xlsx,.xlsm,.xlsb,.xls" hidden onChange={e => { const t = e.target as HTMLInputElement; const file = t.files?.[0]; if (file) void guard(() => openLocalFile(file)); t.value = ""; }} />
      <button class="btn icon" id="reloadBtn" title="Reload the workbook from disk (after saving in Excel)" disabled={f?.src !== "folder"} onClick={() => void guard(reloadWorkbook)}>↻</button>
      <button class="btn" id="wizardBtn" disabled={!S.wb} title="Choose sheets and tables, arrange slides, cover and index" onClick={() => void guard(openWizard)}>✦ Wizard</button>
      <div class="fname" id="fileName">{S.opening ? <>Opening <b>{S.opening}</b>…</> : f ? <><b>{f.name}</b> · {n} slide{n === 1 ? "" : "s"}{f.src === "upload" ? " · not in the folder" : f.src === "local" ? " · preview only" : ""}</> : "No workbook"}</div>
      <Others />
      <div class="spacer" />
      <div class="seg" title="Slide design (saved with this workbook)">
        {(["glass", "excel"] as const).map(d => <button key={d} data-design={d} disabled={!has} class={st.design === d ? "on" : ""} onClick={() => styleChange("Design", { design: d })}>{d === "glass" ? "Liquid Glass" : "Excel"}</button>)}
      </div>
      {st.design === "glass" && <div class="seg" id="glassSeg" title="Strength of the glass effect">
        {(["subtle", "medium", "strong"] as const).map(g => <button key={g} data-glass={g} disabled={!has} class={st.glass === g ? "on" : ""} onClick={() => styleChange("Glass strength", { glass: g })}>{g[0].toUpperCase() + g.slice(1)}</button>)}
      </div>}
      {st.design === "glass" && <div class="colorctl" id="colorCtl" title="Background colour: from plain white to full colour">
        <span class="lbl">Colour</span><input type="range" id="colorRange" min="0" max="100" step="5" disabled={!has} value={st.color} onInput={e => { const v = +(e.target as HTMLInputElement).value; document.getElementById("colorVal")!.textContent = v + "%"; debounced("color", () => styleChange("Background colour", { color: v }, "color")); }} /><span id="colorVal" class="cv">{st.color}%</span>
      </div>}
      <Options />
      <ServerPill />
      <ExportButton />
    </header>
  );
}
export { setPrefs };
