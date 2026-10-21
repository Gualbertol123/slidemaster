/* Add table ▾ (#addTable, ribbon 2 › Insert; S13.4, 09 §3.9): the deck's mapped tables – the ones on no slide first, then
   the others with the slides they are on – each with its name, sheet and range and a small preview of its cells; a click
   adds it to the current slide. "New table from cells…" opens the sheet view (PickCells.tsx). */
import { setDialogs, useStore } from "../state/store";
import { style } from "../state/app";
import { addTable, tableChoices } from "../editor/slides";
import { gToRange, resolveTable } from "@slide-builder/core/model/preset";
import type { TableDef } from "@slide-builder/core/model/types";
import type { TableLayout } from "@slide-builder/core/xlsx/types";

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
  const rows = tableChoices(p), content = cur?.type === "content";
  const where = (def: TableDef, L: TableLayout | null) => def.sheet + "!" + (def.kind === "range" ? def.range : L ? gToRange(L.g) : def.anchor);
  return <div className="chartmenu addtable" id="addTableMenu">
    {!rows.length && <div className="empty">No mapped tables yet: make one from cells.</div>}
    {rows.length > 0 && <div className="tlist">{rows.map(({ def, on }) => {
      let L: TableLayout | null = null;
      try { L = wb ? resolveTable(wb, def, style().design) : null; } catch { L = null; }
      const here = !!cur && (cur.cfg.tables || []).includes(def.id);
      return <button key={def.id} data-table={def.id} disabled={!content || here} title={!content ? "Select a content slide first" : here ? "On this slide already" : "Add it to this slide"}
        onClick={() => { close(); addTable(def); }}>
        {L ? <Preview L={L} /> : <i className="tprev" />}
        <span className="tname"><b>{def.name || def.sheet}</b><small>{where(def, L)}</small></span>
        <small>{here ? "on this slide" : on.length ? "on slide " + on.join(", ") : "on no slide"}</small>
      </button>;
    })}</div>}
    <div className="sep" />
    <button data-a="table-pick" disabled={!content} onClick={() => { close(); setDialogs({ pick: { kind: "table" } }); }}>New table from cells…<small>of any sheet: drag across its cells</small></button>
  </div>;
}
