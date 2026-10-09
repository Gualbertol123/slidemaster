import { useEffect, useRef } from "react";
import { S, useApp, THUMBS } from "../state/store";
import { ctx, gotoSlide, guard, reloadWorkbook, setZoom, style } from "../state/app";
import { DLG } from "../state/dialogs";
import { backend } from "../sync/api";
import { mountStage, zoomBy } from "../editor/stage";
import { mountThumbs } from "../editor/thumbs";
import { slideIssues } from "../editor/issues";
import { presetOf } from "./util";
import { Topbar } from "./Topbar";
import { Ribbon, FxBar, selStatus } from "./Ribbon";
import { TableRibbon } from "./TableTools";
import { TablesDialog } from "./TablesDialog";
import { TextStylesDialog } from "./TextStylesDialog";
import { CommentDialog } from "./CommentDialog";
import { Dialogs } from "./Dialogs";
import { Wizard } from "../wizard/Wizard";
import { esc } from "../xlsx/util";

function Thumbs() {
  useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) mountThumbs(ref.current); }, []);
  const sig = S.slides.map(R => R.id + R.label + R.type).join("|") + "|" + S.file?.name;
  useEffect(() => { THUMBS.render(); }, [sig]);           // new frames → fill them
  useEffect(() => { ref.current?.querySelector(".thumb.on")?.scrollIntoView({ block: "nearest" }); }, [S.cur]);
  const c = ctx();
  return (
    <div className="thumbs" id="thumbs" ref={ref}>
      {S.slides.map((R, i) => {
        const issues = slideIssues(R, c).filter(x => x.cls === "warn" || x.cls === "err").length;
        return <button key={R.id} className={"thumb" + (i === S.cur ? " on" : "")} data-i={i} onClick={() => gotoSlide(i)}>
          <div className="frame" data-i={i} />
          <div className="cap"><span className="n">{i + 1}</span><b>{R.label}</b>{R.type !== "content" && <span className="tag">{R.type}</span>}{issues > 0 && <span className="badge">{issues}</span>}</div>
        </button>;
      })}
    </div>
  );
}

function Issues() {
  useApp();
  const R = S.slides[S.cur]; if (!R) return <div className="issues" id="issues" />;
  const c = ctx(), P = presetOf();
  const used = new Set(S.slides.flatMap(x => x.cfg.tables || []));
  const unused = P ? P.tables.filter(t => !used.has(t.id)).length : 0;
  const html = `<h4>Slide ${S.cur + 1} · ${esc(R.label)}</h4><ul>${slideIssues(R, c).map(x => `<li class="${x.cls}">${x.html}</li>`).join("")}${S.logoMissing ? `<li class="warn">Logo “${esc(style().logo)}” not found in the folder</li>` : ""}</ul>` +
    `<h4 style="margin-top:10px">Preset</h4><ul><li>${P ? P.tables.length : 0} table${P && P.tables.length === 1 ? "" : "s"} · ${S.slides.length} slide${S.slides.length === 1 ? "" : "s"}${unused ? ` · <span class="warn">${unused} table${unused > 1 ? "s" : ""} not on any slide</span>` : ""}</li></ul>`;
  return <div className="issues" id="issues" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Canvas() {
  useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) mountStage(ref.current); }, []);
  const has = S.slides.length > 0;
  return (
    <section className="canvas">
      <div id="stage" ref={ref} style={{ position: "absolute", inset: "0" }} />
      {!has && <div className="empty" id="emptyState" style={{ display: "flex" }}>
        <div className="drop">
          <div className="big">Open a workbook</div>
          <p>A wizard lets you pick the sheets and the tables (drag across the cells, or use the suggestions),<br />then arrange them on slides with an optional cover and index. Tables between two “x” cells are found automatically.<br />Everything is saved with the workbook, for you and your colleagues.<br />
            <span style={{ fontSize: "12px" }}>Workbooks placed in the main <b>Slide Builder</b> folder appear in the Open menu · exports go to the <b>export</b> folder.</span></p>
          <button className="btn primary" id="emptyOpen" onClick={() => (backend.served ? document.getElementById("openBtn") : document.getElementById("fileInput"))?.click()}>Open workbook</button>
          <p style={{ fontSize: "12px" }}>…or drop an .xlsx file anywhere on this window.</p>
        </div>
      </div>}
      {has && <div className="zoomctl" id="zoomctl" style={{ display: "flex" }}>
        <button id="zoomOut" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</button><span id="zoomVal" />{/* text set by the stage */}
        <button id="zoomIn" title="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
        <button id="zoomFit" title="Fit" style={{ width: "auto", padding: "0 8px" }} onClick={() => setZoom("fit")}>Fit</button>
      </div>}
    </section>
  );
}

const SAVE_TEXT: Record<string, string> = { pending: "Unsaved changes…", saving: "Saving…", saved: "✓ Saved", local: "Saved in this browser only (helper not running)", error: "⚠ Not saved yet – retrying: ", outdated: "⚠ " };
function Status() {
  useApp();
  const st = S.sync?.state, err = S.sync?.error || "";
  const ago = S.remote ? Math.round((Date.now() - S.remote.at) / 60000) : 0;
  return (
    <footer className="statusbar">
      <span id="sbSel">{selStatus()}</span>
      <span>Arrows move · Shift extends · type or F2 to edit · Del clears · Ctrl+B/I · Ctrl+Z/Y · PgUp/PgDn slides</span>
      <span className="spacer" />
      {S.remote && <span id="sbRemote" className="remote">Updated by {S.remote.by} {ago < 1 ? "just now" : ago + " min ago"}</span>}
      <span id="sbSave" className={st === "error" || st === "outdated" ? "err" : st === "saved" ? "ok" : ""}>{st ? SAVE_TEXT[st] + (st === "error" || st === "outdated" ? err : "") : ""}</span>
    </footer>
  );
}

function Busy() {
  useApp();
  if (!S.busy) return null;
  const f = S.busy.frac;
  return <div id="busy" style={{ display: "flex" }}><div className="busybox"><div className="busytxt">{S.busy.text}</div>
    <div className="busybar"><i className={f == null ? "indet" : ""} style={{ width: f == null ? "35%" : Math.round(Math.max(.03, Math.min(1, f)) * 100) + "%" }} /></div>
    <div className="busyhint">Large workbooks: only the sheets you choose are read.</div></div></div>;
}
function Toast() {
  useApp();
  const t = S.toast;
  return <div className={"toast" + (t ? " show" : "") + (t?.err ? " err" : "")} id="toast">
    {t && <><span dangerouslySetInnerHTML={{ __html: t.html }} />{(t.actions || []).map(a => <button key={a.label} onClick={() => { S.toast = null; a.fn(); }}>{a.label}</button>)}</>}
  </div>;
}

export function App() {
  useApp();
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault(); document.body.classList.add("dragover"); };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) document.body.classList.remove("dragover"); };
    const drop = (e: DragEvent) => { e.preventDefault(); document.body.classList.remove("dragover"); const f = e.dataTransfer?.files?.[0]; if (f) void guard(() => import("../state/app").then(m => m.openLocalFile(f))); };
    document.addEventListener("dragover", over); document.addEventListener("dragleave", leave); document.addEventListener("drop", drop);
    return () => { document.removeEventListener("dragover", over); document.removeEventListener("dragleave", leave); document.removeEventListener("drop", drop); };
  }, []);
  return (
    <>
      <div className="app">
        <Topbar />
        <div>
          {!backend.served && <div className="banner show" id="bannerOffline">Opened directly from disk: work is kept in this browser only and exports are off. Start <b>Start Slide Builder.bat</b> to share presets with colleagues and export PDFs.</div>}
          {S.changedOnDisk && <div className="banner info show" id="bannerChanged">The workbook was saved again in Excel. <button className="btn" onClick={() => void guard(reloadWorkbook)}>Reload now</button></div>}
          <Ribbon />
          <TableRibbon />
          <FxBar />
        </div>
        <div className="main">
          <aside className="nav">
            <div className="navhd"><span>SLIDES <span id="slideCount" style={{ fontWeight: "500", marginLeft: "4px" }}>{S.slides.length || ""}</span></span></div>
            <Thumbs />
            <Issues />
          </aside>
          <Canvas />
        </div>
        <Status />
      </div>
      <Toast />
      <Busy />
      {DLG.wizard && <Wizard req={DLG.wizard} />}
      {DLG.tables && <TablesDialog />}
      {DLG.textStyles && <TextStylesDialog />}
      {DLG.comment && <CommentDialog />}
      <Dialogs />{/* last: confirmations open above the wizard and the other dialogs */}
    </>
  );
}
