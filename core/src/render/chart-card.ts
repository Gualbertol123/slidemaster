/* The chart card (4.13, B54; ADR-015 amendment of 2026-10-23): parts of a series chart inside its own box, each switched
   on and off in the chart panel, the plot shrinking to make room (chart-series.ts seriesLayout reserves the bands
   cardRoom measures, so the PowerPoint chart's plot moves with it):
   * the corner tag – a small text in the title line's right corner ("ILLUSTRATIVE", "ACTUAL LOANS"), its own colour;
   * the stats row under the title – chips of a small caps label over a big value: a series' last / first / previous /
     lowest / highest value, a cell, a reference line's value, the last value's gap to a reference line (absolute or %;
     the gap coloured by sign);
   * the separator under the stats row;
   * the momentum row at the bottom – a label ("MOMENTUM") and chips of the last value's change against the first value,
     the lowest (since the trough), the highest (since the peak), the previous one, or a cell: absolute, %, or both,
     coloured by sign with its good direction, a caption under each ("vs Q3", "since trough", "WoW").
   Every number comes from the chart's own data (the filtered series, chart-data.ts) or a cell, so a reload, a scenario
   and "Run for each value" move them; a cell without a number shows "–" and says so in the Issues panel. The display
   list's own nodes only (texts, a line): in PowerPoint they are text boxes and a line shape over the native chart
   (overlayNodes), never pictures. Pure. */
import type { ChartItem, ChartMom, ChartStat, LineStyle } from "../model/types";
import type { Node } from "../dl/types";
import type { Metrics } from "./excel-dl";
import type { RenderCtx } from "./context";
import type { SerData } from "./chart-data";
import { refTarget } from "./chart-data";
import { cellOf, isGeneral, refValues, signed, targetLook } from "./chart-targets";
import { tickText } from "./chart-axes";
import { ellipsis, font, lineH, textNode, type St } from "./chart-font";
import { changeOf, changeText, goodColor, goodOf, shownSign, shownZero } from "./deltas";
import { lineStyleOf, lineStroke } from "./chart-lines";
import type { TextFmt } from "../model/types";
import { fmtAlign, fmtColor, fmtSize, layNum, layWord, offOf, partFmt, type CardPart } from "../model/textparts";
import { fontStack } from "../model/fonts";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const MINUS = "−";
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** the entries of a card map that are on, in n order (then id) */
function onEntries<T extends { n: number; off?: boolean }>(m: Record<string, T> | undefined): [string, T][] {
  return Object.entries(isObj(m) ? m : {}).filter(([, x]) => isObj(x) && !x.off)
    .sort(([a, p], [b, q]) => (Number.isFinite(+p.n) ? +p.n : 0) - (Number.isFinite(+q.n) ? +q.n : 0) || (a < b ? -1 : a > b ? 1 : 0)) as [string, T][];
}
/** the most chips a row draws (the panel adds no more; more on – another writer's – are named in the Issues panel) */
export const MAX_STATS = 4, MAX_MOMS = 6;
export const statsOf = (it: ChartItem) => onEntries<ChartStat>(it.stats).slice(0, MAX_STATS);
export const momsOf = (it: ChartItem) => onEntries<ChartMom>(it.moms).slice(0, MAX_MOMS);
const sepOf = (it: ChartItem): LineStyle | null => isObj(it.sep) ? it.sep as LineStyle : null;
const tagOf = (it: ChartItem) => isObj(it.tag) && (typeof it.tag.text === "string" ? !!it.tag.text.trim() : isObj(it.tag.text)) ? it.tag : null;
const subOf = (it: ChartItem) => typeof it.subtitle === "string" ? (it.subtitle.trim() ? it.subtitle : null) : isObj(it.subtitle) && typeof it.subtitle.range === "string" ? it.subtitle : null;
/** whether the chart has a card part (else it draws exactly as before 4.13) */
export const hasCard = (it: ChartItem) => statsOf(it).length > 0 || momsOf(it).length > 0 || !!sepOf(it) || !!tagOf(it) || !!subOf(it);
/** (B55) the subtitle's text: its own, or its cell's ("" and `issue` when its cell is not found) */
export function subtitleText(it: ChartItem, ctx: RenderCtx): { text: string; issue?: string } {
  const s = subOf(it);
  if (!s) return { text: "" };
  if (typeof s === "string") return { text: s.trim() };
  const c = cellOf(s, ctx);
  return c ? { text: c.text.trim() } : { text: "", issue: `the subtitle's cell ${refTarget(s, ctx).source} not found` };
}

/** the tag's text: its own, or its cell's (""; `issue` when its cell is not found) */
export function tagText(it: ChartItem, ctx: RenderCtx): { text: string; issue?: string } {
  const tag = tagOf(it);
  if (!tag) return { text: "" };
  if (typeof tag.text === "string") return { text: caps(it, "tag", tag.text.trim()) };
  const c = cellOf(tag.text, ctx);
  return c ? { text: caps(it, "tag", c.text.trim()) } : { text: "", issue: `the tag's cell ${refTarget(tag.text, ctx).source} not found` };
}
/** the card's text styles, from the chart's label style; (B56) each part's own format over it (`it.texts`) */
export interface CardStyles { label: St; value: St; tag: St; momVal: St; momCap: St; momHead: St; /** (B55) */ sub: St }
export function cardStyles(lab: St, ink: string, muted: string, it?: ChartItem): CardStyles {
  const s = lab.size, sz = (k: number) => Math.max(6, Math.round(s * k));
  const own = (st: St, part: CardPart) => it ? partStyle(st, partFmt(it, part)) : st;
  return {
    label: own({ ...lab, size: sz(.82), weight: 700, italic: false, color: muted }, "statLabel"),
    value: own({ ...lab, size: sz(1.9), weight: 700, italic: false, color: ink }, "statValue"),
    tag: own({ ...lab, size: sz(.78), weight: 700, italic: false, color: muted }, "tag"),
    momHead: own({ ...lab, size: sz(.86), weight: 700, italic: false, color: ink }, "momHead"),
    momVal: own({ ...lab, size: sz(.92), weight: 700, italic: false, color: ink }, "momVal"),
    momCap: own({ ...lab, size: sz(.82), weight: 400, italic: false, color: muted }, "momCap"),
    sub: own({ ...lab, size: sz(.86), weight: 400, italic: false, color: muted }, "sub"),
  };
}
/** a style with a part's format over it (6–72 px, as a chart's texts) */
export function partStyle(st: St, f: TextFmt | undefined): St {
  if (!f) return st;
  const z = fmtSize(f, 72), c = fmtColor(f);
  return { ...st, ...(f.font ? { family: fontStack(f.font) } : {}), ...(z ? { size: z } : {}), ...(f.b !== undefined ? { weight: f.b ? 700 : 400 } : {}),
    ...(f.i !== undefined ? { italic: !!f.i } : {}), ...(c ? { color: c } : {}) };
}
/** (B56) the card's spacing: under the title, above the plot (after the stats row), above the momentum row */
export const cardGaps = (it: ChartItem) => ({ head: layNum(it, "gapH", 0, 80) ?? 8, plot: layNum(it, "gapP", 0, 120) ?? 10, foot: layNum(it, "gapF", 0, 120) ?? 14 });
/** (B56) the tag's place: the title line's right corner, or a line of its own under the title */
export const tagBelow = (it: ChartItem) => layWord(it, "tag", ["right", "below"] as const) === "below";
const caps = (it: ChartItem, part: CardPart, t: string) => partFmt(it, part)?.caps === false ? t : t.toUpperCase();
/** the room the card's parts take: above the plot (a tag's own line when there is no title; the stats row and the
    separator) and below it (the momentum row), px */
export interface CardRoom { tagLine: number; top: number; bottom: number }
export function cardRoom(it: ChartItem, lab: St, hasTitle: boolean, ctx: RenderCtx): CardRoom {
  if (!hasCard(it)) return { tagLine: 0, top: 0, bottom: 0 };
  const S = cardStyles(lab, "#000000", "#000000", it), sep = sepOf(it), stats = statsOf(it).length, moms = momsOf(it), G = cardGaps(it);
  // (a tag whose text is empty – an empty cell – takes no line; B56: a tag placed under the title takes its own line too)
  const tagLine = tagOf(it) && (!hasTitle || tagBelow(it)) && tagText(it, ctx).text ? lineH(S.tag) + 6 : 0;
  // (B56: the space after the stats row – above the separator and the plot – from the layout, 10 px unless set)
  let top = stats ? 2 + lineH(S.label) + 2 + lineH(S.value) + G.plot : 0;
  // (B55) the subtitle's line, right under the title (a subtitle whose text is empty – an empty cell – takes none)
  if (subOf(it) && subtitleText(it, ctx).text) top += subRoom(S);
  if (sep) top += Math.max(.5, +(sep.w ?? 1) || 1) + 12;
  // (B56: the space above the plot, over the 10 px the stats row leaves)
  const caps = moms.some(([, k]) => capOf(k, null) !== "");
  const bottom = moms.length ? G.foot + lineH(S.momVal) + (caps ? 2 + lineH(S.momCap) : 0) : 0;
  return { tagLine, top, bottom };
}
/** the subtitle line's room: its line, and a little air before what follows */
const subRoom = (S: CardStyles) => lineH(S.sub) + 8;
/** a chip's caption: its own, else the automatic one (null: categories unknown yet – only whether there is one) */
function capOf(k: ChartMom, auto: string | null): string {
  if (typeof k.caption === "string") return k.caption.trim();
  return auto ?? "x";
}

/** what the card's parts need of the laid-out chart */
export interface CardFrame {
  frame: { x: number; y: number; w: number; h: number };
  /** the title line's height (0: no title) and its top */ titleH: number;
  /** where the stats row starts (under the title and its rule) and where the momentum row starts */ top: number; bottom: number;
  /** the rows left out for want of room (a box too small: seriesLayout) */ skip?: { stats?: boolean; sep?: boolean; moms?: boolean };
  series: SerData[]; cats: string[]; /** the value axis's number format (a General cell's fallback) */ num: string;
  lab: St; ink: string; sepColor: string;
  /** (B56) the chart's box (offsets are fractions of it), the tag's line when it has one of its own, the stage's drag hits */
  unit?: { w: number; h: number }; tagY?: number; hit?: (key: string, b: { x: number; y: number; w: number; h: number }) => void;
}
/** (B56) the x of each chip of a row: from the left in slots (as before 4.14), or as a group centred / spread to both
    edges, each chip its own width (or the width set) */
function chipXs(n: number, x0: number, W: number, slot0: number, align: "left" | "center" | "spread", own: number | undefined, widths: number[], gap: number): { x: number; w: number }[] {
  if (align === "left") { const sl = own ?? slot0; return widths.map((_, j) => ({ x: x0 + j * sl, w: sl })); }
  const ws = widths.map(w => own ?? Math.ceil(w) + 1), sum = ws.reduce((a, b) => a + b, 0);
  const g = align === "spread" && n > 1 ? Math.max(0, (W - sum) / (n - 1)) : own ? 0 : gap;
  let x = align === "spread" && n > 1 ? x0 : x0 + Math.max(0, (W - sum - g * (n - 1)) / 2);
  return ws.map(w => { const r = { x, w }; x += w + g; return r; });
}
/** the card's nodes and its Issues lines */
export function cardParts(it: ChartItem, F: CardFrame, ctx: RenderCtx, m: Metrics): { nodes: Node[]; issues: string[] } {
  const out: Node[] = [], issues: string[] = [];
  if (!hasCard(it)) return { nodes: out, issues };
  const look = targetLook(ctx, F.ink), S = cardStyles(F.lab, F.ink, look.muted, it), { x: X0, y: Y0, w: W0 } = F.frame;
  // (B56) a part dragged on the stage: its offset (fractions of the chart's box); the hits the stage drags
  const unit = F.unit || F.frame, off = (key: string) => offOf(it, key, unit), hit = F.hit || (() => undefined);
  const own = (part: CardPart) => partFmt(it, part);
  // the corner tag: in the title's line, at its right; else on a line of its own (B56: also under the title, when asked)
  const tag = tagOf(it);
  if (tag) {
    const T = tagText(it, ctx);
    if (T.issue) issues.push(T.issue);
    const st = { ...S.tag, color: fmtColor(own("tag")) ?? (HEX.test(tag.color || "") ? tag.color!.toUpperCase() : look.muted) };
    const below = tagBelow(it) && F.tagY !== undefined, lh = lineH(st), y = below ? F.tagY! : F.titleH ? Y0 + (F.titleH - lh) / 2 : Y0, o = off("tag");
    if (T.text) {
      const al = below ? fmtAlign(own("tag")) || "left" : "right", t = ellipsis(m, T.text, st, below ? W0 : W0 * .45);
      const n = textNode(m, t, (al === "left" ? X0 : al === "center" ? X0 + W0 / 2 : X0 + W0) + o.x, y + o.y, st, al);
      out.push(n); hit("tag", { x: n.x, y: y + o.y, w: n.w, h: lh });
    }
  }
  // (B55) the subtitle: the first line under the title
  let y = F.top;
  if (subOf(it) && !F.skip?.stats) {
    const T = subtitleText(it, ctx);
    if (T.issue) issues.push(T.issue);
    if (T.text) { out.push(textNode(m, ellipsis(m, T.text, S.sub, W0), X0, y - 4, S.sub)); y += subRoom(S); }
  }
  const on = (x: unknown) => Object.values(isObj(x) ? x : {}).filter(v => isObj(v) && !v.off).length;
  if (on(it.stats) > MAX_STATS) issues.push(`the stats row draws ${MAX_STATS} chips: ${on(it.stats) - MAX_STATS} more not drawn`);
  if (on(it.moms) > MAX_MOMS) issues.push(`the momentum row draws ${MAX_MOMS} chips: ${on(it.moms) - MAX_MOMS} more not drawn`);
  if (F.skip?.moms) issues.push("the chart is too small for its momentum row: not drawn");
  // ((B55) the subtitle goes with the stats row: named too)
  if (F.skip?.stats) { const gone = [subOf(it) ? "subtitle" : "", statsOf(it).length ? "stats row" : ""].filter(Boolean); if (gone.length) issues.push(`the chart is too small for its ${gone.join(" and ")}: not drawn`); }
  // the series a chip reads (its own, else the first) and its values
  const serOf = (sid: string | undefined) => (sid ? F.series.find(s => s.id === sid) : null) || F.series[0] || null;
  const fmtOf = (s: SerData | null, num?: string) => typeof num === "string" && num.trim() ? num : s && !isGeneral(s.fmt) ? s.fmt : F.num || "General";
  const pts = (s: SerData | null) => s ? s.vals.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => typeof p.v === "number" && Number.isFinite(p.v)) : [];
  const refs = (it.stats || it.moms) ? refValues(it, ctx, F.num) : [];
  // the stats row
  const stats = F.skip?.stats ? [] : statsOf(it);
  if (stats.length) {
    const slot = W0 / Math.max(3, stats.length), lhL = lineH(S.label);
    const chips = stats.map(([sid, k]) => {
      const s = serOf(k.s), P = pts(s), last = P[P.length - 1], fmt = fmtOf(s, k.num);
      let text = "–", col = fmtColor(own("statValue")) ?? F.ink, d: number | null = null;
      const R = k.ref ? refs.find(r => r.id === k.ref) : refs[0];
      switch (k.src) {
        case "first": case "last": case "prev": case "min": case "max": {
          const p = k.src === "first" ? P[0] : k.src === "last" ? last : k.src === "prev" ? P[P.length - 2]
            : P.length ? P.reduce((a, b) => (k.src === "min" ? b.v < a.v : b.v > a.v) ? b : a) : undefined;
          if (p) { text = tickText(p.v, fmt); d = p.v; } else issues.push(`stat '${label(k, sid)}': no ${k.src === "prev" ? "previous " : ""}value in the series`);
          break;
        }
        case "cell": {
          if (!k.cell) { issues.push(`stat '${label(k, sid)}': no cell`); break; }
          const c = cellOf(k.cell, ctx);
          if (!c) issues.push(`stat '${label(k, sid)}': ${refTarget(k.cell, ctx).source} not found`);
          else if (c.v === null) issues.push(`stat '${label(k, sid)}': no number in ${c.source}`);
          else { text = tickText(c.v, typeof k.num === "string" && k.num.trim() ? k.num : isGeneral(c.fmt) ? fmt : c.fmt); d = c.v; }
          break;
        }
        case "ref": {
          if (!R || R.v === null) issues.push(`stat '${label(k, sid)}': no reference line with a value`);
          else { text = typeof k.num === "string" && k.num.trim() ? tickText(R.v, k.num) : R.text; d = R.v; }
          break;
        }
        case "gap": case "gapPct": {
          if (!R || R.v === null) { issues.push(`stat '${label(k, sid)}': no reference line with a value`); break; }
          if (!last) { issues.push(`stat '${label(k, sid)}': no value in the series`); break; }
          const c = changeOf(last.v, R.v);
          d = c.d;
          if (k.src === "gap") { if (shownZero(c.d, fmt)) { d = 0; text = tickText(0, fmt); } else text = c.d < 0 ? MINUS + tickText(-c.d, fmt) : tickText(c.d, fmt); }
          else if (c.pct === null) { text = "n/a"; issues.push(`stat '${label(k, sid)}': the reference line is 0 – no %`); }
          else { const f = typeof k.num === "string" && k.num.trim() ? k.num : "0.0%"; if (shownZero(c.pct, f)) { d = 0; text = tickText(0, f); } else text = signed(c.pct, f); }
          break;
        }
      }
      const bySign = typeof k.signs === "boolean" ? k.signs : k.src === "gap" || k.src === "gapPct";
      if (bySign && d !== null) col = goodColor(d, goodOf(k.good), look, F.ink);
      const lt = caps(it, "statLabel", label(k, sid)), vs = { ...S.value, color: col };
      return { sid, lt, text, vs, w: Math.max(m.run(lt, font(S.label)).w, m.run(text, font(vs)).w) };
    });
    // (B56) the row: from the left in thirds (as before), centred or spread; each chip's texts aligned in it
    const align = layWord(it, "stats", ["left", "center", "spread"] as const) || "left", sw = layNum(it, "statW", 5, 100);
    const xs = chipXs(chips.length, X0, W0, slot, align, sw !== undefined ? W0 * sw / 100 : undefined, chips.map(c => c.w), 24);
    const la = fmtAlign(own("statLabel")) || "left", va = fmtAlign(own("statValue")) || "left";
    chips.forEach((c, j) => {
      const { x, w: cw } = xs[j], w = align === "left" ? Math.max(1, cw - 12) : Math.max(1, cw), o = off("st:" + c.sid);
      const at = (a: "left" | "center" | "right") => (a === "center" ? x + w / 2 : a === "right" ? x + w : x) + o.x;
      out.push(textNode(m, ellipsis(m, c.lt, S.label, w), at(la), y + 2 + o.y, S.label, la));
      out.push(textNode(m, ellipsis(m, c.text, c.vs, w), at(va), y + 2 + lhL + 2 + o.y, c.vs, va));
      hit("st:" + c.sid, { x: x + o.x, y: y + 2 + o.y, w: Math.min(w, Math.max(c.w, 8)) + (la === "left" && va === "left" ? 0 : w - Math.min(w, Math.max(c.w, 8))), h: lhL + 2 + lineH(c.vs) });
    });
    y += 2 + lhL + 2 + lineH(S.value) + cardGaps(it).plot;
  }
  // the separator
  const sep = F.skip?.sep ? null : sepOf(it);
  if (sep) {
    const L = lineStyleOf(sep, F.sepColor, 1), yy = Math.round(y + 6) + L.w / 2;
    out.push({ t: "line", x1: X0, y1: yy, x2: X0 + W0, y2: yy, stroke: lineStroke(L, "butt") });
  }
  // the momentum row
  const moms = F.skip?.moms ? [] : momsOf(it);
  if (moms.length) {
    const head = typeof it.momLabel === "string" ? it.momLabel.trim() : "MOMENTUM", y0 = F.bottom + cardGaps(it).foot, ht = caps(it, "momHead", head);
    let x0 = X0;
    if (head) {
      const o = off("mh"), n = textNode(m, ellipsis(m, ht, S.momHead, W0 * .3), X0 + o.x, y0 + o.y, S.momHead);
      out.push(n); hit("mh", { x: n.x, y: y0 + o.y, w: n.w, h: lineH(S.momHead) });
      x0 = X0 + Math.min(W0 * .3, m.run(ht, font(S.momHead)).w) + 28;
    }
    const slot = Math.max(10, (X0 + W0 - x0) / Math.max(3, moms.length));
    const chips = moms.map(([mid, k]) => {
      const s = serOf(k.s), P = pts(s), last = P[P.length - 1], fmt = fmtOf(s, k.num), show = k.show === "abs" || k.show === "pct" ? k.show : "both";
      let base: number | null = null, auto = "", text = "–", col = fmtColor(own("momVal")) ?? F.ink;
      const name = (i: number) => (F.cats[i] || "").trim();
      switch (k.vs) {
        case "first": if (P[0]) { base = P[0].v; auto = "vs " + name(P[0].i); } break;
        case "prev": { const p = P[P.length - 2]; if (p) { base = p.v; auto = "vs " + name(p.i); } break; }
        case "trough": if (P.length) { base = P.reduce((a, p) => Math.min(a, p.v), Infinity); auto = "since trough"; } break;
        case "peak": if (P.length) { base = P.reduce((a, p) => Math.max(a, p.v), -Infinity); auto = "since peak"; } break;
        case "cell": {
          if (!k.cell) break;
          const c = cellOf(k.cell, ctx);
          if (!c) issues.push(`momentum '${mid}': ${refTarget(k.cell, ctx).source} not found`);
          else if (c.v === null) issues.push(`momentum '${mid}': no number in ${c.source}`);
          else { base = c.v; auto = "vs " + c.text; }
          break;
        }
      }
      if (!last) issues.push(`momentum '${mid}': no value in the series`);
      else if (base === null) { if (k.vs !== "cell" || !k.cell) issues.push(`momentum '${mid}': ${k.vs === "cell" ? "no cell" : k.vs === "prev" ? "no previous value" : "no value"} to compare with`); }
      else {
        const c = changeOf(last.v, base);
        text = changeText(c, show, fmt);
        if (c.pct === null && show !== "abs") issues.push(`momentum '${mid}': the value compared with is 0 – no %`);
        col = goodColor(shownSign(c, show, fmt), goodOf(k.good), look, fmtColor(own("momVal")) ?? F.ink);
      }
      const cap = capOf(k, auto), vs = { ...S.momVal, color: col };
      return { mid, text, cap, vs, w: Math.max(m.run(text, font(vs)).w, cap ? m.run(cap, font(S.momCap)).w : 0) };
    });
    const align = layWord(it, "moms", ["left", "center", "spread"] as const) || "left", mw = layNum(it, "momW", 5, 100);
    const xs = chipXs(chips.length, x0, X0 + W0 - x0, slot, align, mw !== undefined ? W0 * mw / 100 : undefined, chips.map(c => c.w), 24);
    const va = fmtAlign(own("momVal")) || "left", ca = fmtAlign(own("momCap")) || "left";
    chips.forEach((c, j) => {
      const { x, w: cw } = xs[j], w = align === "left" ? Math.max(1, cw - 10) : Math.max(1, cw), o = off("mo:" + c.mid);
      const at = (a: "left" | "center" | "right") => (a === "center" ? x + w / 2 : a === "right" ? x + w : x) + o.x;
      out.push(textNode(m, ellipsis(m, c.text, c.vs, w), at(va), y0 + o.y, c.vs, va));
      if (c.cap) out.push(textNode(m, ellipsis(m, c.cap, S.momCap, w), at(ca), y0 + lineH(S.momVal) + 2 + o.y, S.momCap, ca));
      hit("mo:" + c.mid, { x: x + o.x, y: y0 + o.y, w: va === "left" && ca === "left" ? Math.min(w, Math.max(c.w, 8)) : w, h: lineH(S.momVal) + (c.cap ? 2 + lineH(S.momCap) : 0) });
    });
  }
  return { nodes: out, issues };
}
/** a stat's label: its own, else what it shows */
function label(k: ChartStat, id: string): string {
  if (typeof k.label === "string") return k.label;
  return ({ last: "Latest", first: "First", prev: "Previous", min: "Lowest", max: "Highest", cell: "Value", ref: "Reference", gap: "Gap", gapPct: "Gap %" } as Record<string, string>)[k.src] || id;
}
