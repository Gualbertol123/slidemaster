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
  if (typeof tag.text === "string") return { text: tag.text.trim().toUpperCase() };
  const c = cellOf(tag.text, ctx);
  return c ? { text: c.text.trim().toUpperCase() } : { text: "", issue: `the tag's cell ${refTarget(tag.text, ctx).source} not found` };
}
/** the card's text styles, from the chart's label style */
export interface CardStyles { label: St; value: St; tag: St; momVal: St; momCap: St; momHead: St; /** (B55) */ sub: St }
export function cardStyles(lab: St, ink: string, muted: string): CardStyles {
  const s = lab.size, sz = (k: number) => Math.max(6, Math.round(s * k));
  return {
    label: { ...lab, size: sz(.82), weight: 700, italic: false, color: muted },
    value: { ...lab, size: sz(1.9), weight: 700, italic: false, color: ink },
    tag: { ...lab, size: sz(.78), weight: 700, italic: false, color: muted },
    momHead: { ...lab, size: sz(.86), weight: 700, italic: false, color: ink },
    momVal: { ...lab, size: sz(.92), weight: 700, italic: false, color: ink },
    momCap: { ...lab, size: sz(.82), weight: 400, italic: false, color: muted },
    sub: { ...lab, size: sz(.86), weight: 400, italic: false, color: muted },
  };
}
/** the room the card's parts take: above the plot (a tag's own line when there is no title; the stats row and the
    separator) and below it (the momentum row), px */
export interface CardRoom { tagLine: number; top: number; bottom: number }
export function cardRoom(it: ChartItem, lab: St, hasTitle: boolean, ctx: RenderCtx): CardRoom {
  if (!hasCard(it)) return { tagLine: 0, top: 0, bottom: 0 };
  const S = cardStyles(lab, "#000000", "#000000"), sep = sepOf(it), stats = statsOf(it).length, moms = momsOf(it);
  // (a tag whose text is empty – an empty cell – takes no line)
  const tagLine = tagOf(it) && !hasTitle && tagText(it, ctx).text ? lineH(S.tag) + 6 : 0;
  let top = stats ? 2 + lineH(S.label) + 2 + lineH(S.value) + 10 : 0;
  // (B55) the subtitle's line, right under the title (a subtitle whose text is empty – an empty cell – takes none)
  if (subOf(it) && subtitleText(it, ctx).text) top += subRoom(S);
  if (sep) top += Math.max(.5, +(sep.w ?? 1) || 1) + 12;
  const caps = moms.some(([, k]) => capOf(k, null) !== "");
  const bottom = moms.length ? 14 + lineH(S.momVal) + (caps ? 2 + lineH(S.momCap) : 0) : 0;
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
}
/** the card's nodes and its Issues lines */
export function cardParts(it: ChartItem, F: CardFrame, ctx: RenderCtx, m: Metrics): { nodes: Node[]; issues: string[] } {
  const out: Node[] = [], issues: string[] = [];
  if (!hasCard(it)) return { nodes: out, issues };
  const look = targetLook(ctx, F.ink), S = cardStyles(F.lab, F.ink, look.muted), { x: X0, y: Y0, w: W0 } = F.frame;
  // the corner tag: in the title's line, at its right; else on a line of its own
  const tag = tagOf(it);
  if (tag) {
    const T = tagText(it, ctx);
    if (T.issue) issues.push(T.issue);
    const st = { ...S.tag, color: HEX.test(tag.color || "") ? tag.color!.toUpperCase() : look.muted };
    const lh = lineH(st), y = F.titleH ? Y0 + (F.titleH - lh) / 2 : Y0;
    if (T.text) out.push(textNode(m, ellipsis(m, T.text, st, W0 * .45), X0 + W0, y, st, "right"));
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
    stats.forEach(([sid, k], j) => {
      const s = serOf(k.s), P = pts(s), last = P[P.length - 1], fmt = fmtOf(s, k.num);
      let text = "–", col = F.ink, d: number | null = null;
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
      const x = X0 + j * slot, w = Math.max(1, slot - 12);
      out.push(textNode(m, ellipsis(m, label(k, sid).toUpperCase(), S.label, w), x, y + 2, S.label));
      out.push(textNode(m, ellipsis(m, text, { ...S.value, color: col }, w), x, y + 2 + lhL + 2, { ...S.value, color: col }));
    });
    y += 2 + lhL + 2 + lineH(S.value) + 10;
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
    const head = typeof it.momLabel === "string" ? it.momLabel.trim() : "MOMENTUM", y0 = F.bottom + 14;
    let x0 = X0;
    if (head) { out.push(textNode(m, ellipsis(m, head.toUpperCase(), S.momHead, W0 * .3), X0, y0, S.momHead)); x0 = X0 + Math.min(W0 * .3, m.run(head.toUpperCase(), font(S.momHead)).w) + 28; }
    const slot = Math.max(10, (X0 + W0 - x0) / Math.max(3, moms.length));
    moms.forEach(([mid, k], j) => {
      const s = serOf(k.s), P = pts(s), last = P[P.length - 1], fmt = fmtOf(s, k.num), show = k.show === "abs" || k.show === "pct" ? k.show : "both";
      let base: number | null = null, auto = "", text = "–", col = F.ink;
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
        col = goodColor(shownSign(c, show, fmt), goodOf(k.good), look, F.ink);
      }
      const x = x0 + j * slot, w = Math.max(1, slot - 10), cap = capOf(k, auto);
      out.push(textNode(m, ellipsis(m, text, { ...S.momVal, color: col }, w), x, y0, { ...S.momVal, color: col }));
      if (cap) out.push(textNode(m, ellipsis(m, cap, S.momCap, w), x, y0 + lineH(S.momVal) + 2, S.momCap));
    });
  }
  return { nodes: out, issues };
}
/** a stat's label: its own, else what it shows */
function label(k: ChartStat, id: string): string {
  if (typeof k.label === "string") return k.label;
  return ({ last: "Latest", first: "First", prev: "Previous", min: "Lowest", max: "Highest", cell: "Value", ref: "Reference", gap: "Gap", gapPct: "Gap %" } as Record<string, string>)[k.src] || id;
}
