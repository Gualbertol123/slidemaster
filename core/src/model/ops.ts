/* Document operations – the ONLY way documents change, and the ONLY implementation of their semantics
   (docs/ARCHITECTURE.md §3; since 4.0 the helper applies none: it stores records of them, model/fold.ts folds
   them). Pinned by shared/ops-vectors.json. */
import type { CellEdit, Op, SlideDef, TableDef, WorkbookDoc, StylePatch } from "./types";

const SLIDE_KEYS = ["title", "subtitle", "date", "note", "logo", "layout", "align", "scale", "valign", "subs"] as const;
const SLIDE_MAPS = ["notes", "fmt", "sizes", "free", "looks", "hide"] as const;
const TABLE_KEYS = ["name", "gridH", "gridV"] as const;
const TABLE_MAPS = ["cols", "rows", "scales", "merges", "sizes", "cellGrid", "borders"] as const;
const CELL_KEYS = ["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role"] as const;
const STYLE_MAPS = ["pn", "footer", "theme", "text", "colors", "designs"] as const;
const STYLE_KEYS = ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const;
/* slide items (07 §2.2): plain keys of both kinds, and the two map-merge keys */
const ITEM_KEYS = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail"] as const;
const ITEM_MAPS = ["colors", "fmt"] as const;
const ITEM_KINDS = ["chart", "shape"];
/* slide.add / table.add (4.6, 09 §2.8): the slide types and table kinds this page draws (a later page's are skipped) */
const SLIDE_TYPES = ["cover", "index", "content"], TABLE_KINDS = ["markers", "range"];
const REF = /^[A-Z]{1,3}[0-9]{1,7}$/;
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
        const it = isObj(cur) ? cur : {};
        for (const k of ITEM_KEYS) if (k in p) { const v = p[k]; if (v === null) delete it[k]; else it[k] = clone(v); }
        for (const k of ITEM_MAPS) if (k in p) mapMerge(it, k, p[k]);
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
  }
  return false;
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
    case "item.patch": return p === null || (only(ITEM_KEYS, ITEM_MAPS) && (!("kind" in (p as object)) || ITEM_KINDS.includes((p as Record<string, unknown>).kind as string)));
    // (the definitions are kept whole, keys this page does not draw too; a later page's slide type or table kind is not)
    case "slide.add": return isObj(o.slide) && SLIDE_TYPES.includes(o.slide.type as string);
    case "table.add": return isObj(o.table) && TABLE_KINDS.includes(o.table.kind as string);
    case "slide.remove": case "table.remove": return true;
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
const outside = (p: unknown, known: readonly string[]) => isObj(p) && Object.keys(p).some(k => !known.includes(k));
const holds = (x: unknown, keys: readonly string[]) => isObj(x) && keys.some(k => x[k] != null && x[k] !== false && !(isObj(x[k]) && !Object.keys(x[k] as object).length));
/** an op 4.0.0 does not apply whole (it would skip it, or a key of it): the deck must be format 5 before the op is
    appended. item.patch (4.3), every op 4.0 lacks (slide.add / remove, table.add / remove, version.patch of 4.6 and
    any later one) and every key outside 4.0's lists (free, looks, cellGrid, borders, hidden, valign, num …). A
    preset.set 4.0 keeps whole (4.2's `links` too: AUDIT-2 §6) – unless the preset holds such content */
export function needsV5(op: Op | Record<string, unknown>): boolean {
  const o = op as Record<string, unknown>;
  switch (o.op) {
    case "preset.set": return isObj(o.preset) && presetNeedsV5(o.preset);
    case "slide.patch": return outside(o.patch, V40_SLIDE);
    case "table.patch": return outside(o.patch, V40_TABLE);
    case "cell.patch": return outside(o.patch, V40_CELL);
    case "style.patch": return outside(o.patch, V40_STYLE);
  }
  return true;
}
function presetNeedsV5(p: Record<string, unknown>): boolean {
  const some = (k: string, keys: readonly string[]) => Array.isArray(p[k]) && (p[k] as unknown[]).some(x => holds(x, keys));
  return some("slides", V5_SLIDE) || some("tables", V5_TABLE) || some("versions", V5_VERSION);
}
/** the same on a document: it holds what 4.0.0 does not know (a deck with it is written as format 5, fold.ts
    nextSnapshot; a 4.6 page opening such a deck at format 4 raises it at once) */
export function docNeedsV5(doc: Pick<WorkbookDoc, "preset" | "edits">): boolean {
  if (isObj(doc.preset) && presetNeedsV5(doc.preset as unknown as Record<string, unknown>)) return true;
  for (const sheet of Object.values(doc.edits || {})) for (const e of Object.values(sheet || {})) if (holds(e, V5_CELL)) return true;
  return false;
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
      for (const kk of Object.keys(p)) inv[kk] = m[kk] === undefined ? null : clone(m[kk]);
      out[k] = inv;
    } else out[k] = cur[k] === undefined ? null : clone(cur[k]);
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
      if (!isObj(cur)) return op.patch && "kind" in op.patch ? { op: "item.patch", slide: op.slide, id: op.id, patch: null } : null;
      return { op: "item.patch", slide: op.slide, id: op.id, patch: op.patch === null ? clone(cur) : inversePatch(cur, op.patch as Record<string, unknown>, ITEM_MAPS) } as Op;
    }
    case "style.patch": return { op: "style.patch", patch: inversePatch(doc.style as Record<string, unknown>, op.patch as Record<string, unknown>, STYLE_MAPS) } as Op;
    // 09 §2.8: an op that would be skipped has no inverse (as above); undo takes off only what the op put there
    case "slide.add": {
      if (!doc.preset || !isSlide(op.slide) || doc.preset.slides.some(x => x.id === op.slide.id)) return null;
      return { op: "slide.remove", id: op.slide.id };
    }
    case "slide.remove": {
      // the removed slide's definition and its previous neighbour (null: it was the first)
      const slides = doc.preset?.slides || [], i = slides.findIndex(x => x.id === op.id); if (i < 0) return null;
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
  }
  return null;
}
export const emptyDoc = (workbook: string): WorkbookDoc => ({ schema: 3, workbook, rev: 0, preset: null, style: {} as StylePatch, edits: {} });
