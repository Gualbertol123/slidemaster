/* B50: the sections of a comment in the macro's structure ("As the macro" in the comment dialog). Each comparison of the
   table can be a section – ticked ones are written, in the order shown (↑ ↓) – and each has its rule for when it is
   written (always / only in the last week of the month / only in the first week / only from day N, decided from the
   latest period's date the analysis finds), its alert threshold (the macro's -5 % for a plan, -1 % otherwise), its
   heading and its parts (the YoY clause, the concentration sentence, the downside bullet, the alert sentence). */
import type { Analysis, Group } from "@slide-builder/core/model/comment";
import { defaultAlert, periodDate, sectionApplies, sectionHeading, sectionsOf, WHEN_LABEL, type CommentSection, type SectionWhen } from "@slide-builder/core/model/comment-macro";

const WHENS: SectionWhen[] = ["always", "monthEnd", "firstWeek", "fromDay"];
const fmtDate = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

export function CommentSections({ a, sections, onChange }: { a: Analysis; sections: CommentSection[] | undefined; onChange: (s: CommentSection[]) => void }) {
  const cur = sectionsOf(a, { sections }), date = periodDate(a);
  const on = cur.filter(s => a.groups.some(g => g.id === s.g && g.abs !== null));
  const off = a.groups.filter(g => !on.some(s => s.g === g.id));
  const set = (i: number, p: Partial<CommentSection>) => {
    const next = on.map((s, k) => k === i ? { ...s, ...p } : s);
    // unset keys are left out of the saved section (its defaults: the macro's)
    for (const s of next) for (const k of Object.keys(s) as (keyof CommentSection)[]) if (s[k] === undefined) delete s[k];
    onChange(next);
  };
  const move = (i: number, d: -1 | 1) => { const next = on.slice(), j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  const row = (s: CommentSection, i: number, g: Group) => {
    const when = s.when || "always", written = sectionApplies(s, date), alert = s.alert ?? defaultAlert(g);
    return (
      <div key={g.id} className="cmtsec" data-sec={g.id}>
        <div className="cmtsechd">
          <label className="ck"><input type="checkbox" checked onChange={() => onChange(on.filter((_, k) => k !== i))} /><b>{sectionHeading(g, s)}</b></label>
          <span className={"cmtwhen" + (written ? "" : " out")}>{date ? (written ? "written on " : "left out on ") + fmtDate(date) : "no date found: written"}</span>
          <button className="btn icon" data-move="up" title="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="btn icon" data-move="down" title="Later" disabled={i === on.length - 1} onClick={() => move(i, 1)}>↓</button>
        </div>
        <div className="cmtgrid">
          <label>Include</label><div className="row">
            <select data-when value={when} onChange={e => { const w = (e.target as HTMLSelectElement).value as SectionWhen; set(i, { when: w === "always" ? undefined : w, day: w === "fromDay" ? s.day ?? 25 : undefined }); }}>
              {WHENS.map(w => <option key={w} value={w}>{WHEN_LABEL[w]}</option>)}</select>
            {when === "fromDay" && <input data-day type="number" min="1" max="31" className="txt num" value={s.day ?? 25} onChange={e => { const v = Math.round(+(e.target as HTMLInputElement).value); if (v >= 1 && v <= 31) set(i, { day: v }); }} onKeyDown={e => e.stopPropagation()} />}
          </div>
          <label>Alert at</label><div className="row">
            <input data-alert type="number" step="0.5" max="0" className="txt num" defaultValue={+(alert * 100).toFixed(2)} onChange={e => { const v = parseFloat((e.target as HTMLInputElement).value); if (isFinite(v)) set(i, { alert: v / 100 === defaultAlert(g) ? undefined : v / 100 }); }} onKeyDown={e => e.stopPropagation()} />
            <span className="cv">% or worse among the named negatives</span></div>
          <label>Heading</label><input data-heading className="txt" placeholder={sectionHeading(g)} defaultValue={s.heading || ""} onChange={e => set(i, { heading: (e.target as HTMLInputElement).value.trim() || undefined })} onKeyDown={e => e.stopPropagation()} />
        </div>
        <div className="cmtchecks row3">
          {g.kind === "target" && <label className="ck"><input type="checkbox" data-part="yoy" checked={s.yoy !== false} onChange={e => set(i, { yoy: (e.target as HTMLInputElement).checked ? undefined : false })} />YoY clause</label>}
          <label className="ck"><input type="checkbox" data-part="share" checked={s.share !== false} onChange={e => set(i, { share: (e.target as HTMLInputElement).checked ? undefined : false })} />Concentration</label>
          <label className="ck"><input type="checkbox" data-part="down" checked={s.down !== false} onChange={e => set(i, { down: (e.target as HTMLInputElement).checked ? undefined : false })} />Downside bullet</label>
          <label className="ck"><input type="checkbox" data-part="flag" checked={s.flag !== false} onChange={e => set(i, { flag: (e.target as HTMLInputElement).checked ? undefined : false })} />Alert sentence</label>
        </div>
      </div>);
  };
  return (
    <div id="cmtSections">
      {date ? <div className="optnote">Latest period: {fmtDate(date)} – each section's rule is decided from it.</div>
        : <div className="optnote">No date found in the period's header: every ticked section is written.</div>}
      {on.map((s, i) => row(s, i, a.groups.find(g => g.id === s.g)!))}
      {off.map(g => <label key={g.id} className="ck cmtsecoff" data-sec={g.id}><input type="checkbox" checked={false} disabled={g.abs === null} onChange={() => onChange([...on, { g: g.id }])} />{sectionHeading(g)}</label>)}
    </div>);
}
