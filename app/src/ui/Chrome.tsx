/* The panels of the window around the toolbars: slide list, issues, the stage's frame, status bar, busy
   overlay and toast. Each reads only what it shows from the store. */
import { useEffect, useRef, useState } from "react";
import { patch, useStore, THUMBS } from "../state/store";
import { gotoSlide, setZoom } from "../state/app";
import { backend } from "../sync/api";
import { mountStage, zoomBy } from "../editor/stage";
import { mountThumbs } from "../editor/thumbs";
import { slideIssues } from "../editor/issues";
import { useCtx, useCurSlide, useStyle } from "./hooks";
import { selStatus } from "./Ribbon";
import { esc } from "../xlsx/util";

export function Thumbs() {
  const slides = useStore(s => s.deck.slides), cur = useStore(s => s.deck.cur), fname = useStore(s => s.deck.file?.name);
  const c = useCtx();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) mountThumbs(ref.current); }, []);
  const sig = slides.map(R => R.id + R.label + R.type).join("|") + "|" + fname;
  useEffect(() => { THUMBS.render(); }, [sig]);           // new frames → fill them
  useEffect(() => { ref.current?.querySelector(".thumb.on")?.scrollIntoView({ block: "nearest" }); }, [cur]);
  return (
    <div className="thumbs" id="thumbs" ref={ref}>
      {slides.map((R, i) => {
        const issues = slideIssues(R, c).filter(x => x.cls === "warn" || x.cls === "err").length;
        return <button key={R.id} className={"thumb" + (i === cur ? " on" : "")} data-i={i} onClick={() => gotoSlide(i)}>
          <div className="frame" data-i={i} />
          <div className="cap"><span className="n">{i + 1}</span><b>{R.label}</b>{R.type !== "content" && <span className="tag">{R.type}</span>}{issues > 0 && <span className="badge">{issues}</span>}</div>
        </button>;
      })}
    </div>
  );
}

export function Issues() {
  const slides = useStore(s => s.deck.slides), cur = useStore(s => s.deck.cur), logoMissing = useStore(s => s.ui.logoMissing);
  const c = useCtx(), st = useStyle();
  const R = slides[cur]; if (!R) return <div className="issues" id="issues" />;
  const P = c.preset;
  const used = new Set(slides.flatMap(x => x.cfg.tables || []));
  const unused = P ? P.tables.filter(t => !used.has(t.id)).length : 0;
  const html = `<h4>Slide ${cur + 1} · ${esc(R.label)}</h4><ul>${slideIssues(R, c).map(x => `<li class="${x.cls}">${x.html}</li>`).join("")}${logoMissing ? `<li class="warn">Logo “${esc(st.logo)}” not found in the folder</li>` : ""}</ul>` +
    `<h4 style="margin-top:10px">Preset</h4><ul><li>${P ? P.tables.length : 0} table${P && P.tables.length === 1 ? "" : "s"} · ${slides.length} slide${slides.length === 1 ? "" : "s"}${unused ? ` · <span class="warn">${unused} table${unused > 1 ? "s" : ""} not on any slide</span>` : ""}</li></ul>`;
  return <div className="issues" id="issues" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Canvas() {
  const has = useStore(s => s.deck.slides.length > 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) mountStage(ref.current); }, []);
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
/** "Updated by bob 3 min ago" counts on while it is shown (once every 10 s, only this bar) */
function useMinutesAgo(at: number | undefined) {
  const [, tick] = useState(0);
  useEffect(() => { if (at === undefined) return; const t = setInterval(() => tick(n => n + 1), 10_000); return () => clearInterval(t); }, [at]);
  return at === undefined ? 0 : Math.round((Date.now() - at) / 60000);
}
export function Status() {
  const st = useStore(s => s.doc.save), err = useStore(s => s.doc.error), remote = useStore(s => s.deck.remote);
  // what the selection text is computed from
  useStore(s => s.selection); useCurSlide(); useStore(s => s.deck.slides.length); useCtx();
  const ago = useMinutesAgo(remote?.at);
  return (
    <footer className="statusbar">
      <span id="sbSel">{selStatus()}</span>
      <span>Arrows move · Shift extends · type or F2 to edit · Del clears · Ctrl+B/I · Ctrl+Z/Y · PgUp/PgDn slides</span>
      <span className="spacer" />
      {remote && <span id="sbRemote" className="remote">Updated by {remote.by} {ago < 1 ? "just now" : ago + " min ago"}</span>}
      <span id="sbSave" className={st === "error" || st === "outdated" ? "err" : st === "saved" ? "ok" : ""}>{st ? SAVE_TEXT[st] + (st === "error" || st === "outdated" ? err : "") : ""}</span>
    </footer>
  );
}

export function Busy() {
  const busy = useStore(s => s.ui.busy);
  if (!busy) return null;
  const f = busy.frac;
  return <div id="busy" style={{ display: "flex" }}><div className="busybox"><div className="busytxt">{busy.text}</div>
    <div className="busybar"><i className={f == null ? "indet" : ""} style={{ width: f == null ? "35%" : Math.round(Math.max(.03, Math.min(1, f)) * 100) + "%" }} /></div>
    <div className="busyhint">Large workbooks: only the sheets you choose are read.</div></div></div>;
}
export function Toast() {
  const t = useStore(s => s.ui.toast);
  return <div className={"toast" + (t ? " show" : "") + (t?.err ? " err" : "")} id="toast">
    {t && <><span dangerouslySetInnerHTML={{ __html: t.html }} />{(t.actions || []).map(a => <button key={a.label} onClick={() => { patch("ui", { toast: null }); a.fn(); }}>{a.label}</button>)}</>}
  </div>;
}
