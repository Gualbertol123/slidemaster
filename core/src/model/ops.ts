/* Document operations – the ONLY way documents change, and the ONLY implementation of their semantics
   (docs/ARCHITECTURE.md §3; since 4.0 the helper applies none: it stores records of them, model/fold.ts folds
   them). Pinned by shared/ops-vectors.json. */
import type { CellEdit, Op, WorkbookDoc, StylePatch } from "./types";

const SLIDE_KEYS = ["title", "subtitle", "date", "note", "logo", "layout", "align", "scale", "valign", "subs"] as const;
const SLIDE_MAPS = ["notes", "fmt", "sizes", "free"] as const;
const TABLE_KEYS = ["name", "gridH", "gridV"] as const;
const TABLE_MAPS = ["cols", "rows", "scales", "merges", "sizes"] as const;
const CELL_KEYS = ["text", "orig", "font", "sz", "b", "i", "color", "fill", "bg", "cf", "align", "role"] as const;
const STYLE_MAPS = ["pn", "footer", "theme", "text", "colors", "designs"] as const;
const STYLE_KEYS = ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const;
/* slide items (07 §2.2): plain keys of both kinds, and the two map-merge keys */
const ITEM_KEYS = ["kind", "type", "values", "labels", "series", "title", "legend", "show", "startAngle", "box", "attach",
  "shape", "icon", "text", "fill", "border", "radius", "tail"] as const;
const ITEM_MAPS = ["colors", "fmt"] as const;
const ITEM_KINDS = ["chart", "shape"];
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
  }
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
  }
  return null;
}
export const emptyDoc = (workbook: string): WorkbookDoc => ({ schema: 3, workbook, rev: 0, preset: null, style: {} as StylePatch, edits: {} });
