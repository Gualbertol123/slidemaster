/* Series charts, columns and bars (4.7, S14.2; docs/next/09 §3.1–§3.2; CT-01, CT-02, LG-01): a chart with `sers` and
   type column or bar, drawn with the display list's own nodes –
   * the value axis (Excel's automatic bounds and unit, chart-axes.ts; or the axis's own min / max / step), its tick
     labels in the axis's number format (else the cells'), gridlines where the design or the axis asks for them;
   * the category axis: its labels (one per category, every n-th when they are too narrow), the axis line at zero;
   * the bars: clustered, stacked or 100 % (chart-bars.ts), Excel's gap width and overlap, per-point colours, the
     design's radius on the outer end (Liquid Glass) and its gradient, negative values below (left of) the axis;
   * data labels (value, name, category, percent; outside end, inside end, centre, inside base), white inside a dark
     bar, one left out where it does not fit, `points[i].label` replacing (or, null, hiding) one;
   * the legend (chart-legend.ts), the title (`titleFmt` over the deck's note style), and `hit` nodes: the item, and
     one `point` per bar ("<item>:<series>:<i>").
   seriesLayout is the one place that decides where each part goes: the display list (seriesNodes) and the PowerPoint
   chart (seriesSem: c:barChart with the same bounds, gap, overlap, plot rectangle as manualLayout and legend box) are
   both made from it, so a native chart's bars stand where the slide's do. */
import type { Box, ChartItem, TextFmt } from "../model/types";
import type { Node, Paint } from "../dl/types";
import type { Metrics } from "./excel-dl";
import type { RenderCtx } from "./context";
import type { BarsSem, BarSerSem, FontSem, LineSem } from "../pptx/chart-sem";
import { seriesData, type SeriesData } from "./chart-data";
import { autoScale, axisFormat, ticks, tickText, type Scale } from "./chart-axes";
import { barSlots, gapOf, outerRadius, overlapOf, stackBars, type Seg, type StackMode } from "./chart-bars";
import { legendAtOf, legendNodes, shownEntries, type LegendOut } from "./chart-legend";
import { ellipsis, font, lineH, lum, textNode, type St } from "./chart-font";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { fontStack } from "../model/fonts";
import { mix } from "../model/style";
import { parseColor, solid } from "../dl/color";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** what the design gives a series chart besides chart-dl.ts's ChartLook */
interface AxisLook { tick: string; grid: LineSem | null; gridOn: boolean; line: LineSem | null; card: { fill: string; a: number; line: string } }
function axisLook(ctx: RenderCtx): AxisLook {
  const d = ctx.style.design;
  if (isConsult(d)) {
    const S = specOf(ctx);
    // hairline axes, no gridlines unless the axis asks for them
    return { tick: S.chart.label.color, grid: { color: S.rule.color, w: 1 }, gridOn: false, line: { color: S.rule.color, w: 1 }, card: { fill: "#FFFFFF", a: 1, line: S.rule.color } };
  }
  if (d === "glass") return { tick: "#3C4253", grid: { color: "#C5CCDA", w: 1, dash: "sysDot" }, gridOn: true, line: { color: "#AEB6C6", w: 1 }, card: { fill: "#FFFFFF", a: .7, line: "#E1E5EC" } };
  // Excel and Excel Refined: Office's chart – grey tick labels, light gridlines, the category axis line
  return { tick: "#595959", grid: { color: "#D9D9D9", w: 1 }, gridOn: true, line: { color: "#BFBFBF", w: 1 }, card: { fill: "#FFFFFF", a: .9, line: "#D9D9D9" } };
}
/** a text format over a style (sizes 6–72 px, colours #RRGGBB only: an item's maps are merged without checks) */
export function withFmt(st: St, f: TextFmt | undefined): St {
  if (!f || typeof f !== "object") return st;
  const n = +(f.size as number);
  return { ...st, ...(f.font ? { family: fontStack(f.font) } : {}), ...(Number.isFinite(n) && n > 0 ? { size: Math.max(6, Math.min(72, n)) } : {}),
    ...(f.b !== undefined ? { weight: f.b ? 700 : 400 } : {}), ...(f.i !== undefined ? { italic: !!f.i } : {}), ...(HEX.test(f.color || "") ? { color: f.color!.toUpperCase() } : {}) };
}
export const fontSem = (s: St): FontSem => ({ css: s.family, size: s.size, color: s.color, b: s.weight >= 600, i: s.italic });

type Pos = "outEnd" | "inEnd" | "ctr" | "inBase";
interface Bar { s: number; i: number; v: number; x: number; y: number; w: number; h: number; color: string; dir: "up" | "down" | "right" | "left"; outer: boolean }
interface Lab { s: number; i: number; text: string; x: number; top: number; st: St; align: "left" | "center" | "right"; inside: boolean }
export interface SeriesLayout {
  data: Extract<SeriesData, { ok: true }>; dir: "col" | "bar"; mode: StackMode; gap: number; overlap: number;
  title: string; titleSt: St; /** the title's text box (the PowerPoint title's manual layout) */ titleBox: Box | null; plot: Box; scale: Scale; num: string; valSt: St; catSt: St; valShow: boolean; catShow: boolean; skip: number;
  look: AxisLook; grid: boolean; colors: string[]; bars: Bar[]; labs: Lab[]; legend: LegendOut; ticks: { v: number; text: string }[];
  /** each series' label settings (null = none), as drawn */ labels: (BarSerSem["labels"] | null)[];
  /** the series (indexes) out of the legend (legendHide) */ hidden: number[];
  issue: string | null;
}
export interface SeriesStyle { lab: St; ttl: St; family: string; colors: string[]; legend: "capsule" | "square" | "line"; ink: string; gradient: boolean; radius: number }

/** where every part of a column or bar chart goes inside its frame (the box less the card's padding) */
export function seriesLayout(it: ChartItem, frame: Box, ctx: RenderCtx, m: Metrics, sty: SeriesStyle): SeriesLayout | { why: "missing" | "empty"; source: string } {
  const data = seriesData(it, ctx);
  if (!data.ok) return { why: data.why, source: data.source };
  const dir = it.type === "bar" ? "bar" : "col", mode: StackMode = it.stack === "stacked" || it.stack === "percent" ? it.stack : "none";
  const look = axisLook(ctx), A = it.axes || {}, ser = data.series;
  const colors = ser.map((s, k) => s.color || (k < sty.colors.length ? sty.colors[k] : sty.colors[k % sty.colors.length]));
  const { x: X0, y: Y0, w: W0, h: H0 } = frame;
  let area: Box = { x: X0, y: Y0, w: W0, h: H0 };
  // the title: the item's ("" = none), else the series' name when there is one series (as Excel)
  const title = (typeof it.title === "string" ? it.title : ser.length === 1 ? ser[0].name : "").trim();
  const titleSt = withFmt(sty.ttl, it.titleFmt);
  let titleBox: Box | null = null;
  if (title) {
    const lh = lineH(titleSt), w = Math.min(W0, m.run(title, font(titleSt)).w);
    titleBox = { x: X0 + (W0 - w) / 2, y: Y0, w, h: lh };
    area = { ...area, y: area.y + lh + 8, h: Math.max(10, area.h - lh - 8) };
  }
  // the legend
  // (Excel lists a stacked chart's and a bar chart's series bottom-up in a legend beside the plot, as they are drawn)
  const at = legendAtOf(it), up = (dir === "bar" || mode !== "none") && at !== "top" && at !== "bottom";
  const entries = shownEntries(it, ser.map((s, k) => ({ key: s.id, label: s.name, color: colors[k] })));
  const legend = legendNodes(up ? entries.slice().reverse() : entries, at, area, sty.legend, sty.lab, m, look.card);
  area = legend.area;
  // the axes' text
  const valSt = withFmt({ ...sty.lab, color: look.tick }, A.y?.fmt), catSt = withFmt({ ...sty.lab, color: look.tick }, A.x?.fmt);
  const valShow = A.y?.show !== false, catShow = A.x?.show !== false;
  const { segs, lo, hi } = stackBars(ser.map(s => s.vals), mode);
  const num = axisFormat(A.y, mode === "percent", ser[0]?.fmt || "General");
  const tw = (t: string, st: St) => m.run(t, font(st)).w;
  const N = Math.max(1, data.cats.length), vlh = lineH(valSt), clh = lineH(catSt);
  let plot: Box, scale: Scale, tk: { v: number; text: string }[], skip = 1;
  const mkTicks = (s: Scale) => ticks(s).map(v => ({ v, text: tickText(v, num) }));
  if (dir === "col") {
    const top = area.y + (valShow ? Math.ceil(vlh / 2) : 4), catH = catShow ? clh + 6 : 0, h = Math.max(10, area.y + area.h - catH - top);
    scale = autoScale(lo, hi, { maxN: Math.floor(h / (vlh * 1.6)), axis: A.y, percent: mode === "percent" });
    tk = mkTicks(scale);
    const yw = valShow ? Math.max(...tk.map(t => tw(t.text, valSt))) + 8 : 0;
    plot = { x: area.x + yw, y: top, w: Math.max(10, area.w - yw - 4), h };
    const slot = plot.w / N;
    if (catShow && slot < 36) skip = Math.ceil(36 / slot);
  } else {
    const catW = catShow ? Math.min(area.w * .35, Math.max(...data.cats.map(c => tw(c, catSt))) + 10) : 0, valH = valShow ? vlh + 6 : 0;
    const w0 = Math.max(10, area.w - catW - 8);
    const wide = Math.max(...mkTicks(autoScale(lo, hi, { axis: A.y, percent: mode === "percent" })).map(t => tw(t.text, valSt)));
    scale = autoScale(lo, hi, { maxN: Math.floor(w0 / (wide + 16)), axis: A.y, percent: mode === "percent" });
    tk = mkTicks(scale);
    const half = valShow ? tw(tk[tk.length - 1].text, valSt) / 2 : 4;
    plot = { x: area.x + catW, y: area.y + 4, w: Math.max(10, area.w - catW - half - 2), h: Math.max(10, area.h - valH - 4) };
    const slot = plot.h / N;
    if (catShow && slot < clh + 2) skip = Math.ceil((clh + 2) / slot);
  }
  // values → px along the value axis (clamped to the plot: a bar beyond an axis's own bounds ends at its edge)
  const span = scale.max - scale.min || 1;
  const vp = (v: number) => {
    const t = Math.max(0, Math.min(1, (v - scale.min) / span));
    return dir === "col" ? plot.y + plot.h - t * plot.h : plot.x + t * plot.w;
  };
  const gap = gapOf(it.gap), overlap = overlapOf(it.overlap, mode), n = mode === "none" ? ser.length : 1;
  const slots = barSlots(n, gap, overlap), slot = (dir === "col" ? plot.w : plot.h) / N;
  const base = Math.max(scale.min, Math.min(scale.max, 0));
  const bars: Bar[] = [];
  for (const g of segs) {
    const s = ser[g.s], j = mode === "none" ? g.s : 0, own = s.src.points?.[String(g.i)]?.color;
    const color = typeof own === "string" && HEX.test(own) ? own.toUpperCase() : colors[g.s];
    const from = mode === "none" ? base : g.from, a = vp(from), b = vp(g.to);
    const bw = slots.w * slot, off = slots.off(j) * slot;
    if (dir === "col") {
      const x = plot.x + g.i * slot + off, y = Math.min(a, b), h = Math.abs(b - a);
      bars.push({ s: g.s, i: g.i, v: g.v, x, y, w: bw, h, color, dir: g.to >= from ? "up" : "down", outer: g.outer });
    } else {
      // Excel's bar chart: the first category at the bottom, the first series at the bottom of its cluster
      const y = plot.y + plot.h - (g.i + 1) * slot + (slot - off - bw), x = Math.min(a, b), w = Math.abs(b - a);
      bars.push({ s: g.s, i: g.i, v: g.v, x, y, w, h: bw, color, dir: g.to >= from ? "right" : "left", outer: g.outer });
    }
  }
  // data labels
  const labs: Lab[] = [], labels: SeriesLayout["labels"] = [];
  ser.forEach((s, k) => {
    const L = s.src.labels;
    // (a share – "percent" – exists on a 100 % chart only, as in Excel)
    const show = L && Array.isArray(L.show) ? L.show.filter((w): w is "value" | "name" | "category" | "percent" => w === "value" || w === "name" || w === "category" || (w === "percent" && mode === "percent")) : [];
    const custom = Object.entries(s.src.points || {}).filter(([, p]) => p && typeof p === "object" && "label" in p);
    if (!show.length && !custom.some(([, p]) => typeof p.label === "string")) { labels.push(null); return; }
    const raw = L?.pos, want: Pos = raw === "inEnd" ? "inEnd" : raw === "center" ? "ctr" : raw === "inBase" || raw === "below" || raw === "left" ? "inBase" : raw === "outEnd" || raw === "above" || raw === "right" ? "outEnd" : mode === "none" ? "outEnd" : "ctr";
    // (a stacked bar has no outside end in Excel or PowerPoint: inside end there)
    const pos: Pos = mode !== "none" && want === "outEnd" ? "inEnd" : want;
    const st = withFmt(sty.lab, L?.fmt), own = !!(L?.fmt && HEX.test(L.fmt.color || "")), numFmt = typeof L?.num === "string" && L.num.trim() ? L.num : null;
    const points: NonNullable<BarSerSem["labels"]>["points"] = [];
    for (const b of bars.filter(b => b.s === k)) {
      const p = s.src.points?.[String(b.i)], seg = segs.find(g => g.s === k && g.i === b.i) as Seg;
      let text: string;
      if (p && p.label === null) { points.push({ i: b.i, hide: true }); continue; }
      if (p && typeof p.label === "string") text = p.label;
      else {
        const share = mode === "percent" ? seg.to - seg.from : null;
        text = show.map(w => w === "value" ? (numFmt ? tickText(b.v, numFmt) : s.texts[b.i] || tickText(b.v, s.fmt)) : w === "name" ? s.name : w === "category" ? data.cats[b.i] || "" : tickText(share ?? 0, "0%")).filter(t => t).join(", ");
      }
      if (!text) { points.push({ i: b.i, hide: true }); continue; }
      const inside = pos !== "outEnd", white = inside && !own && lum(b.color) < .6, lst = white ? { ...st, color: "#FFFFFF" } : st;
      const w = tw(text, lst), lh = lineH(lst);
      // an inside label that does not fit its bar is left out (Excel would draw it over the edge)
      const len = dir === "col" ? b.h : b.w, across = dir === "col" ? b.w : b.h;
      if (inside && ((dir === "col" ? lh : w) + 4 > len || (dir === "col" ? w : lh) > across + 8)) { points.push({ i: b.i, hide: true }); continue; }
      let x: number, top: number, align: Lab["align"] = "center";
      if (dir === "col") {
        x = b.x + b.w / 2;
        const up = b.dir === "up", end = up ? b.y : b.y + b.h, start = up ? b.y + b.h : b.y;
        top = pos === "outEnd" ? (up ? end - lh - 2 : end + 2) : pos === "inEnd" ? (up ? end + 3 : end - lh - 3) : pos === "inBase" ? (up ? start - lh - 3 : start + 3) : b.y + (b.h - lh) / 2;
      } else {
        top = b.y + (b.h - lh) / 2;
        const right = b.dir === "right", end = right ? b.x + b.w : b.x, start = right ? b.x : b.x + b.w;
        if (pos === "ctr") x = b.x + b.w / 2;
        else if (pos === "outEnd") { x = right ? end + 4 : end - 4; align = right ? "left" : "right"; }
        else if (pos === "inEnd") { x = right ? end - 4 : end + 4; align = right ? "right" : "left"; }
        else { x = right ? start + 4 : start - 4; align = right ? "left" : "right"; }
      }
      labs.push({ s: k, i: b.i, text, x, top, st: lst, align, inside });
      // PowerPoint: our own texts (a point's label; a share, which a bar chart's labels cannot show) as static text
      const ownText = (p && typeof p.label === "string") || show.includes("percent");
      if (ownText || white) points.push({ i: b.i, ...(ownText ? { text } : {}), ...(white ? { color: "#FFFFFF" } : {}) });
    }
    labels.push({ show, pos, num: numFmt, font: fontSem(st), points });
  });
  const issue = data.issues.length ? data.issues.join("; ") : null;
  return { data, dir, mode, gap, overlap, title, titleSt, titleBox, plot, scale, num, valSt, catSt, valShow, catShow, skip, look,
    grid: typeof A.y?.grid === "boolean" ? A.y.grid : look.gridOn, colors, bars, labs, legend, ticks: tk, labels, issue,
    hidden: ser.flatMap((s, k) => entries.some(e => e.key === s.id) ? [] : [k]) };
}

/** the nodes of a laid-out column or bar chart: gridlines, bars, the axis line, labels, the axes' texts, the legend,
    the title, the point hits */
export function seriesNodes(L: SeriesLayout, id: string, frame: Box, m: Metrics, sty: SeriesStyle): Node[] {
  const out: Node[] = [], { plot, dir, scale } = L, span = scale.max - scale.min || 1;
  if (L.title) out.push(textNode(m, ellipsis(m, L.title, L.titleSt, frame.w), frame.x + frame.w / 2, frame.y, L.titleSt, "center"));
  const vp = (v: number) => { const t = Math.max(0, Math.min(1, (v - scale.min) / span)); return dir === "col" ? plot.y + plot.h - t * plot.h : plot.x + t * plot.w; };
  const stroke = (s: LineSem) => ({ w: s.w, paint: solid(s.color), ...(s.dash === "sysDot" ? { dash: [2, 3] } : s.dash === "dash" ? { dash: [6, 4] } : {}) });
  // gridlines (behind the bars)
  if (L.grid && L.look.grid) for (const t of L.ticks) {
    const p = r2(vp(t.v));
    out.push(dir === "col" ? { t: "line", x1: r2(plot.x), y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: stroke(L.look.grid) } : { t: "line", x1: p, y1: r2(plot.y), x2: p, y2: r2(plot.y + plot.h), stroke: stroke(L.look.grid) });
  }
  // the bars
  for (const b of L.bars) {
    if (!(b.w > 0 && b.h > 0)) continue;
    const c = parseColor(b.color).c, light = parseColor(mix(b.color, "#FFFFFF", .22)).c;
    const lin: [number, number, number, number] = b.dir === "up" ? [0, 0, 0, 1] : b.dir === "down" ? [0, 1, 0, 0] : b.dir === "right" ? [1, 0, 0, 0] : [0, 0, 1, 0];
    const fill: Paint = sty.gradient ? { linear: lin, stops: [{ o: 0, c: light, a: 1 }, { o: 1, c, a: 1 }] } : { solid: c };
    const r = b.outer && sty.radius > 0 ? outerRadius(sty.radius, b.dir, b.w, b.h) : 0;
    out.push({ t: "rect", x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), ...(r ? { r } : {}), fill });
  }
  // the category axis line, at zero (or the axis's end nearest it)
  const axisLine = L.look.line;
  if (axisLine) {
    const p = r2(vp(Math.max(scale.min, Math.min(scale.max, 0))));
    out.push(dir === "col" ? { t: "line", x1: r2(plot.x), y1: p, x2: r2(plot.x + plot.w), y2: p, stroke: stroke(axisLine) } : { t: "line", x1: p, y1: r2(plot.y), x2: p, y2: r2(plot.y + plot.h), stroke: stroke(axisLine) });
  }
  // data labels
  for (const l of L.labs) out.push(textNode(m, l.text, l.x, l.top, l.st, l.align));
  // the value axis's tick labels
  if (L.valShow) for (const t of L.ticks) {
    const p = vp(t.v), lh = lineH(L.valSt);
    out.push(dir === "col" ? textNode(m, t.text, plot.x - 6, p - lh / 2, L.valSt, "right") : textNode(m, t.text, p, plot.y + plot.h + 4, L.valSt, "center"));
  }
  // the category labels
  if (L.catShow) {
    const N = Math.max(1, L.data.cats.length), slot = (dir === "col" ? plot.w : plot.h) / N, lh = lineH(L.catSt);
    L.data.cats.forEach((c, i) => {
      if (i % L.skip) return;
      if (dir === "col") out.push(textNode(m, ellipsis(m, c, L.catSt, slot * L.skip - 4), plot.x + (i + .5) * slot, plot.y + plot.h + 4, L.catSt, "center"));
      else out.push(textNode(m, ellipsis(m, c, L.catSt, plot.x - frame.x - 8), plot.x - 6, plot.y + plot.h - (i + .5) * slot - lh / 2, L.catSt, "right"));
    });
  }
  out.push(...L.legend.nodes);
  // a hit per bar: the panel's point (per-point colour and label, S14.5)
  for (const b of L.bars) {
    const s = L.data.series[b.s];
    out.push({ t: "hit", kind: "point", id: `${id}:${s.id}:${b.i}`, x: r2(b.x), y: r2(b.y), w: r2(Math.max(1, b.w)), h: r2(Math.max(1, b.h)), label: `${s.name} · ${L.data.cats[b.i] || b.i + 1}: ${s.texts[b.i] || tickText(b.v, s.fmt)}` });
  }
  return out;
}

/** what the PowerPoint writer makes of the same layout: a c:barChart with these bounds, bars, labels and legend */
export function seriesSem(L: SeriesLayout): BarsSem {
  const ser: BarSerSem[] = L.data.series.map((s, k) => ({
    name: s.name, values: s.vals.slice(), color: L.colors[k], fmt: s.fmt,
    points: Object.entries(s.src.points || {}).flatMap(([i, p]) => p && typeof p.color === "string" && HEX.test(p.color) && +i >= 0 && +i < s.vals.length ? [{ i: +i, color: p.color.toUpperCase() }] : []),
    labels: L.labels[k] ?? null,
  }));
  const lp = L.legend.at === "right" ? "r" : L.legend.at === "left" ? "l" : L.legend.at === "top" ? "t" : L.legend.at === "top-right" ? "tr" : L.legend.at === "inside-tl" || L.legend.at === "inside-tr" ? "r" : "b";
  return {
    dir: L.dir, grouping: L.mode === "none" ? "clustered" : L.mode === "stacked" ? "stacked" : "percentStacked", gap: L.gap, overlap: L.overlap,
    cats: L.data.cats.slice(), series: ser, title: L.titleBox,
    val: { min: L.scale.min, max: L.scale.max, step: L.scale.step, num: L.num, grid: L.grid ? L.look.grid : null, line: null, show: L.valShow, font: fontSem(L.valSt) },
    cat: { line: L.look.line, show: L.catShow, font: fontSem(L.catSt), skip: L.skip },
    plot: { x: r2(L.plot.x), y: r2(L.plot.y), w: r2(L.plot.w), h: r2(L.plot.h) },
    legend: L.legend.box ? { pos: lp, box: L.legend.box, overlay: L.legend.at === "inside-tl" || L.legend.at === "inside-tr", hide: L.hidden } : null,
  };
}
