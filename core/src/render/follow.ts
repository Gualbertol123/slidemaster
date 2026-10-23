/* "Follow header" (B57, 4.14): a reference whose bind says `f` is read where its header text is NOW – a column moved or
   rows inserted above it in Excel need no repoint. Resolved where the cells are read: the item is drawn (screen, PDF,
   PNG, PowerPoint, a scenario's view, "Run for each value") as a copy with those references at their found addresses,
   so every cache key that holds the item's references (chart-data.ts seriesData / chartData, chart-dl.ts chartKey,
   chart-progress.ts) holds the resolved address. The stored A1 is the fallback (the header found nowhere: as stored) –
   older pages and their exports read it. */
import type { DataRef, Item } from "../model/types";
import type { RenderCtx } from "./context";
import { bindFor, checkRef, findBlock, following, movedRef, parseA1, refAt, refsOf, rewritePatch } from "../model/datarefs";
import { genOf, ORIGIN } from "./chart-data";

const MEMO = new WeakMap<object, { key: string; out: Item }>();
/** the item with its following references at their headers' places now (the same object when none moved) */
export function boundItem<T extends Item>(it: T, ctx: RenderCtx): T {
  const f = following(it); if (!f.length) return it;
  const slots = refsOf(it).filter(s => f.some(([p]) => p === s.path) && !s.token);
  if (!slots.length) return it;
  const tables = ctx.preset?.tables || null;
  const sheets = slots.map(s => "sheet" in s.ref ? s.ref.sheet : (tables || []).find(t => t.id === (s.ref as { table: string }).table)?.sheet ?? "");
  // (each sheet's generation: a reload or a scenario's view is another sheet object, so another key)
  const key = JSON.stringify(sheets.map(n => [n, genOf(n ? ctx.sheet?.(n) ?? null : null)]));
  const hit = MEMO.get(it); if (hit && hit.key === key) return hit.out as T;
  const refs: Record<string, DataRef> = {};
  slots.forEach((s, i) => {
    const b = bindFor(f.find(([p]) => p === s.path)![1], refAt(s.ref, tables)), S = sheets[i] ? ctx.sheet?.(sheets[i]) ?? null : null, g = parseA1(s.ref.range);
    if (!b || !S || !g) return;
    const d = findBlock(S, g, b);
    if (d && (d.dr || d.dc)) { const r = movedRef(s.ref, d); if (r) refs[s.path] = r; }
  });
  let out: T = it;
  if (Object.keys(refs).length) {
    const p = rewritePatch(it, refs) as Record<string, unknown> | null;
    if (p) {
      const copy = { ...it } as Record<string, unknown>;
      for (const [k, v] of Object.entries(p)) copy[k] = v && typeof v === "object" && !Array.isArray(v) && ["sers", "groups", "marks", "axes", "stats", "moms"].includes(k) ? { ...(it as unknown as Record<string, unknown>)[k] as object, ...v as object } : v;
      out = copy as T;
      ORIGIN.set(out, ORIGIN.get(it) ?? it);
    }
  }
  MEMO.set(it, { key, out });
  return out;
}
/** (B57) what the item's binds say of its references now: a moved block (the header or the label bound with a reference
    is no longer beside it), for the item's own issue line – "Repoint…" in the page's Data sources. Only references with a
    bind (made by Data sources): an older item says nothing new */
export function bindIssue(it: Item, ctx: RenderCtx): string | null {
  if (!(it as { bind?: unknown }).bind) return null;
  it = boundItem(it, ctx);                                         // (a following reference: where its header is now)
  const b = (it as { bind?: Record<string, import("../model/types").RefBind> }).bind;
  if (!b || typeof b !== "object") return null;
  const tables = ctx.preset?.tables || null, out: string[] = [];
  for (const s of refsOf(it)) {
    const x = b[s.path]; if (!x || typeof x !== "object") continue;
    const c = checkRef(s, { sheet: n => ctx.sheet?.(n) ?? null, tables }, x);
    if (c.status === "moved") out.push(`${s.label}: the cells moved? ${c.why}`);
  }
  return out.length ? out.join("; ") + " – Data sources › Repoint" : null;
}
