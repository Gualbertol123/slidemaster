/* Bulk repoint (B57, 4.14): the operations that move references – of one item, of the items of a slide or of the deck on
   one sheet – and tables, with what is keyed by their cells, by N rows / columns (Excel's insert or delete at a row or
   column, or a plain move of the block), or from one sheet to another (a renamed or copied sheet). Every plan is a list
   of operations the page sends as ONE change (one undo step: DocSync keeps their inverses in reverse order) and a
   preview: each reference's old → new address. Pure (model/datarefs.ts does the maths). What moves with a table:
   * its definition: its range (a markers table finds itself: its settings only), its column widths and row heights (also
     per design), merges, colour-scale ranges, cell gridlines and borders – all keyed by sheet rows, columns or A1;
   * the slides' hidden rows / columns of it ("<table>:r12", "<table>:cC");
   * the cell edits inside it (text, colours, number formats, a painted rule's source "Sheet!A1");
   * the versions' emptied cells and deleted rows / columns that touch it;
   * the items reading it: by the table ({table, range}) always, by its sheet's cells inside it unless told not to.
   Its free-layout box ("t:<id>") and its text boxes ("<id>:<side>") are keyed by the table, not by cells: they stay. */
import type { CellEdit, DataRef, Item, Op, RefBind, TableBind, TableDef, WorkbookDoc } from "./types";
import type { Range } from "../xlsx/util";
import { colToNum, numToCol } from "../xlsx/util";
import { bindFor, fmtA1, parseA1, refAt, refSheet, refsOf, rewritePatch, shiftA1, shiftSpan, type RefSlot, type Shift } from "./datarefs";

/** a move: by rows / columns on one sheet (null: every sheet the item reads – one item's own move), or a sheet's
    references to another sheet */
export type Move = { kind: "shift"; s: Shift; sheet: string | null } | { kind: "sheet"; from: string; to: string };
/** one line of the preview: what moves, where it is (slide, table), its address before and after (null: it would be
    deleted or pushed off the sheet – it is left as it is) */
export interface PlanRow { what: string; where: string; from: string; to: string | null }
export interface Plan { ops: Op[]; rows: PlanRow[]; /** what else moves with the tables ("4 cell edits", "2 hidden rows") */ notes: string[] }
type Doc = Pick<WorkbookDoc, "preset" | "edits">;
/** a fresh fingerprint at a reference's new address (the page reads its sheet; null: not now) */
export type Fp = (ref: DataRef, want: RefSlot["want"]) => RefBind | null;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const MAXR = 1048576, MAXC = 16384;
const inRect = (g: Range, r: Range | null) => !r || (g.r1 >= r.r1 && g.r2 <= r.r2 && g.c1 >= r.c1 && g.c2 <= r.c2);
const touches = (g: Range, r: Range | null) => !r || (g.r1 <= r.r2 && g.r2 >= r.r1 && g.c1 <= r.c2 && g.c2 >= r.c1);

/** one reference after the move (null: not moved – another sheet, or it would leave the sheet; `gone` then says so) */
function moveRef(ref: DataRef, sheet: string, mv: Move, rect: Range | null): { ref: DataRef | null; gone: boolean } {
  const g = parseA1(ref.range); if (!g || !inRect(g, rect)) return { ref: null, gone: false };
  if (mv.kind === "sheet") return "sheet" in ref && ref.sheet === mv.from ? { ref: { sheet: mv.to, range: ref.range }, gone: false } : { ref: null, gone: false };
  if (mv.sheet !== null && sheet !== mv.sheet) return { ref: null, gone: false };
  const r = shiftA1(ref.range, mv.s);
  return r === null ? { ref: null, gone: true } : r === ref.range ? { ref: null, gone: false } : { ref: { ...ref, range: r }, gone: false };
}
/** an item's references moved: its item.patch (one), the preview's lines. `table`: only its {table} references and
    (unless `sheetCells` is false) its sheet's references inside `rect` */
export function planItem(doc: Doc, slide: string, id: string, it: Item, mv: Move, opts: { where?: string; fp?: Fp; table?: string; rect?: Range | null; sheetCells?: boolean } = {}): { op: Op | null; rows: PlanRow[] } {
  const tables = doc.preset?.tables || [], refs: Record<string, DataRef> = {}, binds: Record<string, RefBind | null> = {}, rows: PlanRow[] = [];
  const have = isObj((it as { bind?: unknown }).bind) ? (it as { bind: Record<string, RefBind> }).bind : {};
  for (const slot of refsOf(it)) {
    const ref = slot.ref, sheet = refSheet(ref, tables);
    if (opts.table !== undefined) {
      const byTable = "table" in ref && ref.table === opts.table, bySheet = "sheet" in ref && opts.sheetCells !== false && sheet === tables.find(t => t.id === opts.table)?.sheet;
      if (!byTable && !bySheet) continue;
      if (byTable && mv.kind === "sheet") continue;                 // (a {table} reference follows the table's sheet)
    }
    // (a table's: its sheet's cells only inside its rectangle – none when it is not known)
    if (opts.table !== undefined && "sheet" in ref && !opts.rect) continue;
    const m = moveRef(ref, sheet, mv, opts.table !== undefined && "sheet" in ref ? opts.rect! : null);
    if (!m.ref && !m.gone) continue;
    rows.push({ what: slot.label, where: opts.where || "", from: refAt(ref, tables), to: m.ref ? refAt(m.ref, tables) : null });
    if (!m.ref) continue;
    refs[slot.path] = m.ref;
    // the bind follows: a fresh fingerprint at the new address (bind time), its `follow` kept
    const old = bindFor(have[slot.path], refAt(ref, tables)), fresh = opts.fp ? opts.fp(m.ref, slot.want) : null;
    if (fresh || old) binds[slot.path] = { ...(fresh || { ...old!, at: refAt(m.ref, tables) }), ...(old?.f ? { f: true } : {}) };
  }
  const p = Object.keys(refs).length ? rewritePatch(it, refs, binds) : null;
  return { op: p ? { op: "item.patch", slide, id, patch: p } as Op : null, rows };
}
/** the items of these slides (all: null) moved – one item.patch each */
export function planItems(doc: Doc, mv: Move, opts: { slides?: string[] | null; items?: { slide: string; id: string }[]; fp?: Fp } = {}): Plan {
  const plan: Plan = { ops: [], rows: [], notes: [] };
  (doc.preset?.slides || []).forEach((s, k) => {
    if (opts.slides && !opts.slides.includes(s.id)) return;
    for (const [id, it] of Object.entries(s.items || {})) {
      if (!it || (opts.items && !opts.items.some(x => x.slide === s.id && x.id === id))) continue;
      const r = planItem(doc, s.id, id, it, mv, { where: `Slide ${k + 1}`, fp: opts.fp });
      if (r.op) plan.ops.push(r.op);
      plan.rows.push(...r.rows);
    }
  });
  return plan;
}

/* ---- tables ---- */
/** a sheet column / row key ("3") moved (null: deleted) */
const moveCol = (k: string, s: Shift) => { const c = shiftSpan(+k, +k, s.dc, s.col, MAXC); return c ? String(c[0]) : null; };
const moveRow = (k: string, s: Shift) => { const r = shiftSpan(+k, +k, s.dr, s.row, MAXR); return r ? String(r[0]) : null; };
/** a map's keys moved: the patch that removes the old keys and sets the new (null when nothing moves) */
function rekey<T>(m: Record<string, T> | undefined, f: (k: string) => string | null): Record<string, T | null> | null {
  if (!isObj(m)) return null;
  const p: Record<string, T | null> = {}, next: Record<string, T> = {};
  let changed = false;
  for (const [k, v] of Object.entries(m)) { const n = f(k); if (n !== k) changed = true; if (n !== null) next[n] = v; }
  if (!changed) return null;
  for (const k of Object.keys(m)) p[k] = null;
  for (const [k, v] of Object.entries(next)) p[k] = v;
  return p;
}
/** the whole map moved (for a design's sizes, replaced whole) */
function moved<T>(m: Record<string, T> | undefined, f: (k: string) => string | null): Record<string, T> | undefined {
  if (!isObj(m)) return undefined;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) { const n = f(k); if (n !== null) out[n] = v; }
  return Object.keys(out).length ? out : undefined;
}
/** a table's own rectangle: a range table's range (a markers table's: `rect`, its layout's, from the page) */
export const tableRect = (def: TableDef, rect?: Range | null): Range | null => def.kind === "range" ? parseA1(def.range) : rect ?? null;
/** a table moved (by rows / columns, or to another sheet) with everything keyed by its cells; `rect`: a markers table's
    cells (its range is found by its markers); `withItems`: also the items reading its sheet's cells inside it (default) */
export function planTable(doc: Doc, tid: string, mv: Move, opts: { rect?: Range | null; withItems?: boolean; fp?: Fp; bind?: TableBind | null } = {}): Plan {
  const plan: Plan = { ops: [], rows: [], notes: [] };
  const def = doc.preset?.tables.find(t => t.id === tid); if (!def) return plan;
  const rect = tableRect(def, opts.rect), name = def.name || def.sheet + (def.kind === "range" ? "!" + def.range : "");
  if (mv.kind === "sheet" && def.sheet !== mv.from) return plan;
  if (mv.kind === "shift" && mv.sheet !== null && mv.sheet !== def.sheet) return plan;
  const p: Record<string, unknown> = {};
  if (mv.kind === "sheet") {
    p.sheet = mv.to;
    plan.rows.push({ what: "Table cells", where: name, from: def.sheet + "!" + (def.kind === "range" ? def.range : "(x markers)"), to: mv.to + "!" + (def.kind === "range" ? def.range : "(x markers)") });
  } else {
    const s = mv.s;
    if (def.kind === "range") {
      const r = shiftA1(def.range, s);
      plan.rows.push({ what: "Table cells", where: name, from: def.sheet + "!" + def.range, to: r === null ? null : def.sheet + "!" + r });
      if (r === null) return plan;                                 // (deleted: nothing moves)
      if (r !== def.range) p.range = r;
    } else plan.rows.push({ what: "Table settings (found by its x markers)", where: name, from: def.sheet + "!" + (rect ? fmtA1(rect) : "?"), to: rect ? def.sheet + "!" + (shiftA1(fmtA1(rect), s) ?? "–") : "–" });
    const cols = rekey(def.cols, k => moveCol(k, s)), rows = rekey(def.rows, k => moveRow(k, s));
    if (cols) p.cols = cols; if (rows) p.rows = rows;
    const sizes: Record<string, unknown> = {};
    for (const [d, z] of Object.entries(def.sizes || {})) {
      if (!z) continue;
      const n = { ...(moved(z.cols, k => moveCol(k, s)) ? { cols: moved(z.cols, k => moveCol(k, s)) } : {}), ...(moved(z.rows, k => moveRow(k, s)) ? { rows: moved(z.rows, k => moveRow(k, s)) } : {}) };
      if (JSON.stringify(n) !== JSON.stringify(z)) sizes[d] = Object.keys(n).length ? n : null;
    }
    if (Object.keys(sizes).length) p.sizes = sizes;
    for (const k of ["merges", "cellGrid", "borders"] as const) { const m = rekey(def[k] as Record<string, unknown> | undefined, a => shiftA1(a, s)); if (m) p[k] = m; }
    if (isObj(def.scales)) {
      const sc: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(def.scales)) { if (!v) continue; const r = shiftA1(v.range, s); if (r !== v.range) sc[k] = r === null ? null : { ...v, range: r }; }
      if (Object.keys(sc).length) p.scales = sc;
    }
    const kept = def.cols || def.rows || def.sizes ? ["column widths / row heights"] : [];
    if (p.merges || p.cellGrid || p.borders || p.scales) kept.push("merges, gridlines, borders, colour scales");
    if (kept.length && (p.cols || p.rows || p.sizes || p.merges || p.cellGrid || p.borders || p.scales)) plan.notes.push(`The table's ${kept.join(", ")} move with it`);
  }
  const b = opts.bind !== undefined ? opts.bind : def.bind && mv.kind === "shift" && p.range ? { ...def.bind, at: String(p.range) } : undefined;
  if (b !== undefined) p.bind = b;
  if (Object.keys(p).length) plan.ops.push({ op: "table.patch", id: tid, patch: p } as Op);
  // the slides' hidden rows / columns of it
  if (mv.kind === "shift") {
    let n = 0;
    for (const s of doc.preset?.slides || []) {
      const m = rekey(s.hidden, k => {
        if (!k.startsWith(tid + ":")) return k;
        const x = /^(.*):([rc])(.+)$/.exec(k); if (!x) return k;
        if (x[2] === "r") { const r = moveRow(x[3], mv.s); return r === null ? null : `${tid}:r${r}`; }
        const c = /^[A-Z]{1,3}$/.test(x[3]) ? moveCol(String(colToNum(x[3])), mv.s) : x[3];
        return c === null ? null : `${tid}:c${/^\d+$/.test(c) ? numToCol(+c) : c}`;
      });
      if (m) { plan.ops.push({ op: "slide.patch", id: s.id, patch: { hidden: m } } as Op); n += Object.keys(s.hidden || {}).filter(k => k.startsWith(tid + ":")).length; }
    }
    if (n) plan.notes.push(`${n} hidden row${n > 1 ? "s" : ""} / column${n > 1 ? "s" : ""} of it on its slides move with it`);
  }
  // (a table whose cells are not known – a markers table without its layout's rectangle: none of the sheet's cell
  // edits or versions' entries is its own to move)
  if (rect) cellsPlan(doc, plan, def.sheet, rect, mv);
  else plan.notes.push("The table's cells are not known here: its cell edits and the versions' entries stay where they are");
  // the items reading it
  (doc.preset?.slides || []).forEach((s, k) => {
    for (const [id, it] of Object.entries(s.items || {})) {
      if (!it) continue;
      const r = planItem(doc, s.id, id, it, mv, { where: `Slide ${k + 1}`, table: tid, rect, sheetCells: opts.withItems !== false, fp: opts.fp });
      if (r.op) plan.ops.push(r.op);
      plan.rows.push(...r.rows);
    }
  });
  return plan;
}
/** the cell edits and the versions' entries of a sheet inside `rect` (null: the whole sheet) moved */
function cellsPlan(doc: Doc, plan: Plan, sheet: string, rect: Range | null, mv: Move) {
  const to = mv.kind === "sheet" ? mv.to : sheet, src = doc.edits[sheet] || {};
  const moves: [string, string | null, CellEdit][] = [];
  for (const [k, e] of Object.entries(src)) {
    const g = parseA1(k); if (!g || !inRect(g, rect)) continue;
    const n = mv.kind === "sheet" ? k : shiftA1(k, mv.s);
    if (n !== k || to !== sheet) moves.push([k, n, e]);
  }
  if (moves.length) {
    const work = clone(doc.edits) as Record<string, Record<string, CellEdit>>;
    for (const [k, , e] of moves) {
      plan.ops.push({ op: "cell.patch", sheet, ref: k, patch: Object.fromEntries(Object.keys(e).map(x => [x, null])) } as Op);
      delete work[sheet][k];
    }
    for (const [, n, e] of moves) {
      if (n === null) continue;
      const cur = (work[to] || {})[n] || {}, patch: Record<string, unknown> = { ...Object.fromEntries(Object.keys(cur).map(x => [x, null])), ...clone(e) };
      // a painted rule's source inside the moved cells moves with them
      if (typeof e.cf === "string" && e.cf !== "none") {
        const m = /^(.*)!([A-Z]{1,3}[0-9]{1,7})$/.exec(e.cf);
        if (m && m[1] === sheet) { const g = parseA1(m[2]); if (g && inRect(g, rect)) patch.cf = to + "!" + (mv.kind === "sheet" ? m[2] : shiftA1(m[2], mv.s) ?? m[2]); }
      }
      plan.ops.push({ op: "cell.patch", sheet: to, ref: n, patch } as Op);
      (work[to] ||= {})[n] = e;
    }
    const gone = moves.filter(m => m[1] === null).length;
    plan.notes.push(`${moves.length - gone} cell edit${moves.length - gone === 1 ? "" : "s"} move${moves.length - gone === 1 ? "s" : ""} with the cells` + (gone ? ` (${gone} on deleted cells removed)` : ""));
  }
  // the versions' emptied cells ("C5:D9") and deleted rows ("5:7") / columns ("C:D") inside the cells. One that reaches
  // beyond them (a whole row "5:7" crosses every other table of the sheet; a range half in the table) is not the table's
  // alone: it stays as it is, and the preview says so
  let nv = 0, beyond = 0;
  for (const v of doc.preset?.versions || []) {
    const patch: Record<string, unknown> = {};
    for (const key of ["hide", "drop"] as const) {
      const list = (v[key] || {})[sheet]; if (!Array.isArray(list)) continue;
      const stay: string[] = [], go: string[] = [];
      for (const a of list) {
        const span = spanOf(a);
        if (!span || !touches(span, rect)) { stay.push(a); continue; }
        if (!inRect(span, rect)) { stay.push(a); beyond++; continue; }
        if (mv.kind === "sheet") go.push(a);
        else { const n = shiftA1(a, mv.s); if (n !== null) stay.push(n); }
      }
      if (mv.kind === "sheet" && go.length) patch[key] = { [sheet]: stay.length ? stay : null, [to]: [...((v[key] || {})[to] || []), ...go] };
      else if (mv.kind === "shift" && JSON.stringify(stay) !== JSON.stringify(list)) patch[key] = { [sheet]: stay.length ? stay : null };
    }
    if (Object.keys(patch).length) { plan.ops.push({ op: "version.patch", id: v.id, patch } as Op); nv++; }
  }
  if (nv) plan.notes.push(`The emptied cells and deleted rows / columns of ${nv} version${nv > 1 ? "s" : ""} move with them`);
  if (beyond) plan.notes.push(`${beyond} version entr${beyond > 1 ? "ies" : "y"} (emptied cells, deleted rows or columns) reach${beyond > 1 ? "" : "es"} beyond the table: left as ${beyond > 1 ? "they are" : "it is"} – check the version (Cells › For this version ▾)`);
}
/** a version entry's rectangle: a range, whole rows "5:7", whole columns "C:D" */
function spanOf(a: string): Range | null {
  const t = String(a).trim().toUpperCase().replace(/\$/g, "");
  let m = /^([0-9]{1,7})(?::([0-9]{1,7}))?$/.exec(t);
  if (m) return { r1: +m[1], r2: +(m[2] ?? m[1]), c1: 1, c2: MAXC };
  m = /^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/.exec(t);
  if (m) return { r1: 1, r2: MAXR, c1: colToNum(m[1]), c2: colToNum(m[2] ?? m[1]) };
  return parseA1(t);
}
/** a whole sheet's things moved – Excel's insert / delete of rows or columns there, or the sheet renamed: the items of
    the deck reading it (or of `slides`), its tables with their settings, its cell edits and the versions' entries */
export function planSheet(doc: Doc, mv: Move, opts: { slides?: string[] | null; fp?: Fp; tables?: boolean } = {}): Plan {
  const sheet = mv.kind === "sheet" ? mv.from : mv.sheet;
  const plan = planItems(doc, mv, { slides: opts.slides, fp: opts.fp });
  if (opts.tables === false || !sheet) return plan;
  for (const def of doc.preset?.tables || []) {
    if (def.sheet !== sheet) continue;
    const t = planTable({ ...doc, edits: {}, preset: { ...doc.preset!, versions: [], slides: doc.preset!.slides.map(s => ({ ...s, items: undefined })) } }, def.id, mv, {});
    plan.ops.push(...t.ops); plan.rows.push(...t.rows); plan.notes.push(...t.notes);
  }
  cellsPlan(doc, plan, sheet, null, mv);
  return plan;
}
