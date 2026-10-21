/* The panels of the window around the toolbars: slide list, issues, the stage's frame, status bar, busy
   overlay and toast. Each reads only what it shows from the store. */
import { useEffect, useRef, useState } from "react";
import { patch, useStore, THUMBS } from "../state/store";
import { checkFormulas, gotoSlide, setZoom } from "../state/app";
import { backend } from "../sync/api";
import { Stage } from "../stage/Stage";
import { zoomBy } from "../stage/actions";
import { useStage } from "../stage/data";
import { mountThumbs } from "../editor/thumbs";
import { clearPreview } from "../editor/scenario";
import { slideIssues } from "../editor/issues";
import { openLicences } from "./notices";
import { useCtx, useCurSlide, useStyle } from "./hooks";
import { selStatus } from "./Ribbon";
import { esc } from "@slide-builder/core/xlsx/util";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import type { RenderCtx } from "@slide-builder/core/render/context";

/** a slide's badge (its warnings and errors), worked out again only when what it depends on changed: the slide, the
    preset, the number of slides, the edits of its sheets (an edit elsewhere leaves the other slides' badges alone) */
const badges = new WeakMap<RuntimeSlide, { deps: unknown[]; n: number }>();
function badge(R: RuntimeSlide, c: RenderCtx): number {
  const deps = [R.cfg, R.tables, c.preset, c.slides.length, ...R.tables.map(T => c.edits[T.sheet.name])], hit = badges.get(R);
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.n;
  const n = slideIssues(R, c).filter(x => x.cls === "warn" || x.cls === "err").length;
  badges.set(R, { deps, n });
  return n;
}
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
        const issues = badge(R, c);
        return <button key={R.id} className={"thumb" + (i === cur ? " on" : "")} data-i={i} onClick={() => gotoSlide(i)}>
          <div className="frame" data-i={i} />
          <div className="cap"><span className="n">{i + 1}</span><b>{R.label}</b>{R.type !== "content" && <span className="tag">{R.type}</span>}{issues > 0 && <span className="badge">{issues}</span>}</div>
        </button>;
      })}
    </div>
  );
}

/** the Issues panel's "Formulas" line (B24, S7.4): the engine's self-check on request – how many formula cells
    recompute like Excel, and the classes that do not */
function CalcLine() {
  const calc = useStore(s => s.ui.calc), open = useStore(s => s.doc.open);
  if (!open) return null;
  let text: string, warn = false;
  if (calc === null) text = "Formulas: not checked yet";
  else if (calc === "busy") text = "Formulas: checking…";
  else {
    const c = calc.counts, parts = [`${c.exact} of ${calc.formulas} recompute like Excel`];
    if (c.volatile) parts.push(`${c.volatile} volatile (TODAY, NOW, RAND)`);
    if (calc.textFormatted) parts.push(`${calc.textFormatted} with TEXT in Italian, formatted by Slide Builder`);
    if (c.locale) parts.push(`${c.locale} locale-dependent (TEXT)`);
    if (c.hidden) parts.push(`${c.hidden} read a hidden sheet`);
    if (c.external) parts.push(`${c.external} read a workbook not in the folder`);
    if (c.unreadable) parts.push(`${c.unreadable} could not be read`);
    if (c.different) { parts.push(`${c.different} different from Excel`); warn = true; }
    if (calc.namesSkipped?.length) parts.push(`names not recalculated: ${calc.namesSkipped.map(n => n.replace(/^!/, "")).join(", ")}`);
    text = "Formulas: " + parts.join(" · ");
  }
  return <div className={"calcline" + (warn ? " warn" : "")} id="calcLine" title="Every formula of the workbook recomputed by Slide Builder and compared with the value Excel saved (docs/next/07 §1.4)">
    <span>{text}</span> <button className="btn small" id="calcCheckBtn" disabled={calc === "busy"} onClick={() => void checkFormulas()}>{calc && calc !== "busy" ? "Check again" : "Check"}</button>
  </div>;
}
export function Issues() {
  const slides = useStore(s => s.deck.slides), cur = useStore(s => s.deck.cur), logoMissing = useStore(s => s.ui.logoMissing), fontBuilds = useStore(s => s.ui.fontBuilds), wb = useStore(s => s.deck.wb);
  const c = useCtx(), st = useStyle();
  // the items' Issues lines as one string: a stage answer that changes none of them re-renders nothing here
  const R = slides[cur], itemSig = useStage(s => R && s.shown?.id === R.id ? Object.entries(s.shown.items || {}).map(([id, x]) => id + "\u0000" + (x.issue || "")).join("\u0001") : "");
  const items = itemSig ? Object.fromEntries(itemSig.split("\u0001").map(e => { const [id, issue] = e.split("\u0000"); return [id, { issue: issue || null }]; })) : null;
  if (!R) return <div className="issues" id="issues" />;
  const P = c.preset;
  // a linked workbook of the deck that is not in the folder (S7.3): its tables are missing until it is back
  const lost = (P?.links || []).filter(f => !(wb?.meta || []).some(m => m.linked === f));
  const used = new Set(slides.flatMap(x => x.cfg.tables || []));
  const unused = P ? P.tables.filter(t => !used.has(t.id)).length : 0;
  const html = `<h4>Slide ${cur + 1} · ${esc(R.label)}</h4><ul>${slideIssues(R, c, items).map(x => `<li class="${x.cls}">${x.html}</li>`).join("")}${lost.map(f => `<li class="err">Linked workbook “${esc(f)}” not found in the folder: its tables are missing until it is back (the deck keeps them)</li>`).join("")}${logoMissing ? `<li class="warn">Logo “${esc(st.logo)}” not found in the folder</li>` : ""}</ul>` +
    `<h4 style="margin-top:10px">Preset</h4><ul><li>${P ? P.tables.length : 0} table${P && P.tables.length === 1 ? "" : "s"} · ${slides.length} slide${slides.length === 1 ? "" : "s"}${unused ? ` · <span class="warn">${unused} table${unused > 1 ? "s" : ""} not on any slide</span>` : ""}</li></ul>` +
    // W13: a Windows font whose file differs on other PCs – their slides may wrap or fit a little differently
    (fontBuilds.length ? `<h4 style="margin-top:10px">Fonts</h4><ul>${fontBuilds.map(f => `<li class="warn" data-font="${esc(f.family)}">${esc(f.family)} on this PC is another version than on ${esc(f.hosts.slice(0, 3).join(", "))}${f.hosts.length > 3 ? ` and ${f.hosts.length - 3} more` : ""}: slides may lay out a little differently there</li>`).join("")}</ul>` : "");
  // the Formulas line is a sibling of the issues block: the parity goldens capture #issues as it was
  return <><div className="issues" id="issues" dangerouslySetInnerHTML={{ __html: html }} /><CalcLine /></>;
}

/** the deck on the share (storage v4, S5.5): its snapshot, the changes past it (folded into the next one), its journals */
export function DeckHealth() {
  const health = useStore(s => s.doc.health), save = useStore(s => s.doc.save), open = useStore(s => s.doc.open);
  if (!open || !health || save === "local") return null;
  const warn = save === "readonly" || health.backlog > 2000;
  return <div className={"dhealth" + (warn ? " warn" : "")} id="deckHealth" title="The deck on the shared folder: its snapshot, the changes saved since (folded into the next snapshot), the journals they are in">
    Deck: snapshot {health.gen} · {health.backlog} change{health.backlog === 1 ? "" : "s"} since{health.backlog ? ` in ${health.journals} journal${health.journals === 1 ? "" : "s"}` : ""}{save === "readonly" ? " · read-only" : ""}
  </div>;
}

export function Canvas() {
  const has = useStore(s => s.deck.slides.length > 0);
  return (
    <section className="canvas">
      <Stage />
      {!has && <div className="empty" id="emptyState" style={{ display: "flex" }}>
        <div className="drop">
          <div className="big">Open a workbook</div>
          <p>A wizard lets you pick the sheets and the tables (drag across the cells, or use the suggestions),<br />then arrange them on slides with an optional cover and index. Tables between two “x” cells are found automatically.<br />Everything is saved with the workbook, for you and your colleagues.<br />
            <span style={{ fontSize: "12px" }}>Workbooks placed in the main <b>Slide Builder</b> folder appear in the Open menu · exports go to the <b>export</b> folder.</span></p>
          <button className="btn primary" id="emptyOpen" onClick={() => (backend.served ? document.getElementById("openBtn") : document.getElementById("fileInput"))?.click()}>Open workbook</button>
          <p style={{ fontSize: "12px" }}>…or drop an .xlsx file anywhere on this window.</p>
          <p style={{ fontSize: "11px" }}>Slide Builder includes open-source software: <button className="btn" id="emptyLicences" onClick={() => void openLicences()}>Licences…</button></p>
        </div>
      </div>}
      <ScenarioBanner />
      {has && <div className="zoomctl" id="zoomctl" style={{ display: "flex" }}>
        <button id="zoomOut" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</button><ZoomVal />
        <button id="zoomIn" title="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
        <button id="zoomFit" title="Fit" style={{ width: "auto", padding: "0 8px" }} onClick={() => setZoom("fit")}>Fit</button>
      </div>}
    </section>
  );
}

/** a scenario on the stage (S8.1, 07 §2.4): which value the slides show; nothing of it is saved */
function ScenarioBanner() {
  const p = useStore(s => s.ui.preview);
  if (!p) return null;
  return <div className="scbanner" id="scBanner" title={`${p.input} set to “${p.value}” in the formula engine: ${p.changed} formula cell${p.changed === 1 ? "" : "s"} recalculated`}>
    Previewing: <b>{p.value}</b> – a scenario, not saved{p.textUnknown ? <span className="scbad"> · {p.textUnknown} TEXT cell{p.textUnknown === 1 ? "" : "s"} not formatted (previous text)</span> : null}{p.still ? <span className="scbad" id="scNoChange"> · no formula changed with this value of {p.input}</span> : null}<button className="btn" id="scClear" onClick={() => void clearPreview()}>Clear</button></div>;
}

/** the zoom shown: the stage's scale (fit or chosen) */
function ZoomVal() { const s = useStage(st => st.scale); return <span id="zoomVal">{Math.round(s * 100) + "%"}</span>; }

const SAVE_TEXT: Record<string, string> = { pending: "Unsaved changes…", saving: "Saving…", saved: "✓ Saved", local: "Saved in this browser only (helper not running)", error: "⚠ Not saved yet – retrying: ", outdated: "⚠ ", readonly: "⚠ " };
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
      <span id="sbSave" className={st === "error" || st === "outdated" || st === "readonly" ? "err" : st === "saved" ? "ok" : ""}>{st ? SAVE_TEXT[st] + (st === "error" || st === "outdated" || st === "readonly" ? err : "") : ""}</span>
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
