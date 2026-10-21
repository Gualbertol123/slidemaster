/* Charts on slides (4.3, B16; docs/next/07 §3, ADR-015): a pie or donut drawn with the display list's own nodes – slices
   as `path`s (each arc as cubic Béziers of at most 90°, κ = 4/3·tan(θ/4), 0.5523 for a quarter), a separator stroke in
   the background colour, labels (`text`; outside with a `line` leader on a slice under 12°), a legend (`rect` swatch +
   `text`), a title, and `hit` nodes (the item over its box, one per slice). Liquid Glass draws it inside a glass card
   (glassBox: clip + blurred wallpaper + tint + shadows), Excel Refined on a plain rounded card, Excel and the consulting
   designs on the slide itself.
   Data: through ctx.sheet() like the tables, so a reload or a scenario's overlay redraws the chart; numbers only, blank,
   text and hidden cells skipped, the cells a version removes too; labels from the item's labels range, else the row /
   column headers beside the values. Colours: the item's colors[i], else the design's palette (resolved per design,
   model/style.ts palette / consult-spec.ts specOf). Pure: the stage, thumbnails and every export draw the same nodes.
   Since 4.7 (S14.2–S14.4, docs/next/09 §3): a column, bar, line, area, combo, scatter or waterfall chart with `sers` is laid out by
   chart-series.ts (axes, bars, lines, areas, labels, marks, legend) inside the same card; its data comes from
   chart-data.ts, where every cell rule now lives. A chart without `sers` draws exactly as before, whatever its type
   (09 §2.2). */
import type { Box, ChartItem } from "../model/types";
import type { Node, Paint, PathCmd, RGB } from "../dl/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import { glassBox, type GlassVars, type Wallpaper } from "./glass-dl";
import { formatValue } from "../xlsx/numfmt";
import { hashStr } from "../xlsx/util";
import { mix, palette, themeOf } from "../model/style";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { deckFmt } from "./text";
import { fontStack } from "../model/fonts";
import { parseColor, solid } from "../dl/color";
import type { ChartSem } from "../pptx/chart-sem";
import { cellsOf, chartData, hasSeries, refTarget, seriesData, type ChartData } from "./chart-data";
import { ellipsis, font, lum, textNode, type St } from "./chart-font";
import { cardNodes, fontSem, lineOrNone, overlayNodes, seriesLayout, seriesNodes, seriesSem, type SeriesStyle } from "./chart-series";
import { lineStroke } from "./chart-lines";

/* ---- data (chart-data.ts since S14.2: every cell rule in one place) ---- */
export { chartData, refTarget, type ChartData, type Slice } from "./chart-data";
/** what the chart is drawn from, as a cache key (the stage's layer key, 07 §3): the item, its data (a series chart's:
    every sheet's generation, so a reload or a scenario's overlay is another key), the design's look, the scenario's
    overlay hash, the export flag */
export function chartKey(it: ChartItem, ctx: RenderCtx): string {
  return JSON.stringify([it, hasSeries(it) ? seriesData(it, ctx) : chartData(it, ctx), ctx.style.design, ctx.style.theme, ctx.style.colors, ctx.style.contrast ?? null, ctx.style.color ?? null,
    ctx.style.text?.note || null, ctx.style.radius, ctx.scenario || "", !!ctx.forExport]);
}
/** the chart's nodes, built once per key (S14.2; 09 §3.2): the chart key plus where it stands, its id, the text-box
    family, the glass variables and wallpaper – a slide rebuilt without a change to the chart reuses them (nodes are
    never changed after they are built). The page measures text in rounds, each with a new measurer (excel-dl.ts
    measuredBuild: a probe that records what is asked, then the answers), so a hit is taken only when every text the
    chart measured measures the same again – asking the same measurer the same texts, so a probe still records them */
type Measured = [string, string, boolean, number, number, number, string];
/** the blurred wallpaper's content hash (FNV-1a over the whole data URL, S14.2 review 6: two wallpapers of one length
    and one tail no longer share a key), remembered for the few wallpapers a session holds */
const SRC_HASH = new Map<string, string>();
function srcHash(src: string): string {
  let h = SRC_HASH.get(src);
  if (h === undefined) { if (SRC_HASH.size > 8) SRC_HASH.clear(); SRC_HASH.set(src, h = hashStr(src)); }
  return h;
}
const NODES = new Map<string, { out: ReturnType<typeof chartNodes>; runs: Measured[] }>();
export function cachedChartNodes(it: ChartItem, id: string, box: Box, ctx: RenderCtx, m: Metrics, env: ChartEnv): ReturnType<typeof chartNodes> {
  const key = JSON.stringify([chartKey(it, ctx), id, box, env.family, env.V, env.wall ? [env.wall.blurId, srcHash(env.wall.blurSrc)] : null, !!env.noContent]);
  const hit = NODES.get(key);
  if (hit && hit.runs.every(([t, f, tn, w, a, d, adv]) => { const r = m.run(t, f, tn); return r.w === w && r.asc === a && r.desc === d && JSON.stringify(r.adv ?? null) === adv; })) return hit.out;
  const runs: Measured[] = [];
  const rec: Metrics = {
    run: (t, f, tn = false) => { const r = m.run(t, f, tn); runs.push([t, f, tn, r.w, r.asc, r.desc, JSON.stringify(r.adv ?? null)]); return r; },
    // (charts break no lines; a chart that did would not be cached, its breaks unchecked)
    // (wrapped text is not replayed: its NaN never compares equal, so a chart that wraps text is rebuilt every time – by
    // intent, S14.2 review 7)
    lines: (t, f, w) => { runs.push(["", "", false, NaN, NaN, NaN, ""]); return m.lines(t, f, w); },
  };
  const out = chartNodes(it, id, box, ctx, rec, env);
  if (NODES.size > 100) NODES.clear();
  NODES.set(key, { out, runs });
  return out;
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
/** slice i's colour of n: its own, else the design's palette – which never gives the last slice the first one's colour
    (they touch at 12 o'clock) */
const colourOf = (it: ChartItem, look: ChartLook, i: number, n = 0) => {
  const own = it.colors?.[String(i)];
  if (typeof own === "string" && HEX.test(own)) return own.toUpperCase();
  if (i >= look.colors.length && look.other) return look.other;
  const L = look.colors.length, k = i % L;
  return n > 1 && i === n - 1 && k === 0 && L > 1 ? look.colors[1] : look.colors[k];
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
export interface PieGeom { cx: number; cy: number; r: number; ri: number; slices: { i: number; a0: number; a1: number; label: string; color: string }[] }
export function sliceAt(G: { cx: number; cy: number; r: number; ri: number; slices: { i: number; a0: number; a1: number }[] }, x: number, y: number): number | null {
  const dx = x - G.cx, dy = y - G.cy, d = Math.hypot(dx, dy);
  if (d > G.r || d < G.ri) return null;
  let a = Math.atan2(dx, -dy) / RAD; if (a < 0) a += 360;
  for (const s of G.slices) { const lo = ((s.a0 % 360) + 360) % 360, span = s.a1 - s.a0, rel = ((a - lo) % 360 + 360) % 360; if (rel <= span) return s.i; }
  return null;
}

/* ---- text (chart-font.ts) ---- */
const pct = (p: number) => formatValue({ v: p, t: "n", fmt: p > 0 && p < .01 ? "0.0%" : "0%" }).text;

/** the chart's text: its labels' style (the item's fmt over the deck's note style), its title's (the note style, bold) */
function stylesOf(it: ChartItem, ctx: RenderCtx, look: ChartLook): { base: St; lab: St; ttl: St } {
  const note = deckFmt(ctx, "note"), f = it.fmt || {};
  const base: St = { family: f.font ? fontStack(f.font) : note.font ? fontStack(note.font) : look.family, size: 14, weight: 400, italic: false, color: look.ink };
  // sizes from a shared document: finite, 6–72 px (an item's fmt is map-merged without checks)
  const px = (v: unknown, d: number) => { const n = +(v as number); return Number.isFinite(n) && n > 0 ? Math.max(6, Math.min(72, n)) : d; };
  const lab: St = { ...base, size: px(f.size, 14), weight: f.b ? 700 : 400, italic: !!f.i, color: HEX.test(f.color || "") ? f.color! : HEX.test(note.color || "") ? note.color! : look.ink };
  const ttl: St = { ...base, size: px(note.size, 18), weight: note.b === false ? 400 : 700, italic: !!note.i, color: HEX.test(note.color || "") ? note.color! : look.ink };
  return { base, lab, ttl };
}
/** what a series chart takes of the design's look: the label and title styles, the palette, the legend's swatch, the
    gradient and the bars' corner radius (Liquid Glass's 4 px at 100 % roundness, none elsewhere) */
function seriesStyle(look: ChartLook, lab: St, ttl: St, rk: number): SeriesStyle {
  return { lab, ttl, family: look.family, colors: look.colors, legend: look.legend, ink: look.ink, gradient: look.gradient, radius: look.card === "glass" ? Math.round(4 * rk) : 0 };
}
export interface ChartEnv { V: GlassVars; wall: Wallpaper | null; /** the design's text-box family (slide-dl.ts) */ family: string;
  /** the card alone, without the pie, labels and legend (the PowerPoint export draws those as a native chart) */ noContent?: boolean }
/** a chart item → its nodes, and the line for the Issues panel when its source is missing or holds no numbers */
export function chartNodes(it: ChartItem, id: string, box: Box, ctx: RenderCtx, m: Metrics, env: ChartEnv): { nodes: Node[]; issue: string | null; geom: PieGeom | null;
  /** with noContent (the PowerPoint card): what is drawn over the native chart – dividers and marks (S14.3) */ overlay?: Node[] } {
  const { x, y, w, h } = box, look = chartLook(ctx, env.family), rk = ctx.style.radius / 100;
  const { base, lab, ttl } = stylesOf(it, ctx, look);
  // a series chart (4.7, S14.2: columns and bars) is laid out by chart-series.ts; a chart without series is a pie
  const frame = { x: x + look.pad, y: y + look.pad, w: Math.max(10, w - 2 * look.pad), h: Math.max(10, h - 2 * look.pad) };
  const sty = seriesStyle(look, lab, ttl, rk), SL = hasSeries(it) ? seriesLayout(it, frame, ctx, m, sty, id) : null;
  const data: ChartData = SL ? ("why" in SL ? { ok: false, source: SL.source, why: SL.why } : { ok: true, source: "", series: SL.title, slices: [] }) : chartData(it, ctx);
  const label = SL && !("why" in SL) ? SL.title : data.ok ? titleOf(it, data) : "";
  const hitNode: Node = { t: "hit", kind: "item", id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), ...(data.ok ? { label } : {}) };
  const inner: Node[] = [];
  let issue: string | null = null, geom: PieGeom | null = null, overlay: Node[] | undefined;
  if (SL && !("why" in SL)) {
    issue = SL.issue;
    // the frame round the chart (09 §2.2 `frame`: unset = the design's, which is none; "none" = none)
    const fr = lineOrNone(it.frame, null);
    if (fr) inner.push({ t: "rect", x: r2(x + fr.w / 2), y: r2(y + fr.w / 2), w: r2(Math.max(1, w - fr.w)), h: r2(Math.max(1, h - fr.w)), stroke: lineStroke(fr, "butt") });
    if (!env.noContent) inner.push(...seriesNodes(SL, id, frame, m, sty));
    // (the PowerPoint card: the title's rule under the native chart, the dividers and marks over it)
    else { inner.push(...cardNodes(SL)); overlay = overlayNodes(SL); }
  } else if (!data.ok) {
    issue = data.why === "missing" ? `source ${data.source} not found` : `no numbers in ${data.source}`;
    // a placeholder on the stage (an export leaves the place empty, as a missing picture)
    if (!ctx.forExport) inner.push({ t: "rect", x: r2(x + .5), y: r2(y + .5), w: r2(Math.max(1, w - 1)), h: r2(Math.max(1, h - 1)), r: 6, fill: { solid: [255, 255, 255], a: .5 }, stroke: { w: 1, paint: solid("#9AA3B2"), dash: [5, 4] } },
      textNode(m, ellipsis(m, "Chart: " + issue, { ...base, size: 13, color: "#5B6274" }, w - 16), x + w / 2, y + h / 2 - 8, { ...base, size: 13, color: "#5B6274" }, "center"));
  } else if (!env.noContent) {
    const pad = look.pad, X0 = x + pad, Y0 = y + pad, W0 = Math.max(10, w - 2 * pad), H0 = Math.max(10, h - 2 * pad);
    let top = Y0;
    const title = titleOf(it, data);
    if (title) { const lh = Math.round(ttl.size * 1.25); inner.push(textNode(m, ellipsis(m, title, ttl, W0), X0 + W0 / 2, top, ttl, "center")); top += lh + 8; }
    const total = data.slices.reduce((s, sl) => s + Math.abs(sl.v), 0), show = Array.isArray(it.show) ? it.show : ["percent"];
    const legendPos = it.legend === "bottom" || it.legend === "none" ? it.legend : "right";
    // the legend: one entry per value, a swatch and the label
    const sw = look.legend === "capsule" ? { w: 18, h: 10, r: 5 } : look.legend === "line" ? { w: 16, h: 2, r: 0 } : { w: 10, h: 10, r: 0 };
    const rowH = Math.max(18, Math.round(lab.size * 1.45)), entries = data.slices.map((s, i) => ({ i, label: s.label, color: colourOf(it, look, i, data.slices.length) }));
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
      const shownLines = lines.slice(0, 3), ly0 = Y0 + H0 - shownLines.length * rowH, more = items.length - shownLines.reduce((s, l) => s + l.length, 0);
      if (more > 0) { const last = shownLines[2], label = `+${more + 1} more`; last.splice(last.length - 1, 1, { ...last[last.length - 1], label, color: "", tw: m.run(label, font(lab)).w }); }
      shownLines.forEach((line, k) => {
        const full = line.reduce((s, e) => s + sw.w + 8 + e.tw + 18, -18); let xx = X0 + (W0 - full) / 2;
        for (const e of line) {
          if (e.color) legend.push({ t: "rect", x: r2(xx), y: r2(ly0 + k * rowH + (rowH - sw.h) / 2), w: sw.w, h: sw.h, ...(sw.r ? { r: sw.r } : {}), fill: solid(e.color) });
          legend.push(textNode(m, ellipsis(m, e.label, lab, e.tw), e.color ? xx + sw.w + 8 : xx, ly0 + k * rowH + (rowH - Math.round(lab.size * 1.25)) / 2, lab));
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
      return { i, a0, a1: a0 + span, span, color: colourOf(it, look, i, data.slices.length), words };
    }).filter(p => p.span > 0);
    // room around the pie for labels outside the thin slices: their leader and a line of text
    const thin = parts.length > 1 && parts.some(p => p.span < 30 && p.words.length), lh = Math.round(lab.size * 1.25);
    const r = Math.max(8, Math.min(plot.w / 2 - (thin ? 30 + 4 * lab.size : 2), plot.h / 2 - (thin ? 20 + lh : 2)));
    const outer = r + (thin ? 30 + 4 * lab.size : 0), group = legendRight ? Math.min(W0, 2 * outer + 16 + lwRight) : plot.w;
    // (the pie stays inside its box however much room its outside labels ask for)
    const cx = Math.max(X0 + r, Math.min(X0 + W0 - r, legendRight ? X0 + (W0 - group) / 2 + outer : plot.x + plot.w / 2)), cy = plot.y + plot.h / 2, ri = it.type === "donut" ? r2(r * .58) : 0;
    legendRight?.(Math.min(X0 + W0 - lwRight, cx + outer + 16));
    geom = { cx: r2(cx), cy: r2(cy), r: r2(r), ri, slices: parts.map(p => ({ i: p.i, a0: p.a0, a1: p.a1, label: data.slices[p.i].label, color: p.color })) };
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
      const lo = plot.y + lh / 2, hi = Math.max(lo, plot.y + plot.h - lh / 2);
      for (let k = 0; k < side.length; k++) side[k].y = Math.max(lo, k ? Math.max(side[k].y, side[k - 1].y + lh) : side[k].y);
      // pushed past the bottom: the column moves up as a whole
      for (let k = side.length - 1; k >= 0; k--) side[k].y = Math.min(side[k].y, k === side.length - 1 ? hi : side[k + 1].y - lh);
      for (const o of side) {
        // the text starts beyond the circle at the label's own height (a label pushed down never lands on the slices)
        const mid = (o.p.a0 + o.p.a1) / 2, [ex, ey] = at(cx, cy, r, mid), [kx] = at(cx, cy, r + 12, mid), ext = Math.sqrt(Math.max(0, (r + 6) ** 2 - (o.y - cy) ** 2));
        const tx = right ? Math.max(kx, cx + ext) + 8 : Math.min(kx, cx - ext) - 8, room = right ? X0 + W0 - tx : tx - X0;
        labels.push({ t: "line", x1: r2(ex), y1: r2(ey), x2: r2(tx + (right ? -4 : 4)), y2: r2(o.y), stroke: { w: 1, paint: solid(look.ink === "#FFFFFF" ? "#FFFFFF" : "#8A93A3") } });
        labels.push(textNode(m, ellipsis(m, o.lines[0], lab, Math.max(10, room)), tx, o.y - lh / 2, lab, right ? "left" : "right"));
      }
    }
    inner.push(...slices, ...labels, ...legend, ...hits);
  }
  // the card behind the chart: a glass card (Liquid Glass), a plain rounded card (Excel Refined), none (Excel, consulting)
  const more = overlay ? { overlay } : {};
  if (look.card === "glass") return { nodes: glassBox("gls wb card chart", x, y, w, h, Math.round(22 * rk), env.V, { x: 0, y: 0, scale: 1 }, env.wall, { content: inner, hit: { kind: "item", id, ...(data.ok ? { label } : {}) } }), issue, geom, ...more };
  if (look.card === "plain") {
    const X = Math.round(x), Y = Math.round(y), W = Math.round(x + w) - X, H = Math.round(y + h) - Y, rr = Math.round(8 * rk);
    return { nodes: [hitNode, { t: "shadow", x: X, y: Y, w: W, h: H, r: rr, dx: 0, dy: 8, blur: 24, spread: -12, c: [20, 30, 60], a: .18 }, { t: "shadow", x: X, y: Y, w: W, h: H, r: rr, dx: 0, dy: 1, blur: 3, spread: 0, c: [20, 30, 60], a: .06 },
      { t: "rect", x: X + .5, y: Y + .5, w: Math.max(0, W - 1), h: Math.max(0, H - 1), r: Math.max(0, rr - .5), fill: solid("#FFFFFF"), stroke: { w: 1, paint: solid("#E1E5EC") } }, ...inner], issue, geom, ...more };
  }
  return { nodes: [hitNode, ...inner], issue, geom, ...more };
}
/** what the PowerPoint export makes a native chart of (07 §4.2, B21): the slices' labels, values (the cells' own: a
    negative one too, as Excel's pie takes its size) and colours, the labels shown, the legend's place, the title and the
    fonts – the same choices as chartNodes – and the frame inside the card; null when the source holds no numbers */
export function chartSem(it: ChartItem, box: Box, ctx: RenderCtx, family: string, m?: Metrics): ChartSem | null {
  const look = chartLook(ctx, family);
  if (hasSeries(it)) return m ? seriesChartSem(it, box, ctx, look, m) : null;
  const data = chartData(it, ctx);
  if (!data.ok) return null;
  const note = deckFmt(ctx, "note"), f = it.fmt || {};
  const css = f.font ? fontStack(f.font) : note.font ? fontStack(note.font) : look.family;
  const px = (v: unknown, d: number) => { const n = +(v as number); return Number.isFinite(n) && n > 0 ? Math.max(6, Math.min(72, n)) : d; };
  const T = refTarget(it.values, ctx), first = T.S && T.g ? cellsOf(T.S, T.g).map(([r, c]) => T.S!.get(r, c)).find(x => x && x.t === "n") : null;
  const n = data.slices.length, pad = look.pad, hex = (c: RGB) => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  return {
    type: it.type === "donut" ? "donut" : "pie", title: titleOf(it, data), series: data.series,
    titleFont: { css, size: px(note.size, 18), color: HEX.test(note.color || "") ? note.color! : look.ink, b: note.b !== false, i: !!note.i },
    labelFont: { css, size: px(f.size, 14), color: HEX.test(f.color || "") ? f.color! : HEX.test(note.color || "") ? note.color! : look.ink, b: !!f.b, i: !!f.i },
    labels: data.slices.map(s => s.label), values: data.slices.map(s => s.v), colors: data.slices.map((_, i) => colourOf(it, look, i, n)),
    show: Array.isArray(it.show) ? it.show.filter(k => k === "label" || k === "value" || k === "percent") : ["percent"],
    legend: it.legend === "bottom" || it.legend === "none" ? it.legend : "right", startAngle: Number.isFinite(it.startAngle) ? +it.startAngle! : 0,
    box: { x: box.x + pad, y: box.y + pad, w: Math.max(10, box.w - 2 * pad), h: Math.max(10, box.h - 2 * pad) },
    sep: n > 1 ? { w: look.sep.w, color: hex(look.sep.color) } : null, fmt: first?.fmt || "General", hole: 58,
  };
}
/** a series chart for PowerPoint (09 §4.2; S14.2 columns and bars, S14.3 lines, areas, combos on two axes): the same
    layout as its display list (seriesLayout), so the native chart's plot, bounds, bars, lines, labels and legend are
    where the slide draws them; the pie fields carry the first series (what a reader of the old fields expects) */
function seriesChartSem(it: ChartItem, box: Box, ctx: RenderCtx, look: ChartLook, m: Metrics): ChartSem | null {
  const { lab, ttl } = stylesOf(it, ctx, look), rk = ctx.style.radius / 100, pad = look.pad;
  const frame = { x: box.x + pad, y: box.y + pad, w: Math.max(10, box.w - 2 * pad), h: Math.max(10, box.h - 2 * pad) };
  const L = seriesLayout(it, frame, ctx, m, seriesStyle(look, lab, ttl, rk));
  if ("why" in L) return null;
  const bars = seriesSem(L), first = bars.series[0];
  return {
    type: it.type === "bar" ? "bar" : it.type === "line" || it.type === "area" || it.type === "combo" || it.type === "scatter" || it.type === "waterfall" ? it.type : "column", title: L.title, series: first?.name || "", titleFont: fontSem(L.titleSt), labelFont: fontSem(lab),
    labels: bars.cats, values: (first?.values || []).map(v => v ?? 0), colors: bars.series.map(s => s.color), show: [],
    legend: bars.legend ? (bars.legend.pos === "b" ? "bottom" : "right") : "none", startAngle: 0, box: frame, sep: null, fmt: first?.fmt || "General", hole: 0, bars,
  };
}
/** the title a chart shows: its own ("" = none), else the series name */
export const titleOf = (it: ChartItem, data: ChartData) => (typeof it.title === "string" ? it.title : data.ok ? data.series : "").trim();
