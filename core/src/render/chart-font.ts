/* The text of charts (07 §3; 09 §3.1): one style shape, a measured text node, an ellipsis to a width – shared by the
   pie (chart-dl.ts) and the series charts (chart-series.ts, chart-legend.ts), so both measure and place text alike. */
import type { TextNode } from "../dl/types";
import { primaryFamily, type Metrics } from "./excel-dl";
import { parseColor, solid } from "../dl/color";

export interface St { family: string; size: number; weight: number; italic: boolean; color: string }
export const font = (s: St) => `${s.italic ? "italic " : ""}${s.weight} ${s.size}px ${s.family}`;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
/** the line a text of this style takes */
export const lineH = (s: St) => Math.round(s.size * 1.25);
/** a text run whose line box starts at `top`, aligned on x */
export function textNode(m: Metrics, text: string, x: number, top: number, st: St, align: "left" | "center" | "right" = "left"): TextNode & { w: number } {
  const run = m.run(text, font(st)), w = Math.max(0, run.w), lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const lh = lineH(st), base = top + Math.floor((lh - (run.asc + run.desc)) / 2) + run.asc;
  return { t: "text", font: primaryFamily(st.family) || "Arial", css: st.family, weight: st.weight, ...(st.italic ? { i: true } : {}), size: st.size, x: r2(lx), y: r2(base), src: text, w, fill: solid(st.color) };
}
/** the text cut to a width with "…" */
export function ellipsis(m: Metrics, text: string, st: St, maxW: number): string {
  if (m.run(text, font(st)).w <= maxW + .01) return text;
  const ch = [...text]; let k = ch.length;
  while (k > 0 && m.run(ch.slice(0, k).join("") + "…", font(st)).w > maxW + .01) k--;
  return ch.slice(0, k).join("") + "…";
}
/** a colour's luminance 0–1 (white text on a fill under .6) */
export const lum = (hex: string) => { const [r, g, b] = parseColor(hex).c; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
