/* A series chart's legend (F15; 09 §2.2, §3.1; S14.2, LG-01): `legendAt` – right, left, top, bottom, top-right,
   inside top-left / top-right (over the plot, on a card in the design's material), none – and `legendHide` (an entry
   out of the legend while its series is still drawn). An entry is the design's swatch (Liquid Glass's capsule, the
   consulting designs' square or line, Excel's square) and the series' name. What it returns: its nodes, the room left
   for the plot, and its box (the PowerPoint legend's manual layout, so PowerPoint puts it where it is drawn). */
import type { Box, ChartItem, LegendAt } from "../model/types";
import type { Node } from "../dl/types";
import type { Metrics } from "./excel-dl";
import { ellipsis, font, lineH, textNode, type St } from "./chart-font";
import { parseColor, solid } from "../dl/color";
import type { LineSem, MarkerSem } from "../pptx/chart-sem";
import { lineStroke, markerNode } from "./chart-lines";

/** an entry: its series' key, name and colour; a line series' (S14.3) swatch is its line and marker */
export interface LegendEntry { key: string; label: string; color: string; line?: LineSem; marker?: MarkerSem | null }
export interface LegendOut { nodes: Node[]; area: Box; box: Box | null; at: LegendAt;
  /** the PowerPoint legend's box (S14.3 review 1): `box` widened for PowerPoint's line keys, which are far wider than the
      slide's 16 px swatch (a box sized from the slide's entries loses its line entries); `box` itself when no line
      entry is shown */ ppt?: Box | null }
/** how much room a line series' legend key takes in PowerPoint beyond the slide's swatch: LibreOffice's key, the widest
    seen, is about 77 px at a 14 px legend font (5.5 em) against the slide's 10–18 px swatch – 5 em more covers it */
export const lineKeyExtra = (size: number) => Math.ceil(5 * size);
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const POS: LegendAt[] = ["right", "left", "top", "bottom", "top-right", "inside-tl", "inside-tr", "none"];
/** where a series chart's legend goes: legendAt, else the old key (right / bottom / none), else Excel's bottom */
export function legendAtOf(it: ChartItem): LegendAt {
  if (typeof it.legendAt === "string" && POS.includes(it.legendAt)) return it.legendAt;
  return it.legend === "right" || it.legend === "none" ? it.legend : "bottom";
}
/** the entries shown: every series' but those in legendHide */
export function shownEntries(it: ChartItem, all: LegendEntry[]): LegendEntry[] {
  const hide = it.legendHide && typeof it.legendHide === "object" ? it.legendHide : {};
  return all.filter(e => !hide[e.key]);
}
export function legendNodes(entries: LegendEntry[], at: LegendAt, area: Box, kind: "capsule" | "square" | "line", st: St, m: Metrics,
  card: { fill: string; a: number; line: string }): LegendOut {
  if (at === "none" || !entries.length) return { nodes: [], area, box: null, at };
  const sw = kind === "capsule" ? { w: 18, h: 10, r: 5 } : kind === "line" ? { w: 16, h: 2, r: 0 } : { w: 10, h: 10, r: 0 };
  const rowH = Math.max(18, Math.round(st.size * 1.45)), lh = lineH(st), out: Node[] = [];
  const swatch = (x: number, y: number, c: string, e?: LegendEntry) => {
    if (e?.line) {
      // a line series: a stroke across the swatch's width (at most 4 px) and its marker in the middle (at most 10 px)
      const cy = r2(y + rowH / 2);
      out.push({ t: "line", x1: r2(x), y1: cy, x2: r2(x + Math.max(sw.w, 16)), y2: cy, stroke: lineStroke({ ...e.line, w: Math.min(4, e.line.w) }) });
      if (e.marker) { const n = markerNode({ ...e.marker, size: Math.min(e.marker.size, 6) }, x + Math.max(sw.w, 16) / 2, y + rowH / 2, e.marker.color); if (n) out.push(n); }
      return;
    }
    out.push({ t: "rect", x: r2(x), y: r2(y + (rowH - sw.h) / 2), w: sw.w, h: sw.h, ...(sw.r ? { r: sw.r } : {}), fill: solid(c) });
  };
  const tw = (t: string) => m.run(t, font(st)).w;
  if (at === "top" || at === "bottom") {
    // entries flow left to right, centred, wrapping onto at most three rows
    const items = entries.map(e => ({ ...e, tw: Math.min(area.w - sw.w - 8, tw(e.label)) }));
    const lines: (typeof items)[] = [[]]; let lw = 0;
    for (const e of items) { const ew = sw.w + 8 + e.tw + 18; if (lw + ew > area.w && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push(e); lw += ew; }
    const rows = lines.slice(0, 3), more = items.length - rows.reduce((s, l) => s + l.length, 0);
    if (more > 0) { const last = rows[2], label = `+${more + 1} more`; last.splice(last.length - 1, 1, { ...last[last.length - 1], label, color: "", tw: tw(label) }); }
    const y0 = at === "top" ? area.y : area.y + area.h - rows.length * rowH;
    let bx = Infinity, bw = 0;
    rows.forEach((line, k) => {
      const full = line.reduce((s, e) => s + sw.w + 8 + e.tw + 18, -18); let x = area.x + (area.w - full) / 2;
      bx = Math.min(bx, x); bw = Math.max(bw, full);
      for (const e of line) {
        if (e.color) swatch(x, y0 + k * rowH, e.color, e);
        out.push(textNode(m, ellipsis(m, e.label, st, e.tw), e.color ? x + sw.w + 8 : x, y0 + k * rowH + (rowH - lh) / 2, st));
        x += sw.w + 8 + e.tw + 18;
      }
    });
    const h = rows.length * rowH, box = { x: r2(bx), y: r2(y0), w: r2(bw), h };
    // PowerPoint: the same flow with each line entry's key wider, centred where the slide's legend is centred
    let ppt: Box = box;
    if (items.some(e => e.line)) {
      const ex = lineKeyExtra(st.size), pl: number[] = [0];
      for (const e of items) { const ew = sw.w + 8 + e.tw + 18 + (e.line ? ex : 0); if (pl[pl.length - 1] + ew > area.w && pl[pl.length - 1] > 0) pl.push(0); pl[pl.length - 1] += ew; }
      const pw = Math.min(area.w, Math.max(...pl.map(w => w - 18))), ph = Math.min(3, pl.length) * rowH, cx = bx + bw / 2;
      const px = Math.max(area.x, Math.min(area.x + area.w - pw, cx - pw / 2));
      ppt = { x: r2(px), y: r2(at === "top" ? y0 : y0 + h - ph), w: r2(pw), h: ph };
    }
    // (the plot leaves room for the taller of the two: PowerPoint's wider keys may wrap onto another row)
    const H = Math.max(h, ppt.h);
    return { nodes: out, at, box, ppt, area: at === "top" ? { ...area, y: area.y + H + 8, h: Math.max(10, area.h - H - 8) } : { ...area, h: Math.max(10, area.h - H - 8) } };
  }
  // a column of entries: beside the plot (right, left, top-right) or over it (inside)
  const inside = at === "inside-tl" || at === "inside-tr", pad = inside ? 8 : 0;
  const lw = Math.min(area.w * (inside ? .5 : .42), Math.max(...entries.map(e => tw(e.label))) + sw.w + 8);
  const rows = Math.max(1, Math.min(entries.length, Math.floor((area.h - 2 * pad) / rowH))), h = rows * rowH;
  const x = at === "left" || at === "inside-tl" ? area.x + pad + (inside ? 8 : 0) : area.x + area.w - lw - pad - (inside ? 8 : 0);
  const y = at === "right" || at === "left" ? area.y + (area.h - h) / 2 : area.y + pad + (inside ? 8 : 0);
  if (inside) out.push({ t: "rect", x: r2(x - 8), y: r2(y - 6), w: r2(lw + 16), h: r2(h + 12), r: 6, fill: { solid: parseColor(card.fill).c, a: card.a }, stroke: { w: 1, paint: solid(card.line) } });
  entries.slice(0, rows).forEach((e, k) => {
    const yy = y + k * rowH, last = k === rows - 1 && rows < entries.length, txt = last ? `+${entries.length - rows + 1} more` : e.label;
    if (!last) swatch(x, yy, e.color, e);
    out.push(textNode(m, ellipsis(m, txt, st, lw - sw.w - 8), last ? x : x + sw.w + 8, yy + (rowH - lh) / 2, st));
  });
  const box = { x: r2(x), y: r2(y), w: r2(lw), h };
  // PowerPoint: one key column, wider when a shown entry is a line's; the outer edge kept (a right legend grows left) and
  // the plot clear of it on the slide too
  const ex = entries.slice(0, rows).some(e => e.line) ? lineKeyExtra(st.size) : 0, right = !(at === "left" || at === "inside-tl");
  const ppt = ex ? { x: r2(right ? Math.max(area.x, x - ex) : x), y: r2(y), w: r2(lw + ex), h } : box, W = lw + ex;
  if (inside) return { nodes: out, at, box, ppt, area };
  return { nodes: out, at, box, ppt, area: at === "left" ? { ...area, x: area.x + W + 16, w: Math.max(10, area.w - W - 16) } : { ...area, w: Math.max(10, area.w - W - 16) } };
}
