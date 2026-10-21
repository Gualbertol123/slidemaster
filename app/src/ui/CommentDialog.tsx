/* "Comment…": writes an automated comment next to a table (like an analyst's commentary: headline, main
   contributors, concentration, downside, missing data – one section per comparison such as "Δ vs. Budget").
   The comment is a text box with settings, not fixed text: it is rewritten whenever the numbers change.
   "Apply to all similar tables" puts the same kind of comment on every table of the deck with the same
   comparison headers (each with its own title and numbers). */
import { useMemo, useState } from "react";
import { get, setDialogs, useStore, toast } from "../state/store";
import { useCtx, useCurSlide } from "./hooks";
import { change, ctx } from "../state/app";
import { curSlide } from "../editor/edit";
import { DEFAULT_COMMENT, DEFAULT_UNIT, SUMMARY_KINDS, cleanHead, defaultGroups, headingOf, prettyLabel, signatureOf, type CommentCfg, type Group } from "@slide-builder/core/model/comment";
import { analysisOf, commentTables, commentText } from "@slide-builder/core/render/comment";
import { richText } from "@slide-builder/core/render/text";
import { wallBase } from "@slide-builder/core/render/wallpaper";
import { designClass } from "@slide-builder/core/model/designs";
import { noteKey, SIDES } from "@slide-builder/core/render/layout";
import { tableName } from "@slide-builder/core/model/preset";
import type { LineOrNone, Note, Op, RuntimeSlide, Side } from "@slide-builder/core/model/types";
import { FRAME_COLORS, FRAME_WEIGHTS, frameCss, noteFrame } from "@slide-builder/core/render/note-frame";
import { Input } from "./Input";
import { defaultSections, macroTitleFallback } from "@slide-builder/core/model/comment-macro";
import { CommentSections } from "./CommentSections";

const NOUNS = ["country", "bank", "entity", "region", "product", "segment", "division"];
const SIDE_LABEL: Record<Side, string> = { right: "Right of the table", left: "Left of the table", bottom: "Below the table", top: "Above the table" };

/** the automated comment already on table i of slide R (and its side) */
function existing(R: RuntimeSlide, i: number): { side: Side; note: Note } | null {
  for (const side of SIDES) { const n = R.cfg.notes?.[noteKey(R, i, side)]; if (n?.auto) return { side, note: n }; }
  return null;
}

export function CommentDialog() {
  const R = useCurSlide(), c = useCtx(), slides = useStore(s => s.deck.slides);
  const start = useStore(s => s.ui.dialogs.comment?.table) ?? 0;
  const [ti, setTi] = useState(Math.min(start, Math.max(0, (R?.tables.length || 1) - 1)));
  const L = R?.tables[ti], a = useMemo(() => L ? analysisOf(L, c) : null, [L, c]);
  const old = R ? existing(R, ti) : null;
  // comments written before keep their settings and their text (before summaries existed: sections) until switched to
  // another structure here; a new comment is written as the macro writes it (B50), and in "Summary" covers every table of
  // the slide
  const [cfg, setCfg] = useState<CommentCfg>(() => old?.note.auto ? { ...DEFAULT_COMMENT, mode: "sections", ...old.note.auto }
    : { ...DEFAULT_COMMENT, mode: "macro", sections: a ? defaultSections(a) : undefined, groups: a ? defaultGroups(a) : [], tables: (R?.tables || []).filter((_, i) => i !== ti).map(t => t.def?.id || t.id || "").filter(Boolean) });
  const [side, setSide] = useState<Side>(old?.side || "right");
  // a comment on several tables sits in a column beside all of them; the macro's covers its own table only, so a new
  // one sits beside it (switching a new comment to another structure puts it beside all of them again)
  const many = (R?.tables.length || 0) > 1;
  const [span, setSpan] = useState<boolean>(old ? !!old.note.span : false);
  const [size, setSize] = useState<number>(old?.note.w || old?.note.h || 440);
  const [bubble, setBubble] = useState(old ? !!old.note.bubble : true);
  // the box's border (B49): unset = the design's, "none", or a weight and a colour (unset colour = the design's)
  const [frame, setFrame] = useState<LineOrNone | undefined>(old?.note.frame);
  const close = () => setDialogs({ comment: null });
  const frameObj = frame && typeof frame === "object" ? frame : null, previewFrame = frameCss(noteFrame(frame, c.style.design));
  if (!R || !L || !a) return null;
  const set = (p: Partial<CommentCfg>) => setCfg({ ...cfg, ...p });
  const groups = cfg.groups.length ? cfg.groups : defaultGroups(a);
  const toggleGroup = (id: string, on: boolean) => set({ groups: a.groups.map(g => g.id).filter(x => x === id ? on : groups.includes(x)) });
  const ex = new Set((cfg.exclude || []).map(x => x.toLowerCase()));
  const toggleEnt = (label: string, on: boolean) => set({ exclude: on ? (cfg.exclude || []).filter(x => x.toLowerCase() !== label.toLowerCase()) : [...(cfg.exclude || []), label] });
  const summary = (cfg.mode ?? "sections") === "summary", macro = cfg.mode === "macro";
  const text = commentText(L, { ...cfg, groups }, c, R);
  const covered = summary ? commentTables(R, L, cfg) : [L];
  const blocks = covered.flatMap(T => analysisOf(T, c).blocks);
  const kindsHere = [...new Set(covered.flatMap(T => analysisOf(T, c).groups.filter(g => g.abs !== null).map(g => g.kind)))];
  const kinds = cfg.kinds?.length ? cfg.kinds : SUMMARY_KINDS.filter(k => kindsHere.includes(k));
  const KIND_LABEL: Record<Group["kind"], string> = { week: "Previous week", target: "Budget / plan", month: "End of month", quarter: "Quarter", year: "Beginning of year", yoy: "Year on year", other: "Other" };
  const tid = (T: typeof L) => T.def?.id || T.id || "";
  const toggleTable = (id: string, on: boolean) => set({ tables: on ? [...(cfg.tables || []), id] : (cfg.tables || []).filter(x => x !== id) });
  const entityLabels = [...new Set(covered.flatMap(T => analysisOf(T, c).entities.map(e => e.label)))];
  // similar tables: the same comparison headers, anywhere in the deck
  const sig = signatureOf(a);
  const similar = sig ? slides.flatMap((X, si) => X.tables.map((T, i) => ({ X, si, i, T }))).filter(x => !(x.X.id === R.id && x.i === ti) && signatureOf(analysisOf(x.T, c)) === sig) : [];

  const noteFor = (keep: Note | undefined, own: boolean): Note => {
    const auto: CommentCfg = { ...cfg, groups };
    // the macro's sections are saved with a macro comment only (another structure keeps a deck 4.0.0 can read)
    // (the macro's text covers its own table: the other tables of a summary are not kept with it)
    if (macro) { auto.sections = structuredClone(cfg.sections ?? defaultSections(a)); delete auto.tables; } else delete auto.sections;
    if (!own) { delete auto.title; delete auto.exclude; delete auto.tables; }        // other tables: their own title and rows
    const n: Note = { ...(keep || {}), text: "", auto, bubble };
    delete n.w; delete n.h;
    if (side === "left" || side === "right") n.w = size; else n.h = size;
    if (!bubble) delete n.bubble;
    if (span && (side === "left" || side === "right")) n.span = true; else delete n.span;
    if (frame === undefined) delete n.frame; else n.frame = structuredClone(frame);
    return n;
  };
  const opsFor = (X: RuntimeSlide, i: number, own: boolean): Record<string, Note | null> => {
    const prev = existing(X, i), out: Record<string, Note | null> = {};
    if (prev && prev.side !== side) out[noteKey(X, i, prev.side)] = null;           // moved to another side
    const key = noteKey(X, i, side), there = X.cfg.notes?.[key];
    out[key] = noteFor(there?.auto ? there : undefined, own);
    return out;
  };
  const insert = (all: boolean) => {
    const bySlide = new Map<string, Record<string, Note | null>>();
    const add = (X: RuntimeSlide, i: number, own: boolean) => bySlide.set(X.id, { ...(bySlide.get(X.id) || {}), ...opsFor(X, i, own) });
    add(R, ti, true);
    if (all) for (const x of similar) add(x.X, x.i, false);
    const replacing = [...bySlide.entries()].some(([id, m]) => { const X = get().deck.slides.find(s => s.id === id)!; return Object.keys(m).some(k => X.cfg.notes?.[k] && !X.cfg.notes[k].auto && X.cfg.notes[k].text.trim()); });
    if (replacing) { toast("A text box with your own text is already there – pick another side, or delete that text box first.", [], true); return; }
    change(all ? `Comments on ${similar.length + 1} tables` : "Automated comment", [...bySlide.entries()].map(([id, notes]) => ({ op: "slide.patch", id, patch: { notes } } as Op)));
    close();
    toast(all ? `Comments written on ${similar.length + 1} tables. They follow the numbers – reload the workbook next week and they are up to date.` : "Comment written. It follows the numbers: when the workbook changes, the text changes too.");
  };
  const remove = () => { if (old) { change("Remove comment", [{ op: "slide.patch", id: R.id, patch: { notes: { [noteKey(R, ti, old.side)]: null } } } as Op]); close(); } };

  return (
    <div className="modal" onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <div className="dlg cmtdlg">
        <div className="dlghd"><b>Automated comment</b><span>A commentary written from the table's numbers – it rewrites itself when the workbook changes.</span></div>
        <div className="dlgbody cmtbody">
          <div className="cmtset">
            {R.tables.length > 1 && <label className="cmtrow"><span>Table</span><select id="cmtTable" value={ti} onChange={e => setTi(+(e.target as HTMLSelectElement).value)}>
              {R.tables.map((T, i) => <option key={i} value={i}>{tableName(T, c.preset)}</option>)}</select></label>}
            <div className="seg small cmtmode" id="cmtMode">{(["macro", "summary", "sections"] as const).map(m => <button key={m} data-mode={m} className={(cfg.mode ?? "sections") === m ? "on" : ""} title={m === "macro" ? "The Budget Performance / Weekly Momentum bullets, as the Excel macro writes them" : undefined} onClick={() => { set({ mode: m }); if (!old) setSpan(m !== "macro" && many); }}>{m === "macro" ? "Report – as the macro" : m === "summary" ? "Summary – short, joint" : "Detailed – one section per comparison"}</button>)}</div>
            {summary && R.tables.length > 1 && <><div className="opthd">Tables in this comment</div>
              <div className="cmtchecks" id="cmtTables">{R.tables.map((T, i) => <label key={i} className="ck"><input type="checkbox" checked={i === ti || (cfg.tables || []).includes(tid(T))} disabled={i === ti} onChange={e => toggleTable(tid(T), (e.target as HTMLInputElement).checked)} />{tableName(T, c.preset)}</label>)}</div></>}
            <div className="cmtfound">Found: {summary ? <>{blocks.length} block{blocks.length === 1 ? "" : "s"} – {blocks.map(b => b.head ? cleanHead(b.head.label) : "rows without a total").join(", ")}</> : a.total ? <>total <b>{a.total.label}</b></> : "no total row (the sum of the rows is used)"}{!summary && <> · {a.entities.length} rows</>}{a.period ? <> · latest <b>{a.period.name}{a.period.date ? " " + a.period.date : ""}</b></> : ""}</div>
            <label className="cmtrow"><span>Title</span><input id="cmtTitle" className="txt" placeholder={macro ? macroTitleFallback(a, tableName(L, c.preset)) : a.total ? prettyLabel(a.total.label) : tableName(L, c.preset)} value={cfg.title || ""} onChange={e => set({ title: (e.target as HTMLInputElement).value })} onKeyDown={e => e.stopPropagation()} /></label>
            {macro ? <><div className="opthd">Sections <span className="cv">ticked ones, in this order</span></div>
              <CommentSections a={a} sections={cfg.sections} onChange={sections => set({ sections })} /></>
            : summary ? <><div className="opthd">Joins</div>
              <div className="cmtchecks" id="cmtKinds">{kindsHere.map(k => <label key={k} className="ck"><input type="checkbox" data-kind={k} checked={kinds.includes(k)} onChange={e => { const on = (e.target as HTMLInputElement).checked; set({ kinds: (["week", "target", "month", "quarter", "year", "yoy", "other"] as Group["kind"][]).filter(x => x === k ? on : kinds.includes(x)) }); }} />{KIND_LABEL[k]}{k === "week" ? " – judged: how good, who drives it" : ""}</label>)}</div></> : <>
            <div className="opthd">Sections</div>
            {!a.groups.length && <div className="optnote">No comparison columns found. Comments need headers like “Δ vs. Budget”, “vs. Prev. Week”, “Var. YoY”, with Abs. and/or % columns.</div>}
            <div className="cmtchecks" id="cmtGroups">{a.groups.map(g => <label key={g.id} className="ck"><input type="checkbox" data-group={g.id} checked={groups.includes(g.id)} disabled={g.abs === null} onChange={e => toggleGroup(g.id, (e.target as HTMLInputElement).checked)} />{headingOf(g)}</label>)}</div></>}
            <div className="opthd">Layout</div>
            <div className="cmtchecks row3" id="cmtShape">
              <label className="ck"><input type="checkbox" data-shape="title" checked={cfg.showTitle !== false} onChange={e => set({ showTitle: (e.target as HTMLInputElement).checked ? undefined : false })} />Title</label>
              {summary && <label className="ck"><input type="checkbox" data-shape="names" checked={cfg.names !== false} onChange={e => set({ names: (e.target as HTMLInputElement).checked ? undefined : false })} />Name at the start of each paragraph</label>}
              <label className="ck"><input type="checkbox" data-shape="bullets" checked={cfg.bullets !== false} onChange={e => set({ bullets: (e.target as HTMLInputElement).checked ? undefined : false })} />Bullet points</label>
            </div>
            <div className="opthd">Content</div>
            <div className="cmtgrid">
              {!macro && <><label>Length</label><div className="seg small">{(["full", "short"] as const).map(d => <button key={d} className={cfg.detail === d ? "on" : ""} onClick={() => set({ detail: d })}>{d === "full" ? (summary ? "With plan drivers" : "Full analysis") : "Short"}</button>)}</div>
              <label>Name the top</label><select id="cmtTop" value={cfg.top} onChange={e => set({ top: +(e.target as HTMLSelectElement).value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} name{n > 1 ? "s" : ""} per side</option>)}</select></>}
              {/* uncontrolled: what is typed stays as typed ("0.5" starts with "0", "mln EUR" has a space) while the
                  setting gets the cleaned value (a number > 0, a trimmed unit) */}
              {!macro && <><label>Ignore below</label><input id="cmtMin" type="number" min="0" step="any" className="txt" placeholder="0 (all movements)" defaultValue={cfg.minAbs ?? ""} onChange={e => { const v = parseFloat((e.target as HTMLInputElement).value); set({ minAbs: isFinite(v) && v > 0 ? v : undefined }); }} onKeyDown={e => e.stopPropagation()} /></>}
              {/* the macro writes no unit ("+476"): its default is none */}
              <label>Unit after amounts</label><input id="cmtUnit" key={macro ? "m" : "o"} className="txt" placeholder="none" defaultValue={cfg.unit ?? (macro ? "" : DEFAULT_UNIT)} onChange={e => { const v = (e.target as HTMLInputElement).value.trim(); set({ unit: v === (macro ? "" : DEFAULT_UNIT) ? undefined : v }); }} onKeyDown={e => e.stopPropagation()} title="Written after every amount, e.g. +476 mln (percentages keep their %). Empty = no unit." />
              <label>Rows are</label><select id="cmtNoun" value={cfg.noun} onChange={e => set({ noun: (e.target as HTMLSelectElement).value })}>{NOUNS.map(n => <option key={n} value={n}>{n === "entity" ? "entities" : n.endsWith("y") ? n.slice(0, -1) + "ies" : n + "s"}</option>)}</select>
            </div>
            {!summary && !macro && cfg.detail === "full" && <div className="cmtchecks">
              <label className="ck"><input type="checkbox" checked={cfg.share} onChange={e => set({ share: (e.target as HTMLInputElement).checked })} />Concentration (“largely driven by…, ~86%”)</label>
              <label className="ck"><input type="checkbox" checked={cfg.breadth} onChange={e => set({ breadth: (e.target as HTMLInputElement).checked })} />Broad-based moves</label>
              <label className="ck"><input type="checkbox" checked={cfg.missing} onChange={e => set({ missing: (e.target as HTMLInputElement).checked })} />Rows without data</label>
            </div>}
            <div className="opthd">Rows to include</div>
            <div className="cmtents">{entityLabels.map(l => <label key={l} className="ck"><input type="checkbox" checked={!ex.has(l.toLowerCase())} onChange={ev => toggleEnt(l, (ev.target as HTMLInputElement).checked)} />{l}</label>)}</div>
            <div className="opthd">Placement</div>
            <div className="cmtgrid">
              <label>Where</label><select id="cmtSide" value={span ? "span-" + side : side} onChange={e => { const v = (e.target as HTMLSelectElement).value, sp = v.startsWith("span-"), s = (sp ? v.slice(5) : v) as Side; setSpan(sp); setSide(s); setSize(s === "left" || s === "right" ? 440 : 220); }}>
                {R.tables.length > 1 && <><option value="span-right">Beside all tables – right</option><option value="span-left">Beside all tables – left</option></>}
                {SIDES.map(s => <option key={s} value={s}>{SIDE_LABEL[s]}{R.tables.length > 1 ? " (this table)" : ""}</option>)}</select>
              <label>{side === "left" || side === "right" ? "Width" : "Height"}</label><div className="row"><input type="range" min={side === "left" || side === "right" ? 240 : 100} max={side === "left" || side === "right" ? 800 : 500} step="10" value={size} onChange={e => setSize(+(e.target as HTMLInputElement).value)} /><span className="cv">{size} px</span></div>
              <label></label><label className="ck"><input type="checkbox" checked={bubble} onChange={e => setBubble((e.target as HTMLInputElement).checked)} />In a bubble (glass card / framed box)</label>
            </div>
            <div className="opthd">Border</div>
            <div className="cmtgrid" id="cmtFrame">
              <label>Thickness</label><div className="seg small">
                <button data-fw="design" className={frame === undefined ? "on" : ""} title="As the design draws it: a bubble's own frame, none without a bubble" onClick={() => setFrame(undefined)}>Design</button>
                <button data-fw="none" className={frame === "none" ? "on" : ""} title="No border (an Excel bubble without its frame too)" onClick={() => setFrame("none")}>None</button>
                {FRAME_WEIGHTS.map(w => <button key={w} data-fw={w} className={frameObj?.w === w ? "on" : ""} onClick={() => setFrame({ ...(frameObj || {}), w })}>{w} px</button>)}</div>
              <label>Colour</label><div className="row cmtfc">
                <button data-fc="" className={"cgsw auto" + (frameObj && !frameObj.color ? " on" : "")} title="The design's frame colour" onClick={() => setFrame({ w: frameObj?.w ?? 1 })}>Auto</button>
                {FRAME_COLORS.map(col => <button key={col} data-fc={col} className={"cgsw" + (frameObj?.color?.toUpperCase() === col ? " on" : "")} style={{ background: col }} title={col} onClick={() => setFrame({ w: frameObj?.w ?? 1, color: col })} />)}
                <label className="cgsw custom" title="Any colour"><Input type="color" value={frameObj?.color || "#000000"} onCommit={e => setFrame({ w: frameObj?.w ?? 1, color: (e.target as HTMLInputElement).value.toUpperCase() })} />…</label></div>
            </div>
          </div>
          <div className={"cmtprev slide " + designClass(c.style.design)} style={c.style.design === "glass" ? { "--wallbase": wallBase(c.style) } as React.CSSProperties : undefined}><div className="tnote auto" id="cmtPreview" style={previewFrame ? { border: previewFrame, padding: previewFrame === "none" ? undefined : "8px 10px" } : undefined} dangerouslySetInnerHTML={{ __html: richText(text) }} /></div>
        </div>
        <div className="dlgft">
          {old && <button className="btn" id="cmtRemove" onClick={remove}>Remove comment</button>}
          <span className="hint">The text size shrinks to fit the box; make it wider or pick fewer sections for larger text.</span>
          <button className="btn" onClick={close}>Cancel</button>
          {similar.length > 0 && !(summary && (cfg.tables || []).length) && <button className="btn" id="cmtAll" title={similar.map(x => `${x.si + 1}. ${tableName(x.T, c.preset)}`).join("\n")} onClick={() => insert(true)}>Also on {similar.length} similar table{similar.length > 1 ? "s" : ""}</button>}
          <button className="btn primary" id="cmtInsert" disabled={!a.groups.length} onClick={() => insert(false)}>{old ? "Update comment" : "Insert comment"}</button>
        </div>
      </div>
    </div>
  );
}
