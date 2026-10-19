/* The consulting look's parts in ribbon 2 (B29, docs/next/08 §2.8): with nothing or a table selected, the table's parts
   (style, numbers, Δ bars, trend line, latest bar); with the title, the KPI line or the message panel selected, the
   headline's (headline, KPIs, ground) – the KPI line's and the panel's font, size and colour are the TEXT row's. A change
   goes to this slide; "Apply to all" makes it the deck's, "Deck's" goes back to the deck's on this slide. */
import { useStore } from "../state/store";
import { CONSULT_CHOICES, CONSULT_TEXT, type ConsultChoice, type ConsultOptions } from "@slide-builder/core/model/designs";
import { applyLookToAll, clearSlideLook, lookState, setPart } from "../editor/look";
import { useCtx, useCurSlide, useStyle } from "./hooks";

const TABLE_PARTS: ConsultChoice[] = ["tables", "numbers", "bars", "trend", "band"];
const HEADLINE_PARTS: ConsultChoice[] = ["headline", "kpis", "background"];
const ONOFF = new Set<ConsultChoice>(["bars", "trend", "band"]);

function Part<K extends ConsultChoice>({ k, s }: { k: K; s: NonNullable<ReturnType<typeof lookState>> }) {
  const T = CONSULT_TEXT[k], v = s.eff[k], own = k in s.own, exhibit = s.eff.tables === "exhibit";
  const off = (k === "numbers" || ONOFF.has(k)) && !exhibit || k === "kpis" && s.eff.headline !== "kpi";
  const tip = T.hint + (own ? " · set on this slide" : "") + (off ? " · " + (k === "kpis" ? "with the KPI line" : "exhibit tables only") : "");
  if (ONOFF.has(k)) return <button className={"tb lookpart" + (v === "on" ? " on" : "") + (own ? " own" : "")} data-part={k} disabled={off} title={tip}
    onClick={() => setPart(k, (v === "on" ? "off" : "on") as ConsultOptions[K])}>{T.name}</button>;
  return <span className={"lookpart" + (own ? " own" : "")} data-part={k} title={tip}>
    <span className="lbl">{T.name}</span>
    <span className="seg small">{(CONSULT_CHOICES[k] as readonly ConsultOptions[K][]).map(c =>
      <button key={String(c)} data-value={String(c)} className={c === v ? "on" : ""} disabled={off} onClick={() => setPart(k, c)}>{(T.labels as Record<string, string>)[String(c)]}</button>)}</span>
  </span>;
}

export function LookGroup() {
  // re-render with the slide, the document and the selection
  useCurSlide(); useCtx(); const st = useStyle(); const textSel = useStore(s => s.selection.textSel);
  const s = lookState(); if (!s || st.design !== s.d) return null;
  const headline = textSel === "title" || textSel === "subtitle" || textSel === "kpi" || textSel === "panel";
  const own = Object.keys(s.own).length > 0;
  return <div className="grp lookgrp" id="lookGroup" data-mode={headline ? "headline" : "table"}>
    {(headline ? HEADLINE_PARTS : TABLE_PARTS).map(k => <Part key={k} k={k} s={s} />)}
    <button className="tb" id="lookApplyAll" disabled={!own} title="Make this slide's look the deck's: every slide takes it" onClick={applyLookToAll}>Apply to all</button>
    <button className="tb" id="lookReset" disabled={!own} title="This slide back to the deck's look" onClick={clearSlideLook}>Deck's</button>
  </div>;
}
