/* Document operations – the ONLY way documents change, and the ONLY implementation of their semantics
   (docs/ARCHITECTURE.md §3; since 4.0 the helper applies none: it stores records of them, model/fold.ts folds
   them). Pinned by shared/ops-vectors.json. */
import { kpiClean } from "./kpi";
import type { CellEdit, Op, SlideDef, TableDef, WorkbookDoc, StylePatch } from "./types";

const SLIDE_KEYS = ["title", "subtitle", "date", "note", "logo", "layout", "align", "scale", "valign", "subs"] as const;
const SLIDE_MAPS = ["notes", "fmt", "sizes", "free", "looks", "hide", "hidden"] as const;
const TABLE_KEYS = ["name", "gridH", "gridV", /* 4.14 (B57): the table's cells moved – its sheet, its range, its header row as bound */ "sheet", "range", "bind"] as const;
const TABLE_MAPS = ["cols", "rows", "scales", "merges", "sizes", "cellGrid", "borders"] as const;
const CELL_KEYS = ["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role", "valign", "num"] as const;
const STYLE_MAPS = ["pn", "footer", "theme", "text", "colors", "designs"] as const;
const STYLE_KEYS = ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const;
/* slide items (07 §2.2): plain keys of every kind, and the map-merge keys. 09 §2.10's whole item.patch row (S14.P, for
   M14's charts and M15's lines and icons at once): chart keys stack … plot, line keys route … style, the icon's stroke;
   the chart maps merged per entry (a whole series / group / axis / mark, 09 §2.2); kind "line" */
const ITEM_KEYS = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail",
  "stack", "gap", "overlap", "legendAt", "frame", "titleRule", "plot",
  "route", "a", "b", "mid", "bend", "ends", "style", "stroke",
  /* 4.13 (B54): the chart card's filter, tag, separator and momentum label; a KPI card's keys (model/kpi.ts) */
  "filter", "tag", "sep", "momLabel", "head", "cur", "rows", "good", "num",
  /* 4.14 (B55): a chart card's subtitle, the budget-achievement chart (type "progress") */
  "subtitle", "progress"] as const;
const ITEM_MAPS = ["colors", "fmt", "sers", "groups", "axes", "marks", "legendHide", "titleFmt", "nudge", /* 4.13 (B54) */ "stats", "moms",
  /* 4.14 (B56, model/textparts.ts): a part's text format, the parts' layout, their offsets */ "texts", "lay", "offs",
  /* 4.14 (B57, model/datarefs.ts): what each reference was bound to, follow its header */ "bind"] as const;
const ITEM_KINDS = ["chart", "shape", "line", /* 4.13 (B54) */ "kpi"];
/* a chart's marks (an entry of `marks`, kept whole): the kinds and keys this page draws – 4.10 (B52) adds the reference
   line, the gap arrow and the change pills and their keys (value … off); a later page's kind or key is not known */
const MARK_KINDS = ["arrow", "line", "band", "icon", "text", "ref", "gap", "change"];
const MARK_KEYS = ["kind", "a", "b", "style", "icon", "size", "text", "fmt", "dy",
  "value", "name", "axis", "show", "pos", "ref", "caption", "num", "pct", "abs", "signs", "pairs", "off",
  /* 4.11 (B53) */ "labelSide", "from", "capPos"];
/** every mark entry of a marks map (a patch's or an item's) is one this page draws whole */
const marksKnown = (m: unknown) => !isObj(m) || Object.values(m).every(k => k === null || !isObj(k) || (MARK_KINDS.includes(k.kind as string) && Object.keys(k).every(x => MARK_KEYS.includes(x))));
/* slide.add / table.add (4.6, 09 §2.8): the slide types and table kinds this page draws (a later page's are skipped) */
const SLIDE_TYPES = ["cover", "index", "content"], TABLE_KINDS = ["markers", "range"];
const REF = /^[A-Z]{1,3}[0-9]{1,7}$/;
/** (B57) a range table's range: one cell or a rectangle, A1 */
const A1RANGE = /^[A-Z]{1,3}[0-9]{1,7}(:[A-Z]{1,3}[0-9]{1,7})?$/;
/** (B57) a table's header row as bound: its address and the texts of its first row */
const isTableBind = (b: unknown) => isObj(b) && typeof b.at === "string" && Array.isArray(b.h) && b.h.every(x => typeof x === "string");
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const clone = <T>(x: T): T => x === undefined ? x : JSON.parse(JSON.stringify(x));

type Doc = Pick<WorkbookDoc, "preset" | "style" | "edits">;

/** applies one op in place; returns false when it was skipped */
export function applyOp(doc: Doc, op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case "preset.set": {
      if (!("preset" in o) || (o.preset !== null && !isObj(o.preset))) return false;
      doc.preset = clone(o.preset) as Doc["preset"];
      return true;
    }
    case "slide.patch": {
      if (typeof o.id !== "string" || !isObj(o.patch) || !doc.preset) return false;
      const s = doc.preset.slides.find(x => x.id === o.id) as unknown as Record<string, unknown> | undefined;
      if (!s) return false;
      for (const k of SLIDE_KEYS) if (k in o.patch) { const v = o.patch[k]; if (v === null) delete s[k]; else s[k] = clone(v); }
      for (const k of SLIDE_MAPS) if (k in o.patch) mapMerge(s, k, o.patch[k]);
      return true;
    }
    case "table.patch": {
      if (typeof o.id !== "string" || !isObj(o.patch) || !doc.preset) return false;
      const t = doc.preset.tables.find(x => x.id === o.id) as unknown as Record<string, unknown> | undefined;
      if (!t) return false;
      // (B57) a table always has a sheet, a range table a range: never removed, a bad one skips the op (a markers table has none)
      if ("sheet" in o.patch && !(typeof o.patch.sheet === "string" && o.patch.sheet)) return false;
      if ("range" in o.patch && !(t.kind === "range" && typeof o.patch.range === "string" && A1RANGE.test(o.patch.range))) return false;
      if ("bind" in o.patch && o.patch.bind !== null && !isTableBind(o.patch.bind)) return false;
      for (const k of TABLE_KEYS) if (k in o.patch) { const v = o.patch[k]; if (v === null) delete t[k]; else t[k] = clone(v); }
      for (const k of TABLE_MAPS) if (k in o.patch) mapMerge(t, k, o.patch[k]);
      return true;
    }
    case "cell.patch": {
      if (typeof o.sheet !== "string" || !o.sheet || typeof o.ref !== "string" || !REF.test(o.ref) || !isObj(o.patch)) return false;
      const sheet = doc.edits[o.sheet] || (doc.edits[o.sheet] = {});
      const e = (sheet[o.ref] || (sheet[o.ref] = {})) as Record<string, unknown>;
      for (const k of CELL_KEYS) if (k in o.patch) { const v = o.patch[k]; if (v === null) delete e[k]; else e[k] = clone(v); }
      if (e.text === undefined) delete e.orig;
      if (!Object.keys(e).length) delete sheet[o.ref];
      if (!Object.keys(sheet).length) delete doc.edits[o.sheet];
      return true;
    }
    case "item.patch": {
      if (typeof o.slide !== "string" || typeof o.id !== "string" || !o.id || o.id === "__proto__" || !doc.preset || (o.patch !== null && !isObj(o.patch))) return false;
      const s = doc.preset.slides.find(x => x.id === o.slide) as unknown as Record<string, unknown> | undefined;
      if (!s) return false;
      const items = (isObj(s.items) ? s.items : {}) as Record<string, Record<string, unknown>>, cur = items[o.id];
      if (o.patch === null) {
        if (!isObj(cur)) return false;
        delete items[o.id];
      } else {
        const p = o.patch;
        if ("kind" in p && !ITEM_KINDS.includes(p.kind as string)) return false;      // an unknown kind (a later page's) is skipped
        if ("box" in p && !isBox(p.box)) return false;                                // every item has a box; a bad one is skipped
        if (!isObj(cur) && !("kind" in p && "box" in p)) return false;                // creating needs a kind and a box
        // (B57) a quoted cell of a text ("text~0") never follows a header: a bind saying so is refused (datarefs.ts)
        if (isObj(p.bind) && Object.entries(p.bind).some(([k, b]) => k.includes("~") && isObj(b) && b.f === true)) return false;
        const it = isObj(cur) ? cur : {};
        for (const k of ITEM_KEYS) if (k in p) { const v = p[k]; if (v === null) delete it[k]; else it[k] = clone(v); }
        for (const k of ITEM_MAPS) if (k in p) mapMerge(it, k, p[k]);
        if (it.kind === "kpi") kpiClean(it);                                          // B54: malformed rows / formats dropped
        items[o.id] = it;
      }
      if (Object.keys(items).length) s.items = items; else delete s.items;
      return true;
    }
    case "style.patch": {
      if (!isObj(o.patch)) return false;
      applyStylePatch(doc.style as Record<string, unknown>, o.patch);
      return true;
    }
    /* 09 §2.8: records fold in Lamport order, so of two slides added after one slide the later lands directly after it
       (the same on every page); `after` naming a slide removed meanwhile adds at the end */
    case "slide.add": {
      if (!doc.preset || !isSlide(o.slide) || (o.after !== null && typeof o.after !== "string")) return false;
      const slides = doc.preset.slides, id = o.slide.id;
      // an id that exists: the first add stays. So ids must be unique per writer (S13.4 makes them from the writer id and
      // its seq, or random): two pages making the same id ("s" + count) would merge two users' slides – the second
      // user's later slide.patch / table.add / item.patch landing on the first user's slide (review of S13.3, 3)
      if (slides.some(x => x.id === id)) return false;
      const at = o.after === null ? 0 : slides.findIndex(x => x.id === o.after) + 1 || slides.length;
      slides.splice(at, 0, clone(o.slide));
      return true;
    }
    case "slide.remove": {
      if (typeof o.id !== "string" || !doc.preset) return false;
      const i = doc.preset.slides.findIndex(x => x.id === o.id);
      if (i < 0) return false;
      doc.preset.slides.splice(i, 1);
      return true;
    }
    case "table.add": {
      if (!doc.preset || !isTable(o.table) || typeof o.slide !== "string") return false;
      const s = doc.preset.slides.find(x => x.id === o.slide), id = o.table.id;
      if (!s) return false;
      const list = Array.isArray(s.tables) ? s.tables : (s.tables = []);
      if (list.includes(id)) return false;                                            // on that slide already
      if (!doc.preset.tables.some(x => x.id === id)) doc.preset.tables.push(clone(o.table));   // an existing def is kept
      const at = typeof o.at === "number" && Number.isInteger(o.at) && o.at >= 0 && o.at <= list.length ? o.at : list.length;
      list.splice(at, 0, id);
      return true;
    }
    case "table.remove": {
      if (typeof o.id !== "string" || typeof o.slide !== "string" || !doc.preset) return false;
      const s = doc.preset.slides.find(x => x.id === o.slide), i = s && Array.isArray(s.tables) ? s.tables.indexOf(o.id) : -1;
      if (!s || i < 0) return false;
      s.tables.splice(i, 1);                                                          // its def, notes and free boxes stay
      return true;
    }
    /* 09 §2.5 (4.9, B37): `name` on a missing id creates the version, appended (or at `at`), with `hide: {}`; null deletes it; `hide`
       and `drop` merge per sheet (a sheet's list replaced whole: of two writers on one sheet the later wins, Lamport) */
    case "version.patch": {
      if (!okId(o.id) || !doc.preset || (o.patch !== null && !isObj(o.patch))) return false;
      const list = doc.preset.versions || [], i = list.findIndex(v => v && v.id === o.id), p = o.patch;
      if (p === null) {
        if (i < 0) return false;
        list.splice(i, 1);
        if (list.length) doc.preset.versions = list; else delete doc.preset.versions;
        return true;
      }
      if ("name" in p && !okName(p.name)) return false;                               // a version always has a name
      if (i < 0 && !("name" in p)) return false;                                      // creating needs one
      const v = (i < 0 ? { id: o.id, name: p.name, hide: {} } : list[i]) as unknown as Record<string, unknown>;
      if ("name" in p) v.name = p.name;
      if ("hide" in p) { if (p.hide === null) v.hide = {}; else sheetMerge(v, "hide", p.hide); if (!isObj(v.hide)) v.hide = {}; }
      if ("drop" in p) { if (p.drop === null) delete v.drop; else sheetMerge(v, "drop", p.drop); if (isObj(v.drop) && !Object.keys(v.drop).length) delete v.drop; }
      // a create goes at `at` (0..length, an integer: the undo of a delete puts the version back at its place, AUDIT-3
      // UNDO-1), else at the end
      if (i < 0) { const at = typeof o.at === "number" && Number.isInteger(o.at) && o.at >= 0 && o.at <= list.length ? o.at : list.length; list.splice(at, 0, v as never); doc.preset.versions = list; }
      return true;
    }
  }
  return false;
}
/* version.patch (4.9, B37): a version's name, its emptied cells and its deleted rows / columns per sheet */
const VERSION_KEYS = ["name", "hide", "drop"] as const;
const okName = (x: unknown): x is string => typeof x === "string" && !!x.trim();
/** a version's per-sheet lists (`hide`, `drop`): each sheet's list of strings replaced whole, null removes the sheet; an
    entry that is no list of strings is ignored */
function sheetMerge(v: Record<string, unknown>, key: string, patch: unknown) {
  if (!isObj(patch)) return;
  const m = (isObj(v[key]) ? v[key] : {}) as Record<string, unknown>;
  for (const [sheet, x] of Object.entries(patch)) {
    if (sheet === "__proto__") continue;
    if (x === null) delete m[sheet];
    else if (Array.isArray(x) && x.every(s => typeof s === "string")) { if (x.length) m[sheet] = [...x]; else delete m[sheet]; }
  }
  v[key] = m;
}
const okId = (x: unknown): x is string => typeof x === "string" && !!x && x !== "__proto__";
/** a slide definition slide.add applies: an id, a type this page draws, a list of distinct table ids (a table twice on
    a slide: table.remove would take off one copy only) (other keys kept whole) */
const isSlide = (s: unknown): s is SlideDef => isObj(s) && okId(s.id) && SLIDE_TYPES.includes(s.type as string) && Array.isArray(s.tables) && s.tables.every(okId) && new Set(s.tables).size === s.tables.length;
/** a table definition table.add applies: an id, a sheet, a kind this page reads with the fields that kind needs – a
    range's `range`, markers' `anchor` and `index` (resolveTable copes without them, but the table would draw nothing)
    (other keys kept whole) */
const isTable = (t: unknown): t is TableDef => isObj(t) && okId(t.id) && typeof t.sheet === "string" && !!t.sheet && TABLE_KINDS.includes(t.kind as string)
  && (t.kind === "range" ? typeof t.range === "string" && !!t.range : typeof t.anchor === "string" && !!t.anchor && Number.isInteger(t.index) && (t.index as number) >= 0);
/** an op this page knows whole: a known type whose patch holds only keys this version applies, and an item of a known
    kind. applyOp skips the rest – a later version's op, key or kind – and a snapshot folded without it would lose it for
    every page: a 4.1 page did so with 4.3's charts and 4.4's free layouts (AUDIT-2 DATA-7). So a page never compacts
    while a record holds an op it does not know whole (sync/docsync.ts candidate); a newer page will */
export function knownOp(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>, p = o.patch;
  const only = (...keys: readonly (readonly string[])[]) => isObj(p) && Object.keys(p).every(k => keys.some(ks => ks.includes(k)));
  switch (o.op) {
    case "preset.set": return true;
    case "slide.patch": return only(SLIDE_KEYS, SLIDE_MAPS);
    case "table.patch": return only(TABLE_KEYS, TABLE_MAPS);
    case "cell.patch": return only(CELL_KEYS);
    case "style.patch": return only(STYLE_KEYS, STYLE_MAPS);
    case "item.patch": return p === null || (only(ITEM_KEYS, ITEM_MAPS) && (!("kind" in (p as object)) || ITEM_KINDS.includes((p as Record<string, unknown>).kind as string)) && marksKnown((p as Record<string, unknown>).marks));
    // (the definitions are kept whole, keys this page does not draw too; a later page's slide type or table kind is not)
    case "slide.add": return isObj(o.slide) && SLIDE_TYPES.includes(o.slide.type as string);
    case "table.add": return isObj(o.table) && TABLE_KINDS.includes(o.table.kind as string);
    case "slide.remove": case "table.remove": return true;
    case "version.patch": return p === null || only(VERSION_KEYS);
  }
  return false;
}
/* ---- the per-deck format guard (ADR-019, docs/next/09 §1) ----
   The share runs 4.0.0, and a 4.0–4.5 page folds an op, key or item kind it does not know as nothing (AUDIT-2 DATA-7).
   A deck that receives or holds anything 4.0.0 does not apply whole is raised to snapshot format 5 first (DocSync
   upgrade): no 4.0–4.5 helper then reads, compacts or appends to it. 4.0.0's lists, FROZEN (git show
   v4.0.0:core/src/model/ops.ts:6-12) – never add to them: later keys go to the lists at the top, and are then
   needsV5 by themselves. */
const V40_SLIDE = ["title", "subtitle", "date", "note", "logo", "layout", "align", "scale", "valign", "subs", "notes", "fmt", "sizes"];
const V40_TABLE = ["name", "gridH", "gridV", "cols", "rows", "scales", "merges", "sizes"];
const V40_CELL = ["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role"];
const V40_STYLE = ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble", "pn", "footer", "theme", "text", "colors", "designs"];
/** what a document holds that 4.0.0 does not know (4.3 items; 4.4 free, cellGrid, borders; 4.5 looks; 4.6 hide (S13.6,
    B47: the slide hidden per design, `hide: {glass: true}`, merged per design); 09 §2.5's slide `hidden` (F11: hidden
    rows / columns, `"t3:r12": true` – a different key), a version's drop, cell valign / num): a deck holding a non-empty
    one is format 5 */
const V5_SLIDE = ["items", "free", "looks", "hide", "hidden"], V5_TABLE = ["cellGrid", "borders"], V5_VERSION = ["drop"], V5_CELL = ["valign", "num"];
/** keys of a text box (an entry of a slide's `notes` map) 4.0.0 does not draw (B49: a comment's border). 4.0 keeps a notes
    entry whole, but would draw the box without them – and its dialogs would write them back unseen: format 5 */
const V5_NOTE = ["frame"];
const outside = (p: unknown, known: readonly string[]) => isObj(p) && Object.keys(p).some(k => !known.includes(k));
const holds = (x: unknown, keys: readonly string[]) => isObj(x) && keys.some(k => x[k] != null && x[k] !== false && !(isObj(x[k]) && !Object.keys(x[k] as object).length));
/** an automated comment 4.0.0 does not write (B50: the macro's text, `mode: "macro"`, and its `sections`): 4.0 would write
    it as a summary (its commentText knows "sections" and "summary" only) and its dialog would drop the sections */
const V5_AUTO = ["sections"], autoNew = (n: unknown) => isObj(n) && isObj(n.auto) && (n.auto.mode === "macro" || holds(n.auto, V5_AUTO));
/** a slide's notes map (or a slide.patch's) with an entry holding a V5_NOTE key or a B50 comment */
const notesHold = (notes: unknown) => isObj(notes) && Object.values(notes).some(n => holds(n, V5_NOTE) || autoNew(n));
/** an op 4.0.0 does not apply whole (it would skip it, or a key of it): the deck must be format 5 before the op is
    appended. item.patch (4.3), every op 4.0 lacks (slide.add / remove, table.add / remove, version.patch of 4.6 and
    any later one) and every key outside 4.0's lists (free, looks, cellGrid, borders, hidden, valign, num …). A
    preset.set 4.0 keeps whole (4.2's `links` too: AUDIT-2 §6) – unless the preset holds such content */
export function needsV5(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case "preset.set": return isObj(o.preset) && presetNeedsV5(o.preset);
    case "slide.patch": return outside(o.patch, V40_SLIDE) || (isObj(o.patch) && notesHold(o.patch.notes));
    case "table.patch": return outside(o.patch, V40_TABLE);
    case "cell.patch": return outside(o.patch, V40_CELL);
    case "style.patch": return outside(o.patch, V40_STYLE);
  }
  return true;
}
function presetNeedsV5(p: Record<string, unknown>): boolean {
  const some = (k: string, keys: readonly string[]) => Array.isArray(p[k]) && (p[k] as unknown[]).some(x => holds(x, keys));
  return some("slides", V5_SLIDE) || some("tables", V5_TABLE) || some("versions", V5_VERSION)
    || (Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && notesHold(s.notes)));
}
/** the same on a document: it holds what 4.0.0 does not know (a deck with it is written as format 5, fold.ts
    nextSnapshot; a 4.6 page opening such a deck at format 4 raises it at once) */
export function docNeedsV5(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  if (isObj(doc.preset) && presetNeedsV5(doc.preset as unknown as Record<string, unknown>)) return true;
  for (const sheet of Object.values(doc.edits || {})) for (const e of Object.values(sheet || {})) if (holds(e, V5_CELL)) return true;
  return false;
}
/* ---- format 6 (ADR-019 amendment of 2026-10-22, AUDIT-3 COMPAT-1) ----
   4.6.0–4.8.0 read format 5 but fold 4.9's objects as nothing: their wizard's whole preset.set then erases a version's
   `drop` and the slides' `hidden`, and their exports show the deleted / hidden rows. A deck that receives or holds
   anything 4.8.0 does not apply whole is raised to format 6 the same way as to 5 (marker incident-format-6.json – an
   incident to every 4.0–4.8 helper –, the wait, tail, CAS, the Lamport jump). 4.8.0's lists, FROZEN (git show
   v4/M15-lines-icons:core/src/model/ops.ts:6-23, its knownOp) – never add to them: later keys go to the lists at the
   top, and are then needsV6 by themselves. */
const V48_SLIDE = [...V40_SLIDE, "free", "looks", "hide"], V48_TABLE = [...V40_TABLE, "cellGrid", "borders"];
const V48_CELL = V40_CELL, V48_STYLE = V40_STYLE;          // (4.8.0's cell and style keys are 4.0.0's)
const V48_ITEM = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail", "stack", "gap", "overlap", "legendAt", "frame", "titleRule", "plot",
  "route", "a", "b", "mid", "bend", "ends", "style", "stroke", "colors", "fmt", "sers", "groups", "axes", "marks", "legendHide", "titleFmt"];
const V48_ITEM_KINDS = ["chart", "shape", "line"], V48_SLIDE_TYPES = ["cover", "index", "content"], V48_TABLE_KINDS = ["markers", "range"];
/** what a document holds that 4.8.0 does not know (4.9: a slide's hidden rows / columns, a version's deleted ones, cell
    valign / num): a deck holding a non-empty one is format 6 */
const V6_SLIDE = ["hidden"], V6_VERSION = ["drop"], V6_CELL = ["valign", "num"];
/** (B51) the boxes of a free layout 4.8.0 does not draw: the contents slide's title and list ("c:title", "c:toc"). 4.6–4.8
    keep a free entry whole but draw the contents where the design puts it – and their exports would too: a free
    layout (a slide.patch's `free`, a slide's) holding one is format 6 */
const V6_FREE = "c:";
const freeHoldsV6 = (free: unknown) => isObj(free) && Object.values(free).some(f => isObj(f) && isObj(f.items) && Object.keys(f.items).some(k => k.startsWith(V6_FREE) && (f.items as Record<string, unknown>)[k] != null));
/** an op 4.8.0 does not apply whole: the deck must be format 6 before it is appended. version.patch (4.9: 4.6–4.8 skip
    it, so its versions – name and hide too – would be lost to their wizard's preset.set) and every op 4.8 lacks; every
    key outside 4.8's lists (hidden, valign, num …); a slide.add / preset.set carrying such content */
export function needsV6(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>, p = o.patch;
  switch (o.op) {
    case "preset.set": return isObj(o.preset) && presetNeedsV6(o.preset);
    case "slide.patch": return outside(p, V48_SLIDE) || (isObj(p) && freeHoldsV6(p.free));
    case "table.patch": return outside(p, V48_TABLE);
    case "cell.patch": return outside(p, V48_CELL);
    case "style.patch": return outside(p, V48_STYLE);
    case "item.patch": return p !== null && (!isObj(p) || outside(p, V48_ITEM) || ("kind" in p && !V48_ITEM_KINDS.includes(p.kind as string)));
    case "slide.add": return !isObj(o.slide) || !V48_SLIDE_TYPES.includes(o.slide.type as string) || holds(o.slide, V6_SLIDE) || freeHoldsV6(o.slide.free);
    case "table.add": return !isObj(o.table) || !V48_TABLE_KINDS.includes(o.table.kind as string);
    case "slide.remove": case "table.remove": return false;
  }
  return true;
}
function presetNeedsV6(p: Record<string, unknown>): boolean {
  const some = (k: string, keys: readonly string[]) => Array.isArray(p[k]) && (p[k] as unknown[]).some(x => holds(x, keys));
  return some("slides", V6_SLIDE) || some("versions", V6_VERSION) || (Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && freeHoldsV6(s.free)));
}
/** the same on a document (fold.ts nextSnapshot writes such a deck as format 6; a 4.9 page opening one below 6 raises it) */
export function docNeedsV6(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  if (isObj(doc.preset) && presetNeedsV6(doc.preset as unknown as Record<string, unknown>)) return true;
  for (const sheet of Object.values(doc.edits || {})) for (const e of Object.values(sheet || {})) if (holds(e, V6_CELL)) return true;
  return false;
}
/* ---- format 7 (ADR-019 amendment of 2026-10-22 for B52, 4.10) ----
   4.9.0 keeps a chart's `marks` entries whole but draws only its five kinds (chart-marks.ts `default: continue`): a
   reference line, a gap arrow or change pills would vanish from its screen and exports, and its panel would offer to
   change or remove marks it cannot show. A deck that receives or holds one is raised to format 7 exactly as to 6 (marker
   incident-format-7.json – an incident to every 4.0–4.9 helper, whose _is_incident excepts the format-5 and format-6
   markers only –, the wait, tail, CAS, the Lamport jump). 4.9.0's mark kinds and keys, FROZEN (git show
   v4/release-4.9.0:core/src/model/types.ts ChartMark) – never add to them: later ones go to MARK_KINDS / MARK_KEYS at the
   top, and are then needsV7 by themselves. */
const V49_MARK_KINDS = ["arrow", "line", "band", "icon", "text"], V49_MARK_KEYS = ["kind", "a", "b", "style", "icon", "size", "text", "fmt", "dy"];
/** a mark entry 4.9.0 does not draw whole: a later kind, or a later key on any kind (a switched-off arrow's `off`) */
const markV7 = (k: unknown) => isObj(k) && (!V49_MARK_KINDS.includes(k.kind as string) || Object.keys(k).some(x => !V49_MARK_KEYS.includes(x)));
const marksV7 = (m: unknown) => isObj(m) && Object.values(m).some(markV7);
/** a slide's items map (a slide.add's, a preset's slide's) holding a chart with such a mark */
const itemsV7 = (items: unknown) => isObj(items) && Object.values(items).some(it => isObj(it) && marksV7(it.marks));
/** an op 4.9.0 does not apply whole: the deck must be format 7 before it is appended – an item.patch whose marks (or the
    whole item it writes) hold a 4.10 mark, a slide.add or preset.set carrying one. Removing such a mark (its entry null)
    is not: 4.9 applies that whole */
export function needsV7(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>, p = o.patch;
  switch (o.op) {
    case "item.patch": return isObj(p) && marksV7(p.marks);
    case "slide.add": return isObj(o.slide) && itemsV7(o.slide.items);
    case "preset.set": return isObj(o.preset) && presetNeedsV7(o.preset);
  }
  return false;
}
const presetNeedsV7 = (p: Record<string, unknown>) => Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && itemsV7(s.items));
/** the same on a document (fold.ts nextSnapshot writes such a deck as format 7; a 4.10 page opening one below 7 raises it) */
export function docNeedsV7(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  return isObj(doc.preset) && presetNeedsV7(doc.preset as unknown as Record<string, unknown>);
}
/* ---- format 8 (ADR-019 amendment of 2026-10-22 for B53, 4.11) ----
   4.10.x keeps a chart's maps whole but draws B53's label places, axis cells and dragged labels its own way: a series'
   "auto" labels at the right, a point's own place, a reference line's label "below" / "inside" at the right end, a gap's
   label side and direction, the pills' new rows, an axis's bounds from cells (as automatic ones) – and it skips the item's
   `nudge` (its compaction would lose it). A deck that receives or holds one is raised to format 8 exactly as to 7 (marker
   incident-format-8.json – an incident to every 4.0–4.10 helper –, the wait, tail, CAS, the Lamport jump). 4.10.1's
   lists, FROZEN (git show c504829:core/src/model/ops.ts ITEM_KEYS / ITEM_MAPS / MARK_KEYS, types.ts ChartAxis, ChartSeries
   labels.pos and points, ChartMark pos) – never add to them: later keys and values go to the lists at the top, and are
   then needsV8 by themselves. */
const V410_ITEM = V48_ITEM;          // (4.10's item keys and maps are 4.8's)
const V410_MARK_KEYS = ["kind", "a", "b", "style", "icon", "size", "text", "fmt", "dy",
  "value", "name", "axis", "show", "pos", "ref", "caption", "num", "pct", "abs", "signs", "pairs", "off"];
/** the `pos` values 4.10.1 draws, per mark kind (unset is always fine) */
const V410_MARK_POS: Record<string, string[]> = { ref: ["right", "left", "above"], gap: ["right", "left"], change: ["axis", "line"] };
const V410_AXIS_KEYS = ["show", "min", "max", "step", "num", "title", "grid", "fmt", "line"];
const V410_LABEL_POS = ["above", "below", "left", "right", "center", "inEnd", "inBase", "outEnd"];
const V410_POINT_KEYS = ["color", "marker", "label", "total"];
const markV8 = (k: unknown) => isObj(k) && (Object.keys(k).some(x => !V410_MARK_KEYS.includes(x))
  || (k.pos !== undefined && k.pos !== null && !!V410_MARK_POS[k.kind as string] && !V410_MARK_POS[k.kind as string].includes(k.pos as string)));
const serV8 = (s: unknown) => isObj(s) && ((isObj(s.labels) && s.labels.pos !== undefined && s.labels.pos !== null && !V410_LABEL_POS.includes(s.labels.pos as string))
  || (isObj(s.points) && Object.values(s.points).some(p => isObj(p) && Object.keys(p).some(x => !V410_POINT_KEYS.includes(x)))));
const axisV8 = (a: unknown) => isObj(a) && Object.keys(a).some(x => !V410_AXIS_KEYS.includes(x) && a[x] !== null && !(isObj(a[x]) && !Object.keys(a[x] as object).length));
const some = (m: unknown, f: (x: unknown) => boolean) => isObj(m) && Object.values(m).some(f);
/** an item (or an item.patch) holding what 4.10.1 does not draw whole: a later key (`nudge`), a later series label place
    or point key, axis key (`cells`), mark key or place */
const itemV8 = (p: unknown) => isObj(p) && (Object.keys(p).some(k => !V410_ITEM.includes(k) && p[k] !== null && !(isObj(p[k]) && Object.values(p[k] as object).every(x => x === null))) || some(p.marks, markV8) || some(p.sers, serV8) || some(p.axes, axisV8));
const itemsV8 = (items: unknown) => some(items, itemV8);
/** an op 4.10.1 does not apply or draw whole: the deck must be format 8 before it is appended – an item.patch writing such
    content, a slide.add or preset.set carrying it. Removing it (null) is not: 4.10 applies that whole */
export function needsV8(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>, p = o.patch;
  switch (o.op) {
    case "item.patch": return itemV8(p);
    case "slide.add": return isObj(o.slide) && itemsV8(o.slide.items);
    case "preset.set": return isObj(o.preset) && presetNeedsV8(o.preset);
  }
  return false;
}
const presetNeedsV8 = (p: Record<string, unknown>) => Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && itemsV8(s.items));
/** the same on a document (fold.ts nextSnapshot writes such a deck as format 8; a 4.11 page opening one below 8 raises it) */
export function docNeedsV8(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  return isObj(doc.preset) && presetNeedsV8(doc.preset as unknown as Record<string, unknown>);
}
/* ---- format 9 (ADR-019 amendment of 2026-10-23 for B54, 4.13) ----
   4.12.0 skips a "kpi" item whole (an unknown kind: its item.patch is not applied) and applies a chart's B54 keys as
   nothing (the stats row, the corner tag, the separator, the momentum row, the long table's filter: its applyOp copies
   only the keys it lists, so its compaction would lose them and its exports draw the chart unfiltered). A deck that
   receives or holds one is raised to format 9 exactly as to 8 (marker incident-format-9.json – an incident to every
   4.0–4.12 helper –, the wait, tail, CAS, the Lamport jump). 4.12.0's lists, FROZEN (git show 5eab103:core/src/model/ops.ts
   ITEM_KEYS / ITEM_MAPS / ITEM_KINDS) – never add to them: later keys and kinds go to the lists at the top, and are then
   needsV9 by themselves. (4.12's mark, series, axis and point keys are 4.11's: needsV8 covers them.) */
const V412_ITEM = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail", "stack", "gap", "overlap", "legendAt", "frame", "titleRule", "plot",
  "route", "a", "b", "mid", "bend", "ends", "style", "stroke",
  "colors", "fmt", "sers", "groups", "axes", "marks", "legendHide", "titleFmt", "nudge"];
const V412_ITEM_KINDS = ["chart", "shape", "line"];
/** an item (or an item.patch) holding what 4.12.0 does not apply whole: a later kind, or a later key set – not null, and
    for a MAP key (merged per entry: stats, moms) not an empty or all-null map (a removal). A plain key's {} is content
    (`sep: {}` draws the design's hairline) */
const itemV9 = (p: unknown) => isObj(p) && ((typeof p.kind === "string" && !V412_ITEM_KINDS.includes(p.kind))
  || Object.keys(p).some(k => !V412_ITEM.includes(k) && p[k] !== null && p[k] !== undefined
    && !((ITEM_MAPS as readonly string[]).includes(k) && isObj(p[k]) && Object.values(p[k] as object).every(x => x === null))));
const itemsV9 = (items: unknown) => some(items, itemV9);
/** an op 4.12.0 does not apply whole: the deck must be format 9 before it is appended – an item.patch creating a KPI card
    or writing a B54 key, a slide.add or preset.set carrying one. Removing it (null) is not: 4.12 applies that whole
    (an item.patch null on a KPI card deletes it there too) */
export function needsV9(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case "item.patch": return itemV9(o.patch);
    case "slide.add": return isObj(o.slide) && itemsV9(o.slide.items);
    case "preset.set": return isObj(o.preset) && presetNeedsV9(o.preset);
  }
  return false;
}
const presetNeedsV9 = (p: Record<string, unknown>) => Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && itemsV9(s.items));
/** the same on a document (fold.ts nextSnapshot writes such a deck as format 9; a 4.13 page opening one below 9 raises it) */
export function docNeedsV9(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  return isObj(doc.preset) && presetNeedsV9(doc.preset as unknown as Record<string, unknown>);
}
/* ---- format 10 (ADR-019 amendment of 2026-10-23 for B55, 4.14) ----
   4.13.1 applies a chart's B55 keys as nothing (the subtitle, the budget-achievement chart's `progress`: its applyOp copies
   only the keys it lists, so its compaction would lose them) and draws a chart of type "progress" as a pie of `values`.
   A deck that receives or holds one is raised to format 10 exactly as to 9 (marker incident-format-10.json – an incident
   to every 4.0–4.13 helper –, the wait, tail, CAS, the Lamport jump). 4.13.1's lists, FROZEN (git show 87f0951:core/src/model/ops.ts
   ITEM_KEYS / ITEM_MAPS / ITEM_KINDS; types.ts ChartType) – never add to them: later keys, kinds and chart types go to
   the lists at the top, and are then needsV10 by themselves. */
const V4131_ITEM = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail", "stack", "gap", "overlap", "legendAt", "frame", "titleRule", "plot",
  "route", "a", "b", "mid", "bend", "ends", "style", "stroke",
  "filter", "tag", "sep", "momLabel", "head", "cur", "rows", "good", "num",
  "colors", "fmt", "sers", "groups", "axes", "marks", "legendHide", "titleFmt", "nudge", "stats", "moms"];
const V4131_ITEM_KINDS = ["chart", "shape", "line", "kpi"];
const V4131_CHART_TYPES = ["pie", "donut", "bar", "column", "line", "area", "scatter", "waterfall", "combo"];
/* 4.13.1's item contents, FROZEN (git show 87f0951:core/src/model/{ops,types,kpi}.ts) – the keys and the values of the
   objects inside an item that it draws: a later key or value inside one of them (a 4.14 axis, series, label, point,
   mark, stat, momentum chip, KPI row, tag, filter, separator or text-format key, or a value of an enum 4.13.1 does not
   know) is needsV10 too. A schema: `k` the keys an object may hold (each with its own schema, or 0 = any value), `m` the
   schema of every entry of a map, `a` of every element of an array, `e` the strings allowed. A primitive passes unless
   `e` lists the strings; null / undefined is a removal and never counts. Never edit these: a later format freezes its own */
type Sch = { k?: Record<string, Sch | 0>; m?: Sch; a?: Sch; e?: string[] };
const V4131_REF: Sch = { k: { sheet: 0, table: 0, range: 0 } };
const V4131_FMT: Sch = { k: { font: 0, size: 0, b: 0, i: 0, color: 0, align: { e: ["left", "center", "right"] }, lh: 0, /* a shape's */ valign: { e: ["top", "middle", "bottom"] }, pad: 0 } };
const V4131_DASH: Sch = { e: ["solid", "dashed", "dotted", "dashdot"] };
const V4131_LINE: Sch = { k: { color: 0, w: 0, dash: V4131_DASH }, e: ["none"] };
const V4131_HEAD: Sch = { e: ["none", "arrow", "triangle", "stealth", "oval", "diamond", "bar"] };
const V4131_AT: Sch = { k: { s: 0, i: 0, g: 0, edge: { e: ["start", "end"] }, x: 0, y: 0, axis: { e: ["y", "y2"] } } };
const V4131_GOOD: Sch = { e: ["up", "down", "neutral"] };
const V4131_AXIS: Sch = { k: { show: 0, min: 0, max: 0, step: 0, num: 0, title: 0, grid: 0, fmt: V4131_FMT, line: V4131_LINE, cells: { k: { min: V4131_REF, max: V4131_REF, step: V4131_REF } } } };
const V4131_SERIES: Sch = { k: { n: 0, name: V4131_REF, vals: { a: V4131_REF }, xs: { a: V4131_REF }, target: { a: V4131_REF }, group: 0,
  type: { e: ["column", "bar", "line", "area", "scatter"] }, axis: { e: ["y", "y2"] }, stack: 0, color: 0, line: V4131_LINE, fill: { e: ["solid", "none"] }, smooth: 0,
  marker: { k: { shape: { e: ["circle", "square", "diamond", "triangle", "none"] }, size: 0, color: 0 } },
  labels: { k: { show: { a: { e: ["value", "name", "category", "percent", "ofTarget"] } }, pos: { e: ["above", "below", "left", "right", "center", "inEnd", "inBase", "outEnd", "auto"] }, fmt: V4131_FMT, num: 0 } },
  points: { m: { k: { color: 0, marker: 0, label: 0, total: 0, pos: { e: ["above", "below", "left", "right", "center"] } } } }, hide: 0 } };
const V4131_MARK: Sch = { k: { kind: { e: ["arrow", "line", "band", "icon", "text", "ref", "gap", "change"] }, a: V4131_AT, b: { ...V4131_AT, e: ["floor", "ceiling"] },
  style: { k: { color: 0, w: 0, dash: V4131_DASH, heads: { k: { a: V4131_HEAD, b: V4131_HEAD, size: { e: ["s", "m", "l"] } } } } }, icon: 0, size: 0, text: 0, fmt: V4131_FMT, dy: 0,
  value: V4131_REF, name: V4131_REF, axis: { e: ["y", "y2"] }, show: { e: ["both", "name", "value", "none"] }, pos: { e: ["right", "left", "above", "below", "inside", "axis", "line", "point"] },
  ref: 0, caption: 0, num: 0, pct: 0, abs: 0, signs: { k: { pos: 0, neg: 0, zero: 0 }, e: ["fixed"] }, pairs: { e: ["all", "last"] }, off: 0,
  labelSide: { e: ["right", "left"] }, from: { e: ["line", "point"] }, capPos: { e: ["below", "above", "left", "right"] } } };
/** what 4.13.1 reads inside an item's keys (the keys themselves: V4131_ITEM) */
const V4131_INSIDE: Record<string, Sch> = {
  axes: { k: { x: V4131_AXIS, y: V4131_AXIS, y2: V4131_AXIS } },
  sers: { m: V4131_SERIES },
  groups: { m: { k: { n: 0, cats: { ...V4131_REF, a: {} }, divider: V4131_LINE, label: 0 } } },
  marks: { m: V4131_MARK },
  stats: { m: { k: { n: 0, label: 0, src: { e: ["last", "first", "prev", "min", "max", "cell", "ref", "gap", "gapPct"] }, s: 0, ref: 0, cell: V4131_REF, num: 0, signs: 0, good: V4131_GOOD, off: 0 } } },
  moms: { m: { k: { n: 0, vs: { e: ["first", "trough", "peak", "prev", "cell"] }, s: 0, cell: V4131_REF, show: { e: ["abs", "pct", "both"] }, caption: 0, num: 0, good: V4131_GOOD, off: 0 } } },
  rows: { a: { k: { src: { k: { cell: V4131_REF, ref: V4131_REF, mode: { e: ["pct", "abs", "both"] } } }, label: 0, good: V4131_GOOD, num: 0 } } },
  head: V4131_REF, cur: V4131_REF, good: V4131_GOOD,
  tag: { k: { text: V4131_REF, color: 0 } }, filter: { k: { by: V4131_REF, eq: V4131_REF } }, sep: { k: { color: 0, w: 0, dash: V4131_DASH } },
  titleFmt: V4131_FMT, fmt: V4131_FMT, nudge: { m: { k: { dx: 0, dy: 0 } } },
  /* (B57 review of this list: 4.13.1's two top-level references, read as a DataRef – a later key inside them is beyond it too) */
  values: V4131_REF, labels: V4131_REF,
};
/** a value holding what its 4.13.1 schema does not (a removal – null – never does) */
function beyond(v: unknown, sc: Sch | 0): boolean {
  if (v === null || v === undefined || sc === 0) return false;
  if (typeof v === "string") return !!sc.e && !sc.e.includes(v);
  if (Array.isArray(v)) return sc.a ? v.some(x => beyond(x, sc.a!)) : false;
  if (!isObj(v)) return false;
  if (sc.m) return Object.values(v).some(x => beyond(x, sc.m!));
  if (!sc.k) return false;
  return Object.entries(v).some(([k, x]) => x !== null && x !== undefined && (!(k in sc.k!) || beyond(x, sc.k![k])));
}
/** (4.14, B55) the budget-achievement chart's `progress` as 4.14 draws it – the list a later format freezes (a key or value
    outside it is that format's) */
export const V414_PROGRESS: Sch = { k: { vals: { a: V4131_REF }, targets: { a: V4131_REF }, cats: { ...V4131_REF, a: {} }, table: { k: { by: V4131_REF, val: V4131_REF, target: V4131_REF } },
  fill: 0, track: 0, overFill: 0, over: { e: ["none", "color", "mark"] },
  pct: { k: { off: 0, num: 0, fmt: V4131_FMT } }, cat: { k: { off: 0, caps: 0, fmt: V4131_FMT } },
  gap: { k: { off: 0, over: 0, under: 0, sign: { e: ["over", "both", "none"] }, num: 0, fmt: V4131_FMT } } } };
/** an item (or an item.patch) holding what 4.13.1 does not apply or draw whole: a later kind, a later chart type, a later
    key set (not null; for a MAP key – merged per entry – not an empty or all-null map, a removal; a plain key's {} is
    content: `progress: {}` draws a budget-achievement chart's defaults), or a later key or value inside one of its keys */
const itemV10 = (p: unknown) => isObj(p) && ((typeof p.kind === "string" && !V4131_ITEM_KINDS.includes(p.kind))
  || (typeof p.type === "string" && !V4131_CHART_TYPES.includes(p.type))
  || Object.keys(p).some(k => !V4131_ITEM.includes(k) && p[k] !== null && p[k] !== undefined
    && !((ITEM_MAPS as readonly string[]).includes(k) && isObj(p[k]) && Object.values(p[k] as object).every(x => x === null)))
  || Object.entries(p).some(([k, v]) => k in V4131_INSIDE && beyond(v, V4131_INSIDE[k])));
const itemsV10 = (items: unknown) => some(items, itemV10);
/** an op 4.13.1 does not apply or draw whole: the deck must be format 10 before it is appended – an item.patch writing a
    subtitle or a budget-achievement chart (its `progress`, or its type), a slide.add or preset.set carrying one. Removing
    it (null) is not: 4.13 applies that whole */
export function needsV10(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case "item.patch": return itemV10(o.patch);
    case "slide.add": return isObj(o.slide) && itemsV10(o.slide.items);
    case "preset.set": return isObj(o.preset) && presetNeedsV10(o.preset);
    // (B57) a table's cells moved (its sheet, its range) or its header row bound: 4.13.1 applies none of them
    case "table.patch": return isObj(o.patch) && Object.keys(o.patch).some(k => !V4131_TABLE.includes(k) && (o.patch as Record<string, unknown>)[k] !== null && (o.patch as Record<string, unknown>)[k] !== undefined);
    case "table.add": return isObj(o.table) && tableV10(o.table);
  }
  return false;
}
/* (B57) 4.13.1's table.patch keys, FROZEN (git show 87f0951:core/src/model/ops.ts TABLE_KEYS / TABLE_MAPS) – never add to
   them: a later key is needsV10 by itself */
const V4131_TABLE = ["name", "gridH", "gridV", "cols", "rows", "scales", "merges", "sizes", "cellGrid", "borders"];
/** (B57) a table definition holding what 4.13.1 does not know: the header row as bound */
const tableV10 = (t: unknown) => isObj(t) && holds(t, ["bind"]);
const presetNeedsV10 = (p: Record<string, unknown>) => (Array.isArray(p.slides) && (p.slides as unknown[]).some(s => isObj(s) && itemsV10(s.items)))
  || (Array.isArray(p.tables) && (p.tables as unknown[]).some(tableV10));
/** the same on a document (fold.ts nextSnapshot writes such a deck as format 10; a 4.14 page opening one below 10 raises it) */
export function docNeedsV10(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  return isObj(doc.preset) && presetNeedsV10(doc.preset as unknown as Record<string, unknown>);
}
const isBox = (b: unknown) => isObj(b) && ["x", "y", "w", "h"].every(k => typeof b[k] === "number" && Number.isFinite(b[k])) && (b.w as number) > 0 && (b.h as number) > 0;
/** map merge: null deletes the map; an object sets (replaces) or deletes (null) each entry; empty maps are removed */
function mapMerge(target: Record<string, unknown>, key: string, v: unknown) {
  if (v === null) { delete target[key]; return; }
  if (!isObj(v)) return;
  const m = (isObj(target[key]) ? target[key] : {}) as Record<string, unknown>;
  // (a "__proto__" entry would set the map's prototype, which a saved copy loses: skipped)
  for (const [k, x] of Object.entries(v)) { if (k === "__proto__") continue; if (x === null) delete m[k]; else m[k] = clone(x); }
  if (Object.keys(m).length) target[key] = m; else delete target[key];
}
export function applyStylePatch(style: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const k of STYLE_KEYS) if (k in patch) { const v = patch[k]; if (v === null) delete style[k]; else style[k] = clone(v); }
  for (const k of STYLE_MAPS) if (k in patch) mapMerge(style, k, patch[k]);
}
/** inverse of a patch on `cur` with plain keys and map-merge keys */
function inversePatch(cur: Record<string, unknown>, patch: Record<string, unknown>, maps: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    const p = patch[k];
    if (maps.includes(k) && isObj(p)) {
      const m = (isObj(cur[k]) ? cur[k] : {}) as Record<string, unknown>, inv: Record<string, unknown> = {};
      for (const kk of Object.keys(p)) if (kk !== "__proto__") inv[kk] = m[kk] === undefined ? null : clone(m[kk]);
      out[k] = inv;
    } else if (maps.includes(k) && p !== null) continue;          // a map given as a non-object: mapMerge ignores it, so does its undo
    else out[k] = cur[k] === undefined ? null : clone(cur[k]);
  }
  return out;
}
export function applyOps<T extends Doc>(doc: T, ops: (Op | Record<string, unknown>)[]): { doc: T; applied: number; skipped: number[] } {
  const d = clone(doc); let applied = 0; const skipped: number[] = [];
  ops.forEach((op, i) => { if (applyOp(d, op)) applied++; else skipped.push(i); });
  return { doc: d, applied, skipped };
}

/* ---- inverse operations (undo never reverts somebody else's change) ---- */
export function inverseOf(doc: Doc, op: Op): Op | null {
  switch (op.op) {
    case "preset.set": return { op: "preset.set", preset: clone(doc.preset) };
    case "slide.patch": {
      const s = doc.preset?.slides.find(x => x.id === op.id) as unknown as Record<string, unknown> | undefined; if (!s) return null;
      return { op: "slide.patch", id: op.id, patch: inversePatch(s, op.patch as Record<string, unknown>, SLIDE_MAPS) } as Op;
    }
    case "table.patch": {
      const t = doc.preset?.tables.find(x => x.id === op.id) as unknown as Record<string, unknown> | undefined; if (!t) return null;
      return { op: "table.patch", id: op.id, patch: inversePatch(t, op.patch as Record<string, unknown>, TABLE_MAPS) } as Op;
    }
    case "cell.patch": {
      const e = (doc.edits[op.sheet] || {})[op.ref] || ({} as CellEdit) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      const keys = new Set(Object.keys(op.patch)); if (keys.has("text")) keys.add("orig");
      for (const k of keys) patch[k] = (e as Record<string, unknown>)[k] === undefined ? null : clone((e as Record<string, unknown>)[k]);
      return { op: "cell.patch", sheet: op.sheet, ref: op.ref, patch } as Op;
    }
    case "item.patch": {
      const s = doc.preset?.slides.find(x => x.id === op.slide); if (!s) return null;
      const cur = s.items?.[op.id] as unknown as Record<string, unknown> | undefined;
      // creating: the undo deletes it – unless the create would be skipped (a later page's kind, no valid box: 09 §2.8)
      if (!isObj(cur)) return op.patch && "kind" in op.patch && ITEM_KINDS.includes(op.patch.kind as string) && isBox(op.patch.box) ? { op: "item.patch", slide: op.slide, id: op.id, patch: null } : null;
      return { op: "item.patch", slide: op.slide, id: op.id, patch: op.patch === null ? clone(cur) : inversePatch(cur, op.patch as Record<string, unknown>, ITEM_MAPS) } as Op;
    }
    case "style.patch": return { op: "style.patch", patch: inversePatch(doc.style as Record<string, unknown>, op.patch as Record<string, unknown>, STYLE_MAPS) } as Op;
    // 09 §2.8: an op that would be skipped has no inverse (as above); undo takes off only what the op put there
    case "slide.add": {
      if (!doc.preset || !isSlide(op.slide) || doc.preset.slides.some(x => x.id === op.slide.id)) return null;
      return { op: "slide.remove", id: op.slide.id };
    }
    case "slide.remove": {
      // the removed slide's definition and its previous neighbour (null: it was the first); none when slide.add would
      // skip that definition (a later version's slide type, …): the undo would be a skipped op (review of M13, 4)
      const slides = doc.preset?.slides || [], i = slides.findIndex(x => x.id === op.id); if (i < 0 || !isSlide(slides[i])) return null;
      return { op: "slide.add", slide: clone(slides[i]), after: i ? slides[i - 1].id : null };
    }
    case "table.add": {
      const s = doc.preset?.slides.find(x => x.id === op.slide);
      if (!s || !isTable(op.table) || (s.tables || []).includes(op.table.id)) return null;
      return { op: "table.remove", id: op.table.id, slide: op.slide };          // (a new def stays in preset.tables)
    }
    case "table.remove": {
      // the definition (it stays in preset.tables) and the table's index in the slide's tables
      const s = doc.preset?.slides.find(x => x.id === op.slide), at = s && Array.isArray(s.tables) ? s.tables.indexOf(op.id) : -1;
      const def = doc.preset?.tables.find(x => x.id === op.id);
      if (at < 0 || !def) return null;
      return { op: "table.add", table: clone(def), slide: op.slide, at };
    }
    // create ↔ delete (the undo of a delete re-creates the version at the end), per sheet entry otherwise (09 §2.5)
    case "version.patch": {
      if (!doc.preset || !okId(op.id) || (op.patch !== null && !isObj(op.patch))) return null;
      const vs = doc.preset.versions || [], at = vs.findIndex(v => v && v.id === op.id), cur = vs[at] as unknown as Record<string, unknown> | undefined, p = op.patch;
      if (!cur) return p && okName(p.name) ? { op: "version.patch", id: op.id, patch: null } : null;
      if (p === null) {
        if (!okName(cur.name)) return null;
        const back: Record<string, unknown> = { name: cur.name, hide: clone(isObj(cur.hide) ? cur.hide : {}) };
        if (isObj(cur.drop) && Object.keys(cur.drop).length) back.drop = clone(cur.drop);
        return { op: "version.patch", id: op.id, patch: back, at } as Op;            // back at its place (UNDO-1)
      }
      if ("name" in p && !okName(p.name)) return null;                                 // skipped: no undo
      const out: Record<string, unknown> = {};
      if ("name" in p) out.name = cur.name;
      for (const k of ["hide", "drop"] as const) {
        if (!(k in p)) continue;
        const was = (isObj(cur[k]) ? cur[k] : {}) as Record<string, unknown>, x = p[k];
        // hide: null empties it – its undo puts back each sheet's list; drop: null deletes it – its undo the whole map
        if (x === null) out[k] = k === "drop" && !Object.keys(was).length ? null : clone(was);
        else if (isObj(x)) { const inv: Record<string, unknown> = {}; for (const s of Object.keys(x)) if (s !== "__proto__") inv[s] = was[s] === undefined ? null : clone(was[s]); out[k] = inv; }
      }
      return { op: "version.patch", id: op.id, patch: out } as Op;
    }
  }
  return null;
}
export const emptyDoc = (workbook: string): WorkbookDoc => ({ schema: 3, workbook, rev: 0, preset: null, style: {} as StylePatch, edits: {} });
