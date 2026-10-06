/* Document operations – the ONLY way documents change (docs/ARCHITECTURE.md §3.2).
   The helper applies the same rules in backend/slidebuilder/ops.py; both are tested against
   shared/ops-vectors.json. Keep them in sync. */
import type { CellEdit, Op, WorkbookDoc, StylePatch } from "./types";

const SLIDE_KEYS = ["title", "subtitle", "date", "note", "logo", "layout"] as const;
const CELL_KEYS = ["text", "orig", "sz", "b", "i", "color", "fill", "align", "role"] as const;
const STYLE_KEYS = ["design", "glass", "color", "logo"] as const;
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
    case "style.patch": {
      if (!isObj(o.patch)) return false;
      applyStylePatch(doc.style as Record<string, unknown>, o.patch);
      return true;
    }
  }
  return false;
}
export function applyStylePatch(style: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const k of STYLE_KEYS) if (k in patch) { const v = patch[k]; if (v === null) delete style[k]; else style[k] = clone(v); }
  if ("pn" in patch) {
    const v = patch.pn;
    if (v === null) delete style.pn;
    else if (isObj(v)) {
      const pn = (isObj(style.pn) ? style.pn : {}) as Record<string, unknown>;
      for (const [k, x] of Object.entries(v)) { if (x === null) delete pn[k]; else pn[k] = clone(x); }
      if (Object.keys(pn).length) style.pn = pn; else delete style.pn;
    }
  }
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
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(op.patch)) patch[k] = s[k] === undefined ? null : clone(s[k]);
      return { op: "slide.patch", id: op.id, patch } as Op;
    }
    case "cell.patch": {
      const e = (doc.edits[op.sheet] || {})[op.ref] || ({} as CellEdit) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      const keys = new Set(Object.keys(op.patch)); if (keys.has("text")) keys.add("orig");
      for (const k of keys) patch[k] = (e as Record<string, unknown>)[k] === undefined ? null : clone((e as Record<string, unknown>)[k]);
      return { op: "cell.patch", sheet: op.sheet, ref: op.ref, patch } as Op;
    }
    case "style.patch": {
      const st = doc.style as Record<string, unknown>, patch: Record<string, unknown> = {};
      for (const k of Object.keys(op.patch)) {
        if (k === "pn" && isObj(op.patch.pn)) {
          const cur = (isObj(st.pn) ? st.pn : {}) as Record<string, unknown>, p: Record<string, unknown> = {};
          for (const kk of Object.keys(op.patch.pn)) p[kk] = cur[kk] === undefined ? null : clone(cur[kk]);
          patch.pn = p;
        } else patch[k] = st[k] === undefined ? null : clone(st[k]);
      }
      return { op: "style.patch", patch } as Op;
    }
  }
  return null;
}
export const emptyDoc = (workbook: string): WorkbookDoc => ({ schema: 3, workbook, rev: 0, preset: null, style: {} as StylePatch, edits: {} });
