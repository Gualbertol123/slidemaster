/* Where a slide hides rows or columns of a table (S16.1, B36, docs/next/09 §3.6): a thin double mark on the stage at
   each closed-up place – a click brings those rows / columns back (one undo step) – and, below a table with hidden rows,
   a small note that Excel's totals still include them (09 §9 Q8: totals are not recomputed). DOM over the slide, never
   in the display list: nothing of it is exported. An exhibit (a consulting design's) draws its own rows: there the
   table gets one badge instead, its click unhides them all. */
import { memo } from "react";
import { slideHidden, hiddenKey } from "@slide-builder/core/model/hidden";
import { geomOf, tableH, tableW } from "@slide-builder/core/render/layout";
import type { RenderCtx } from "@slide-builder/core/render/context";
import type { RuntimeSlide } from "@slide-builder/core/model/types";
import type { TableLayout } from "@slide-builder/core/xlsx/types";
import { colEdges, rowEdges } from "./hit";
import { unhide } from "../editor/hidden";
import type { StageModel } from "./model";

const INK = "#2F6FED";
interface Gap { at: number; keys: string[] }
/** the closed-up places of one kind: between visible rows (columns) a and b, the hidden ones of this slide in (a, b) */
function gaps(id: string, kind: "r" | "c", visible: number[], start: (n: number) => number, end: number, set: Set<number>, lo: number, hi: number): Gap[] {
  const out: Gap[] = [], bounds = [lo, ...visible, hi];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1], keys: string[] = [];
    for (let n = a + 1; n < b; n++) if (set.has(n)) keys.push(hiddenKey(id, kind, n));
    if (keys.length) out.push({ at: k < visible.length ? start(visible[k]) : end, keys });
  }
  return out;
}
const unhideLabel = (keys: string[]) => {
  const rows = keys.filter(k => /:r\d+$/.test(k)).length, cols = keys.length - rows;
  return rows && cols ? "Unhide rows and columns" : rows ? (rows === 1 ? "Unhide row" : "Unhide rows") : cols === 1 ? "Unhide column" : "Unhide columns";
};
const stop = (e: { stopPropagation(): void; preventDefault(): void }) => { e.stopPropagation(); e.preventDefault(); };

export const HiddenMarks = memo(function HiddenMarks({ m, R, c }: { m: StageModel; R: RuntimeSlide; c: RenderCtx }) {
  if (!R.cfg.hidden) return null;
  return <>{m.tables.map(t => {
    const T = R.tables[t.i], id = T?.def?.id; if (!T || !id) return null;
    const h = slideHidden(R.cfg, id), all = [...[...h.rows].filter(r => r > T.g.r1 && r < T.g.r2).map(r => hiddenKey(id, "r", r)), ...[...h.cols].filter(n => n > T.g.c1 && n < T.g.c2).map(n => hiddenKey(id, "c", n))];
    if (!all.length) return null;
    const W = tableW(T, c), H = tableH(T, c), anyRows = all.some(k => /:r\d+$/.test(k));
    const box = { left: t.box.x, top: t.box.y, width: W, height: H, transform: `scale(${t.box.scale})`, transformOrigin: "0 0" } as const;
    const note = anyRows ? <div className="hidrcnote" title="Totals are Excel's own: they still include the hidden rows (not exported)"
      style={{ position: "absolute", right: 0, top: H + 4, font: "600 11px var(--font)", color: "#5B6475", background: "rgba(255,255,255,.85)", borderRadius: 6, padding: "1px 6px", pointerEvents: "auto", whiteSpace: "nowrap" }}>Σ incl. hidden rows</div> : null;
    if (geomOf(c) === "exhibit") {
      return <div key={t.i} className="hidrcs" data-t={t.i} style={{ position: "absolute", pointerEvents: "none", ...box }}>
        <button className="hidrc hbadge" data-keys={all.join(" ")} title={`${all.length} hidden on this slide – click to show them again`} onPointerDown={stop}
          onClick={e => { stop(e); unhide(R, all, "Unhide all on this table"); }}
          style={{ position: "absolute", right: 0, top: -22, pointerEvents: "auto", font: "600 11px var(--font)", color: "#fff", background: INK, border: 0, borderRadius: 8, padding: "2px 7px", cursor: "pointer" }}>{all.length} hidden · show</button>
        {note}
      </div>;
    }
    const rs = rowEdges(T), cs = colEdges(T, c);
    const rowAt = new Map(rs.map(([y, , r]) => [r, y])), colAt = new Map(cs.map(([x, , col]) => [col, x]));
    const rows = gaps(id, "r", T.rows, r => rowAt.get(r) ?? 0, H, h.rows, T.g.r1, T.g.r2);
    const cols = gaps(id, "c", T.cols, col => colAt.get(col) ?? 0, W, h.cols, T.g.c1, T.g.c2);
    const k = 1 / (t.box.scale || 1);
    // above the table's hit area (.hits, z-index 40): the marks lie over the table and take their own clicks
    return <div key={t.i} className="hidrcs" data-t={t.i} style={{ position: "absolute", pointerEvents: "none", zIndex: 41, ...box }}>
      {rows.map(g => <div key={"r" + g.at} className="hidrc hrow" data-keys={g.keys.join(" ")} title={`${g.keys.length === 1 ? "1 row" : g.keys.length + " rows"} hidden here – click to show`}
        onPointerDown={stop} onClick={e => { stop(e); unhide(R, g.keys, unhideLabel(g.keys)); }}
        style={{ position: "absolute", left: -10 * k, width: W + 20 * k, top: g.at - 4 * k, height: 8 * k, cursor: "pointer", pointerEvents: "auto", borderTop: `${1.5 * k}px solid ${INK}`, borderBottom: `${1.5 * k}px solid ${INK}`, boxSizing: "border-box", background: "rgba(47,111,237,.10)" }} />)}
      {cols.map(g => <div key={"c" + g.at} className="hidrc hcol" data-keys={g.keys.join(" ")} title={`${g.keys.length === 1 ? "1 column" : g.keys.length + " columns"} hidden here – click to show`}
        onPointerDown={stop} onClick={e => { stop(e); unhide(R, g.keys, unhideLabel(g.keys)); }}
        style={{ position: "absolute", top: -10 * k, height: H + 20 * k, left: g.at - 4 * k, width: 8 * k, cursor: "pointer", pointerEvents: "auto", borderLeft: `${1.5 * k}px solid ${INK}`, borderRight: `${1.5 * k}px solid ${INK}`, boxSizing: "border-box", background: "rgba(47,111,237,.10)" }} />)}
      {note}
    </div>;
  })}</>;
});
