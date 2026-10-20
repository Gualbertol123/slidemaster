/* Phase 0 prototypes of docs/next/09 (pictures only; nothing here ships – M14–M16 build the real renderers in core/src/render).
   Display-list nodes for the new charts (§3.1–§3.3), lines and annotations (§3.4), Tabler icons (§3.5), snapping guides
   and handles (§5, the stage overlay drawn as nodes for the picture) and Excel conditional formats in cells (§3.10),
   in each design's look: the palettes, card recipes and number formats are the core's own (chartLook, glassBox,
   formatValue), so a picture shows what the design would draw. Bundled by tools/p09-package.mjs into the page under
   review as window.P09 and called from its slide hook. */
import type { Node, PathCmd, RGB, TextNode } from "../../core/src/dl/types";
import type { RenderCtx } from "../../core/src/render/context";
import type { Design, Op } from "../../core/src/model/types";
import { chartLook, type ChartLook } from "../../core/src/render/chart-dl";
import { glassBox, glassVars, GLASS_TBOX_FONT, type Wallpaper } from "../../core/src/render/glass-dl";
import { primaryFamily, type Metrics } from "../../core/src/render/excel-dl";
import { applyOps, emptyDoc } from "../../core/src/model/ops";
import { resolveStyle } from "../../core/src/model/style";
import { formatValue } from "../../core/src/xlsx/numfmt";
import { parseColor, solid } from "../../core/src/dl/color";
import { wrapLines } from "../../core/src/text/lines";

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const lum = (hex: string) => { const [r, g, b] = parseColor(hex).c; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/* ---------------------------------------------------------------- environment */
export interface Env { design: Design; ctx: RenderCtx; m: Metrics; look: ChartLook; wall: Wallpaper | null; family: string; ink: string; rule: string; bg: string }
export function env(design: Design, deckOps: Op[], consult: Record<string, unknown> | null, images: Record<string, string>, nodes: Node[]): Env {
  const { doc } = applyOps(emptyDoc("W.xlsx"), deckOps);
  const style = resolveStyle({}, { ...doc.style, design, ...(consult ? { designs: { [design]: { consult } } } : {}) } as never);
  const ctx = { style, edits: {}, slides: [], preset: null, workbook: "W.xlsx", logoSrc: "", sheet: () => null, version: null } as unknown as RenderCtx;
  const cv = document.createElement("canvas").getContext("2d")!;
  const m: Metrics = {
    run: (t, font) => { cv.font = font; const mm = cv.measureText(t); return { w: mm.width, asc: mm.fontBoundingBoxAscent, desc: mm.fontBoundingBoxDescent }; },
    lines: (t, font, width) => { cv.font = font; return wrapLines(t, width, s => cv.measureText(s).width); },
  };
  const family = design === "glass" ? GLASS_TBOX_FONT : design === "excel" ? "Calibri,Carlito,Arial,sans-serif" : design === "clean" ? "'Segoe UI',Arial,sans-serif" : "Arial,'Liberation Sans',sans-serif";
  const look = chartLook(ctx, family);
  // the blurred wallpaper of Liquid Glass: the picture the glass cards of the slide already show (not the full-slide sharp one)
  let wall: Wallpaper | null = null;
  const sharp = nodes.find(n => n.t === "image" && n.w === 1600 && n.h === 900) as { id: string } | undefined;
  const walk = (ns: Node[]) => { for (const n of ns) { if (n.t === "image" && n.id !== sharp?.id && images[n.id] && !wall && n.w >= 1500) wall = { blurId: n.id, blurSrc: images[n.id] }; if (n.t === "group") walk(n.children); } };
  if (design === "glass") walk(nodes);
  const consultInk = design === "mckinsey" ? "#051C2C" : design === "bain" ? "#222222" : null;
  const ink = consultInk || (design === "glass" ? "#0B0D17" : "#262626");
  const rule = design === "mckinsey" ? "#B3BAC5" : design === "bain" ? "#BFBFBF" : design === "glass" ? "#9AA3B2" : "#D9D9D9";
  return { design, ctx, m, look, wall, family, ink, rule, bg: "#FFFFFF" };
}

/* ---------------------------------------------------------------- text */
interface St { family: string; size: number; weight: number; italic?: boolean; color: string }
const font = (s: St) => `${s.italic ? "italic " : ""}${s.weight} ${s.size}px ${s.family}`;
function text(E: Env, t: string, x: number, baselineOrTop: number, st: St, align: "left" | "center" | "right" = "left", top = true): TextNode {
  const run = E.m.run(t, font(st)), w = Math.max(0, run.w), lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const y = top ? baselineOrTop + run.asc : baselineOrTop;
  return { t: "text", font: primaryFamily(st.family) || "Arial", css: st.family, weight: st.weight, ...(st.italic ? { i: true } : {}), size: st.size, x: r2(lx), y: r2(y), src: t, w, fill: solid(st.color) };
}
const tw = (E: Env, t: string, st: St) => E.m.run(t, font(st)).w;
const num = (v: number, fmt = "#,##0") => formatValue({ v, t: "n", fmt }).text;

/* ---------------------------------------------------------------- SVG path → display-list commands (the vendor step of ADR-020) */
export function svgPath(d: string, s: number, ox: number, oy: number): PathCmd[] {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const out: PathCmd[] = []; let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, prev = "";
  const P = (px: number, py: number): [number, number] => [r2(ox + px * s), r2(oy + py * s)];
  const n = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), bx = rel ? x : 0, by = rel ? y : 0;
    if (C === "Z") { out.push(["Z"]); x = sx; y = sy; prev = "Z"; continue; }
    if (C === "M") { x = bx + n(); y = by + n(); sx = x; sy = y; out.push(["M", ...P(x, y)]); cmd = rel ? "l" : "L"; prev = "M"; continue; }
    if (C === "L") { x = bx + n(); y = by + n(); out.push(["L", ...P(x, y)]); prev = "L"; continue; }
    if (C === "H") { x = bx + n(); out.push(["L", ...P(x, y)]); prev = "L"; continue; }
    if (C === "V") { y = (rel ? y : 0) + n(); out.push(["L", ...P(x, y)]); prev = "L"; continue; }
    if (C === "C" || C === "S" || C === "Q" || C === "T") {
      let x1: number, y1: number, x2: number, y2: number, ex: number, ey: number;
      if (C === "C") { x1 = bx + n(); y1 = by + n(); x2 = bx + n(); y2 = by + n(); ex = bx + n(); ey = by + n(); }
      else if (C === "S") { x1 = /[CS]/.test(prev) ? 2 * x - cx : x; y1 = /[CS]/.test(prev) ? 2 * y - cy : y; x2 = bx + n(); y2 = by + n(); ex = bx + n(); ey = by + n(); }
      else { const qx = C === "Q" ? bx + n() : /[QT]/.test(prev) ? 2 * x - cx : x, qy = C === "Q" ? by + n() : /[QT]/.test(prev) ? 2 * y - cy : y; ex = bx + n(); ey = by + n();
        x1 = x + 2 / 3 * (qx - x); y1 = y + 2 / 3 * (qy - y); x2 = ex + 2 / 3 * (qx - ex); y2 = ey + 2 / 3 * (qy - ey); cx = qx; cy = qy; out.push(["C", ...P(x1, y1), ...P(x2, y2), ...P(ex, ey)]); x = ex; y = ey; prev = C; continue; }
      out.push(["C", ...P(x1, y1), ...P(x2, y2), ...P(ex, ey)]); cx = x2; cy = y2; x = ex; y = ey; prev = C; continue;
    }
    if (C === "A") {
      let rx = Math.abs(n()), ry = Math.abs(n()); const rot = n() * Math.PI / 180, large = n(), sweep = n(), ex = bx + n(), ey = by + n();
      if (!rx || !ry) { out.push(["L", ...P(ex, ey)]); x = ex; y = ey; prev = "L"; continue; }
      // endpoint → centre parameterisation (SVG 1.1 F.6.5), then cubics of ≤ 90°
      const cs = Math.cos(rot), sn = Math.sin(rot), dx = (x - ex) / 2, dy = (y - ey) / 2, x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
      const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const sign = large === sweep ? -1 : 1, num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
      const co = sign * Math.sqrt(Math.max(0, num2 / den)), cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
      const ccx = cs * cxp - sn * cyp + (x + ex) / 2, ccy = sn * cxp + cs * cyp + (y + ey) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
      const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
      const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), st = dt / segs, k = 4 / 3 * Math.tan(st / 4);
      const pt = (t: number): [number, number] => [ccx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, ccy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs];
      const dv = (t: number): [number, number] => [-rx * Math.sin(t) * cs - ry * Math.cos(t) * sn, -rx * Math.sin(t) * sn + ry * Math.cos(t) * cs];
      for (let j = 0; j < segs; j++) {
        const a0 = t1 + j * st, a1 = a0 + st, [p0x, p0y] = pt(a0), [p3x, p3y] = pt(a1), [d0x, d0y] = dv(a0), [d1x, d1y] = dv(a1);
        out.push(["C", ...P(p0x + k * d0x, p0y + k * d0y), ...P(p3x - k * d1x, p3y - k * d1y), ...P(p3x, p3y)]);
      }
      x = ex; y = ey; prev = "A"; continue;
    }
    i++;                                                   // unknown token: skipped
  }
  return out;
}

/* ---------------------------------------------------------------- icons (Tabler, §3.5) */
export type IconData = { outline: Record<string, string[]>; filled: Record<string, string[]> };
let ICONS: IconData = { outline: {}, filled: {} };
export const setIcons = (d: IconData) => { ICONS = d; };
/** an icon as nodes: outline = stroked open paths (round caps; the round join is the Stroke.join amendment – drawn
    here with the canvas's lineJoin set round by the hook), filled = one even-odd fill */
export function icon(name: string, x: number, y: number, size: number, color: string, filled = false, stroke = 2): Node[] {
  const paths = (filled ? ICONS.filled : ICONS.outline)[name];
  if (!paths) return [{ t: "rect", x, y, w: size, h: size, stroke: { w: 1, paint: solid("#FF0000") } }];
  const s = size / 24;
  if (filled) return [{ t: "path", d: paths.flatMap(p => svgPath(p, s, x, y)), fill: solid(color), rule: "nonzero" }];
  return paths.map(p => ({ t: "path", d: svgPath(p, s, x, y), stroke: { w: r2(stroke * s), paint: solid(color), cap: "round" } }) as Node);
}

/* ---------------------------------------------------------------- lines and heads (§3.4) */
export type Head = "none" | "arrow" | "triangle" | "stealth" | "oval" | "diamond" | "bar";
function head(kind: Head, tx: number, ty: number, fx: number, fy: number, w: number, color: string): Node[] {
  if (kind === "none") return [];
  const a = Math.atan2(ty - fy, tx - fx), L = 3.2 * w + 5, H = 2.2 * w + 3.5, ca = Math.cos(a), sa = Math.sin(a);
  const pt = (u: number, v: number): [number, number] => [r2(tx + u * ca - v * sa), r2(ty + u * sa + v * ca)];
  if (kind === "bar") { const [x1, y1] = pt(0, -H * 1.2), [x2, y2] = pt(0, H * 1.2); return [{ t: "line", x1, y1, x2, y2, stroke: { w, paint: solid(color), cap: "butt" } }]; }
  if (kind === "oval") { const r = H * .8, k = .5523 * r, [cx, cy] = pt(-r, 0); return [{ t: "path", d: [["M", cx + r, cy], ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r], ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy], ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r], ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy], ["Z"]], fill: solid(color) }]; }
  if (kind === "arrow") return [{ t: "path", d: [["M", ...pt(-L, -H)], ["L", ...pt(0, 0)], ["L", ...pt(-L, H)]], stroke: { w, paint: solid(color), cap: "round" } }];
  const d: PathCmd[] = kind === "stealth" ? [["M", ...pt(0, 0)], ["L", ...pt(-L, -H)], ["L", ...pt(-L * .7, 0)], ["L", ...pt(-L, H)], ["Z"]]
    : kind === "diamond" ? [["M", ...pt(0, 0)], ["L", ...pt(-L / 2, -H)], ["L", ...pt(-L, 0)], ["L", ...pt(-L / 2, H)], ["Z"]]
    : [["M", ...pt(0, 0)], ["L", ...pt(-L, -H)], ["L", ...pt(-L, H)], ["Z"]];
  return [{ t: "path", d, fill: solid(color) }];
}
/** how far a filled head covers the line's end (the line stops under it so the tip is exact) */
const inset = (k: Head, w: number) => k === "triangle" || k === "stealth" || k === "diamond" ? (3.2 * w + 5) * (k === "stealth" ? .7 : k === "diamond" ? 1 : .9) : k === "oval" ? (2.2 * w + 3.5) * .8 : 0;
export interface LineSpec { route: "straight" | "elbow" | "curve" | "bracket" | "range"; a: [number, number]; b: [number, number]; mid?: number; bend?: "hv" | "vh";
  color?: string; w?: number; dash?: "solid" | "dashed" | "dotted"; ha?: Head; hb?: Head; label?: string; curly?: boolean }
export function line(E: Env, L: LineSpec): Node[] {
  const color = L.color || E.ink, w = L.w ?? 2, dash = L.dash === "dashed" ? [w * 4, w * 3] : L.dash === "dotted" ? [w, w * 2] : undefined;
  const st = { w, paint: solid(color), ...(dash ? { dash } : {}), cap: (L.ha && L.ha !== "none") || (L.hb && L.hb !== "none") ? "butt" as const : "round" as const };
  const [ax, ay] = L.a, [bx, by] = L.b, out: Node[] = [];
  const shorten = (x: number, y: number, fx: number, fy: number, d: number): [number, number] => { const l = Math.hypot(x - fx, y - fy) || 1; return [r2(x - (x - fx) / l * d), r2(y - (y - fy) / l * d)]; };
  if (L.route === "straight" || L.route === "range") {
    const [sx, sy] = shorten(ax, ay, bx, by, inset(L.ha || "none", w)), [ex, ey] = shorten(bx, by, ax, ay, inset(L.hb || "none", w));
    out.push({ t: "line", x1: sx, y1: sy, x2: ex, y2: ey, stroke: st }, ...head(L.ha || "none", ax, ay, bx, by, w, color), ...head(L.hb || "none", bx, by, ax, ay, w, color));
  } else if (L.route === "elbow") {
    const m = L.mid ?? .5, pts: [number, number][] = L.bend === "vh" ? [[ax, ay], [ax, ay + (by - ay) * m], [bx, ay + (by - ay) * m], [bx, by]] : [[ax, ay], [ax + (bx - ax) * m, ay], [ax + (bx - ax) * m, by], [bx, by]];
    const p0 = shorten(pts[0][0], pts[0][1], pts[1][0], pts[1][1], inset(L.ha || "none", w)), p3 = shorten(pts[3][0], pts[3][1], pts[2][0], pts[2][1], inset(L.hb || "none", w));
    out.push({ t: "path", d: [["M", ...p0], ["L", ...pts[1]], ["L", ...pts[2]], ["L", ...p3]], stroke: st },
      ...head(L.ha || "none", ax, ay, pts[1][0], pts[1][1], w, color), ...head(L.hb || "none", bx, by, pts[2][0], pts[2][1], w, color));
  } else if (L.route === "curve") {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay), ny = bx - ax, l = Math.hypot(nx, ny) || 1, k = (L.mid ?? .25) * Math.hypot(bx - ax, by - ay);
    const c1: [number, number] = [r2(ax + (mx - ax) * .5 + nx / l * k), r2(ay + (my - ay) * .5 + ny / l * k)], c2: [number, number] = [r2(bx + (mx - bx) * .5 + nx / l * k), r2(by + (my - by) * .5 + ny / l * k)];
    out.push({ t: "path", d: [["M", ax, ay], ["C", ...c1, ...c2, ...shorten(bx, by, c2[0], c2[1], inset(L.hb || "none", w))]], stroke: st }, ...head(L.hb || "none", bx, by, c2[0], c2[1], w, color));
  } else {                                                // bracket: square or curly, opening towards the side of `mid`'s sign
    const dep = L.mid ?? 16, len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy * dep, ny = ux * dep;
    if (!L.curly) out.push({ t: "path", d: [["M", ax + nx, ay + ny], ["L", ax, ay], ["L", bx, by], ["L", bx + nx, by + ny]], stroke: { ...st, cap: "butt" } });
    else { const mx = (ax + bx) / 2, my = (ay + by) / 2, q = .5523;
      out.push({ t: "path", d: [["M", ax + nx, ay + ny], ["C", ax + nx * (1 - q), ay + ny * (1 - q), ax + ux * dep * q, ay + uy * dep * q, ax + ux * dep, ay + uy * dep],
        ["L", mx - ux * dep, my - uy * dep], ["C", mx - ux * dep * (1 - q), my - uy * dep * (1 - q), mx - nx * (1 - q), my - ny * (1 - q), mx - nx, my - ny],
        ["C", mx - nx * (1 - q), my - ny * (1 - q), mx + ux * dep * (1 - q), my + uy * dep * (1 - q), mx + ux * dep, my + uy * dep],
        ["L", bx - ux * dep, by - uy * dep], ["C", bx - ux * dep * q, by - uy * dep * q, bx + nx * (1 - q), by + ny * (1 - q), bx + nx, by + ny]], stroke: st }); }
  }
  if (L.label) {
    const s: St = { family: E.family, size: 15, weight: 600, color }, t = tw(E, L.label, s), mx = (ax + bx) / 2, my = (ay + by) / 2;
    const above = L.route === "range" || L.route === "bracket";
    const lx = L.route === "bracket" ? mx - (by - ay) / (Math.hypot(bx - ax, by - ay) || 1) * ((L.mid ?? 16) + 8) : mx, ly = L.route === "bracket" ? my + (bx - ax) / (Math.hypot(bx - ax, by - ay) || 1) * ((L.mid ?? 16) + 8) : my;
    const top = above ? ly - 26 : ly - 11;
    out.push({ t: "rect", x: r2(lx - t / 2 - 5), y: r2(top - 1), w: r2(t + 10), h: 22, r: 4, fill: solid(E.design === "glass" ? "#FFFFFF" : E.bg), ...(E.design === "glass" ? {} : {}) },
      text(E, L.label, lx, top + 1, s, "center"));
  }
  return out;
}

/* ---------------------------------------------------------------- charts (§3.1–§3.3) */
export interface Axis { min: number; max: number; step: number; num?: string; grid?: boolean; show?: boolean }
export interface PSeries { id: string; name: string; type: "column" | "bar" | "line" | "area" | "scatter"; axis?: "y" | "y2"; group?: number;
  vals: (number | null)[]; xs?: number[]; target?: number[]; color?: string; smooth?: boolean; stack?: string; w?: number; dash?: boolean;
  marker?: { shape: "circle" | "square" | "diamond" | "none"; size: number; color?: string };
  points?: Record<number, { color?: string; marker?: string; label?: string | null }>;
  labels?: { show: ("value" | "ofTarget" | "name")[]; pos: "above" | "below" | "inEnd" | "center" | "outEnd" | "right"; b?: boolean; size?: number; color?: string; num?: string } }
export type PMark = { kind: "arrow"; s: string; i: number; color?: string; w?: number } | { kind: "icon"; s: string; i: number; icon: string; size: number; dy: number; color?: string }
  | { kind: "text"; s: string; i: number; text: string; dy: number; size: number; color?: string };
export interface PChart { box: { x: number; y: number; w: number; h: number }; title?: string; titleColor?: string; titleRule?: string; frame?: string;
  legendAt?: "right" | "left" | "top" | "bottom" | "top-right" | "inside-tr" | "none"; legendHide?: string[];
  groups: { cats: string[]; divider?: boolean }[]; y?: Axis; y2?: Axis; x?: Axis /* scatter */; catBold?: string; series: PSeries[]; marks?: PMark[];
  percent?: boolean; horizontal?: boolean; gap?: number; overlap?: number; waterfall?: boolean; note?: string }

function scaleFor(ax: Axis | undefined, vals: number[]): Axis {
  if (ax) return ax;
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1, raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
}
function marker(shape: string, x: number, y: number, s: number, fill: string, ring: string): Node[] {
  const r = s / 2;
  if (shape === "none") return [];
  const stroke = { w: 1.5, paint: solid(ring) };
  if (shape === "square") return [{ t: "rect", x: r2(x - r), y: r2(y - r), w: s, h: s, fill: solid(fill), stroke }];
  if (shape === "diamond") return [{ t: "path", d: [["M", x, y - r * 1.2], ["L", x + r * 1.2, y], ["L", x, y + r * 1.2], ["L", x - r * 1.2, y], ["Z"]], fill: solid(fill), stroke }];
  const k = .5523 * r;
  return [{ t: "path", d: [["M", r2(x + r), y], ["C", r2(x + r), r2(y + k), r2(x + k), r2(y + r), x, r2(y + r)], ["C", r2(x - k), r2(y + r), r2(x - r), r2(y + k), r2(x - r), y],
    ["C", r2(x - r), r2(y - k), r2(x - k), r2(y - r), x, r2(y - r)], ["C", r2(x + k), r2(y - r), r2(x + r), r2(y - k), r2(x + r), y], ["Z"]], fill: solid(fill), stroke }];
}
/** Catmull–Rom through the points (Excel's "smoothed line" within a pixel), as cubics */
function smoothCmds(p: [number, number][]): PathCmd[] {
  const d: PathCmd[] = [["M", ...p[0]]];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d.push(["C", r2(p1[0] + (p2[0] - p0[0]) / 6), r2(p1[1] + (p2[1] - p0[1]) / 6), r2(p2[0] - (p3[0] - p1[0]) / 6), r2(p2[1] - (p3[1] - p1[1]) / 6), ...p2]);
  }
  return d;
}
export function chart(E: Env, C: PChart): Node[] {
  const { x, y, w, h } = C.box, L = E.look, pad = Math.max(L.pad, 14), inner: Node[] = [];
  const colourOf = (s: PSeries, i: number) => s.color || L.colors[i % L.colors.length];
  const base: St = { family: L.family || E.family, size: 15, weight: 400, color: E.design === "glass" ? "#3C4253" : E.ink };
  let top = y + pad;
  if (C.title) {
    const st: St = { ...base, size: 22, weight: 700, color: C.titleColor || E.ink };
    inner.push(text(E, C.title, x + pad, top, st));
    top += 30;
    if (C.titleRule) { inner.push({ t: "line", x1: x + pad, y1: top + 4, x2: x + w - pad, y2: top + 4, stroke: { w: 1.5, paint: solid(C.titleRule) } }); top += 12; }
    top += 10;
  }
  // legend
  const legendAt = C.legendAt || "none", shown = C.series.filter(s => !(C.legendHide || []).includes(s.id));
  const lst: St = { ...base, size: 14 }, sw = L.legend === "capsule" ? { w: 18, h: 10, r: 5 } : { w: 12, h: 12, r: 0 };
  const entryW = (s: PSeries) => sw.w + 6 + tw(E, s.name, lst) + 18;
  let plot = { x: x + pad, y: top, w: w - 2 * pad, h: y + h - pad - top };
  const legendNodes: Node[] = [];
  const entry = (s: PSeries, ex: number, ey: number) => {
    const c = colourOf(s, C.series.indexOf(s));
    legendNodes.push(s.type === "line" ? { t: "line", x1: ex, y1: ey + 7, x2: ex + sw.w, y2: ey + 7, stroke: { w: 3, paint: solid(c), cap: "round" } }
      : { t: "rect", x: ex, y: r2(ey + 7 - sw.h / 2), w: sw.w, h: sw.h, r: sw.r, fill: solid(c) });
    legendNodes.push(text(E, s.name, ex + sw.w + 6, ey - 2, lst));
  };
  if (legendAt === "top" || legendAt === "bottom") {
    const total = shown.reduce((a, s) => a + entryW(s), 0); let ex = plot.x + (plot.w - total) / 2;
    const ey = legendAt === "top" ? plot.y : y + h - pad - 18;
    shown.forEach(s => { entry(s, ex, ey); ex += entryW(s); });
    if (legendAt === "top") { plot.y += 30; plot.h -= 30; } else plot.h -= 30;
  } else if (legendAt === "right" || legendAt === "left" || legendAt === "top-right" || legendAt === "inside-tr") {
    const lw = Math.max(...shown.map(entryW)) + 4, ex = legendAt === "left" ? plot.x : plot.x + plot.w - lw;
    let ey = legendAt === "right" || legendAt === "left" ? plot.y + plot.h / 2 - shown.length * 13 : plot.y;
    if (legendAt === "inside-tr") legendNodes.push({ t: "rect", x: r2(ex - 8), y: r2(ey - 6), w: r2(lw + 4), h: shown.length * 26 + 8, r: 6, fill: { solid: [255, 255, 255], a: .85 }, stroke: { w: 1, paint: solid(E.rule) } });
    shown.forEach(s => { entry(s, ex, ey); ey += 26; });
    if (legendAt === "right" || legendAt === "top-right") plot.w -= lw + 10; else if (legendAt === "left") { plot.x += lw + 10; plot.w -= lw + 10; }
  }
  // scales
  const cats = C.groups.flatMap(g => g.cats), N = cats.length, slotOf = (g: number, i: number) => C.groups.slice(0, g).reduce((a, gg) => a + gg.cats.length, 0) + i;
  const valsOf = (axis: "y" | "y2") => {
    const own = C.series.filter(s => (s.axis || "y") === axis);
    const out = own.flatMap(s => [...s.vals, ...(s.target || [])].filter((v): v is number => v != null));
    // stacked series: the stacks' totals per category set the scale
    const keys = [...new Set(own.filter(s => s.stack).map(s => s.stack!))];
    for (const k of keys) for (let i = 0; i < Math.max(...own.map(s => s.vals.length)); i++)
      out.push(own.filter(s => s.stack === k).reduce((a, s) => a + Math.max(0, s.vals[i] ?? 0), 0));
    return out;
  };
  let Y = scaleFor(C.y, valsOf("y")), Y2 = C.series.some(s => s.axis === "y2") ? scaleFor(C.y2, valsOf("y2")) : null;
  if (C.percent) Y = { min: 0, max: 1, step: .2, num: "0%" };
  const axSt: St = { ...base, size: 14 }, fmtY = (a: Axis, v: number) => num(v, a.num || "#,##0");
  const yw = Math.max(...Array.from({ length: Math.round((Y.max - Y.min) / Y.step) + 1 }, (_, k) => tw(E, fmtY(Y, Y.min + k * Y.step), axSt))) + 10;
  const y2w = Y2 ? Math.max(...Array.from({ length: Math.round((Y2.max - Y2.min) / Y2.step) + 1 }, (_, k) => tw(E, fmtY(Y2, Y2.min + k * Y2.step), axSt))) + 10 : 0;
  const catH = 30;
  const P = C.horizontal ? { x: plot.x + Math.max(...cats.map(c => tw(E, c, axSt))) + 12, y: plot.y + 6, w: 0, h: plot.h - 6 - 26 } : { x: plot.x + yw, y: plot.y + 6, w: plot.w - yw - y2w, h: plot.h - 6 - catH };
  if (C.horizontal) P.w = plot.x + plot.w - P.x - 10;
  const vy = (a: Axis, v: number) => P.y + P.h - (v - a.min) / (a.max - a.min) * P.h;
  const vx = (a: Axis, v: number) => P.x + (v - a.min) / (a.max - a.min) * P.w;
  const slotW = (C.horizontal ? P.h : P.w) / Math.max(1, N), mid = (k: number) => (C.horizontal ? P.y : P.x) + slotW * (k + .5);
  // axes and gridlines
  const ruleSt = { w: 1, paint: solid(E.rule) };
  if (!C.horizontal && !C.x) {
    for (let v = Y.min; v <= Y.max + 1e-9; v += Y.step) {
      const yy = r2(vy(Y, v));
      if (Y.grid !== false && Y.grid) inner.push({ t: "line", x1: P.x, y1: yy, x2: P.x + P.w, y2: yy, stroke: { w: 1, paint: solid(E.rule), ...(E.design === "glass" ? { dash: [2, 3] } : {}) } });
      inner.push(text(E, fmtY(Y, v), P.x - 8, yy - 9, axSt, "right"));
    }
    if (Y2) for (let v = Y2.min; v <= Y2.max + 1e-9; v += Y2.step) inner.push(text(E, fmtY(Y2, v), P.x + P.w + 8, r2(vy(Y2, v)) - 9, axSt, "left"));
    inner.push({ t: "line", x1: P.x, y1: P.y + P.h, x2: P.x + P.w, y2: P.y + P.h, stroke: ruleSt });
    const cst: St = C.catBold ? { ...axSt, weight: 700, color: C.catBold } : axSt;
    cats.forEach((c, k) => inner.push(text(E, c, mid(k), P.y + P.h + 7, cst, "center")));
    let k0 = 0;
    C.groups.forEach((g, gi) => { if (gi > 0 && g.divider) inner.push({ t: "line", x1: r2(P.x + slotW * k0), y1: P.y - 6, x2: r2(P.x + slotW * k0), y2: P.y + P.h + 26, stroke: { w: 1.5, paint: solid("#7F7F7F"), dash: [6, 5] } }); k0 += g.cats.length; });
  } else if (C.horizontal) {
    for (let v = Y.min; v <= Y.max + 1e-9; v += Y.step) { const xx = r2(vx(Y, v)); if (Y.grid) inner.push({ t: "line", x1: xx, y1: P.y, x2: xx, y2: P.y + P.h, stroke: { w: 1, paint: solid(E.rule) } }); inner.push(text(E, fmtY(Y, v), xx, P.y + P.h + 6, axSt, "center")); }
    inner.push({ t: "line", x1: P.x, y1: P.y, x2: P.x, y2: P.y + P.h, stroke: ruleSt });
    cats.forEach((c, k) => inner.push(text(E, c, P.x - 8, mid(k) - 9, axSt, "right")));
  }
  const labelSt = (s: PSeries): St => ({ ...base, size: s.labels?.size || 14, weight: s.labels?.b ? 700 : 400, color: s.labels?.color || E.ink });
  const pointsOf: Record<string, { x: number; y: number; top: number; i: number }[]> = {};
  // bars (clustered / stacked / 100 % / target), waterfall
  const bars = C.series.filter(s => s.type === "column" || s.type === "bar");
  const clusters = [...new Set(bars.map(s => s.stack || s.id))];
  const gap = (C.gap ?? 80) / 100, bw = slotW / (clusters.length + gap);
  const stackPos: Record<string, number[]> = {}, stackNeg: Record<string, number[]> = {};
  const totals = cats.map((_, k) => bars.reduce((a, s) => { const g = s.group || 0, i = k - slotOf(g, 0); const v = i >= 0 && i < s.vals.length ? s.vals[i] : null; return a + Math.abs(v || 0); }, 0));
  let run = 0;
  bars.forEach((s, si) => {
    const A = s.axis === "y2" && Y2 ? Y2 : Y, ci = clusters.indexOf(s.stack || s.id), g = s.group || 0;
    const pts: { x: number; y: number; top: number; i: number }[] = [];
    s.vals.forEach((raw, i) => {
      if (raw == null) return;
      const k = slotOf(g, i), v0 = C.percent ? raw / (totals[k] || 1) : raw, key = s.stack || s.id;
      const pos = (stackPos[key] ||= []), neg = (stackNeg[key] ||= []);
      let from = v0 >= 0 ? (pos[k] || 0) : (neg[k] || 0);
      // waterfall: the first and the last point are totals standing on the axis, the others float on the running total
      const total = C.waterfall && (i === 0 || i === s.vals.length - 1);
      if (C.waterfall) { from = total ? 0 : run; run = total ? v0 : run + v0; }
      const to = total ? v0 : from + v0;
      if (!C.waterfall) { if (v0 >= 0) pos[k] = to; else neg[k] = to; }
      const color = s.points?.[i]?.color || (C.waterfall ? (total ? (E.design === "glass" ? E.look.colors[0] : E.ink) : v0 >= 0 ? (E.design === "bain" ? "#2F7D32" : "#2E8540") : "#C62828") : colourOf(s, si));
      const c0 = (C.horizontal ? P.y : P.x) + slotW * k + (slotW - clusters.length * bw) / 2 + ci * bw;
      if (C.horizontal) {
        const xa = vx(A, Math.min(from, to)), xb = vx(A, Math.max(from, to));
        inner.push({ t: "rect", x: r2(xa), y: r2(c0 + 2), w: r2(Math.max(1, xb - xa)), h: r2(bw - 4), r: E.design === "glass" ? 4 : 0, fill: L.gradient ? { linear: [0, 0, 1, 0], stops: [{ o: 0, c: parseColor(color).c, a: .75 }, { o: 1, c: parseColor(color).c, a: 1 }] } : solid(color) });
        if (s.labels) inner.push(text(E, num(raw, s.labels.num), xb + 6, c0 + bw / 2 - 9, labelSt(s)));
        return;
      }
      const ya = vy(A, Math.max(from, to)), yb = vy(A, Math.min(from, to)), bx0 = c0 + (s.target ? 0 : 2), bww = bw - (s.target ? 0 : 4);
      if (s.target) {                                        // "actual inside target": the outlined target, the fill inside
        const ty = vy(A, s.target[i]);
        inner.push({ t: "rect", x: r2(bx0 + .75), y: r2(ty + .75), w: r2(bww - 1.5), h: r2(P.y + P.h - ty - .75), stroke: { w: 1.5, paint: solid(color) } });
        inner.push({ t: "rect", x: r2(bx0 + 5), y: r2(ya), w: r2(bww - 10), h: r2(Math.max(1, P.y + P.h - ya)), fill: solid(color) });
        pts.push({ x: c0 + bw / 2, y: ya, top: ty, i });
        if (s.labels?.show.includes("ofTarget")) {
          const pct = num(raw / s.target[i], "0 %"), st = { ...labelSt(s), color: s.labels.color || (lum(color) < .6 ? "#FFFFFF" : E.ink) };
          inner.push(text(E, pct.replace(/\s*%/, " %"), c0 + bw / 2, ya + 14, st, "center"));
        }
        return;
      }
      inner.push({ t: "rect", x: r2(bx0), y: r2(ya), w: r2(bww), h: r2(Math.max(1, yb - ya)), r: E.design === "glass" ? [4, 4, 0, 0] : 0,
        fill: L.gradient ? { linear: [0, 0, 0, 1], stops: [{ o: 0, c: parseColor(color).c, a: 1 }, { o: 1, c: parseColor(color).c, a: .72 }] } : solid(color) });
      if (C.waterfall && i < s.vals.length - 1) { const nx = c0 + slotW; inner.push({ t: "line", x1: r2(bx0 + bww), y1: r2(vy(A, to)), x2: r2(nx + 2), y2: r2(vy(A, to)), stroke: { w: 1, paint: solid("#8A93A3"), dash: [3, 3] } }); }
      pts.push({ x: c0 + bw / 2, y: ya, top: ya, i });
      if (s.labels) {
        const t = s.labels.show.includes("value") ? (C.percent ? num(v0, "0%") : num(raw, s.labels.num)) : "";
        const st = labelSt(s), inside = s.labels.pos === "center" || s.labels.pos === "inEnd";
        if (t) inner.push(text(E, t, c0 + bw / 2, inside ? (s.labels.pos === "center" ? (ya + yb) / 2 - 9 : ya + 6) : ya - 22, inside ? { ...st, color: lum(color) < .6 ? "#FFFFFF" : E.ink } : st, "center"));
      }
    });
    pointsOf[s.id] = pts;
  });
  // areas, lines, scatter
  C.series.filter(s => s.type === "area" || s.type === "line" || s.type === "scatter").forEach(s => {
    const si = C.series.indexOf(s), A = s.axis === "y2" && Y2 ? Y2 : Y, g = s.group || 0, color = colourOf(s, si);
    const X = C.x;
    const pts = s.vals.map((v, i) => v == null ? null : { x: X && s.xs ? vx(X, s.xs[i]) : mid(slotOf(g, i)), y: vy(A, v), top: vy(A, v), i }).filter((p): p is { x: number; y: number; top: number; i: number } => !!p);
    pointsOf[s.id] = pts;
    const xy = pts.map(p => [r2(p.x), r2(p.y)] as [number, number]);
    if (s.type === "area" && xy.length) {
      const d = s.smooth ? smoothCmds(xy) : [["M", ...xy[0]] as PathCmd, ...xy.slice(1).map(p => ["L", ...p] as PathCmd)];
      const fl = r2(vy(A, Math.max(A.min, 0)));
      inner.push({ t: "path", d: [...d, ["L", xy[xy.length - 1][0], fl], ["L", xy[0][0], fl], ["Z"]], fill: { linear: [0, 0, 0, 1], stops: [{ o: 0, c: parseColor(color).c, a: .55 }, { o: 1, c: parseColor(color).c, a: .12 }] } });
      inner.push({ t: "path", d, stroke: { w: 2.5, paint: solid(color), cap: "round" } });
    }
    if (s.type === "line" && xy.length > 1) inner.push({ t: "path", d: s.smooth ? smoothCmds(xy) : [["M", ...xy[0]], ...xy.slice(1).map(p => ["L", ...p] as PathCmd)], stroke: { w: s.w || 3, paint: solid(color), cap: "round", ...(s.dash ? { dash: [8, 6] } : {}) } });
    if (s.type === "scatter" && s.smooth && xy.length > 1) inner.push({ t: "path", d: smoothCmds(xy), stroke: { w: 2, paint: solid(color), cap: "round" } });
    const mk = s.marker || (s.type === "scatter" ? { shape: "circle" as const, size: 11 } : null);
    pts.forEach(p => {
      if (mk) inner.push(...marker(mk.shape, r2(p.x), r2(p.y), mk.size, s.points?.[p.i]?.marker || mk.color || color, E.design === "glass" ? "#FFFFFF" : "#FFFFFF"));
      const lab = s.points?.[p.i]?.label;
      if (s.labels && lab !== null) {
        const t = lab ?? num(s.vals[p.i] as number, s.labels.num), st = labelSt(s);
        inner.push(text(E, t, p.x + (s.labels.pos === "right" ? 10 : 0), s.labels.pos === "below" ? p.y + 10 : s.labels.pos === "right" ? p.y - 9 : p.y - (mk ? mk.size / 2 : 0) - 28, st, s.labels.pos === "right" ? "left" : "center"));
      }
    });
  });
  if (C.x) {                                             // scatter axes
    const X = C.x;
    for (let v = X.min; v <= X.max + 1e-9; v += X.step) inner.push(text(E, num(v, X.num || "0"), r2(vx(X, v)), P.y + P.h + 7, axSt, "center"));
    for (let v = Y.min; v <= Y.max + 1e-9; v += Y.step) { const yy = r2(vy(Y, v)); inner.push({ t: "line", x1: P.x, y1: yy, x2: P.x + P.w, y2: yy, stroke: { w: 1, paint: solid(E.rule), dash: [2, 3] } }); inner.push(text(E, fmtY(Y, v), P.x - 8, yy - 9, axSt, "right")); }
    inner.push({ t: "line", x1: P.x, y1: P.y + P.h, x2: P.x + P.w, y2: P.y + P.h, stroke: ruleSt });
  }
  // marks in data coordinates
  for (const mk of C.marks || []) {
    const p = pointsOf[mk.s]?.find(q => q.i === mk.i); if (!p) continue;
    if (mk.kind === "arrow") inner.push(...line(E, { route: "straight", a: [r2(p.x), r2(P.y + P.h - 1)], b: [r2(p.x), r2(p.y + 9)], color: mk.color || E.ink, w: mk.w || 2, hb: "triangle" }));
    if (mk.kind === "icon") inner.push(...icon(mk.icon, r2(p.x - mk.size / 2), r2(p.top + mk.dy - mk.size), mk.size, mk.color || E.ink));
    if (mk.kind === "text") inner.push(text(E, mk.text, p.x, p.top + mk.dy - mk.size * 1.25, { ...base, size: mk.size, weight: 700, color: mk.color || E.ink }, "center"));
  }
  if (C.note) inner.push(text(E, C.note, x + w - pad, y + h - pad - 16, { ...base, size: 12, color: "#8A93A3", italic: true }, "right"));
  inner.push(...legendNodes);
  // the card: Liquid Glass's glass card, Excel Refined's plain card, the item's own frame elsewhere
  if (L.card === "glass") return glassBox("gls wb card chart", x, y, w, h, Math.round(22 * E.ctx.style.radius / 100), glassVars(E.ctx), { x: 0, y: 0, scale: 1 }, E.wall, { content: inner, hit: { kind: "item", id: "p09" } });
  if (L.card === "plain") return [{ t: "shadow", x, y, w, h, r: 8, dx: 0, dy: 8, blur: 24, spread: -12, c: [20, 30, 60], a: .18 },
    { t: "rect", x: x + .5, y: y + .5, w: w - 1, h: h - 1, r: 8, fill: solid("#FFFFFF"), stroke: { w: 1, paint: solid(C.frame || "#E1E5EC") } }, ...inner];
  return [...(C.frame ? [{ t: "rect", x: x + .5, y: y + .5, w: w - 1, h: h - 1, fill: solid("#FFFFFF"), stroke: { w: 1, paint: solid(C.frame) } } as Node] : []), ...inner];
}

/* ---------------------------------------------------------------- the stage overlay (snapping guides, handles) as nodes for the picture */
export const PINK = "#FF2D92";
export function guideV(x: number, y1: number, y2: number, dashed = false): Node { return { t: "line", x1: x, y1, x2: x, y2, stroke: { w: 1.5, paint: solid(PINK), ...(dashed ? { dash: [6, 4] } : {}) } }; }
export function guideH(y: number, x1: number, x2: number, dashed = false): Node { return { t: "line", x1, y1: y, x2, y2: y, stroke: { w: 1.5, paint: solid(PINK), ...(dashed ? { dash: [6, 4] } : {}) } }; }
export function spacing(E: Env, x1: number, x2: number, y: number, label: string): Node[] {
  const st: St = { family: "'Segoe UI',Arial,sans-serif", size: 13, weight: 700, color: "#FFFFFF" }, w = tw(E, label, st) + 12;
  return [{ t: "line", x1, y1: y, x2, y2: y, stroke: { w: 1.5, paint: solid(PINK) } }, { t: "line", x1, y1: y - 7, x2: x1, y2: y + 7, stroke: { w: 1.5, paint: solid(PINK) } },
    { t: "line", x1: x2, y1: y - 7, x2, y2: y + 7, stroke: { w: 1.5, paint: solid(PINK) } },
    { t: "rect", x: r2((x1 + x2) / 2 - w / 2), y: y - 22, w: r2(w), h: 19, r: 9.5, fill: solid(PINK) }, text(E, label, (x1 + x2) / 2, y - 21, st, "center")];
}
export function handle(x: number, y: number, kind: "end" | "mid" = "end"): Node[] {
  return kind === "end" ? [{ t: "rect", x: x - 7, y: y - 7, w: 14, h: 14, r: 7, fill: solid("#FFFFFF"), stroke: { w: 2, paint: solid("#2563EB") } }]
    : [{ t: "rect", x: x - 6, y: y - 6, w: 12, h: 12, r: 2, fill: solid("#FFD60A"), stroke: { w: 1.5, paint: solid("#7A5C00") } }];
}
export function caption(E: Env, t: string, x: number, y: number, color = "#5B6274", size = 14, align: "left" | "center" | "right" = "left"): Node { return text(E, t, x, y, { family: "'Segoe UI',Arial,sans-serif", size, weight: 600, color }, align); }

/* ---------------------------------------------------------------- Excel conditional formats in cells (§3.10) */
export type CellHit = { r: number; c: number; x: number; y: number; w: number; h: number; label: string };
/** Excel's "3 arrows (coloured)" icon in a cell: up green, side amber, down red – redrawn as vectors */
export function cfArrow(dir: 1 | 0 | -1, x: number, y: number, s: number, design: Design): Node {
  const g = design === "mckinsey" ? "#2251FF" : design === "bain" ? "#2F7D32" : design === "glass" ? "#34C759" : "#00B050";
  const r = design === "mckinsey" ? "#051C2C" : design === "bain" ? "#CC0000" : design === "glass" ? "#FF3B30" : "#C00000";
  const a = design === "glass" ? "#FF9F0A" : design === "mckinsey" ? "#99A3B0" : "#FFC000";
  const color = dir > 0 ? g : dir < 0 ? r : a, c = s / 2, k = s * .32;
  const up: [number, number][] = [[c, 0], [s, c], [c + k / 2 + 1, c], [c + k / 2 + 1, s], [c - k / 2 - 1, s], [c - k / 2 - 1, c], [0, c]];
  const rot = (p: [number, number]): [number, number] => dir > 0 ? p : dir < 0 ? [s - p[0], s - p[1]] : [s - p[1], p[0]];
  const pts = up.map(rot);
  return { t: "path", d: [["M", r2(x + pts[0][0]), r2(y + pts[0][1])], ...pts.slice(1).map(p => ["L", r2(x + p[0]), r2(y + p[1])] as PathCmd), ["Z"]], fill: solid(color) };
}
export function cfBar(v: number, max: number, cell: CellHit, design: Design): Node {
  const color = design === "glass" ? "#5AC8FA" : design === "mckinsey" ? "#2251FF" : design === "bain" ? "#CC0000" : "#638EC6";
  // all values positive: Excel's automatic axis puts the bar's start at the cell's left edge
  const neg = v < 0, wv = Math.max(2, Math.abs(v) / max * (cell.w - 6));
  const x = cell.x + 3, h = design === "mckinsey" || design === "bain" ? 6 : cell.h - 8, y = design === "mckinsey" || design === "bain" ? cell.y + cell.h - 8 : cell.y + 4;
  const c = parseColor(neg ? (design === "glass" ? "#FF3B30" : "#FF0000") : color).c as RGB;
  return { t: "rect", x: r2(x), y: r2(y), w: r2(wv), h: r2(h), r: design === "glass" ? h / 2 : 0,
    fill: design === "excel" || design === "clean" ? { linear: neg ? [1, 0, 0, 0] : [0, 0, 1, 0], stops: [{ o: 0, c, a: .9 }, { o: 1, c, a: .12 }] } : { solid: c, a: design === "glass" ? .55 : .85 } };
}
export { HEX };
