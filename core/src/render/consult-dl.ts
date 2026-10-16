/* Consulting Navy / Consulting Red tables → display list (docs/next/08-consulting-designs.md §2.6, ADR-018; product
   owner 2026-10-16: Navy = "Insight board", Red = "Signal", review/S7b.3/concepts/): the table is drawn as a DATA EXHIBIT
   read by exhibit.ts (label column, body and total rows, a period series, references, variance groups), on the
   exhibit's own geometry (exhibitLayout: the same boxes the page hit-tests with). Square, white, no fills but bars.
   - Navy: small-caps grey heads over a navy rule; per row the label (bold navy), the latest period's number, a trend
     line over the series, the references in grey, each variance as a diverging bar around its own axis (blue up, red
     down) labelled with its % (or its absolute); hairlines between rows; the total on a pale band under a navy rule,
     "+192 · +0,2%", red when negative.
   - Red: the latest period as a grey bar with its number, the first two variances as diverging bars (dark grey up, red
     down) with their absolutes, the others as % texts; the total under a 2 px black rule, red when negative.
   - A table that does not read as an exhibit (exhibit.ts "plain") is a clean typographic table on the workbook's
     geometry: grey heads over a rule, hairlines, labels bold, no grid, no fills.
   Every value drawn has a hit node (kind "t", id "r,c") at its box, so the stage selects and edits the cells. Text is
   measured (Metrics); only the eight node types. */
import type { Item, Rect, TableLayout } from "../xlsx/types";
import type { DisplayList, Node, PathCmd, TextNode } from "../dl/types";
import { solid } from "../dl/color";
import { fontStack } from "../model/fonts";
import { collapse } from "../text/lines";
import { cellText, cssFont, measuredBuild, picNodes, primaryFamily, shapeNodes, textBoxNodes, type Metrics, type TableDL } from "./excel-dl";
import { effItems } from "./edits";
import { barOf, EXF, EXG, EXT, exhibitLayout, type BoxR, type ExCell, type ExCol, type ExLayout, type ExRow } from "./exhibit";
import { consultOptions } from "../model/designs";
import { glassPlan, type GlassPlan } from "./glass";
import { cardsToDisplayList } from "./consult-cards";
import { rulesToDisplayList } from "./consult-rules";
import { specOf } from "./consult-spec";
import type { RenderCtx } from "./context";

const r2 = (v: number) => Math.round(v * 100) / 100;
/** the exhibits' colours (concepts.mjs, round 4: no table background – the slide is tinted –, dark tabular numbers,
    negatives red, % a touch lighter); the accent follows the deck's colours (specOf) */
function paletteOf(ctx: RenderCtx) {
  const S = specOf(ctx);
  return ctx.style.design === "bain"
    ? { ink: "#1A1A1A", label: "#1A1A1A", neg: S.accent, pct: "#555555", head: "#6B6B6B", hair: "#E2DED8", axis: "#BDBDBD", up: "#4A4A4A", down: S.accent, bar: "#E3E3E3", rule: "#1A1A1A", muted: "#8A8A8A", band: null as string | null, trend: S.accent }
    : { ink: "#0E2238", label: "#0E2238", neg: "#D93025", pct: "#4E5B66", head: "#5B6B7A", hair: "#D9E1EA", axis: "#C9D3DF", up: S.accent, down: "#D93025", bar: "#D9D9D9", rule: S.table.head.ink, muted: "#8A96A3", band: "#E4EBF3" as string | null, trend: S.accent };
}

/** text helpers over the measurer: one run, aligned at x, its baseline centred on cy */
function typeset(m: Metrics, family: string) {
  const key = primaryFamily(family);
  return (src: string, x: number, cy: number, size: number, b: boolean, color: string, align: "start" | "end" | "middle" = "start", ls = 0): TextNode => {
    const font = cssFont(size, family, b), run = m.run(src, font), base = m.run("", font), n = [...src].length;
    const w = Math.max(0, run.w + (ls ? ls * (n - 1) : 0)), x0 = align === "end" ? x - w : align === "middle" ? x - w / 2 : x;
    return { t: "text", font: key, css: family, ...(b ? { b: true } : {}), size, x: r2(x0), y: r2(cy + (base.asc - base.desc) / 2), src, w, fill: solid(color), ...(ls ? { ls } : {}) };
  };
}
const hitOf = (it: Item, b: BoxR, text: string): Node => ({ t: "hit", kind: "t", id: `${it.b.r},${it.b.c}`, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), label: collapse(text).trim() });
const rect = (x: number, y: number, w: number, h: number, color: string): Node => ({ t: "rect", x: r2(x), y: r2(y), w: r2(Math.max(0, w)), h: r2(Math.max(0, h)), fill: solid(color) });

/** a consulting table as its options say (consultOptions: tables "exhibit" | "cards" | "rules", numbers "full" | "compact") */
export function consultToDisplayList(L: TableLayout, ctx: RenderCtx, m: Metrics, opts: { noText?: boolean } = {}, plan?: GlassPlan): TableDL {
  const o = consultOptions(ctx);
  if (o.tables === "cards") return cardsToDisplayList(L, ctx, m, opts, plan);
  if (o.tables === "rules") return rulesToDisplayList(L, ctx, m, opts);
  return exhibitToDisplayList(L, ctx, m, opts, o.numbers);
}
/** a text clipped at its column (a long label never runs into the numbers) */
const clipTo = (n: Node, x: number, y: number, w: number, h: number): Node => ({ t: "group", clip: { x, y, w: Math.max(0, w), h }, children: [n] });
export function exhibitToDisplayList(L: TableLayout, ctx: RenderCtx, m: Metrics, opts: { noText?: boolean } = {}, numbers: "full" | "compact" = "full"): TableDL {
  const g = exhibitLayout(L, ctx, numbers)!, S = specOf(ctx), deck = ctx.style.text?.table?.font, family = deck ? fontStack(deck, S.table.family) : S.table.family;
  if (g.ex.kind !== "exhibit") return plainTable(L, ctx, m, g, family, opts);
  if (g.numbers === "full") return fullNumbers(ctx, m, g, family, opts);
  const P = paletteOf(ctx), T = typeset(m, family), nodes: DisplayList = [], texts: Node[] = [], navy = g.design === "mckinsey";
  const cell = (x: ExCell | null | undefined, node: Node | null) => {
    if (!x) { if (node) texts.push(node); return; }
    const b = g.boxes.get(x.r + "," + x.c); if (b) texts.push(hitOf(x.it, b, x.text));
    if (node) texts.push(node);
  };
  // heads: small capitals, letter-spaced, grey
  const ex = g.ex, ser = ex.series, last = ser ? ser.cols[ser.cols.length - 1] : null, G0 = navy ? EXG.mckinsey : EXG.bain;
  for (const c of g.cols) {
    const h = g.heads.get(c), label = c.kind === "trend" && ser ? `${ser.labels[0]}–${ser.labels[ser.labels.length - 1]}` : c.kind === "latest" && ser ? ser.labels[ser.labels.length - 1]
      : c.kind === "ref" ? c.ref!.label : c.kind === "dbar" || c.kind === "dpct" ? "Δ " + c.delta!.label : h?.text || "";
    if (!label) continue;
    const t = label.toUpperCase(), align = c.kind === "label" || c.kind === "trend" || (c.kind === "latest" && !navy) ? "start" : c.kind === "dbar" ? "middle" : "end";
    const x = align === "start" ? c.x + (c.kind === "trend" ? (EXG.mckinsey.trend - EXG.mckinsey.spark) / 2 : 0) : align === "middle" ? c.x + c.w / 2 : c.x + c.w;
    // a head wider than its column goes on two lines (broken at a space or a dash)
    const avail = c.w - (c.kind === "trend" ? (EXG.mckinsey.trend - EXG.mckinsey.spark) / 2 : 6), one = T(t, x, G0.headY, EXT.head, true, P.head, align, EXT.ls);
    let lines = [t];
    if (one.w! > avail) {
      const parts = t.split(/(?<=[ –-])/);
      for (let k = parts.length - 1; k > 0 && lines.length === 1; k--) { const a = parts.slice(0, k).join("").trim(), b = parts.slice(k).join("").trim(); if (T(a, x, 0, EXT.head, true, P.head, align, EXT.ls).w! <= avail || k === 1) lines = [a, b]; }
    }
    if (h && c.kind !== "trend") { const b = g.boxes.get(h.it.b.r + "," + h.it.b.c); if (b) texts.push(hitOf(h.it, b, h.text)); }
    if (!opts.noText) lines.forEach((s, k) => texts.push(lines.length === 1 ? one : T(s, x, G0.headY + (k ? 5.5 : -5.5), EXT.head, true, P.head, align, EXT.ls)));
  }
  if (navy) nodes.push(rect(0, EXG.mckinsey.rule, g.W, 1.5, P.rule));
  // rows
  const rows: ExRow[] = [...ex.rows, ...(ex.total ? [ex.total] : [])];
  rows.forEach((r, i) => {
    const top = g.tops.get(r.r)!, cy = top + g.pitch / 2, total = r.kind === "total";
    if (total) { if (P.band) nodes.push(rect(0, top, g.W, g.pitch, P.band)); nodes.push(rect(0, top, g.W, navy ? 1.5 : 2, P.rule)); }
    else if (navy ? i > 0 : true) nodes.push(rect(0, navy ? top - .5 : top + g.pitch - 1, g.W, 1, P.hair));
    for (const c of g.cols) drawCell(c, r, cy, total);
  });
  function drawCell(c: ExCol, r: ExRow, cy: number, total: boolean) {
    const txt = (x: ExCell | null | undefined) => x && x.text.trim() ? x.text.trim() : "–";
    const neg = (x: ExCell | null | undefined) => !!x && x.v !== null && x.v < 0;
    const show = (x: ExCell | null | undefined, node: Node) => cell(x, opts.noText ? null : node);
    if (c.kind === "label") { show(r.label, clipTo(T(txt(r.label), c.x, cy, total && !navy ? EXT.totalRed : EXT.text, true, P.ink), c.x, cy - g.pitch / 2, c.w - 6, g.pitch)); return; }
    if (c.kind === "latest") {
      const x = last === null ? null : r.cells.get(last);
      if (navy) { show(x, T(txt(x), c.x + c.w, cy, EXT.text, total, x && x.v !== null ? P.ink : P.muted, "end")); return; }
      if (total) { show(x, T(txt(x), c.x, cy, EXT.totalRed, true, P.ink)); return; }
      const m0 = g.max.get(last!) || 0, w = x && x.v !== null && m0 ? Math.min(1, Math.abs(x.v) / m0) * EXG.bain.bar : 0;
      if (w) nodes.push(rect(c.x, cy - EXG.bain.barH / 2, w, EXG.bain.barH, P.bar));
      show(x, T(txt(x), c.x + w + 6, cy, EXT.value, false, P.ink)); return;
    }
    if (c.kind === "trend") {
      const k = ser!.cols.length, x0 = c.x + (c.w - EXG.mckinsey.spark) / 2, sw = EXG.mckinsey.spark, h = EXG.mckinsey.sparkH;
      const pts = ser!.cols.map((col, j) => { const v = r.cells.get(col)?.v ?? null; return v === null ? null : { x: x0 + j * sw / (k - 1), v }; }).filter((p): p is { x: number; v: number } => !!p);
      // the earlier periods' hits: their slices of the trend (the latest has its own column)
      for (const col of ser!.cols.slice(0, k - 1)) { const x = r.cells.get(col), b = x && g.boxes.get(x.r + "," + x.c); if (x && b) texts.push(hitOf(x.it, b, x.text)); }
      if (pts.length < 2) return;
      const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), y = (v: number) => hi === lo ? cy : cy + h / 2 - (v - lo) / (hi - lo) * h;
      const d: PathCmd[] = pts.map((p, j): PathCmd => [j ? "L" : "M", r2(p.x), r2(y(p.v))]), color = total ? P.ink : P.trend, e = pts[pts.length - 1];
      nodes.push({ t: "path", d, stroke: { w: 1.6, paint: solid(color), cap: "round" } }, { t: "path", d: circle(e.x, y(e.v), 2.5), fill: solid(color) });
      return;
    }
    if (c.kind === "ref") { const x = r.cells.get(c.ref!.col); show(x, T(txt(x), c.x + c.w, cy, EXT.ref, false, P.ink, "end")); return; }
    const D = c.delta!, ab = D.abs === null ? null : r.cells.get(D.abs), pc = D.pct === null ? null : r.cells.get(D.pct);
    if (c.kind === "dpct") { const x = pc || ab; show(x, T(txt(x), c.x + c.w, cy, total ? EXT.totalRed : EXT.ref, true, neg(x) ? P.down : P.ink, "end")); return; }
    const cx = c.x + c.w / 2, first = !navy && g.cols.find(k => k.kind === "dbar") === c;
    if (total) {
      if (navy) {
        const s = [ab, pc].filter((x): x is ExCell => !!x && !!x.text.trim()).map(x => x.text.trim()).join(" · ") || "–";
        cell(ab, null); cell(pc, null);
        if (!opts.noText) texts.push(T(s, cx, cy, EXT.ref, true, neg(ab || pc) ? P.down : P.ink, "middle"));
      } else { cell(pc, null); show(ab || pc, T(txt(ab || pc), cx, cy, EXT.totalRed, true, neg(ab || pc) ? P.down : P.ink, "middle")); }
      return;
    }
    const G = navy ? EXG.mckinsey : EXG.bain, bar = barOf(c, D.abs ?? D.pct, r, g.max, G.half, G.barH, cy);
    nodes.push({ t: "line", x1: r2(cx), y1: r2(cy - G.axis), x2: r2(cx), y2: r2(cy + G.axis), stroke: { w: 1, paint: solid(P.axis) } });
    if (bar.v === null) { show(navy ? (pc || ab) : (ab || pc), T("–", cx, cy, EXT.small, false, P.muted, "middle")); if (navy) cell(ab && pc ? ab : null, null); return; }
    if (bar.w) nodes.push(rect(bar.x, bar.y, bar.w, bar.h, bar.v >= 0 ? P.up : P.down));
    // the label beside the bar's end: Navy the % (or the absolute), Red the absolute
    const lab = navy ? (pc || ab) : (ab || pc), pos = bar.v >= 0, tx = pos ? bar.x + bar.w + 4 : bar.x - 4;
    const node = T(txt(lab), tx, cy, EXT.small, first, neg(lab) || bar.v < 0 ? P.down : P.ink, pos ? "start" : "end");
    show(lab, node);
    if (navy && ab && pc) cell(ab, null);
  }
  return { nodes: [...nodes, ...texts], images: {} };
}

/** full numbers (round 4): every cell's number in tabular, right-aligned columns, the graphics beside them – a diverging
    bar in each variance's lane (Red: the first two), the trend after the periods (Navy), the latest period's value as a
    light band under its number (Red); heads on two lines, a variance group's title centred over it with "Abs." / "%" */
function fullNumbers(ctx: RenderCtx, m: Metrics, g: ExLayout, family: string, opts: { noText?: boolean }): TableDL {
  const P = paletteOf(ctx), T = typeset(m, family), nodes: DisplayList = [], texts: Node[] = [], navy = g.design === "mckinsey", G = EXF[g.design], ex = g.ex;
  const hit = (x: ExCell | null | undefined) => { const b = x && g.boxes.get(x.r + "," + x.c); if (x && b) texts.push(hitOf(x.it, b, x.text)); };
  // heads
  const seen = new Set<string>();
  for (const h of g.headTexts) {
    const key = h.it ? h.it.b.r + "," + h.it.b.c : "";
    if (h.it && !seen.has(key)) { seen.add(key); const b = g.boxes.get(key); if (b) texts.push(hitOf(h.it, b, String(h.it.text))); }
    if (opts.noText) continue;
    const x = h.align === "start" ? h.x : h.align === "middle" ? h.x + h.w / 2 : h.x + h.w - 2;
    texts.push(T(h.text.toUpperCase(), x, G.lines[h.line], EXT.head, true, P.head, h.align, EXT.ls));
  }
  if (navy) nodes.push(rect(0, G.rule, g.W, 1.5, P.rule));
  const rows: ExRow[] = [...ex.rows, ...(ex.total ? [ex.total] : [])], ser = ex.series;
  rows.forEach((r, i) => {
    const top = g.tops.get(r.r)!, cy = top + g.pitch / 2, total = r.kind === "total";
    if (total) { if (P.band) nodes.push(rect(0, top, g.W, g.pitch, P.band)); nodes.push(rect(0, top, g.W, navy ? 1.5 : 2, P.rule)); }
    else if (navy ? i > 0 : true) nodes.push(rect(0, navy ? top - .5 : top + g.pitch - 1, g.W, 1, P.hair));
    for (const c of g.cols) {
      if (c.kind === "label") { hit(r.label); if (!opts.noText && r.label) texts.push(clipTo(T(r.label.text.trim() || "–", c.x, cy, EXT.text, true, P.label), c.x, top, c.w - 6, g.pitch)); continue; }
      if (c.kind === "num") {
        const x = r.cells.get(c.col!), v = x && x.v !== null ? x.v : null, s = x && x.text.trim() ? x.text.trim() : "–";
        // Red: the latest period's value as a light band under its number, from the lane's left, ∝ value
        if (!navy && c.role === "latest" && !total && v !== null) { const m0 = g.max.get(c.col!) || 0, w = m0 ? Math.min(1, Math.abs(v) / m0) * (c.w - 4) : 0; if (w) nodes.push(rect(c.x, cy - 8, w, 16, P.bar)); }
        hit(x);
        if (opts.noText) continue;
        const color = s === "–" ? P.muted : v !== null && v < 0 ? P.neg : c.role === "pct" ? P.pct : P.ink;
        texts.push(T(s, c.x + c.w - 2, cy, EXT.text, total || r.kind === "sub", color, "end"));
        continue;
      }
      if (c.kind === "lane") {
        if (total) continue;
        const cx = c.x + c.w / 2, D = c.delta!, bar = barOf(c, D.abs ?? D.pct, r, g.max, c.w / 2 - 3, G.barH, cy);
        nodes.push({ t: "line", x1: r2(cx), y1: r2(cy - 7), x2: r2(cx), y2: r2(cy + 7), stroke: { w: 1, paint: solid(P.axis) } });
        if (bar.v !== null && bar.w) nodes.push(rect(bar.x, bar.y, bar.w, bar.h, bar.v >= 0 ? P.up : P.down));
        continue;
      }
      if (c.kind === "trend" && ser) {
        const k = ser.cols.length, x0 = c.x + (c.w - G.spark) / 2, h = G.sparkH;
        const pts = ser.cols.map((col, j) => { const v = r.cells.get(col)?.v ?? null; return v === null ? null : { x: x0 + j * G.spark / (k - 1), v }; }).filter((p): p is { x: number; v: number } => !!p);
        if (pts.length < 2) continue;
        const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), y = (v: number) => hi === lo ? cy : cy + h / 2 - (v - lo) / (hi - lo) * h;
        const color = total ? P.rule : P.trend, e = pts[pts.length - 1];
        nodes.push({ t: "path", d: pts.map((p, j): PathCmd => [j ? "L" : "M", r2(p.x), r2(y(p.v))]), stroke: { w: 1.6, paint: solid(color), cap: "round" } }, { t: "path", d: circle(e.x, y(e.v), 2.5), fill: solid(color) });
      }
    }
  });
  return { nodes: [...nodes, ...texts], images: {} };
}

const KAPPA = .5522847498;
function circle(cx: number, cy: number, r: number): PathCmd[] {
  const k = r * KAPPA, a = r2(cx), b = r2(cy);
  return [["M", a + r, b], ["C", a + r, b + k, a + k, b + r, a, b + r], ["C", a - k, b + r, a - r, b + k, a - r, b], ["C", a - r, b - k, a - k, b - r, a, b - r], ["C", a + k, b - r, a + r, b - k, a + r, b], ["Z"]];
}

/** a table that is not an exhibit: the workbook's geometry and text (cellText: wrapping, sup / sub, rotation as Excel
    Refined), in the design's font and inks; grey bold heads over a rule, hairlines between the rows, labels bold */
function plainTable(L: TableLayout, ctx: RenderCtx, m: Metrics, g: ExLayout, family: string, opts: { noText?: boolean }): TableDL {
  const P = paletteOf(ctx), heads = new Set(g.ex.head), items = effItems(L, ctx), nodes: DisplayList = [], images: Record<string, string> = {};
  const body = L.rows.filter(r => !heads.has(r) && items.some(it => it.b.r === r && String(it.text || "").trim()));
  const lastHead = g.ex.head.length ? g.ex.head[g.ex.head.length - 1] : null;
  if (lastHead !== null) nodes.push(rect(0, L.rowY.get(lastHead)! + L.rowH.get(lastHead)! - 1.5, L.W, 1.5, P.rule));
  body.slice(0, -1).forEach(r => nodes.push(rect(0, L.rowY.get(r)! + L.rowH.get(r)! - 1, L.W, 1, P.hair)));
  if (!opts.noText) for (const it of items) if (it.text) {
    const head = heads.has(it.b.r) && !(it.b.r2 > (lastHead ?? -1)), label = it.b.c === g.ex.labelCol;
    nodes.push(...cellText(it, ctx, m, { family, color: it.userColor || it.nfColor || (head ? P.head : P.ink), b: it.userB ?? (head || label || !!it.font.b) }));
  }
  const rr = Math.round(8 * ctx.style.radius / 100);
  for (const r of L.rects) nodes.push(...shapeNodes(r, rr));
  for (const tb of L.texts as Rect[]) nodes.push(...textBoxNodes(tb, rr, m));
  for (const p of L.pics) nodes.push(...picNodes(p, !!ctx.forExport, images, m));
  return { nodes, images };
}

/** a table's display list with the page's measurements */
export function consultTableDL(L: TableLayout, ctx: RenderCtx, opts: { noText?: boolean } = {}) {
  // the cards' scene does not depend on the measurements: made once, not in every measuring round
  const plan = consultOptions(ctx).tables === "cards" ? glassPlan(L, ctx, opts) : undefined;
  return measuredBuild(m => consultToDisplayList(L, ctx, m, opts, plan));
}
