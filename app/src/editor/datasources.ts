/* Data sources (B57, 4.14): where an item's (or a table's) references read, whether that still looks right, and the
   repoints – one reference (Change…: the sheet view on its own cells), every reference by N rows / columns, from one
   sheet to another, or back under its header (Find the block) – each ONE change (one undo step) with a preview first
   for the bulk ones. The maths is the core's (model/datarefs.ts, model/repoint.ts); this file reads the page's
   workbook mirror and sends the operations.
   What a reference was bound to (its header, its first label) comes from its bind (stored by Data sources), else from
   the workbook as it was before the last reload in this window (the page keeps the previous mirror of the same file):
   a block moved in Excel and reloaded is seen either way. */
import { get, setDialogs, toast, useStore } from "../state/store";
import { change, ctx } from "../state/app";
import type { DataRef, Item, Op, RefBind, RuntimeSlide, TableDef, TableBind } from "@slide-builder/core/model/types";
import type { Sheet, Workbook } from "@slide-builder/core/xlsx/types";
import type { Range } from "@slide-builder/core/xlsx/util";
import { A1, esc } from "@slide-builder/core/xlsx/util";
import { bindFor, checkRef, findBlock, findHeaderRow, fingerprint, following, fmtA1, movedRef, parseA1, refAt, refHidden, refSheet, refsOf, rewritePatch, shiftA1, STATUS_TEXT, tableHeader,
  type CheckCtx, type RefCheck, type RefSlot, type RefStatus, type Shift } from "@slide-builder/core/model/datarefs";
import { planItem, planItems, planSheet, planTable, type Move, type Plan, type PlanRow } from "@slide-builder/core/model/repoint";
import { boundItem } from "@slide-builder/core/render/follow";
import { gToRange } from "@slide-builder/core/model/preset";
import { itemOf } from "./charts";
import { curSlide } from "./edit";
import { kindText } from "./item-text";

/** what Data sources looks at: an item of the current slide, or a table of the deck */
export type SrcTarget = { item: string } | { table: string };
/** the sheet view's request (PickCells.tsx kind "src") */
export interface SrcPick { kind: "src"; target: SrcTarget; path: string; label: string; sheet: string; range: string; one: boolean }

/* ---- the workbook before the last reload (this window only) ---- */
let seen: { name: string; wb: Workbook } | null = null, before: { name: string; wb: Workbook } | null = null;
function track(wb: Workbook | null) {
  const name = get().deck.file?.name || "";
  if (!wb || seen?.wb === wb) return;
  before = seen && seen.name === name ? seen : null;
  seen = { name, wb };
}
useStore.subscribe(s => s.deck.wb, wb => track(wb as Workbook | null));
/** the workbook as it was before the last reload of the same file (null: none in this window) */
export const previousWorkbook = () => { track(get().deck.wb as Workbook | null); return before?.wb ?? null; };
/** (tests) forget the previous workbook */
export const resetPrevious = () => { seen = null; before = null; };

const loaded = (wb: Workbook | null | undefined, n: string): Sheet | null => wb?.sheets.find(s => s.name === n) || null;
/** the checks' view of the page's workbook */
export function checkCtx(): CheckCtx {
  const wb = get().deck.wb;
  return { sheet: n => loaded(wb, n), exists: n => !!wb?.meta.some(m => m.name === n), tables: get().doc.view?.preset?.tables || [] };
}
const tables = () => get().doc.view?.preset?.tables || [];
/** a reference's fingerprint in the page's workbook now (bind time) – null when nothing beside it can be read */
export function fpNow(ref: DataRef, want: RefSlot["want"], wb: Workbook | null = get().deck.wb): RefBind | null {
  const S = loaded(wb, refSheet(ref, tables())), g = parseA1(ref.range);
  if (!S || !g) return null;
  const b = fingerprint(S, g, want, refAt(ref, tables()));
  return b.h || b.l ? b : null;
}

/* ---- one row per reference ---- */
export interface SrcRow {
  slot: RefSlot; check: RefCheck;
  /** what it was bound to: its bind, else (moved? only) the workbook before the reload */ fp: RefBind | null; stored: boolean;
  /** follows its header; `now`: where it reads now when that is not its stored address */ follow: boolean; now?: string;
}
const binds = (it: Item) => ((it as { bind?: Record<string, RefBind> }).bind || {}) as Record<string, RefBind>;
/** every reference of an item with its status now */
/** `all`: also the references the item does not draw (its pie fallback, core datarefs.ts refHidden) – the bulk repoints'
    own list; the panel and the Issues lines show the drawn ones */
export function itemRows(it: Item, all = false): SrcRow[] {
  const cx = checkCtx(), b = binds(it), prev = previousWorkbook(), T = tables();
  const resolved = following(it).length ? boundItem(it, ctx()) : it, res = resolved === it ? null : refsOf(resolved);
  return refsOf(it).filter(slot => all || !refHidden(it, slot)).map(slot => {
    const at = refAt(slot.ref, T), own = bindFor(b[slot.path], at);
    const old = own ? null : prevFp(slot, prev);
    const follow = !!own?.f, moved = res?.find(s => s.path === slot.path);
    if (follow && moved && refAt(moved.ref, T) !== at) {
      const c = checkRef({ ...slot, ref: moved.ref }, cx);
      return { slot, check: c, fp: own, stored: true, follow, now: refAt(moved.ref, T) };
    }
    return { slot, check: checkRef(slot, cx, own || old), fp: own || old, stored: !!own, follow };
  });
}
/** the fingerprint the workbook before the reload gives a reference (its sheet still loaded there) */
function prevFp(slot: RefSlot, prev: Workbook | null): RefBind | null {
  if (!prev || slot.token) return null;
  const S = loaded(prev, refSheet(slot.ref, tables())), g = parseA1(slot.ref.range);
  if (!S || !g) return null;
  const b = fingerprint(S, g, slot.want, refAt(slot.ref, tables()));
  return b.h || b.l ? b : null;
}
/** a table's row: its cells (a range table's range; a markers table found by its markers) */
export interface TableRow { def: TableDef; at: string; status: RefStatus | "markers"; why: string; rect: Range | null; header: string[] | null; stored: boolean }
export function tableRow(def: TableDef, R: RuntimeSlide | null = curSlide()): TableRow {
  const L = R?.tables.find(t => t.def?.id === def.id) || get().deck.slides.flatMap(s => s.tables).find(t => t.def?.id === def.id);
  const cx = checkCtx(), S = cx.sheet(def.sheet);
  if (def.kind === "markers") {
    const rect = L ? parseA1(gToRange(L.g)) : null;
    return { def, at: def.sheet + "!" + (rect ? fmtA1(rect) : "(x markers)"), status: !S && !cx.exists!(def.sheet) ? "sheet" : L ? "markers" : "empty", why: L ? "found by its x markers: it follows the workbook" : "its x markers are not found", rect, header: null, stored: false };
  }
  const at = def.sheet + "!" + def.range, rect = parseA1(def.range);
  if (!S) return { def, at, status: cx.exists!(def.sheet) ? "wait" : "sheet", why: cx.exists!(def.sheet) ? "" : `the sheet “${def.sheet}” is not in the workbook (renamed or deleted?)`, rect, header: null, stored: false };
  const c = checkRef({ ref: { sheet: def.sheet, range: def.range }, want: "any" }, cx);
  if (c.status !== "ok") return { def, at, status: c.status, why: c.why, rect, header: null, stored: false };
  // its header row: as bound (stored), else as it was before the reload
  const stored = def.bind && def.bind.at === def.range ? def.bind.h : null, pS = loaded(previousWorkbook(), def.sheet);
  const header = stored || (pS && rect ? tableHeader(pS, rect) : null);
  if (header && rect && header.some(Boolean)) {
    const now = tableHeader(S, rect), d = findHeaderRow(S, rect, header);
    if (!d || d.dr || d.dc) return { def, at, status: "moved", why: `its header row (${header.filter(Boolean).slice(0, 3).map(h => "“" + h + "”").join(", ")}…) is no longer at row ${rect.r1}${now.some(Boolean) ? "" : " (empty now)"}`, rect, header, stored: !!stored };
  }
  return { def, at, status: "ok", why: "", rect, header, stored: !!stored };
}
export const statusText = (s: RefStatus | "markers") => s === "markers" ? "follows its markers" : STATUS_TEXT[s];
export const isBad = (s: RefStatus | "markers") => s !== "ok" && s !== "wait" && s !== "markers";

/* ---- one reference changed (the sheet view) ---- */
export function srcInit(p: SrcPick): Range | null { return parseA1(p.range); }
export function openChange(target: SrcTarget, row: { path: string; label: string; ref: DataRef; one: boolean }) {
  const sheet = refSheet(row.ref, tables());
  setDialogs({ pick: { kind: "src", target, path: row.path, label: row.label, sheet, range: row.ref.range.replace(/\$/g, "").toUpperCase(), one: row.one } });
}
/** the cells chosen: ONE item.patch replacing only that reference (its bind made at the new cells, follow kept), or the
    table's cells with what is keyed by them */
export function applySrcPick(p: SrcPick, sheet: string, range: string) {
  if ("item" in p.target) {
    const it = itemOf(p.target.item); if (!it) return;
    const slot = refsOf(it).find(s => s.path === p.path); if (!slot) return;
    const ref: DataRef = "table" in slot.ref && refSheet(slot.ref, tables()) === sheet ? { table: slot.ref.table, range } : { sheet, range };
    const old = bindFor(binds(it)[p.path], refAt(slot.ref, tables())), fresh = fpNow(ref, slot.want);
    const b = fresh ? { ...fresh, ...(old?.f ? { f: true } : {}) } : old ? null : undefined;
    const patch = rewritePatch(it, { [p.path]: ref }, b === undefined ? {} : { [p.path]: b });
    if (patch) send(`Data sources · ${p.label}`, [{ op: "item.patch", slide: curSlide()!.id, id: p.target.item, patch } as Op]);
    return;
  }
  const def = tables().find(t => t.id === (p.target as { table: string }).table); if (!def) return;
  const plan = tableTo(def, sheet, range);
  if (plan) { send("Data sources · table cells", plan.ops); const n = plan.notes.find(x => x.startsWith("To another sheet")); if (n) toast(esc(n)); }
}
/** a table to these cells: on its sheet its settings move by the top-left's shift; to another sheet with them */
export function tableTo(def: TableDef, sheet: string, range: string): Plan | null {
  const doc = get().doc.view; if (!doc) return null;
  const g = parseA1(range), old = def.kind === "range" ? parseA1(def.range) : null;
  if (!g) return null;
  let plan: Plan;
  if (sheet === def.sheet && old) plan = planTable(doc, def.id, { kind: "shift", s: { dr: g.r1 - old.r1, dc: g.c1 - old.c1 }, sheet: null }, { fp: fpNow });
  else plan = planTable(doc, def.id, { kind: "sheet", from: def.sheet, to: sheet }, { fp: fpNow });
  // the exact cells chosen (another size too), its header row bound there
  const S = loaded(get().deck.wb, sheet), bind: TableBind | null = S ? { at: fmtA1(g, true), h: tableHeader(S, g) } : null;
  const tp = plan.ops.find(o => o.op === "table.patch" && o.id === def.id) as Extract<Op, { op: "table.patch" }> | undefined;
  const extra = { ...(def.kind === "range" ? { range: fmtA1(g, true) } : {}), ...(sheet !== def.sheet ? { sheet } : {}), ...(bind ? { bind } : {}) };
  if (tp) Object.assign(tp.patch, extra); else plan.ops.unshift({ op: "table.patch", id: def.id, patch: extra } as Op);
  if (sheet !== def.sheet && old && (g.r1 !== old.r1 || g.c1 !== old.c1))
    plan.notes.push(`To another sheet at other cells: its column widths, row heights, merges, gridlines, borders and hidden rows / columns keep their old coordinates (${A1(old.r1, old.c1)}…) – move them with Move all by… on “${sheet}” if they should follow`);
  return plan;
}
/** one change, one undo step; the preview's plan applied */
function send(label: string, ops: Op[]) { if (ops.length) change(label, ops); }
export const applyPlan = (label: string, p: Plan) => send(label, p.ops);

/* ---- bulk ---- */
export type Scope = "item" | "slide" | "deck";
/** Move all by…: this item's references (every sheet, or one), the slide's or the deck's on one sheet (the deck: its
    tables, cell edits and versions too); a table: the table and what is keyed by its cells */
export function planMove(target: SrcTarget, scope: Scope, sheet: string | null, s: Shift): Plan {
  const doc = get().doc.view!, R = curSlide()!, mv: Move = { kind: "shift", s, sheet };
  if ("table" in target) return planTable(doc, target.table, mv, { rect: tableRow(tables().find(t => t.id === target.table)!).rect, fp: fpNow });
  if (scope === "item") { const it = itemOf(target.item)!; const r = planItem(doc, R.id, target.item, it, mv, { where: kindText(it).name(it), fp: fpNow }); return { ops: r.op ? [r.op] : [], rows: r.rows, notes: [] }; }
  if (scope === "slide") return planItems(doc, mv, { slides: [R.id], fp: fpNow });
  return planSheet(doc, mv, { fp: fpNow });
}
/** Change sheet…: every reference from one sheet to another (a renamed or copied sheet) */
export function planSheetChange(target: SrcTarget, scope: Scope, from: string, to: string): Plan {
  const doc = get().doc.view!, R = curSlide()!, mv: Move = { kind: "sheet", from, to };
  if ("table" in target) return planTable(doc, target.table, mv, { rect: tableRow(tables().find(t => t.id === target.table)!).rect, fp: (r, w) => fpNow(r, w) });
  if (scope === "item") { const it = itemOf(target.item)!; const r = planItem(doc, R.id, target.item, it, mv, { where: kindText(it).name(it), fp: fpNow }); return { ops: r.op ? [r.op] : [], rows: r.rows, notes: [] }; }
  if (scope === "slide") return planItems(doc, mv, { slides: [R.id], fp: fpNow });
  return planSheet(doc, mv, { fp: fpNow });
}
/** Find the block: each reference whose header (or label) is known, back under it – an item's (or the slide's items'),
    a table's header row */
export function planFind(target: SrcTarget, scope: Scope): Plan {
  const plan: Plan = { ops: [], rows: [], notes: [] }, R = curSlide()!, T = tables();
  if ("table" in target) {
    const def = T.find(t => t.id === target.table)!, row = tableRow(def);
    const S = loaded(get().deck.wb, def.sheet);
    if (!row.header || !row.rect || !S) { plan.notes.push("Its header row is not known: Remember headers first, or Change… its cells."); return plan; }
    const d = findHeaderRow(S, row.rect, row.header);
    if (!d) { plan.notes.push(`The header row (“${row.header.filter(Boolean)[0]}”…) is nowhere on ${def.sheet}.`); return plan; }
    if (!d.dr && !d.dc) { plan.notes.push("The table's header row is where it was: nothing to move."); return plan; }
    const p = tableTo(def, def.sheet, fmtA1({ r1: row.rect.r1 + d.dr, c1: row.rect.c1 + d.dc, r2: row.rect.r2 + d.dr, c2: row.rect.c2 + d.dc }, true));
    return p || plan;
  }
  const ids = scope === "item" ? [target.item] : Object.keys(R.cfg.items || {});
  for (const id of ids) {
    const it = itemOf(id); if (!it) continue;
    const refs: Record<string, DataRef> = {}, bs: Record<string, RefBind> = {};
    for (const r of itemRows(it, true)) {
      if (!r.fp || r.now || r.slot.token) continue;
      const S = r.check.S, g = parseA1(r.slot.ref.range); if (!S || !g) continue;
      const d = findBlock(S, g, r.fp);
      if (d && d.ambiguous !== undefined) { plan.notes.push(`${r.slot.label}: “${r.fp.h}” is in ${d.ambiguous} places on ${r.check.sheet} and its label does not tell which: Change… its cells.`); continue; }
      if (!d || (!d.dr && !d.dc)) { if (!d && r.check.status === "moved") plan.notes.push(`${r.slot.label}: “${r.fp.h || r.fp.l}” is nowhere on ${r.check.sheet}.`); continue; }
      const nr = movedRef(r.slot.ref, d); if (!nr) continue;
      refs[r.slot.path] = nr;
      const fresh = fpNow(nr, r.slot.want);
      bs[r.slot.path] = { ...(fresh || { ...r.fp, at: refAt(nr, T) }), ...(r.follow ? { f: true } : {}) };
      plan.rows.push({ what: r.slot.label, where: kindText(it).name(it), from: refAt(r.slot.ref, T), to: refAt(nr, T) });
    }
    const p = Object.keys(refs).length ? rewritePatch(it, refs, bs) : null;
    if (p) plan.ops.push({ op: "item.patch", slide: R.id, id, patch: p } as Op);
  }
  if (!plan.rows.length && !plan.notes.length) plan.notes.push("Every reference with a known header is where its header is: nothing to move.");
  return plan;
}
/** Follow header on / off for one reference: its bind (made now when it has none) with `f` */
export function setFollow(id: string, path: string, on: boolean) {
  const it = itemOf(id); if (!it) return;
  const slot = refsOf(it).find(s => s.path === path); if (!slot) return;
  const at = refAt(slot.ref, tables()), own = bindFor(binds(it)[path], at), b = own || fpNow(slot.ref, slot.want);
  if (!b || !b.h) return;
  const next: RefBind = { ...b, at }; if (on) next.f = true; else delete next.f;
  send(on ? "Follow header" : "Stop following header", [{ op: "item.patch", slide: curSlide()!.id, id, patch: { bind: { [path]: next } } } as Op]);
}
/** a reference can follow its header: a header (text above / left, or its own first cell) is beside it now */
export const canFollow = (r: SrcRow) => !r.slot.token && !!(r.fp?.h || (r.check.status === "ok" && fpNow(r.slot.ref, r.slot.want)?.h));
/** Remember headers: every reference's header and label as they are now (Find the block and the checks use them) */
export function rememberHeaders(target: SrcTarget) {
  if ("table" in target) {
    const def = tables().find(t => t.id === target.table), S = def && loaded(get().deck.wb, def.sheet), g = def && def.kind === "range" ? parseA1(def.range) : null;
    if (def && S && g) send("Remember the table's header", [{ op: "table.patch", id: def.id, patch: { bind: { at: def.kind === "range" ? def.range : "", h: tableHeader(S, g) } } } as Op]);
    return;
  }
  const it = itemOf(target.item); if (!it) return;
  const out: Record<string, RefBind> = {}, have = binds(it);
  for (const s of refsOf(it)) {
    if (s.token) continue;
    const b = fpNow(s.ref, s.want); if (!b) continue;
    out[s.path] = { ...b, ...(bindFor(have[s.path], b.at!)?.f ? { f: true } : {}) };
  }
  if (Object.keys(out).length) send("Remember headers", [{ op: "item.patch", slide: curSlide()!.id, id: target.item, patch: { bind: out } } as Op]);
}
/** the sheets a target's references read (for Move all by… / Change sheet…) */
export function targetSheets(target: SrcTarget): string[] {
  if ("table" in target) { const d = tables().find(t => t.id === target.table); return d ? [d.sheet] : []; }
  const it = itemOf(target.item);
  return it ? [...new Set(refsOf(it).map(s => refSheet(s.ref, tables())).filter(Boolean))] : [];
}
/** the workbook's sheets (Change sheet's choices) */
export const workbookSheets = () => (get().deck.wb?.meta || []).map(m => m.name);
/** the slide's problems for the Issues panel: per item (and table) its references that look wrong */
export interface SrcIssue { target: SrcTarget; name: string; bad: { label: string; status: string; why: string }[] }
export function slideSrcIssues(R: RuntimeSlide | null = curSlide()): SrcIssue[] {
  if (!R) return [];
  const out: SrcIssue[] = [], count: Record<string, number> = {};
  for (const [id, it] of Object.entries(R.cfg.items || {})) {
    if (!it || (it.kind !== "chart" && it.kind !== "kpi")) continue;
    const n = count[it.kind] = (count[it.kind] || 0) + 1;
    const bad = itemRows(it).filter(r => isBad(r.check.status)).map(r => ({ label: r.slot.label, status: STATUS_TEXT[r.check.status], why: r.check.why }));
    if (bad.length) out.push({ target: { item: id }, name: (it.kind === "kpi" ? "KPI card " : "Chart ") + n, bad });
  }
  for (const id of R.cfg.tables || []) {
    const def = tables().find(t => t.id === id); if (!def) continue;
    const t = tableRow(def, R);
    if (isBad(t.status)) out.push({ target: { table: id }, name: "Table " + (def.name || t.at), bad: [{ label: "Table cells", status: statusText(t.status), why: t.why }] });
  }
  return out;
}
/** the address a move would give (the preview of one reference) */
export const shifted = (ref: DataRef, s: Shift) => shiftA1(ref.range, s);
export type { Plan, PlanRow, Shift };
export { A1 };
