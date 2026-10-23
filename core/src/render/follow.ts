/* "Follow header" (B57, 4.14): a reference whose bind says `f` is read where its header text is NOW – a column moved or
   rows inserted above it in Excel need no repoint. Resolved where the cells are read: the item is drawn (screen, PDF,
   PNG, PowerPoint, a scenario's view, "Run for each value") as a copy with those references at their found addresses,
   so every cache key that holds the item's references (chart-data.ts seriesData / chartData, chart-dl.ts chartKey,
   chart-progress.ts) holds the resolved address. The stored A1 is the fallback – the header found nowhere, or in several
   places with no label singling one out (ambiguous: the item's issue says "moved?") – and older pages and their exports
   read it. A quoted cell of a text ("text~0") never follows (ops.ts skips such a bind). */
import type { DataRef, Item, RefBind } from "../model/types";
import type { RenderCtx } from "./context";
import { bindFor, checkRef, findBlock, following, movedRef, parseA1, refAt, refHidden, refSheet, refsOf, rewritePatch } from "../model/datarefs";
import { genOf, ORIGIN } from "./chart-data";

/** a small cache per item: a few views at once (the workbook, a scenario's view, each value of "Run for each value") */
const LRU = 8;
function memo<T>(m: WeakMap<object, Map<string, T>>, it: object, key: string, make: () => T): T {
  let e = m.get(it); if (!e) m.set(it, e = new Map());
  const hit = e.get(key);
  if (hit !== undefined || e.has(key)) { e.delete(key); e.set(key, hit as T); return hit as T; }
  const out = make();
  e.set(key, out); if (e.size > LRU) e.delete(e.keys().next().value as string);
  return out;
}
/** the sheets' generations an item's references read (a reload or a scenario's view is another sheet object) */
function viewKey(it: Item, ctx: RenderCtx, paths: string[] | null): string {
  const tables = ctx.preset?.tables || null, names = new Set<string>();
  for (const s of refsOf(it)) if (!paths || paths.includes(s.path)) names.add(refSheet(s.ref, tables));
  return JSON.stringify([...names].sort().map(n => [n, genOf(n ? ctx.sheet?.(n) ?? null : null)]));
}
const RESOLVED = new WeakMap<object, Map<string, Item>>();
/** the item with its following references at their headers' places now (the same object when none moved) */
export function boundItem<T extends Item>(it: T, ctx: RenderCtx): T {
  const f = following(it); if (!f.length) return it;
  const paths = f.map(([p]) => p);
  return memo(RESOLVED, it, viewKey(it, ctx, paths), () => resolve(it, ctx, f)) as T;
}
function resolve<T extends Item>(it: T, ctx: RenderCtx, f: [string, RefBind][]): T {
  const tables = ctx.preset?.tables || null, refs: Record<string, DataRef> = {};
  for (const s of refsOf(it)) {
    const fb = f.find(([p]) => p === s.path); if (!fb || s.token) continue;
    const b = bindFor(fb[1], refAt(s.ref, tables)), n = refSheet(s.ref, tables), S = n ? ctx.sheet?.(n) ?? null : null, g = parseA1(s.ref.range);
    if (!b || !S || !g) continue;
    const d = findBlock(S, g, b);
    if (d && d.ambiguous === undefined && (d.dr || d.dc)) { const r = movedRef(s.ref, d); if (r) refs[s.path] = r; }
  }
  if (!Object.keys(refs).length) return it;
  const p = rewritePatch(it, refs) as Record<string, unknown> | null;
  if (!p) return it;
  const copy = { ...it } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) copy[k] = v && typeof v === "object" && !Array.isArray(v) && ["sers", "groups", "marks", "axes", "stats", "moms"].includes(k) ? { ...(it as unknown as Record<string, unknown>)[k] as object, ...v as object } : v;
  ORIGIN.set(copy, ORIGIN.get(it) ?? it);
  return copy as T;
}
const ISSUES = new WeakMap<object, Map<string, string | null>>();
/** (B57) what the item's binds say of its references now: a moved block (the header bound with a reference is no longer
    above / beside it – a following one's too when its header is nowhere or in several places), for the item's own issue
    line – "Repoint…" in the page's Data sources. Only references with a bind (made by Data sources): an older item says
    nothing new. Cached per item and its sheets' generations */
export function bindIssue(it: Item, ctx: RenderCtx): string | null {
  const b0 = (it as { bind?: unknown }).bind;
  if (!b0 || typeof b0 !== "object") return null;
  return memo(ISSUES, it, viewKey(it, ctx, null), () => {
    const r = boundItem(it, ctx);                                  // (a following reference: where its header is now)
    const b = (r as { bind?: Record<string, RefBind> }).bind || {}, tables = ctx.preset?.tables || null, out: string[] = [];
    for (const s of refsOf(r)) {
      // (a reference the item does not draw – a series chart's pie fallback – says nothing: Data sources lists it nowhere
      // but in its bulk repoints)
      if (refHidden(it, s)) continue;
      const x = b[s.path]; if (!x || typeof x !== "object") continue;
      const c = checkRef(s, { sheet: n => ctx.sheet?.(n) ?? null, tables }, x);
      if (c.status !== "moved") continue;
      const S = c.S, g = c.g, d = S && g && x.f ? findBlock(S, g, x) : null;
      out.push(`${s.label}: the cells moved? ${c.why}` + (d && d.ambiguous ? ` (“${x.h}” is in ${d.ambiguous} places: not followed)` : ""));
    }
    return out.length ? out.join("; ") + " – Data sources › Repoint" : null;
  });
}
