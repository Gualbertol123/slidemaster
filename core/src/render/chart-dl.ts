/* Charts on slides (4.3, B16; docs/next/07 §3, ADR-015): a pie or donut drawn with the display list's own nodes – slices
   as `path`s (each arc as cubic Béziers of at most 90°, κ = 4/3·tan(θ/4), 0.5523 for a quarter), a separator stroke in
   the background colour, labels (`text`; outside with a `line` leader on a slice under 12°), a legend (`rect` swatch +
   `text`), a title, and `hit` nodes (the item over its box, one per slice). Liquid Glass draws it inside a glass card
   (glassBox: clip + blurred wallpaper + tint + shadows), Excel Refined on a plain rounded card, Excel and the consulting
   designs on the slide itself.
   Data: through ctx.sheet() like the tables, so a reload or a scenario's overlay redraws the chart; numbers only, blank,
   text and hidden cells skipped, the cells a version removes too; labels from the item's labels range, else the row /
   column headers beside the values. Colours: the item's colors[i], else the design's palette (resolved per design,
   model/style.ts palette / consult-spec.ts specOf). Pure: the stage, thumbnails and every export draw the same nodes. */
import type { Box, ChartItem, DataRef } from "../model/types";
import type { Node, Paint, PathCmd, RGB, TextNode } from "../dl/types";
import type { Sheet } from "../xlsx/types";
import type { Range } from "../xlsx/util";
import type { RenderCtx } from "./context";
import { primaryFamily, type Metrics } from "./excel-dl";
import { glassBox, type GlassVars, type Wallpaper } from "./glass-dl";
import { formatValue } from "../xlsx/numfmt";
import { A1, numToCol, parseRange } from "../xlsx/util";
import { mix, palette, themeOf } from "../model/style";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { deckFmt } from "./text";
import { fontStack } from "../model/fonts";
import { parseColor, solid } from "../dl/color";

/* ---- data ---- */
export interface Slice { label: string; v: number; text: string }
export type ChartData =
  | { ok: true; source: string; series: string; slices: Slice[] }
  | { ok: false; source: string; why: "missing" | "empty" };
/** the most cells a chart reads (a range the size of a sheet is a mistake, not a chart) */
const MAX_CELLS = 2000;
/** where a DataRef points: its sheet, its rectangle (a table's range follows the table when it grows), and how the
    Issues panel names it ("Summary!C5:C9") */
export function refTarget(ref: DataRef | undefined, ctx: RenderCtx): { S: Sheet | null; g: Range | null; source: string; sheet: string } {
  if (!ref || typeof ref !== "object" || typeof ref.range !== "string") return { S: null, g: null, source: "?", sheet: "" };
  const def = "table" in ref ? (ctx.preset?.tables || []).find(t => t.id === ref.table) : undefined;
  const sheet = "table" in ref ? def?.sheet || "" : typeof ref.sheet === "string" ? ref.sheet : "";
  const range = ref.range.replace(/\$/g, "").toUpperCase().trim(), source = (sheet || "?") + "!" + range;
  const S = sheet ? ctx.sheet?.(sheet) ?? null : null;
  let g = /^[A-Z]{1,3}[0-9]{1,7}(:[A-Z]{1,3}[0-9]{1,7})?$/.test(range) ? parseRange(range) : null;
  if (!g || g.r2 < g.r1 || g.c2 < g.c1) return { S, g: null, source, sheet };
  // a table that grows with new rows: a range ending on the table's saved last row ends on its current one
  if (def && def.kind === "range" && def.grow) {
    const L = ctx.slides.flatMap(R => R.tables).find(t => t.def?.id === def.id);
    if (L && g.r2 === parseRange(def.range).r2 && L.g.r2 > g.r2) g = { ...g, r2: L.g.r2 };
  }
  if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > MAX_CELLS) return { S, g: null, source, sheet };
  return { S, g, source, sheet };
}
/** the text a cell shows: its formatted value, or the text a cell edit put there (while the Excel text is unchanged) */
function shown(S: Sheet, r: number, c: number, ctx: RenderCtx): string {
  const cell = S.get(r, c), t = cell ? formatValue(cell).text : "";
  const e = ctx.edits[S.name]?.[A1(r, c)];
  return e && e.text !== undefined && e.orig === t ? e.text : t;
}
const cutOf = (ctx: RenderCtx, S: Sheet) => (ctx.version?.hide[S.name] || []).map(parseRange);
/** the cells of a rectangle in reading order (rows, then columns), without hidden rows and columns */
function cellsOf(S: Sheet, g: Range): [number, number][] {
  const out: [number, number][] = [];
  for (let r = g.r1; r <= g.r2; r++) { if (S.rowHidden(r)) continue; for (let c = g.c1; c <= g.c2; c++) if (!S.colHidden(c)) out.push([r, c]); }
  return out;
}
const DATA = new WeakMap<Sheet, Map<string, ChartData>>();
/** the chart's numbers, labels and series name (cached per sheet object: a reload or a scenario's view is another one) */
export function chartData(it: ChartItem, ctx: RenderCtx): ChartData {
  const T = refTarget(it.values, ctx), source = T.source;
  if (!T.S || !T.g) return { ok: false, source, why: "missing" };
  const S = T.S, g = T.g, L = it.labels ? refTarget(it.labels, ctx) : null;
  const key = JSON.stringify([g, it.labels ? [L!.sheet, L!.g] : null, it.series ?? null, ctx.edits[S.name] || null, L?.S && L.S !== S ? ctx.edits[L.S.name] || null : null, ctx.version?.hide || null]);
  let m = DATA.get(S); if (!m) DATA.set(S, m = new Map());
  const hit = m.get(key); if (hit) return hit;
  const out = resolve(S, g, L, it, ctx, source);
  if (m.size > 200) m.clear();
  m.set(key, out);
  return out;
}
function resolve(S: Sheet, g: Range, L: ReturnType<typeof refTarget> | null, it: ChartItem, ctx: RenderCtx, source: string): ChartData {
  const cells = cellsOf(S, g), cut = cutOf(ctx, S), col = g.c1 === g.c2 && g.r2 > g.r1;
  const isCut = (r: number, c: number) => cut.some(x => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
  // labels: the item's range (cell k names value k), else the headers beside the values – the nearest column on the
  // left with text in those rows (a column of values), or the nearest row above (a row of values)
  const lcells = L?.S && L.g ? cellsOf(L.S, L.g) : null;
  let labelAt: (r: number, c: number, k: number) => string;
  if (lcells) labelAt = (_r, _c, k) => lcells[k] ? shown(L!.S!, lcells[k][0], lcells[k][1], ctx).trim() : "";
  else if (col) {
    let lc = 0;
    for (let c = g.c1 - 1; c >= 1 && c >= g.c1 - 30 && !lc; c--) for (let r = g.r1; r <= g.r2; r++) { const x = S.get(r, c); if (x && x.t === "s" && String(x.v).trim()) { lc = c; break; } }
    labelAt = (r, _c, k) => (lc ? shown(S, r, lc, ctx).trim() : "") || String(k + 1);
  } else {
    let lr = 0;
    for (let r = g.r1 - 1; r >= 1 && r >= g.r1 - 30 && !lr; r--) for (let c = g.c1; c <= g.c2; c++) { const x = S.get(r, c); if (x && x.t === "s" && String(x.v).trim()) { lr = r; break; } }
    labelAt = (_r, c, k) => (lr ? shown(S, lr, c, ctx).trim() : "") || String(k + 1);
  }
  const slices: Slice[] = [];
  cells.forEach(([r, c], k) => {
    const x = S.get(r, c);
    if (!x || x.t !== "n" || typeof x.v !== "number" || !Number.isFinite(x.v) || isCut(r, c)) return;
    slices.push({ label: labelAt(r, c, k) || numToCol(c) + r, v: x.v, text: formatValue(x).text });
  });
  if (!slices.length || !slices.some(s => s.v !== 0)) return { ok: false, source, why: "empty" };
  // the series name: the item's, else the nearest text above a column of values / left of a row of values (5 cells)
  let series = typeof it.series === "string" ? it.series : "";
  for (let k = 1; typeof it.series !== "string" && k <= 5 && !series; k++) {
    const r = col ? g.r1 - k : g.r1, c = col ? g.c1 : g.c1 - k;
    if (r < 1 || c < 1) break;
    const x = S.get(r, c);
    if (x && x.t === "s") series = shown(S, r, c, ctx).trim();
  }
  return { ok: true, source, series, slices };
}
/** what the chart is drawn from, as a cache key (the stage's layer key, 07 §3): the item, its data, the design's look */
export function chartKey(it: ChartItem, ctx: RenderCtx): string {
  return JSON.stringify([it, chartData(it, ctx), ctx.style.design, ctx.style.theme, ctx.style.colors, ctx.style.text?.note || null, ctx.style.radius, ctx.scenario || "", !!ctx.forExport]);
}

/* ---- look per design ---- */
const OFFICE = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E", "#636363", "#997300"];
const HEX = /^#[0-9A-Fa-f]{6}$/;
export interface ChartLook {
  colors: string[]; other: string | null; sep: { w: number; color: RGB; a: number }; gradient: boolean;
  family: string; ink: string; legend: "capsule" | "square" | "line"; card: "glass" | "plain" | null; pad: number;
}
export function chartLook(ctx: RenderCtx, family: string): ChartLook {
  const d = ctx.style.design, P = palette(ctx.style);
  if (isConsult(d)) {
    const C = specOf(ctx).chart, sep = parseColor(C.separator.color);
    return { colors: C.palette, other: C.other, sep: { w: C.separator.w, color: sep.c, a: sep.a }, gradient: false, family: C.label.family, ink: C.label.color,
      legend: C.legend.kind, card: null, pad: 8 };
  }
  if (d === "glass") {
    const t = themeOf(ctx.style), a1 = ctx.style.colors?.accent || t.a1;
    return { colors: [a1, t.a2, t.c3, t.c4, "#34C759", "#FF9F0A", "#FF3B30", "#5AC8FA", "#AF52DE", "#8E8E93"], other: null,
      sep: { w: 1, color: [255, 255, 255], a: .9 }, gradient: true, family, ink: "#0B0D17", legend: "capsule", card: "glass", pad: 18 };
  }
  // Excel: the theme's accent, then Office's chart colours; Excel Refined the same on its plain card
  const bg = parseColor(P.bg);
  return { colors: [P.accent, ...OFFICE.filter(c => c !== P.accent.toUpperCase())], other: null, sep: { w: 1, color: d === "clean" ? [255, 255, 255] : bg.c, a: 1 },
    gradient: false, family, ink: "#16181D", legend: "square", card: d === "clean" ? "plain" : null, pad: d === "clean" ? 14 : 6 };
}
const colourOf = (it: ChartItem, look: ChartLook, i: number) => {
  const own = it.colors?.[String(i)];
  if (typeof own === "string" && HEX.test(own)) return own.toUpperCase();
  return i < look.colors.length || !look.other ? look.colors[i % look.colors.length] : look.other;
};

/* ---- geometry ---- */
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const RAD = Math.PI / 180;
/** a point on a circle at `deg` clockwise from 12 o'clock */
const at = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.sin(deg * RAD), cy - r * Math.cos(deg * RAD)];
/** an arc from a0 to a1 (degrees, clockwise when a1 > a0) as cubic Béziers of at most 90° each, the pen already at its
    start */
export function arcCmds(cx: number, cy: number, r: number, a0: number, a1: number): PathCmd[] {
  const out: PathCmd[] = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9)), step = (a1 - a0) / n;
  for (let k = 0; k < n; k++) {
    const s = a0 + k * step, e = s + step, h = 4 / 3 * Math.tan(Math.abs(step) * RAD / 4) * r * Math.sign(step);
    const [x0, y0] = at(cx, cy, r, s), [x3, y3] = at(cx, cy, r, e);
    // the tangent at angle a (clockwise from 12 o'clock): (cos a, sin a)
    out.push(["C", r2(x0 + h * Math.cos(s * RAD)), r2(y0 + h * Math.sin(s * RAD)), r2(x3 - h * Math.cos(e * RAD)), r2(y3 - h * Math.sin(e * RAD)), r2(x3), r2(y3)]);
  }
  return out;
}
/** a slice: a wedge from the centre (pie) or a ring segment (donut, inner radius ri > 0); a whole turn is a circle / ring */
export function sliceCmds(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): PathCmd[] {
  const whole = a1 - a0 >= 360 - 1e-9, [sx, sy] = at(cx, cy, r, a0);
  if (ri <= 0) return whole ? [["M", r2(sx), r2(sy)], ...arcCmds(cx, cy, r, a0, a0 + 360), ["Z"]]
    : [["M", r2(cx), r2(cy)], ["L", r2(sx), r2(sy)], ...arcCmds(cx, cy, r, a0, a1), ["Z"]];
  const [ex, ey] = at(cx, cy, ri, a1);
  if (whole) { const [ix, iy] = at(cx, cy, ri, a0); return [["M", r2(sx), r2(sy)], ...arcCmds(cx, cy, r, a0, a0 + 360), ["Z"], ["M", r2(ix), r2(iy)], ...arcCmds(cx, cy, ri, a0 + 360, a0), ["Z"]]; }
  return [["M", r2(sx), r2(sy)], ...arcCmds(cx, cy, r, a0, a1), ["L", r2(ex), r2(ey)], ...arcCmds(cx, cy, ri, a1, a0), ["Z"]];
}
/** where a chart's parts go inside its box: the title line, the legend, the pie's centre and radii, each slice's angles
    (the stage's slice picking uses the same numbers, so a click selects the slice drawn under it) */
export interface PieGeom { cx: number; cy: number; r: number; ri: number; slices: { i: number; a0: number; a1: number }[] }
export function sliceAt(G: PieGeom, x: number, y: number): number | null {
  const dx = x - G.cx, dy = y - G.cy, d = Math.hypot(dx, dy);
  if (d > G.r || d < G.ri) return null;
  let a = Math.atan2(dx, -dy) / RAD; if (a < 0) a += 360;
  for (const s of G.slices) { const lo = ((s.a0 % 360) + 360) % 360, span = s.a1 - s.a0, rel = ((a - lo) % 360 + 360) % 360; if (rel <= span) return s.i; }
  return null;
}

/* ---- text ---- */
interface St { family: string; size: number; weight: number; italic: boolean; color: string }
const font = (s: St) => `${s.italic ? "italic " : ""}${s.weight} ${s.size}px ${s.family}`;
function textNode(m: Metrics, text: string, x: number, top: number, st: St, align: "left" | "center" | "right" = "left"): TextNode & { w: number } {
  const run = m.run(text, font(st)), w = Math.max(0, run.w), lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const lh = Math.round(st.size * 1.25), base = top + Math.floor((lh - (run.asc + run.desc)) / 2) + run.asc;
  return { t: "text", font: primaryFamily(st.family) || "Arial", css: st.family, weight: st.weight, ...(st.italic ? { i: true } : {}), size: st.size, x: r2(lx), y: r2(base), src: text, w, fill: solid(st.color) };
}
function ellipsis(m: Metrics, text: string, st: St, maxW: number): string {
  if (m.run(text, font(st)).w <= maxW + .01) return text;
  const ch = [...text]; let k = ch.length;
  while (k > 0 && m.run(ch.slice(0, k).join("") + "…", font(st)).w > maxW + .01) k--;
  return ch.slice(0, k).join("") + "…";
}
const lum = (hex: string) => { const [r, g, b] = parseColor(hex).c; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const pct = (p: number) => formatValue({ v: p, t: "n", fmt: p > 0 && p < .01 ? "0.0%" : "0%" }).text;

export interface ChartEnv { V: GlassVars; wall: Wallpaper | null; /** the design's text-box family (slide-dl.ts) */ family: string }
/** a chart item → its nodes, and the line for the Issues panel when its source is missing or holds no numbers */
export function chartNodes(it: ChartItem, id: string, box: Box, ctx: RenderCtx, m: Metrics, env: ChartEnv): { nodes: Node[]; issue: string | null; geom: PieGeom | null } {
  const { x, y, w, h } = box, look = chartLook(ctx, env.family), data = chartData(it, ctx), rk = ctx.style.radius / 100;
  const note = deckFmt(ctx, "note"), f = it.fmt || {};
  const base: St = { family: f.font ? fontStack(f.font) : note.font ? fontStack(note.font) : look.family, size: 14, weight: 400, italic: false, color: look.ink };
  const lab: St = { ...base, size: f.size && f.size > 0 ? +f.size : 14, weight: f.b ? 700 : 400, italic: !!f.i, color: HEX.test(f.color || "") ? f.color! : HEX.test(note.color || "") ? note.color! : look.ink };
  const ttl: St = { ...base, size: note.size && note.size > 0 ? +note.size : 18, weight: note.b === false ? 400 : 700, italic: !!note.i, color: HEX.test(note.color || "") ? note.color! : look.ink };
  const hitNode: Node = { t: "hit", kind: "item", id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...(data.ok ? { label: titleOf(it, data) } : {}) };
  const inner: Node[] = [];
  let issue: string | null = null, geom: PieGeom | null = null;
  if (!data.ok) {
    issue = data.why === "missing" ? `source ${data.source} not found` : `no numbers in ${data.source}`;
    // a placeholder on the stage (an export leaves the place empty, as a missing picture)
    if (!ctx.forExport) inner.push({ t: "rect", x: r2(x + .5), y: r2(y + .5), w: r2(Math.max(1, w - 1)), h: r2(Math.max(1, h - 1)), r: 6, fill: { solid: [255, 255, 255], a: .5 }, stroke: { w: 1, paint: solid("#9AA3B2"), dash: [5, 4] } },
      textNode(m, ellipsis(m, "Chart: " + issue, { ...base, size: 13, color: "#5B6274" }, w - 16), x + w / 2, y + h / 2 - 8, { ...base, size: 13, color: "#5B6274" }, "center"));
  } else {
    const pad = look.pad, X0 = x + pad, Y0 = y + pad, W0 = Math.max(10, w - 2 * pad), H0 = Math.max(10, h - 2 * pad);
    let top = Y0;
    const title = titleOf(it, data);
    if (title) { const lh = Math.round(ttl.size * 1.25); inner.push(textNode(m, ellipsis(m, title, ttl, W0), X0 + W0 / 2, top, ttl, "center")); top += lh + 8; }
    const total = data.slices.reduce((s, sl) => s + Math.abs(sl.v), 0), show = Array.isArray(it.show) ? it.show : ["percent"];
    const legendPos = it.legend === "bottom" || it.legend === "none" ? it.legend : "right";
    // the legend: one entry per value, a swatch and the label
    const sw = look.legend === "capsule" ? { w: 18, h: 10, r: 5 } : look.legend === "line" ? { w: 16, h: 2, r: 0 } : { w: 10, h: 10, r: 0 };
    const rowH = Math.max(18, Math.round(lab.size * 1.45)), entries = data.slices.map((s, i) => ({ i, label: s.label, color: colourOf(it, look, i) }));
    let plot = { x: X0, y: top, w: W0, h: Math.max(10, Y0 + H0 - top) };
    const legend: Node[] = [];
    // (the right legend is placed once the pie's size is known: beside it, the two centred in the box)
    let legendRight: ((lx: number) => void) | null = null, lwRight = 0;
    if (legendPos === "right") {
      const lw = lwRight = Math.min(W0 * .42, Math.max(...entries.map(e => m.run(e.label, font(lab)).w)) + sw.w + 8);
      const rows = Math.max(1, Math.min(entries.length, Math.floor(plot.h / rowH))), ly = plot.y + (plot.h - rows * rowH) / 2;
      legendRight = lx => entries.slice(0, rows).forEach((e, k) => {
        const yy = ly + k * rowH, last = k === rows - 1 && rows < entries.length, txt = last ? `+${entries.length - rows + 1} more` : e.label;
        if (!last) legend.push({ t: "rect", x: r2(lx), y: r2(yy + (rowH - sw.h) / 2), w: sw.w, h: sw.h, ...(sw.r ? { r: sw.r } : {}), fill: solid(e.color) });
        legend.push(textNode(m, ellipsis(m, txt, lab, lw - sw.w - 8), last ? lx : lx + sw.w + 8, yy + (rowH - Math.round(lab.size * 1.25)) / 2, lab));
      });
      plot = { ...plot, w: Math.max(10, plot.w - lw - 16) };
    } else if (legendPos === "bottom") {
      // entries flow left to right, centred, wrapping onto at most three rows
      const items = entries.map(e => ({ ...e, tw: Math.min(W0 - sw.w - 8, m.run(e.label, font(lab)).w) }));
      const lines: (typeof items)[] = [[]]; let lw = 0;
      for (const e of items) { const ew = sw.w + 8 + e.tw + 18; if (lw + ew > W0 && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(e); lw += ew; }
      const shownLines = lines.slice(0, 3), ly0 = Y0 + H0 - shownLines.length * rowH;
      shownLines.forEach((line, k) => {
        const full = line.reduce((s, e) => s + sw.w + 8 + e.tw + 18, -18); let xx = X0 + (W0 - full) / 2;
        for (const e of line) {
          legend.push({ t: "rect", x: r2(xx), y: r2(ly0 + k * rowH + (rowH - sw.h) / 2), w: sw.w, h: sw.h, ...(sw.r ? { r: sw.r } : {}), fill: solid(e.color) });
          legend.push(textNode(m, ellipsis(m, e.label, lab, e.tw), xx + sw.w + 8, ly0 + k * rowH + (rowH - Math.round(lab.size * 1.25)) / 2, lab));
          xx += sw.w + 8 + e.tw + 18;
        }
      });
      plot = { ...plot, h: Math.max(10, ly0 - 8 - plot.y) };
    }
    // the slices' angles; the labels each slice gets
    const start = Number.isFinite(it.startAngle) ? +it.startAngle! : 0;
    let a = start;
    const parts = data.slices.map((s, i) => {
      const span = total > 0 ? Math.abs(s.v) / total * 360 : 0, a0 = a; a += span;
      const words = [...(show.includes("label") ? [s.label] : []), ...(show.includes("value") ? [s.text] : []), ...(show.includes("percent") ? [pct(total > 0 ? Math.abs(s.v) / total : 0)] : [])];
      return { i, a0, a1: a0 + span, span, color: colourOf(it, look, i), words };
    }).filter(p => p.span > 0);
    // room around the pie for labels outside the thin slices: their leader and a line of text
    const thin = parts.length > 1 && parts.some(p => p.span < 30 && p.words.length), lh = Math.round(lab.size * 1.25);
    const r = Math.max(8, Math.min(plot.w / 2 - (thin ? 30 + 4 * lab.size : 2), plot.h / 2 - (thin ? 20 + lh : 2)));
    const outer = r + (thin ? 30 + 4 * lab.size : 0), group = legendRight ? Math.min(W0, 2 * outer + 16 + lwRight) : plot.w;
    const cx = legendRight ? X0 + (W0 - group) / 2 + outer : plot.x + plot.w / 2, cy = plot.y + plot.h / 2, ri = it.type === "donut" ? r2(r * .58) : 0;
    legendRight?.(Math.min(X0 + W0 - lwRight, cx + outer + 16));
    geom = { cx: r2(cx), cy: r2(cy), r: r2(r), ri, slices: parts.map(p => ({ i: p.i, a0: p.a0, a1: p.a1 })) };
    const sep: Paint = { solid: look.sep.color, a: look.sep.a };
    const slices: Node[] = [], labels: Node[] = [], hits: Node[] = [];
    const outside: { p: typeof parts[number]; y: number; right: boolean; lines: string[] }[] = [];
    for (const p of parts) {
      const d = sliceCmds(cx, cy, r, ri, p.a0, p.a1), c = parseColor(p.color).c;
      const fill: Paint = look.gradient ? { linear: [0, 0, 0, 1], stops: [{ o: 0, c: parseColor(mix(p.color, "#FFFFFF", .22)).c, a: 1 }, { o: 1, c, a: 1 }] } : { solid: c };
      slices.push({ t: "path", d, fill, ...(parts.length > 1 ? { stroke: { w: look.sep.w, paint: sep } } : {}) });
      // the slice's hit: the box around its wedge (the stage picks the slice by angle, sliceAt)
      const pts = [[cx, cy], at(cx, cy, r, p.a0), at(cx, cy, r, p.a1), ...[0, 90, 180, 270, 360, 450, 540, 630].filter(q => q > p.a0 && q < p.a1).map(q => at(cx, cy, r, q))];
      const hx = Math.min(...pts.map(q => q[0])), hy = Math.min(...pts.map(q => q[1])), hw = Math.max(...pts.map(q => q[0])) - hx, hh = Math.max(...pts.map(q => q[1])) - hy;
      hits.push({ t: "hit", kind: "slice", id: `${id}:${p.i}`, x: r2(hx), y: r2(hy), w: r2(Math.max(1, hw)), h: r2(Math.max(1, hh)), label: data.slices[p.i].label });
      if (!p.words.length) continue;
      const mid = (p.a0 + p.a1) / 2;
      // inside, on the mid-angle, when the slice is 12° or more and its text fits the slice there (its chord, and a
      // donut's ring); else outside with a leader
      const lr = parts.length === 1 && !ri ? 0 : ri ? (r + ri) / 2 : r * .62;
      const chord = 2 * lr * Math.sin(Math.min(p.span, 180) / 2 * RAD), tw = Math.max(...p.words.map(t => m.run(t, font(lab)).w));
      const fits = parts.length === 1 || (p.span >= 12 && tw <= chord * .9 && (!ri || p.words.length * lh <= (r - ri) * .9));
      if (fits) {
        // white on a dark slice
        const [lx, ly] = at(cx, cy, lr, mid);
        const st = { ...lab, color: lum(p.color) < .6 ? "#FFFFFF" : lab.color };
        p.words.forEach((t, k) => labels.push(textNode(m, t, lx, ly - p.words.length * lh / 2 + k * lh, st, "center")));
      } else {
        const [, ly] = at(cx, cy, r + 18, mid);
        outside.push({ p, y: ly, right: (((mid % 360) + 360) % 360) < 180, lines: [p.words.join(" ")] });
      }
    }
    // outside labels: a leader from the slice's edge, the text beyond it; on each side pushed apart so none overlap
    for (const right of [true, false]) {
      const side = outside.filter(o => o.right === right).sort((p, q) => p.y - q.y);
      for (let k = 1; k < side.length; k++) if (side[k].y < side[k - 1].y + lh) side[k].y = side[k - 1].y + lh;
      for (const o of side) {
        const mid = (o.p.a0 + o.p.a1) / 2, [ex, ey] = at(cx, cy, r, mid), [kx] = at(cx, cy, r + 12, mid), tx = right ? Math.max(kx, cx) + 8 : Math.min(kx, cx) - 8;
        labels.push({ t: "line", x1: r2(ex), y1: r2(ey), x2: r2(tx + (right ? -4 : 4)), y2: r2(o.y), stroke: { w: 1, paint: solid(look.ink === "#FFFFFF" ? "#FFFFFF" : "#8A93A3") } });
        labels.push(textNode(m, o.lines[0], tx, o.y - lh / 2, lab, right ? "left" : "right"));
      }
    }
    inner.push(...slices, ...labels, ...legend, ...hits);
  }
  // the card behind the chart: a glass card (Liquid Glass), a plain rounded card (Excel Refined), none (Excel, consulting)
  if (look.card === "glass") return { nodes: glassBox("gls wb card chart", x, y, w, h, Math.round(22 * rk), env.V, { x: 0, y: 0, scale: 1 }, env.wall, { content: inner, hit: { kind: "item", id, ...(data.ok ? { label: titleOf(it, data) } : {}) } }), issue, geom };
  if (look.card === "plain") {
    const X = Math.round(x), Y = Math.round(y), W = Math.round(x + w) - X, H = Math.round(y + h) - Y, rr = Math.round(8 * rk);
    return { nodes: [hitNode, { t: "shadow", x: X, y: Y, w: W, h: H, r: rr, dx: 0, dy: 8, blur: 24, spread: -12, c: [20, 30, 60], a: .18 }, { t: "shadow", x: X, y: Y, w: W, h: H, r: rr, dx: 0, dy: 1, blur: 3, spread: 0, c: [20, 30, 60], a: .06 },
      { t: "rect", x: X + .5, y: Y + .5, w: Math.max(0, W - 1), h: Math.max(0, H - 1), r: Math.max(0, rr - .5), fill: solid("#FFFFFF"), stroke: { w: 1, paint: solid("#E1E5EC") } }, ...inner], issue, geom };
  }
  return { nodes: [hitNode, ...inner], issue, geom };
}
/** the title a chart shows: its own ("" = none), else the series name */
export const titleOf = (it: ChartItem, data: ChartData) => (typeof it.title === "string" ? it.title : data.ok ? data.series : "").trim();
