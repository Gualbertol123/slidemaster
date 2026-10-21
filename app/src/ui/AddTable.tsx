/* Add table ▾ (#addTable, ribbon 2 › Insert; S13.4, 09 §3.9): the deck's mapped tables – the ones on no slide first, then
   the others with the slides they are on – each with its name, sheet and range and a small preview of its cells; a click
   adds it to the current slide. "New table from cells…" opens the sheet view (PickCells.tsx). */
import { useMemo } from "react";
import { setDialogs, useStore } from "../state/store";
import { addTable, tableChoices } from "../editor/slides";
import { useStyle } from "./hooks";
import { growG, gToRange, rangeToG, resolveTable, validRange } from "@slide-builder/core/model/preset";
import { A1 } from "@slide-builder/core/xlsx/util";
import type { Design, TableDef } from "@slide-builder/core/model/types";
import type { TableLayout, Workbook } from "@slide-builder/core/xlsx/types";

/** a table larger than this gets no preview: resolving it could take the main thread past the keypress budget (S13.4
    review: golden/big); its row still names its sheet and range */
export const PREVIEW_CELLS = 2000;
/** the table's cells and, when it is small enough, its layout (the cached one of the slides, else built here); `range`:
    its cells as A1:B2, known without resolving it. Never throws (a sheet that is gone: no preview) */
export function previewOf(wb: Workbook | null | undefined, def: TableDef, design: Design): { L: TableLayout | null; cells: number; range: string | null } {
  if (!wb) return { L: null, cells: 0, range: null };
  const S = wb.sheets.find(x => x.name === def.sheet);
  let g = def.kind === "range" ? (validRange(def.range) ? rangeToG(def.range!) : null)
    : (S?.tables.find(T => A1(T.g.r1, T.g.c1) === def.anchor) || S?.tables[def.index ?? -1])?.g ?? null;   // (as resolveTable finds it)
  if (g && S && def.kind === "range" && def.grow) g = growG(S, g);
  const cells = g ? Math.max(0, g.r2 - g.r1 - 1) * Math.max(0, g.c2 - g.c1 - 1) : 0;
  if (!S || !g || cells > PREVIEW_CELLS) return { L: null, cells, range: g ? gToRange(g) : null };
  try { return { L: resolveTable(wb, def, design), cells, range: gToRange(g) }; } catch { return { L: null, cells, range: gToRange(g) }; }
}

/** a glance at the table's first cells: their fills and a bar where there is text (the menu's picture, not the slide's) */
function Preview({ L }: { L: TableLayout }) {
  const its = L.items.filter(it => it.by < 400 && it.bx < 700).slice(0, 120), W = Math.min(L.W, 700), H = Math.min(L.H, 400);
  return <svg className="tprev" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet" aria-hidden="true">
    <rect width={W} height={H} fill="#fff" />
    {its.map((it, k) => <g key={k}>
      {it.fill && it.fill !== "none" && <rect x={it.bx} y={it.by} width={it.bw} height={it.bh} fill={it.fill} />}
      {it.text && <rect x={it.bx + 3} y={it.by + it.bh * .35} width={Math.max(4, Math.min(it.bw - 6, it.text.length * 6))} height={it.bh * .3} fill={it.color || "#5B6274"} opacity=".55" />}
    </g>)}
  </svg>;
}

export function AddTableMenu({ close }: { close: () => void }) {
  const p = useStore(s => s.doc.view?.preset), wb = useStore(s => s.deck.wb), cur = useStore(s => s.deck.slides[s.deck.cur]);
  const design = useStyle().design;
  const rows = tableChoices(p), content = cur?.type === "content";
  // the previews: worked out once per set of tables, workbook and design – not on every render (a slide chosen, the
  // current slide redrawn); a large table gets none (PREVIEW_CELLS)
  const sig = JSON.stringify(p?.tables || []);
  const previews = useMemo(() => new Map((p?.tables || []).map(def => [def.id, previewOf(wb, def, design)])), [sig, wb, design]);   // (sig: p.tables by value)
  const where = (def: TableDef) => def.sheet + "!" + (def.kind === "range" ? def.range : previews.get(def.id)?.range ?? def.anchor);
  return <div className="chartmenu addtable" id="addTableMenu">
    {!rows.length && <div className="empty">No mapped tables yet: make one from cells.</div>}
    {rows.length > 0 && <div className="tlist">{rows.map(({ def, on }) => {
      const L = previews.get(def.id)?.L ?? null;
      const here = !!cur && (cur.cfg.tables || []).includes(def.id);
      return <button key={def.id} data-table={def.id} disabled={!content || here} title={!content ? "Select a content slide first" : here ? "On this slide already" : "Add it to this slide"}
        onClick={() => { close(); addTable(def); }}>
        {L ? <Preview L={L} /> : <i className="tprev" />}
        <span className="tname"><b>{def.name || def.sheet}</b><small>{where(def)}</small></span>
        <small>{here ? "on this slide" : on.length ? "on slide " + on.join(", ") : "on no slide"}</small>
      </button>;
    })}</div>}
    <div className="sep" />
    <button data-a="table-pick" disabled={!content} onClick={() => { close(); setDialogs({ pick: { kind: "table" } }); }}>New table from cells…<small>of any sheet: drag across its cells</small></button>
  </div>;
}
