/* Consulting Navy / Consulting Red tables → display list (docs/next/08-consulting-designs.md §2.1, §2.2 "Tables",
   ADR-018): one renderer for both designs, every colour, width and font from the DesignSpec (specOf). Built from the
   Excel item list (effItems) like excel-dl.ts, in the same table px (0,0 = the table's top left, L.W × L.H), with its
   helpers (cellText, borderNodes, shapes, text boxes, pictures), so text, merges, sup / sub, rotation, wrapping and
   the workbook's drawings come out exactly as in Excel Refined. What the design changes:
   - the workbook's fills, borders and font families / colours are replaced: horizontal rules only (top, under the
     header, a hairline between body rows, above each total, at the bottom), no verticals, no banding; a filled header
     band with light text and separators when the spec says so (Consulting Red);
   - kept: number formats and their colours, bold / italic, sizes, alignment, conditional-format results, colour
     scales, the user's own colours and fonts; header and total rows are bold; a one-line cell that Arial makes too
     wide for its cell is drawn smaller, down to 0.7× (fitted);
   - the CE-11 highlight is the spec's tint under the cell; a highlighted total is the solid accent with bold light
     text ("strong");
   - the user's gridlines (table › Gridlines on / off) are drawn as Excel draws them; otherwise no cell borders. */
import type { Item, Rect, TableLayout } from "../xlsx/types";
import type { DisplayList, Node } from "../dl/types";
import { solid } from "../dl/color";
import { fontStack } from "../model/fonts";
import { borderNodes, cellText, cssFont, measuredBuild, picNodes, runsOf, seamFillsBy, seamPath, shapeNodes, textBoxNodes, type Metrics, type TableDL } from "./excel-dl";
import { effItems } from "./edits";
import { rolesOf, type RowKind } from "./roles";
import { specOf, type DesignSpec, type Stroke } from "./consult-spec";
import type { RenderCtx } from "./context";

/** a cell's role (Table tools › Role) as a row kind: on the label cell it makes the whole row that kind */
const ROLE_KIND: Record<string, RowKind> = { header: "header", total: "total", body: "body" };

/** each visible row's kind: rolesOf's analysis, unless the row's label cell has a role of the user's */
export function consultRows(L: TableLayout, ctx: RenderCtx, items: Item[]): Map<number, RowKind> {
  const roles = rolesOf(L, ctx), kind = new Map(roles.kind);
  for (const it of items) if (it.role && ROLE_KIND[it.role] && it.b.c === roles.labelC && kind.has(it.b.r)) kind.set(it.b.r, ROLE_KIND[it.role]);
  return kind;
}

export function consultToDisplayList(L: TableLayout, ctx: RenderCtx, m: Metrics, opts: { noText?: boolean } = {}): TableDL {
  const S = specOf(ctx), T = S.table, items = effItems(L, ctx), kind = consultRows(L, ctx, items), rr = Math.round(8 * ctx.style.radius / 100);
  const nodes: DisplayList = [], images: Record<string, string> = {};
  const kOf = (r: number): RowKind => kind.get(r) || "body";
  const top = (r: number) => L.rowY.get(r) ?? 0, bot = (r: number) => top(r) + (L.rowH.get(r) ?? 0);
  const banded = T.head.kind === "fill" && !!T.head.fill;
  // the header band (Consulting Red): one rect per run of header rows, under everything
  if (banded) for (let i = 0; i < L.rows.length; i++) {
    if (kOf(L.rows[i]) !== "header") continue;
    let j = i; while (j + 1 < L.rows.length && kOf(L.rows[j + 1]) === "header") j++;
    nodes.push({ t: "rect", x: 0, y: top(L.rows[i]), w: L.W, h: bot(L.rows[j]) - top(L.rows[i]), fill: solid(T.head.fill!) });
    i = j;
  }
  // cell fills: the highlight, conditional formats, colour scales and the user's own colour – never the workbook's
  const strong = (it: Item) => !!it.userFill && kOf(it.b.r) === "total";
  const fills = items.map(it => fillOf(it, T, strong(it))), under = seamFillsBy(items, fills);
  for (const [k, it] of items.entries()) { const f = fills[k]; if (f) {
    const [l, t, r, b] = under[k];
    nodes.push(l || t || r || b ? { t: "path", d: seamPath(it, under[k]), fill: solid(f), rule: "nonzero" } : { t: "rect", x: it.bx, y: it.by, w: it.bw, h: it.bh, fill: solid(f) });
  } }
  // the user's gridlines "on" (effItems has set them on the items; "off" has removed them): only the directions chosen
  const gh = L.def?.gridH === "on", gv = L.def?.gridV === "on";
  if (gh || gv) for (const it of items) for (const side of ["top", "left", "right", "bottom"] as const) {
    const b = it[side]; if (!b || ((side === "top" || side === "bottom") ? !gh : !gv)) continue;
    nodes.push(...borderNodes(side, b, it.bx, it.by, it.bw, it.bh));
  }
  nodes.push(...ruleNodes(L, items, kOf, T));
  // the header band's separators: at the column edges inside the band, not at its outer edges
  if (banded && T.head.sep) for (const it of items) {
    const x = it.bx + it.bw; if (kOf(it.b.r) !== "header" || x >= L.W - .5 || x <= .5) continue;
    nodes.push(hline(x, it.by, x, it.by + it.bh, T.head.sep));
  }
  if (!opts.noText) for (const [n, it] of items.entries()) if (it.text) {
    // on the header band the light ink, unless the cell has a fill of its own (a highlight, the user's colour)
    const k = kOf(it.b.r), st = strong(it), onBand = banded && k === "header" && !fills[n];
    const own = it.userColor || it.scaleInk || it.nfColor || it.cf?.color;
    const color = st ? it.userColor || T.strong.ink : own || (onBand ? T.head.ink : T.ink);
    const b = st || (it.userB ?? (k === "header" || k === "total" || it.role === "header" || it.role === "total" || !!it.font.b));
    const user = it.userFont || ctx.style.text?.table?.font, family = user ? fontStack(user, T.family) : T.family;
    nodes.push(...cellText(fitted(it, family, b, m), ctx, m, { family, color, b }));
  }
  for (const r of L.rects) nodes.push(...shapeNodes(r, rr));
  for (const tb of L.texts as Rect[]) nodes.push(...textBoxNodes(tb, rr, m));
  for (const p of L.pics) nodes.push(...picNodes(p, !!ctx.forExport, images, m));
  return { nodes, images };
}

/** Arial is wider than most workbooks' fonts: a one-line cell whose text no longer fits its cell (and may not run into
    empty neighbours) is drawn smaller, all its runs alike (sup / sub keep their ratio), down to 0.7×; beyond that it is
    clipped as in Excel. The factor comes from the widths at the cell's own size (one pass: the measuring rounds settle) */
export const MIN_FIT = .7;
function fitted(it: Item, family: string, b: boolean, m: Metrics): Item {
  if (it.wrap || it.rot || it.ov) return it;
  const sz = it.font.sz || 11, size = +(sz * 96 / 72).toFixed(2), i = !!it.font.i;
  // the text box's width as cellText lays it out (padding 3 px, or the indent on its side)
  const ind = it.indent ? 3 + it.indent * 9 : 3, pl = it.indent && it.align !== "right" ? ind : 3, pr = it.indent && it.align === "right" ? ind : 3;
  const avail = Math.max(0, (it.tw || it.bw) - pl - pr), w = runsOf(it, size).reduce((s, r) => s + m.run(r.text, cssFont(r.size, family, b, i)).w, 0);
  if (!(w > avail + .01) || !avail) return it;
  return { ...it, font: { ...it.font, sz: sz * Math.max(MIN_FIT, avail / w) } };
}

/** the fill a cell draws in the design (null = none): the highlight (strong in a total row), else the conditional
    format's or colour scale's result, else the user's own cell colour */
function fillOf(it: Item, T: DesignSpec["table"], strong: boolean): string | null {
  if (it.removed || it.noFill) return null;
  if (it.userFill) return strong ? T.strong.fill : T.highlight;
  if (it.scaleFill) return it.scaleFill;
  if (it.cf?.fill) return it.cf.fill;
  return it.userBg && it.userBg !== "none" ? it.userBg : null;
}

const hline = (x1: number, y1: number, x2: number, y2: number, s: Stroke): Node => ({ t: "line", x1, y1, x2, y2, stroke: { w: s.w, paint: solid(s.color) } });

/** the design's rules, across the table's width: like an Excel border, each lies inside the row it belongs to (a rule
    under a row along its bottom edge, the total's rule along its top edge); a cell merged across the edge breaks it */
function ruleNodes(L: TableLayout, items: Item[], kOf: (r: number) => RowKind, T: DesignSpec["table"]): Node[] {
  const out: Node[] = [], rows = L.rows, spans = items.filter(it => it.b.r2 > it.b.r), top = (r: number) => L.rowY.get(r) ?? 0, bot = (r: number) => top(r) + (L.rowH.get(r) ?? 0);
  /** a rule at y, minus the cells merged across the edge between rows a (above) and b (below) */
  const rule = (y: number, s: Stroke, a?: number, b?: number) => {
    const cuts = a === undefined || b === undefined ? [] : spans.filter(it => it.b.r <= a && it.b.r2 >= b).map(it => [it.bx, it.bx + it.bw]).sort((p, q) => p[0] - q[0]);
    let x = 0;
    for (const [x0, x1] of cuts) { if (x0 > x + .01) out.push(hline(x, y, x0, y, s)); x = Math.max(x, x1); }
    if (x < L.W - .01) out.push(hline(x, y, L.W, y, s));
  };
  // the bottom rule under the last header / body / total row: notes and sources after the data read as footnotes below it
  const drawn = rows.filter(r => { const k = kOf(r); return k === "header" || k === "body" || k === "total"; });
  if (!drawn.length) return out;
  if (T.top) rule(T.top.w / 2, T.top);
  rows.forEach((r, i) => {
    const k = kOf(r), next = rows[i + 1], kn = next === undefined ? null : kOf(next), prev = i ? rows[i - 1] : undefined;
    if (k === "header" && kn !== "header" && T.head.rule && next !== undefined) rule(bot(r) - T.head.rule.w / 2, T.head.rule, r, next);
    if (k === "body" && kn === "body") rule(bot(r) - T.rowRule.w / 2, T.rowRule, r, next);
    // above a total: unless the header's rule is already there
    if (k === "total" && !(prev !== undefined && kOf(prev) === "header" && T.head.rule)) rule(top(r) + T.totalRule.w / 2, T.totalRule, prev, r);
  });
  const last = drawn[drawn.length - 1];
  rule(bot(last) - T.bottom.w / 2, T.bottom);
  return out;
}

/** a table's display list with the page's measurements */
export const consultTableDL = (L: TableLayout, ctx: RenderCtx, opts: { noText?: boolean } = {}) => measuredBuild(m => consultToDisplayList(L, ctx, m, opts));
