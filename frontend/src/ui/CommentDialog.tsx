/* "Comment…": writes an automated comment next to a table (like an analyst's commentary: headline, main
   contributors, concentration, downside, missing data – one section per comparison such as "Δ vs. Budget").
   The comment is a text box with settings, not fixed text: it is rewritten whenever the numbers change.
   "Apply to all similar tables" puts the same kind of comment on every table of the deck with the same
   comparison headers (each with its own title and numbers). */
import { useMemo, useState } from "preact/hooks";
import { S, emit, useApp, toast } from "../state/store";
import { DLG } from "../state/dialogs";
import { change, ctx } from "../state/app";
import { curSlide } from "../editor/edit";
import { DEFAULT_COMMENT, defaultGroups, headingOf, prettyLabel, signatureOf, writeComment, type CommentCfg } from "../model/comment";
import { analysisOf } from "../render/comment";
import { richText } from "../render/text";
import { noteKey, SIDES } from "../render/slide";
import { tableName } from "../model/preset";
import type { Note, Op, RuntimeSlide, Side } from "../model/types";

const NOUNS = ["country", "bank", "entity", "region", "product", "segment", "division"];
const SIDE_LABEL: Record<Side, string> = { right: "Right of the table", left: "Left of the table", bottom: "Below the table", top: "Above the table" };

/** the automated comment already on table i of slide R (and its side) */
function existing(R: RuntimeSlide, i: number): { side: Side; note: Note } | null {
  for (const side of SIDES) { const n = R.cfg.notes?.[noteKey(R, i, side)]; if (n?.auto) return { side, note: n }; }
  return null;
}

export function CommentDialog() {
  useApp();
  const R = curSlide(), c = ctx();
  const start = DLG.comment?.table ?? 0;
  const [ti, setTi] = useState(Math.min(start, Math.max(0, (R?.tables.length || 1) - 1)));
  const L = R?.tables[ti], a = useMemo(() => L ? analysisOf(L, c) : null, [L, c]);
  const old = R ? existing(R, ti) : null;
  const [cfg, setCfg] = useState<CommentCfg>(() => old?.note.auto ? { ...DEFAULT_COMMENT, ...old.note.auto } : { ...DEFAULT_COMMENT, groups: a ? defaultGroups(a) : [] });
  const [side, setSide] = useState<Side>(old?.side || "right");
  const [size, setSize] = useState<number>(old?.note.w || old?.note.h || 440);
  const [bubble, setBubble] = useState(old ? !!old.note.bubble : true);
  const close = () => { DLG.comment = null; emit(); };
  if (!R || !L || !a) return null;
  const set = (p: Partial<CommentCfg>) => setCfg({ ...cfg, ...p });
  const groups = cfg.groups.length ? cfg.groups : defaultGroups(a);
  const toggleGroup = (id: string, on: boolean) => set({ groups: a.groups.map(g => g.id).filter(x => x === id ? on : groups.includes(x)) });
  const ex = new Set((cfg.exclude || []).map(x => x.toLowerCase()));
  const toggleEnt = (label: string, on: boolean) => set({ exclude: on ? (cfg.exclude || []).filter(x => x.toLowerCase() !== label.toLowerCase()) : [...(cfg.exclude || []), label] });
  const text = writeComment(a, { ...cfg, groups }, tableName(L, c.preset));
  // similar tables: the same comparison headers, anywhere in the deck
  const sig = signatureOf(a);
  const similar = sig ? S.slides.flatMap((X, si) => X.tables.map((T, i) => ({ X, si, i, T }))).filter(x => !(x.X.id === R.id && x.i === ti) && signatureOf(analysisOf(x.T, c)) === sig) : [];

  const noteFor = (keep: Note | undefined, own: boolean): Note => {
    const auto: CommentCfg = { ...cfg, groups };
    if (!own) { delete auto.title; delete auto.exclude; }        // other tables: their own title and rows
    const n: Note = { ...(keep || {}), text: "", auto, bubble };
    delete n.w; delete n.h;
    if (side === "left" || side === "right") n.w = size; else n.h = size;
    if (!bubble) delete n.bubble;
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
    const replacing = [...bySlide.entries()].some(([id, m]) => { const X = S.slides.find(s => s.id === id)!; return Object.keys(m).some(k => X.cfg.notes?.[k] && !X.cfg.notes[k].auto && X.cfg.notes[k].text.trim()); });
    if (replacing) { toast("A text box with your own text is already there – pick another side, or delete that text box first.", [], true); return; }
    change(all ? `Comments on ${similar.length + 1} tables` : "Automated comment", [...bySlide.entries()].map(([id, notes]) => ({ op: "slide.patch", id, patch: { notes } } as Op)));
    close();
    toast(all ? `Comments written on ${similar.length + 1} tables. They follow the numbers – reload the workbook next week and they are up to date.` : "Comment written. It follows the numbers: when the workbook changes, the text changes too.");
  };
  const remove = () => { if (old) { change("Remove comment", [{ op: "slide.patch", id: R.id, patch: { notes: { [noteKey(R, ti, old.side)]: null } } } as Op]); close(); } };

  return (
    <div class="modal" onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <div class="dlg cmtdlg">
        <div class="dlghd"><b>Automated comment</b><span>A commentary written from the table's numbers – it rewrites itself when the workbook changes.</span></div>
        <div class="dlgbody cmtbody">
          <div class="cmtset">
            {R.tables.length > 1 && <label class="cmtrow"><span>Table</span><select id="cmtTable" value={ti} onChange={e => setTi(+(e.target as HTMLSelectElement).value)}>
              {R.tables.map((T, i) => <option key={i} value={i}>{tableName(T, c.preset)}</option>)}</select></label>}
            <div class="cmtfound">Found: {a.total ? <>total <b>{a.total.label}</b></> : "no total row (the sum of the rows is used)"} · {a.entities.length} rows{a.period ? <> · latest <b>{a.period.name}{a.period.date ? " " + a.period.date : ""}</b></> : ""} · {a.groups.length} comparison{a.groups.length === 1 ? "" : "s"}</div>
            <label class="cmtrow"><span>Title</span><input id="cmtTitle" class="txt" placeholder={a.total ? prettyLabel(a.total.label) : tableName(L, c.preset)} value={cfg.title || ""} onInput={e => set({ title: (e.target as HTMLInputElement).value })} onKeyDown={e => e.stopPropagation()} /></label>
            <div class="opthd">Sections</div>
            {!a.groups.length && <div class="optnote">No comparison columns found. Comments need headers like “Δ vs. Budget”, “vs. Prev. Week”, “Var. YoY”, with Abs. and/or % columns.</div>}
            <div class="cmtchecks" id="cmtGroups">{a.groups.map(g => <label key={g.id} class="ck"><input type="checkbox" data-group={g.id} checked={groups.includes(g.id)} disabled={g.abs === null} onChange={e => toggleGroup(g.id, (e.target as HTMLInputElement).checked)} />{headingOf(g)}</label>)}</div>
            <div class="opthd">Content</div>
            <div class="cmtgrid">
              <label>Length</label><div class="seg small">{(["full", "short"] as const).map(d => <button key={d} class={cfg.detail === d ? "on" : ""} onClick={() => set({ detail: d })}>{d === "full" ? "Full analysis" : "Short"}</button>)}</div>
              <label>Name the top</label><select id="cmtTop" value={cfg.top} onChange={e => set({ top: +(e.target as HTMLSelectElement).value })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} contributor{n > 1 ? "s" : ""} per side</option>)}</select>
              <label>Ignore below</label><input id="cmtMin" type="number" min="0" step="any" class="txt" placeholder="0 (all movements)" value={cfg.minAbs ?? ""} onInput={e => { const v = parseFloat((e.target as HTMLInputElement).value); set({ minAbs: isFinite(v) && v > 0 ? v : undefined }); }} onKeyDown={e => e.stopPropagation()} />
              <label>Rows are</label><select id="cmtNoun" value={cfg.noun} onChange={e => set({ noun: (e.target as HTMLSelectElement).value })}>{NOUNS.map(n => <option key={n} value={n}>{n === "entity" ? "entities" : n.endsWith("y") ? n.slice(0, -1) + "ies" : n + "s"}</option>)}</select>
            </div>
            {cfg.detail === "full" && <div class="cmtchecks">
              <label class="ck"><input type="checkbox" checked={cfg.share} onChange={e => set({ share: (e.target as HTMLInputElement).checked })} />Concentration (“largely driven by…, ~86%”)</label>
              <label class="ck"><input type="checkbox" checked={cfg.breadth} onChange={e => set({ breadth: (e.target as HTMLInputElement).checked })} />Broad-based moves</label>
              <label class="ck"><input type="checkbox" checked={cfg.missing} onChange={e => set({ missing: (e.target as HTMLInputElement).checked })} />Rows without data</label>
            </div>}
            <div class="opthd">Rows to include</div>
            <div class="cmtents">{a.entities.map(e => <label key={e.label} class="ck"><input type="checkbox" checked={!ex.has(e.label.toLowerCase())} onChange={ev => toggleEnt(e.label, (ev.target as HTMLInputElement).checked)} />{e.label}</label>)}</div>
            <div class="opthd">Placement</div>
            <div class="cmtgrid">
              <label>Where</label><select id="cmtSide" value={side} onChange={e => { const s = (e.target as HTMLSelectElement).value as Side; setSide(s); setSize(s === "left" || s === "right" ? 440 : 220); }}>{SIDES.map(s => <option key={s} value={s}>{SIDE_LABEL[s]}</option>)}</select>
              <label>{side === "left" || side === "right" ? "Width" : "Height"}</label><div class="row"><input type="range" min={side === "left" || side === "right" ? 240 : 100} max={side === "left" || side === "right" ? 800 : 500} step="10" value={size} onInput={e => setSize(+(e.target as HTMLInputElement).value)} /><span class="cv">{size} px</span></div>
              <label></label><label class="ck"><input type="checkbox" checked={bubble} onChange={e => setBubble((e.target as HTMLInputElement).checked)} />In a bubble (glass card / framed box)</label>
            </div>
          </div>
          <div class={"cmtprev slide " + (c.style.design === "clean" ? "excel clean" : c.style.design)}><div class="tnote auto" id="cmtPreview" dangerouslySetInnerHTML={{ __html: richText(text) }} /></div>
        </div>
        <div class="dlgft">
          {old && <button class="btn" id="cmtRemove" onClick={remove}>Remove comment</button>}
          <span class="hint">The text size shrinks to fit the box; make it wider or pick fewer sections for larger text.</span>
          <button class="btn" onClick={close}>Cancel</button>
          {similar.length > 0 && <button class="btn" id="cmtAll" title={similar.map(x => `${x.si + 1}. ${tableName(x.T, c.preset)}`).join("\n")} onClick={() => insert(true)}>Also on {similar.length} similar table{similar.length > 1 ? "s" : ""}</button>}
          <button class="btn primary" id="cmtInsert" disabled={!a.groups.length} onClick={() => insert(false)}>{old ? "Update comment" : "Insert comment"}</button>
        </div>
      </div>
    </div>
  );
}
