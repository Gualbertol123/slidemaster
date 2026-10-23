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
import { changeOf, changeText, shownSign, shownZero, signedText } from "./deltas";
import { isDataRef, kpiDelta, kpiTone, type KpiItem, type KpiRow } from "../model/kpi";
import { cellOf, targetLook } from "./chart-targets";
import { refTarget } from "./chart-data";
import { tickText } from "./chart-axes";
import { ellipsis, font, lineH, lum, textNode, type St } from "./chart-font";
import { glassBox, type GlassVars, type Wallpaper } from "./glass-dl";
import { palette } from "../model/style";
import { isConsult } from "../model/designs";
import { specOf } from "./consult-spec";
import { ISP } from "./isp";
import { solid } from "../dl/color";
import type { TextFmt } from "../model/types";
import { fmtAlign, fmtColor, fmtSize, layNum, layOff, layWord, offOf, partFmt } from "../model/textparts";
import { fontStack } from "../model/fonts";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const isGeneral = (f: string) => !f || /^general$/i.test(f.trim());
export interface KpiEnv { V: GlassVars; wall: Wallpaper | null; family: string; m: Metrics }
/** one delta row as drawn: its text, its colour key, its label; or n/a */
export interface KpiRowOut { text: string; tone: "good" | "bad" | "neutral"; label: string }
/** a number format given on the card (a malformed one – not a string, or blank – is none) */
const fmtOf = (x: unknown) => typeof x === "string" && x.trim() ? x : "";
const MINUS = "−";
/** a change shown with its sign, the sign taken from the number AS SHOWN – render/deltas.ts's one rule (signedText): one
    that rounds to nothing reads "+0.0%" and is neutral, never "−0"; a format with its own sign is never doubled */
export function signedShown(d: number, fmt: string): { text: string; sign: number } {
  return { text: signedText(d, fmt), sign: shownZero(d, fmt) ? 0 : Math.sign(d) };
}
/** the card's texts and their colour keys, and the Issues lines (never throws) */
export function kpiData(it: KpiItem, ctx: RenderCtx): { title: string; value: string; tone: "good" | "bad" | "neutral"; rows: KpiRowOut[]; issues: string[] } {
  const issues: string[] = [];
  let title = "";
  if (typeof it.head === "string") title = it.head;
  else if (isDataRef(it.head)) { const c = cellOf(it.head, ctx); if (c) title = c.text; else issues.push(`title: ${refTarget(it.head, ctx).source} not found`); }
  let cur: number | null = null, value = "–", fmt = "General", tone: "good" | "bad" | "neutral" = "neutral";
  if (isDataRef(it.cur)) {
    const c = cellOf(it.cur, ctx);
    if (!c) issues.push(`value: ${refTarget(it.cur, ctx).source} not found`);
    else if (c.v === null) issues.push(`value: no number in ${c.source}`);
    else {
      cur = c.v; fmt = c.fmt;
      const t = tickText(c.v, fmtOf(it.num) || c.fmt), zero = !/[1-9]/.test(t);
      value = zero ? t.replace(/^-/, "") : t.replace(/^-/, MINUS);
      tone = kpiTone(zero ? 0 : Math.sign(c.v), it.good);
    }
  } else issues.push("value: no cell");
  const rows = (Array.isArray(it.rows) ? it.rows : []).map((r, i): KpiRowOut => rowOut(r, i));
  return { title, value, tone, rows, issues };
  function rowOut(r: KpiRow, i: number): KpiRowOut {
    const ok = !!r && typeof r === "object", label = ok && typeof r.label === "string" ? r.label : "", na = { text: "n/a", tone: "neutral" as const, label };
    const src = ok && r.src && typeof r.src === "object" ? r.src as Record<string, unknown> : undefined, num = ok ? fmtOf(r.num) : "", good = ok ? r.good : undefined;
    if (src && isDataRef(src.cell)) {
      const c = cellOf(src.cell, ctx);
      if (!c) { issues.push(`row ${i + 1}: ${refTarget(src.cell, ctx).source} not found`); return na; }
      if (c.v === null) { issues.push(`row ${i + 1}: no number in ${c.source}`); return na; }
      const s = signedShown(c.v, num || (isGeneral(c.fmt) ? "0.0%" : c.fmt));
      return { text: s.text, tone: kpiTone(s.sign, good), label };
    }
    if (src && isDataRef(src.ref)) {
      const c = cellOf(src.ref, ctx);
      if (!c) { issues.push(`row ${i + 1}: ${refTarget(src.ref, ctx).source} not found`); return na; }
      if (c.v === null) { issues.push(`row ${i + 1}: no number in ${c.source}`); return na; }
      if (cur === null) return na;
      const mode = src.mode === "abs" || src.mode === "both" ? src.mode : "pct", d = kpiDelta(cur, c.v, mode);
      if (!d.ok) { issues.push(`row ${i + 1}: ${d.why} (${c.source}): n/a`); return na; }
      // render/deltas.ts's one rule (the chart card's momentum chips too): "abs (%)" as the owner's picture, the sign and
      // colour of what is shown (the absolute change; the % alone in pct mode). The % in the row's format (pct mode) else
      // 0.0 %; the absolute part in the row's format, else the value cell's (General: one decimal with thousands)
      const ch = changeOf(cur, c.v), pf = mode === "pct" && num ? num : "0.0%", af = num || (isGeneral(fmt) ? "#,##0.0" : fmt);
      return { text: changeText(ch, mode, af, pf), tone: kpiTone(shownSign(ch, mode, af, pf), good), label };
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
/** the largest size from `size` down to `min` (0.5 px steps) at which the text fits `maxW`; below that the text is cut
    with an ellipsis at `min` and `cut` is set */
export function fitText(m: Metrics, text: string, st: St, maxW: number, min: number): { text: string; st: St; cut: boolean } {
  const w = (z: number) => m.run(text, font({ ...st, size: z })).w;
  for (let z = st.size; z >= min; z = r2(z - .5)) if (w(z) <= maxW + .01) return { text, st: { ...st, size: z }, cut: false };
  const at = { ...st, size: min };
  return w(min) <= maxW + .01 ? { text, st: at, cut: false } : { text: ellipsis(m, text, at, Math.max(0, maxW)), st: at, cut: true };
}
const MIN_TEXT = 7;
/** a style with a part's format over it (B56: font, size – 6–150 px –, colour, bold, italic) */
function styled(st: St, f: TextFmt | undefined): St {
  if (!f) return st;
  const z = fmtSize(f), c = fmtColor(f);
  return { ...st, ...(f.font ? { family: fontStack(f.font) } : {}), ...(z ? { size: z } : {}), ...(f.b !== undefined ? { weight: f.b ? 700 : 400 } : {}),
    ...(f.i !== undefined ? { italic: !!f.i } : {}), ...(c ? { color: c } : {}) };
}
/** the card's nodes (its hit first) and its Issues line */
export function kpiNodes(it: KpiItem, id: string, box: Box, ctx: RenderCtx, env: KpiEnv): { nodes: Node[]; issue: string | null } {
  const { x, y, w, h } = box, d = ctx.style.design, rk = ctx.style.radius / 100, D = kpiData(it, ctx);
  const ink = isConsult(d) ? specOf(ctx).note.ink : d === "glass" ? "#0B0D17" : "#16181D", T = targetLook(ctx, ink);
  const toneC = (t: "good" | "bad" | "neutral") => t === "good" ? T.pos : t === "bad" ? T.neg : T.zero;
  const label = [D.title, D.value, ...D.rows.map(r => r.text + " " + r.label)].join(" ");
  const cut: string[] = [];
  // (B56) each text's own format, the layout, the value's and the rows' offsets; on screen the hits the stage drags
  const F = { head: partFmt(it, "head"), value: partFmt(it, "value"), delta: partFmt(it, "delta"), label: partFmt(it, "label") };
  const screen = !ctx.forExport, drags: Node[] = [];
  const dragHit = (key: string, b: Box) => { if (screen) drags.push({ t: "hit", kind: "label", id: `${id}|${key}`, x: r2(b.x), y: r2(b.y), w: r2(Math.max(1, b.w)), h: r2(Math.max(1, b.h)), label: key }); };
  // (an aligned text in PowerPoint: a text box as wide as its section, aligned there – only when the part's alignment is set)
  const frameHit = (key: string, b: Box, al: "left" | "center" | "right") => { if (!screen) inner.push({ t: "hit", kind: "kbox", id: `${key}:${al === "center" ? "ctr" : al === "right" ? "r" : "l"}`, x: r2(b.x), y: r2(b.y), w: r2(Math.max(1, b.w)), h: r2(Math.max(1, b.h)) }); };
  // the card per design (as a callout's: shape-dl.ts lookOf)
  const C = isConsult(d) ? specOf(ctx) : null;
  const rad = Math.max(0, Math.min(C ? C.look.card.radius : d === "glass" ? Math.round(14 * rk) : Math.round(6 * rk), w / 2, h / 2));
  const inner: Node[] = [];
  // the header bar: the card's top corners, square at the bottom (one rect, its own corners: PowerPoint keeps it)
  const ownH = layNum(it, "headH", 8, 200), bar = !layOff(it, "bar");
  const hh = r2(ownH !== undefined ? Math.min(ownH, h * .6) : Math.max(Math.min(16, h * .4), Math.min(56, h * .26))), head = kpiHeadColor(ctx), rr = r2(Math.min(rad, hh));
  if (bar) inner.push({ t: "rect", x: r2(x), y: r2(y), w: r2(w), h: hh, r: [rr, rr, 0, 0], fill: solid(head) });
  const ownPad = layNum(it, "pad", 0, 80), pad = r2(ownPad !== undefined ? Math.min(ownPad, w / 4) : Math.max(4, Math.min(24, w * .04)));
  const t0: St = styled({ family: env.family, size: r2(Math.max(MIN_TEXT, Math.min(28, hh * .42))), weight: 700, italic: false, color: bar ? lum(head) < .5 ? "#FFFFFF" : "#16181D" : ink }, F.head);
  const tf = fitText(env.m, F.head?.caps === false ? D.title : D.title.toUpperCase(), t0, w - 2 * pad, Math.min(t0.size, MIN_TEXT));
  if (tf.text) {
    const al = fmtAlign(F.head) || "left", tx = al === "center" ? x + w / 2 : al === "right" ? x + w - pad : x + pad;
    if (fmtAlign(F.head)) frameHit("kh", { x: x + pad, y, w: w - 2 * pad, h: hh }, al);
    inner.push(textNode(env.m, tf.text, tx, y + (hh - lineH(tf.st)) / 2, tf.st, al));
  }
  if (tf.cut) cut.push("the title");
  // the body: the value on the left, the divider, the rows on the right
  const by = y + hh, bh = Math.max(0, h - hh), n = D.rows.length, split = layNum(it, "split", 10, 90);
  const vw = n ? w * (split !== undefined ? split / 100 : .36) : w;
  const v0: St = styled({ family: env.family, size: r2(Math.max(MIN_TEXT, Math.min(bh * .45, vw * .3, 120))), weight: 700, italic: false, color: toneC(D.tone) }, F.value);
  const vf = fitText(env.m, D.value, v0, vw - 2 * pad, Math.min(v0.size, MIN_TEXT * 1.5));
  if (vf.cut) cut.push("the value");
  if (lineH(vf.st) <= bh + .01) {
    const va = layWord(it, "valign", ["top", "middle", "bottom"] as const) || "middle", al = fmtAlign(F.value) || "left", lh = lineH(vf.st), mv = Math.min(bh * .14, (bh - lh) / 2);
    const vy = va === "top" ? by + mv : va === "bottom" ? by + bh - mv - lh : by + (bh - lh) / 2, o = offOf(it, "kv", { w, h });
    const vx = al === "center" ? x + vw / 2 : al === "right" ? x + vw - pad : x + pad;
    const vn = textNode(env.m, vf.text, vx + o.x, vy + o.y, vf.st, al);
    if (fmtAlign(F.value)) frameHit("kv", { x: x + pad + o.x, y: vy + o.y, w: vw - 2 * pad, h: lh }, al);
    inner.push(vn);
    dragHit("kv", { x: (al === "center" ? vx - vn.w / 2 : al === "right" ? vx - vn.w : vx) + o.x, y: vy + o.y, w: vn.w, h: lh });
  }
  if (n) {
    const dx = r2(x + vw), m = bh * .14;
    if (!layOff(it, "div")) inner.push({ t: "line", x1: dx, y1: r2(by + m), x2: dx, y2: r2(by + bh - m), stroke: { w: 1, paint: solid(T.muted === "#6E6E73" ? "#C7C7CC" : "#D0D5DD") } });
    // rows at a minimum pitch (the text's line and a little air): rows that do not fit the card are not drawn
    const own = fmtSize(F.delta), rs0 = own ?? r2(Math.max(MIN_TEXT, Math.min((bh - 2 * m) / n * .62, w * .045, 40)));
    const place = layWord(it, "rows", ["spread", "top", "middle", "bottom"] as const) || "spread", gap = layNum(it, "rowGap", 0, 80) ?? 4;
    const pitch = place === "spread" ? Math.max((bh - 2 * m) / n, Math.round(rs0 * 1.25) + 2) : Math.round(rs0 * 1.25) + gap;
    const rx = dx + pad, rw = Math.max(0, x + w - pad - rx), cw = rw * .42, fits = Math.max(0, Math.floor((bh - 2 * m + (place === "spread" ? 0 : gap)) / pitch + .001));
    const ds0: St = styled({ family: env.family, size: rs0, weight: 700, italic: false, color: T.zero }, F.delta && { ...F.delta, size: undefined, color: undefined });
    // the change column: one size for all rows (the widest fits), never cut above the minimum (a size of its own: kept)
    const sz = own ?? Math.min(...D.rows.map(r => fitText(env.m, r.text, ds0, cw - 4, MIN_TEXT).st.size), rs0);
    const shown = Math.min(fits, n), block = shown * pitch - (place === "spread" ? 0 : gap);
    const top0 = place === "top" ? by + m : place === "bottom" ? by + bh - m - block : place === "middle" ? by + (bh - block) / 2 : by + m;
    const o = offOf(it, "kr", { w, h }), da = fmtAlign(F.delta) || "right", la = fmtAlign(F.label) || "left";
    const lx0 = rx + cw + 8, lw = Math.max(0, rw - cw - 8);
    D.rows.slice(0, fits).forEach((r, i) => {
      const ds: St = { ...ds0, size: sz, color: fmtColor(F.delta) ?? toneC(r.tone) };
      const ls: St = styled({ family: env.family, size: sz, weight: 400, italic: false, color: T.muted }, F.label);
      const top = top0 + i * pitch + (place === "spread" ? (pitch - lineH(ds)) / 2 : 0) + o.y;
      const f = fitText(env.m, r.text, ds, cw - 4, sz);
      if (f.cut) cut.push(`row ${i + 1}'s change`);
      if (fmtAlign(F.delta)) frameHit("kd", { x: rx + o.x, y: top, w: cw - 4, h: lineH(ds) }, da);
      inner.push(textNode(env.m, f.text, (da === "left" ? rx : da === "center" ? rx + (cw - 4) / 2 : rx + cw - 4) + o.x, top, f.st, da));
      if (r.label) {
        const lt = ellipsis(env.m, r.label, ls, lw);
        if (fmtAlign(F.label)) frameHit("kl", { x: lx0 + o.x, y: top, w: lw, h: lineH(ls) }, la);
        inner.push(textNode(env.m, lt, (la === "center" ? lx0 + lw / 2 : la === "right" ? lx0 + lw : lx0) + o.x, top, ls, la));
      }
    });
    if (shown) dragHit("kr", { x: rx + o.x, y: top0 + o.y, w: rw, h: shown * pitch });
    if (fits < n) D.issues.push(`the card is too small for its rows: ${n - fits} of ${n} not shown`);
  }
  if (cut.length) D.issues.push(`${cut.join(", ")} cut to fit the card (make it larger)`);
  const issue = D.issues.length ? D.issues.join("; ") : null;
  const hit = { kind: "item", id, label };
  inner.push(...drags);
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
