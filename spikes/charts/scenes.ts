/* What each slide of the 09 review decks adds to the slide the page draws (spikes/charts/decks/*.json): the prototypes of
   proto.ts placed on the real slide of each design. Exposed as window.P09.render by tools/p09-package.mjs. */
import type { DisplayList, HitNode, Node } from "../../core/src/dl/types";
import type { Design, Op } from "../../core/src/model/types";
import { consultOptions } from "../../core/src/model/designs";
import { caption, cfArrow, cfBar, chart, env, guideH, guideV, handle, icon, line, setIcons, spacing, type CellHit, type Env, type IconData, type PChart } from "./proto";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const RETAIL = [420, 455, 470, 510, 498, 530], CORP = [310, 300, 335, 360, 372, 390], SME = [150, 162, 158, 171, 180, 176], MARGIN = [2.1, 2.3, 2.2, 2.6, 2.5, 2.8];
const NAVY = "#1F3864", GREY = "#A6A6A6";

/** the owner's chart "Loans Volume – Weekly Evolution" (09 §3.3), with its numbers from spikes/charts/books/loans-weekly.xlsx */
const reference = (box: PChart["box"]): PChart => ({
  box, title: "Loans Volume - Weekly Evolution", titleColor: NAVY, titleRule: NAVY, frame: "#D9D9D9", legendAt: "none", catBold: NAVY, gap: 70,
  groups: [{ cats: ["Q3", "Week37", "Week38", "Week39"] }, { cats: ["Eom Budget", "EoM Ambition"], divider: true }],
  y: { min: 11000, max: 11700, step: 100, num: "#,##0" }, y2: { min: 0, max: 14000, step: 2000, num: "#,##0" },
  series: [
    { id: "vol", name: "Loans", type: "line", axis: "y", group: 0, smooth: true, color: NAVY, w: 3, vals: [11576, 11258, 11258, 11324],
      marker: { shape: "circle", size: 12 }, points: { 0: { marker: GREY } }, labels: { show: ["value"], pos: "above", b: true, size: 17, color: NAVY } },
    { id: "act", name: "Actual", type: "column", axis: "y2", group: 1, vals: [11324, 11324], target: [11624, 12000], points: { 0: { color: NAVY }, 1: { color: GREY } },
      labels: { show: ["ofTarget"], pos: "inEnd", b: true, size: 20, color: "#FFFFFF" } }],
  marks: [{ kind: "arrow", s: "vol", i: 0, color: NAVY, w: 2.5 },
    { kind: "icon", s: "act", i: 0, icon: "target", size: 30, dy: -40, color: NAVY }, { kind: "icon", s: "act", i: 1, icon: "target", size: 30, dy: -40, color: GREY },
    { kind: "text", s: "act", i: 0, text: "11.624", dy: -6, size: 24, color: NAVY }, { kind: "text", s: "act", i: 1, text: "12.000", dy: -6, size: 24, color: "#595959" }],
});
const series3 = (type: "column" | "bar" | "line", extra = {}) => [
  { id: "ret", name: "Retail", type, vals: RETAIL, ...extra }, { id: "corp", name: "Corporate", type, vals: CORP, ...extra }, { id: "sme", name: "SME", type, vals: SME, ...extra }] as PChart["series"];

/** the content area of every design's slide, below its title */
const Q = (k: number) => { const x0 = 70, y0 = 200, w = 720, h = 330, gx = 20, gy = 18; return { x: x0 + (k % 2) * (w + gx), y: y0 + Math.floor(k / 2) * (h + gy), w, h }; };

function charts(E: Env, slide: number): Node[] {
  switch (slide) {
    case 0: return chart(E, reference({ x: 110, y: 190, w: 1380, h: 620 }));
    case 1: return [
      ...chart(E, { box: Q(0), title: "Clustered column", legendAt: "bottom", groups: [{ cats: MONTHS }], series: series3("column") }),
      ...chart(E, { box: Q(1), title: "Stacked column · legend top-right, SME hidden from it", legendAt: "top-right", legendHide: ["sme"], groups: [{ cats: MONTHS }],
        series: series3("column", { stack: "a" }).map((s, i) => i === 0 ? { ...s, labels: { show: ["value"], pos: "center" as const, size: 12 } } : s) }),
      ...chart(E, { box: Q(2), title: "100 % stacked column · legend right", legendAt: "right", percent: true, groups: [{ cats: MONTHS }], series: series3("column", { stack: "a" }) }),
      ...chart(E, { box: Q(3), title: "Bar · labels outside end, no legend", legendAt: "none", horizontal: true, groups: [{ cats: MONTHS }],
        y: { min: 0, max: 600, step: 200 }, series: [{ id: "ret", name: "Retail", type: "bar", vals: RETAIL, labels: { show: ["value"], pos: "outEnd", size: 13 } }] })];
    case 2: return [
      ...chart(E, { box: Q(0), title: "Line with markers · legend bottom", legendAt: "bottom", groups: [{ cats: MONTHS }], y: { min: 100, max: 600, step: 100, grid: true },
        series: series3("line", { marker: { shape: "circle", size: 9 } }) }),
      ...chart(E, { box: Q(1), title: "Smoothed area, stacked · legend top", legendAt: "top", groups: [{ cats: MONTHS }], y: { min: 0, max: 1000, step: 250 },
        series: [{ id: "ret", name: "Retail", type: "area", smooth: true, vals: RETAIL.map((v, i) => v + CORP[i]) }, { id: "corp", name: "Corporate", type: "area", smooth: true, vals: CORP }] }),
      ...chart(E, { box: Q(2), title: "Scatter · margin against volume", legendAt: "none", groups: [{ cats: [] }], x: { min: 400, max: 950, step: 100 }, y: { min: 2, max: 3, step: .2, num: "0.0" },
        series: [{ id: "s", name: "Months", type: "scatter", xs: RETAIL.map((v, i) => v + CORP[i]), vals: MARGIN, labels: { show: ["value"], pos: "right", size: 12 }, points: Object.fromEntries(MONTHS.map((m, i) => [i, { label: m }])) }] }),
      ...chart(E, { box: Q(3), title: "Waterfall · budget bridge", legendAt: "none", waterfall: true, groups: [{ cats: ["Start", "Retail", "Corporate", "Costs", "Tax", "End"] }],
        y: { min: 0, max: 1400, step: 200 }, series: [{ id: "w", name: "Bridge", type: "column", vals: [900, 260, 180, -220, -90, 1030], labels: { show: ["value"], pos: "above", size: 13 } }] })];
    case 3: return chart(E, { box: { x: 110, y: 190, w: 1380, h: 620 }, title: "Combined: volumes (columns, left axis) and margin (line, right axis) · legend top, Corporate hidden from it",
      legendAt: "top", legendHide: ["corp"], groups: [{ cats: MONTHS }], y: { min: 0, max: 600, step: 100, grid: true }, y2: { min: 0, max: 3, step: .5, num: "0.0\" %\"" },
      series: [{ id: "ret", name: "Retail", type: "column", vals: RETAIL }, { id: "corp", name: "Corporate", type: "column", vals: CORP },
        { id: "m", name: "Margin %", type: "line", axis: "y2", vals: MARGIN, smooth: true, marker: { shape: "diamond", size: 11 }, labels: { show: ["value"], pos: "above", num: "0.0", b: true, size: 14 } }] });
    default: return [];
  }
}

/** lines and annotations (§3.4) around the slide's three callouts (made by the deck: c1 top-left, c2 top-right, c3 bottom-middle) */
function lines(E: Env): Node[] {
  const accent = E.look.colors[0], out: Node[] = [];
  out.push(...line(E, { route: "elbow", a: [300, 330], b: [620, 640], mid: 1, bend: "vh", hb: "triangle", w: 2.5, color: accent }));
  out.push(...handle(300, 330), ...handle(620, 640), ...handle(300, 485, "mid"));
  out.push(caption(E, "elbow callout line, selected: two end handles, one middle handle", 312, 470, "#2563EB", 13));
  out.push(...line(E, { route: "curve", a: [470, 255], b: [1130, 255], mid: -.18, hb: "stealth", w: 2, dash: "dashed", color: E.ink }));
  out.push(caption(E, "curved arrow, dashed, stealth head", 700, 268, "#5B6274", 13));
  out.push(...line(E, { route: "range", a: [1160, 420], b: [1460, 420], ha: "bar", hb: "bar", w: 2, color: accent, label: "+3,2 %" }));
  out.push(caption(E, "range marker (limiters at both ends)", 1160, 438, "#5B6274", 13));
  out.push(...line(E, { route: "bracket", a: [1010, 560], b: [1010, 700], mid: 18, curly: true, w: 2, color: E.ink, label: "H2" }));
  out.push(caption(E, "curly bracket", 1050, 710, "#5B6274", 13));
  out.push(...line(E, { route: "bracket", a: [140, 760], b: [520, 760], mid: -14, w: 2, color: E.ink, label: "Weeks 37–39" }));
  out.push(caption(E, "square bracket under a range", 140, 772, "#5B6274", 13));
  out.push(...line(E, { route: "straight", a: [1080, 520], b: [1460, 520], w: 1.5, dash: "dashed", color: E.rule }));
  out.push(caption(E, "divider", 1400, 530, "#5B6274", 13));
  out.push(...line(E, { route: "straight", a: [1200, 790], b: [1460, 600], ha: "oval", hb: "arrow", w: 3, color: E.look.colors[1] || accent }));
  out.push(caption(E, "straight, oval + open arrow heads, 3 px", 1150, 800, "#5B6274", 13));
  return out;
}

/** snapping guides (§5) while the right card is dragged: top edges, equal spacing, the slide's centre */
function snapping(E: Env): Node[] {
  return [
    guideH(300, 120, 1480), guideV(800, 170, 840, true),
    ...spacing(E, 480, 640, 470, "160"), ...spacing(E, 960, 1120, 470, "160"),
    { t: "rect", x: 1126, y: 306, w: 320, h: 150, r: 12, stroke: { w: 1.5, paint: { solid: [37, 99, 235] }, dash: [5, 4] } },
    caption(E, "pointer here (dashed) – dropped snapped: top edge, equal spacing 160 px; the icon's centre on the slide's centre", 160, 812, "#FF2D92", 15)];
}

/** Tabler icons on the slide (§3.5): outline and filled, the design's ink and palette, three sizes and strokes */
function icons(E: Env): Node[] {
  const names = ["target", "trending-up", "trending-down", "building-bank", "currency-euro", "chart-bar", "chart-line", "chart-pie", "alert-triangle", "circle-check",
    "flag", "users", "calendar", "clock", "map-pin", "bulb", "lock", "report-money"];
  const out: Node[] = [], cols = 9, x0 = 110, y0 = 200, dx = 152, dy = 150;
  names.forEach((n, k) => {
    const x = x0 + (k % cols) * dx, y = y0 + Math.floor(k / cols) * dy, c = k % 3 === 0 ? E.ink : E.look.colors[(k % 5) % E.look.colors.length];
    out.push(...icon(n, x + 36, y, 56, c), caption(E, n, x + 64, y + 66, "#5B6274", 12, "center"));
  });
  const filled = ["star", "heart", "circle-check", "alert-triangle", "flag", "map-pin"];
  filled.forEach((n, k) => { const x = x0 + k * dx, y = 520; out.push(...icon(n, x + 36, y, 56, E.look.colors[k % E.look.colors.length], true), caption(E, n + " (filled)", x + 64, y + 66, "#5B6274", 12, "center")); });
  [[24, 1.5], [40, 2], [64, 2], [96, 1.5]].forEach(([s, st], k) => out.push(...icon("target", 1060 + k * 0 + [0, 40, 100, 190][k], 640 - s, s, E.ink, false, st)));
  out.push(caption(E, "sizes 24 · 40 · 64 · 96, stroke 1,5–2", 1060, 660, "#5B6274", 12));
  return out;
}

/* ---- the tables decks: Excel conditional formats drawn into the real table (§3.10) ---- */
const parseIt = (s: string) => { const t = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.\-+]/g, ""); return t === "" || isNaN(+t) ? null : +t; };
function tableHits(list: DisplayList): { group: Node[]; hits: CellHit[] }[] {
  const out: { group: Node[]; hits: CellHit[] }[] = [];
  const walk = (ns: Node[]) => {
    const hits = ns.filter((n): n is HitNode => n.t === "hit" && n.kind === "t").map(n => { const [r, c] = n.id.split(",").map(Number); return { r, c, x: n.x, y: n.y, w: n.w, h: n.h, label: n.label || "" }; });
    if (hits.length) out.push({ group: ns, hits });
    ns.forEach(n => { if (n.t === "group") walk(n.children); });
  };
  walk(list);
  return out;
}
function conditional(E: Env, list: DisplayList): void {
  for (const { group, hits } of tableHits(list)) {
    const totals = new Set(hits.filter(c => /^TOTAL$/i.test(c.label)).map(c => c.r));
    const col = (head: string) => { const h = hits.find(c => c.label === head); return h ? hits.filter(c => c.c === h.c && c.r > h.r && !totals.has(c.r) && parseIt(c.label) != null) : []; };
    const loans = col("Loans").filter(c => c.label !== ""), delta = col("Δ w/w"), dep = col("Deposits");
    const max = Math.max(...loans.map(c => Math.abs(parseIt(c.label)!)), 1);
    const firstText = group.findIndex(n => n.t === "text");
    const bars = loans.map(c => cfBar(parseIt(c.label)!, max, c, E.design));
    group.splice(firstText < 0 ? group.length : firstText, 0, ...bars);
    for (const c of delta) { const v = parseIt(c.label)!, s = Math.min(16, c.h - 6); group.push(cfArrow(v > 2 ? 1 : v < -2 ? -1 : 0, c.x + 4, c.y + (c.h - s) / 2, s, E.design)); }
    // a 3-colour scale on Deposits (red – yellow – green), Excel's default
    const dv = dep.map(c => parseIt(c.label)!), lo = Math.min(...dv), hi = Math.max(...dv);
    const at = group.findIndex(n => n.t === "text");
    dep.forEach((c, k) => {
      const t = (dv[k] - lo) / (hi - lo || 1), mixc = (a: number[], b: number[], f: number) => a.map((v, i) => Math.round(v + (b[i] - v) * f)) as [number, number, number];
      const rgb = t < .5 ? mixc([248, 105, 107], [255, 235, 132], t * 2) : mixc([255, 235, 132], [99, 190, 123], (t - .5) * 2);
      group.splice(at, 0, { t: "rect", x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2, r: E.design === "glass" ? 6 : 0, fill: { solid: rgb, a: E.design === "glass" ? .55 : E.design === "mckinsey" || E.design === "bain" ? .35 : 1 } });
    });
    return;
  }
}

export function render(deck: string, slide: number, design: Design, consult: Record<string, unknown> | null, deckOps: Op[], iconData: IconData,
  nodes: DisplayList, images: Record<string, string>): DisplayList {
  setIcons(iconData);
  const E = env(design, deckOps, consult, images, nodes);
  if (deck === "p09-charts") {
    const add = slide <= 3 ? charts(E, slide) : slide === 4 ? lines(E) : slide === 5 ? snapping(E) : slide === 6 ? icons(E) : [];
    // a consulting design with the message panel (x 0–500) puts content in its column x 560–1540 (render/layout.ts
    // SIGNAL_AREA): the chart slides are fitted into it; the other slides set their own look "no headline" (B29)
    const panel = (design === "mckinsey" || design === "bain") && consultOptions(E.ctx).headline === "panel" && slide <= 3;
    if (!panel) return [...nodes, ...add];
    const s = 980 / 1460;
    return [...nodes, { t: "group", transform: [s, 0, 0, s, 560 - 70 * s, 190 - 190 * s], children: add }];
  }
  if (deck === "p09-cf") { conditional(E, nodes); return nodes; }
  return nodes;
}
