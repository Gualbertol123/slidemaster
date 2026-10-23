/* A KPI card (B54, 4.13; model/kpi.ts): the design's card (Liquid Glass's glass, Excel Refined's plain card with its soft
   shadow, Excel's outlined box, the consulting designs' card tint), a dark header bar with the title in caps, the big
   current value coloured by its sign and good direction, a thin vertical divider and the delta rows (a coloured signed
   change, a grey label). Every size follows the box. Its cells are read through ctx.sheet() as a chart's (chart-targets
   cellOf), so a reload, a scenario and "Run for each value" redraw it. Display-list nodes only (ADR-004): rects, a line,
   texts – the PowerPoint export writes them as native shapes and text boxes. Pure. */
import type { Box } from "../model/types";
import type { Node } from "../dl/types";
import type { RenderCtx } from "./context";
import type { Metrics } from "./excel-dl";
import { isDataRef, kpiDelta, kpiTone, type KpiItem, type KpiRow } from "../model/kpi";
import { cellOf, signed, targetLook } from "./chart-targets";
import { refTarget } from "./chart-data";
import { tickText } from "./chart-axes";
import { ellipsis, lum, textNode, type St } from "./chart-font";
import { glassBox, type GlassVars, type Wallpaper } from "./glass-dl";
import { palette } from "../model/style";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { ISP } from "./isp";
import { solid } from "../dl/color";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const isGeneral = (f: string) => !f || /^general$/i.test(f.trim());
export interface KpiEnv { V: GlassVars; wall: Wallpaper | null; family: string; m: Metrics }
/** one delta row as drawn: its text, its colour key, its label; or n/a */
export interface KpiRowOut { text: string; tone: "good" | "bad" | "neutral"; label: string }
/** the card's texts and their colour keys, and the Issues lines (never throws) */
export function kpiData(it: KpiItem, ctx: RenderCtx): { title: string; value: string; tone: "good" | "bad" | "neutral"; rows: KpiRowOut[]; issues: string[] } {
  const issues: string[] = [];
  let title = "";
  if (typeof it.head === "string") title = it.head;
  else if (isDataRef(it.head)) { const c = cellOf(it.head, ctx); if (c) title = c.text; else issues.push(`title: ${refTarget(it.head, ctx).source} not found`); }
  let cur: number | null = null, value = "–", fmt = "General";
  if (isDataRef(it.cur)) {
    const c = cellOf(it.cur, ctx);
    if (!c) issues.push(`value: ${refTarget(it.cur, ctx).source} not found`);
    else if (c.v === null) issues.push(`value: no number in ${c.source}`);
    else { cur = c.v; fmt = c.fmt; value = tickText(c.v, it.num || c.fmt).replace(/^-/, "−"); }
  } else issues.push("value: no cell");
  const tone = cur === null ? "neutral" : kpiTone(Math.sign(cur), it.good);
  const rows = (Array.isArray(it.rows) ? it.rows : []).map((r, i): KpiRowOut => rowOut(r, i));
  return { title, value, tone, rows, issues };
  function rowOut(r: KpiRow, i: number): KpiRowOut {
    const label = typeof r?.label === "string" ? r.label : "", na = { text: "n/a", tone: "neutral" as const, label }, src = r?.src as Record<string, unknown> | undefined;
    if (src && isDataRef(src.cell)) {
      const c = cellOf(src.cell, ctx);
      if (!c) { issues.push(`row ${i + 1}: ${refTarget(src.cell, ctx).source} not found`); return na; }
      if (c.v === null) { issues.push(`row ${i + 1}: no number in ${c.source}`); return na; }
      return { text: signed(c.v, r.num || (isGeneral(c.fmt) ? "0.0%" : c.fmt)), tone: kpiTone(Math.sign(c.v), r.good), label };
    }
    if (src && isDataRef(src.ref)) {
      const c = cellOf(src.ref, ctx);
      if (!c) { issues.push(`row ${i + 1}: ${refTarget(src.ref, ctx).source} not found`); return na; }
      if (c.v === null) { issues.push(`row ${i + 1}: no number in ${c.source}`); return na; }
      if (cur === null) return na;
      const mode = src.mode === "abs" || src.mode === "both" ? src.mode : "pct", d = kpiDelta(cur, c.v, mode);
      if (!d.ok) { issues.push(`row ${i + 1}: ${d.why} (${c.source}): n/a`); return na; }
      const pct = d.pct !== null ? signed(d.pct, mode === "pct" && r.num ? r.num : "0.0%") : "";
      const abs = d.abs !== null ? signed(d.abs, r.num || (isGeneral(fmt) ? "General" : fmt)) : "";
      return { text: mode === "both" ? `${pct} (${abs})` : pct || abs, tone: kpiTone(d.sign, r.good), label };
    }
    issues.push(`row ${i + 1}: no source`); return na;
  }
}
/** the design's header bar colour: dark (the accent when it is dark, else a navy) */
export function kpiHeadColor(ctx: RenderCtx): string {
  // the consulting designs: their dark header band's colour (Navy's ink navy, Red's charcoal), as the slide's own band
  if (isConsult(ctx.style.design)) return ctx.style.design === "bain" ? "#1F1F1F" : "#051C2C";
  const a = palette(ctx.style).head;
  return lum(a) < .45 ? a.toUpperCase() : "#13293D";
}
/** the card's nodes (its hit first) and its Issues line */
export function kpiNodes(it: KpiItem, id: string, box: Box, ctx: RenderCtx, env: KpiEnv): { nodes: Node[]; issue: string | null } {
  const { x, y, w, h } = box, d = ctx.style.design, rk = ctx.style.radius / 100, D = kpiData(it, ctx);
  const ink = isConsult(d) ? specOf(ctx).note.ink : d === "glass" ? "#0B0D17" : "#16181D", T = targetLook(ctx, ink);
  const toneC = (t: "good" | "bad" | "neutral") => t === "good" ? T.pos : t === "bad" ? T.neg : T.zero;
  const label = [D.title, D.value, ...D.rows.map(r => r.text + " " + r.label)].join(" ");
  // the card per design (as a callout's: shape-dl.ts lookOf)
  const C = isConsult(d) ? specOf(ctx) : null;
  const rad = C ? C.look.card.radius : d === "glass" ? Math.round(14 * rk) : Math.round(6 * rk);
  const inner: Node[] = [];
  // the header bar: its top corners as the card's (a rounded rect clipped to the bar's height)
  const hh = r2(Math.max(16, Math.min(56, h * .26))), head = kpiHeadColor(ctx), rr = Math.min(rad, hh, w / 2);
  inner.push({ t: "group", clip: { x: r2(x), y: r2(y), w: r2(w), h: hh }, children: [{ t: "rect", x: r2(x), y: r2(y), w: r2(w), h: r2(hh + rr), r: rr, fill: solid(head) }] });
  const pad = r2(Math.max(6, Math.min(24, w * .04)));
  const ts: St = { family: env.family, size: r2(Math.max(8, Math.min(28, hh * .42))), weight: 700, italic: false, color: lum(head) < .5 ? "#FFFFFF" : "#16181D" };
  inner.push(textNode(env.m, ellipsis(env.m, D.title.toUpperCase(), ts, w - 2 * pad), x + pad, y + (hh - Math.round(ts.size * 1.25)) / 2, ts));
  // the body: the value on the left, the divider, the rows on the right
  const by = y + hh, bh = h - hh, n = D.rows.length;
  const vw = n ? w * .36 : w, vs: St = { family: env.family, size: r2(Math.max(10, Math.min(bh * .45, vw * .3, 120))), weight: 700, italic: false, color: toneC(D.tone) };
  inner.push(textNode(env.m, ellipsis(env.m, D.value, vs, vw - 2 * pad), x + pad, by + (bh - Math.round(vs.size * 1.25)) / 2, vs));
  if (n) {
    const dx = r2(x + vw), m = bh * .14;
    inner.push({ t: "line", x1: dx, y1: r2(by + m), x2: dx, y2: r2(by + bh - m), stroke: { w: 1, paint: solid(T.muted === "#6E6E73" ? "#C7C7CC" : "#D0D5DD") } });
    const pitch = (bh - 2 * m) / n, rs = r2(Math.max(7, Math.min(pitch * .62, w * .045, 40))), rx = dx + pad, rw = x + w - pad - rx;
    const cw = rw * .42;
    D.rows.forEach((r, i) => {
      const top = by + m + i * pitch + (pitch - Math.round(rs * 1.25)) / 2;
      const ds: St = { family: env.family, size: rs, weight: 700, italic: false, color: toneC(r.tone) };
      const ls: St = { family: env.family, size: rs, weight: 400, italic: false, color: T.muted };
      inner.push(textNode(env.m, ellipsis(env.m, r.text, ds, cw - 4), rx + cw - 4, top, ds, "right"));
      if (r.label) inner.push(textNode(env.m, ellipsis(env.m, r.label, ls, rw - cw - 8), rx + cw + 8, top, ls));
    });
  }
  const issue = D.issues.length ? D.issues.join("; ") : null;
  const hit = { kind: "item", id, label };
  if (d === "glass") return { nodes: glassBox("gls wb card kpi", x, y, w, h, rad, env.V, { x: 0, y: 0, scale: 1 }, env.wall, { content: inner, hit }), issue };
  const hitNode: Node = { t: "hit", kind: "item", id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), label };
  const X = r2(x), Y = r2(y), W = r2(w), H = r2(h);
  const shadow: Node[] = d === "clean" || (C && C.look.card.shadow) ? (() => { const s = C?.look.card.shadow; return s ? [{ t: "shadow", x: X, y: Y, w: W, h: H, r: rad, dx: 0, dy: s.dy, blur: s.blur, spread: s.spread, c: s.c, a: s.a } as Node]
    : [{ t: "shadow", x: X, y: Y, w: W, h: H, r: rad, dx: 0, dy: 8, blur: 24, spread: -12, c: [20, 30, 60], a: .18 } as Node, { t: "shadow", x: X, y: Y, w: W, h: H, r: rad, dx: 0, dy: 1, blur: 3, spread: 0, c: [20, 30, 60], a: .06 } as Node]; })() : [];
  const fill = C ? (C.bg === "#FFFFFF" ? C.card.fill : "#FFFFFF") : "#FFFFFF";
  const stroke = d === "excel" ? { w: ISP.box.w, paint: solid(ISP.box.border) } : d === "clean" ? { w: 1, paint: solid("#E1E5EC") } : undefined;
  const card: Node = { t: "rect", x: X, y: Y, w: W, h: H, r: rad, fill: solid(fill), ...(stroke ? { stroke } : {}) };
  return { nodes: [hitNode, ...shadow, card, ...inner], issue };
}
