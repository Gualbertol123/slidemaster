/* Duplicate slide (S13.7, owner Q12): the definition a copy of a slide is added with (one slide.add, model/ops.ts – the
   op's semantics stay there; this only builds its `slide`). Pure, so the page (app/src/editor/slides.ts) and the export
   tests (core/tests/slidemenu.test.ts) make the very same copy. */
import type { SlideDef } from "./types";

/** a copy of slide `s` under the id `id`: everything as it is (its tables – the same tables of the deck –, text, formats,
    hide, looks, sizes, free layouts, notes), its items under new ids from `itemId` (given the ids taken so far), with
    what names them – the free layouts' "i:<id>" boxes, the lines' ends attached to an item – renamed alike, so the copy
    shares no item id with the original. `s` is left as it is.
    M15 and later: every new place that names an item id (groups, z-order, …) must be renamed here too (`key`, `ren`);
    "t:" and "n:" free-layout keys name tables and notes, which the copy shares, and stay as they are */
export function copySlide(s: SlideDef, id: string, itemId: (taken: (x: string) => boolean) => string): SlideDef {
  const c = JSON.parse(JSON.stringify(s)) as SlideDef;
  c.id = id;
  if (!c.items || typeof c.items !== "object") return c;
  const old = Object.keys(c.items), ren = new Map<string, string>(), taken = new Set(old);
  for (const k of old) { const n = itemId(x => taken.has(x)); taken.add(n); ren.set(k, n); }
  const key = (k: string) => k.startsWith("i:") && ren.has(k.slice(2)) ? "i:" + ren.get(k.slice(2)) : k;
  c.items = Object.fromEntries(old.map(k => {
    const it = c.items![k] as unknown as { ends?: Record<string, { to?: unknown } | null | undefined> } | null;
    if (it && it.ends && typeof it.ends === "object") for (const e of Object.values(it.ends)) if (e && typeof e.to === "string") e.to = key(e.to);
    return [ren.get(k)!, it];
  })) as SlideDef["items"];
  for (const f of Object.values(c.free || {})) if (f && f.items && typeof f.items === "object") f.items = Object.fromEntries(Object.entries(f.items).map(([k, b]) => [key(k), b]));
  return c;
}
