/* Automated comments on slides: the table as a grid of cells (with the user's edits), analysed and
   written by model/comment.ts. A text box with `auto` settings shows this text, rewritten whenever the
   workbook's numbers change. */
import type { TableLayout } from "../xlsx/types";
import type { RenderCtx } from "./context";
import { tableKey } from "./context";
import { cache, effItems } from "./edits";
import { analyse, cleanHead, parseNum, shapeComment, writeComment, writeSummary, type Analysis, type CommentCfg, type Grid } from "../model/comment";
import type { RuntimeSlide } from "../model/types";
import { tableName } from "../model/preset";

export function gridOf(L: TableLayout, ctx: RenderCtx): Grid {
  return cache(L, "grid", tableKey(ctx, L), () => {
    const ri = new Map(L.rows.map((r, i) => [r, i])), ci = new Map(L.cols.map((c, i) => [c, i]));
    const g: Grid = L.rows.map(() => L.cols.map(() => ({ text: "", v: null, anchor: false, bold: false })));
    for (const it of effItems(L, ctx)) {
      const raw = L.sheet.get?.(it.b.src.r, it.b.src.c);
      const v = it.removed ? null : !it.edited && raw && raw.t === "n" && typeof raw.v === "number" ? raw.v : parseNum(it.text);
      for (const r of L.rows) if (r >= it.b.r && r <= it.b.r2) for (const c of L.cols) if (c >= it.b.c && c <= it.b.c2) {
        const anchor = r === it.b.r && c === it.b.c;
        g[ri.get(r)!][ci.get(c)!] = { text: String(it.text || ""), v: anchor ? v : null, anchor, bold: !!it.font?.b };
      }
    }
    return g;
  });
}
export const analysisOf = (L: TableLayout, ctx: RenderCtx): Analysis => cache(L, "analysis", tableKey(ctx, L), () => analyse(gridOf(L, ctx)));
/** the tables a comment covers: its own table first, then the others it names (same slide) */
export function commentTables(R: RuntimeSlide, L: TableLayout, cfg: CommentCfg): TableLayout[] {
  const more = (cfg.tables || []).map(id => R.tables.find(t => (t.def?.id || t.id) === id)).filter((t): t is TableLayout => !!t && t !== L);
  return [L, ...more];
}
export function commentText(L: TableLayout, cfg: CommentCfg, ctx: RenderCtx, R?: RuntimeSlide): string {
  if ((cfg.mode ?? "sections") === "sections") return shapeComment(writeComment(analysisOf(L, ctx), cfg, tableName(L, ctx.preset)), cfg);
  const tables = R ? commentTables(R, L, cfg) : [L];
  const parts = tables.map(T => ({ a: analysisOf(T, ctx), name: cleanHead(tableName(T, ctx.preset).replace(/\s*·.*$/, "")) }));
  const blocks = parts.reduce((n, p) => n + p.a.blocks.length, 0);
  const title = (cfg.title || "").trim() || (blocks > 1 && R ? R.title : parts[0].a.blocks[0]?.head ? cleanHead(parts[0].a.blocks[0].head!.label) : parts[0].name);
  return shapeComment(writeSummary(parts, cfg, title), cfg);
}
