/* A text box's border (B49, product owner 2026-10-21: "make the borders of the auto comments editable in thickness and
   colour"): Note.frame. Unset = the design's own (a bubble's frame in the Excel designs, none otherwise); "none" = no
   border (an Excel bubble without its frame); else a line of that weight and colour around the box, inside its edges
   as a CSS border is, in every design – drawn by slide-dl.ts noteNodes as a rect node's stroke, exported to PowerPoint as
   the native outline (a:ln) of a shape at that box (pptx/scene.ts groups it with the text box). */
import type { Design, LineOrNone } from "../model/types";
import type { Stroke } from "../dl/types";
import { parseColor } from "../dl/color";

/** the weights offered (px, as the gridline weights) */
export const FRAME_WEIGHTS = [.5, 1, 1.5, 2, 3] as const;
/** the colours offered (the Borders ▾ menu's), "" = the design's */
export const FRAME_COLORS = ["#000000", "#7F7F7F", "#1F4E79", "#0A66D8", "#C00000", "#2E7D32"] as const;
/** a border's colour when none is picked: the design's frame / rule colour (Excel and Excel Refined: the ISP template's box outline, B48) */
const DEFAULT_COLOR: Record<Design, string> = { glass: "#A9B0BE", excel: "#7F7F7F", clean: "#7F7F7F", mckinsey: "#051C2C", bain: "#D6D6D6" };
export const frameDefaultColor = (d: Design) => DEFAULT_COLOR[d] || DEFAULT_COLOR.excel;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const DASH: Record<string, number[]> = { dashed: [4, 3], dotted: [1, 2], dashdot: [4, 2, 1, 2] };

/** the frame resolved: null = the design's own (nothing set), "none", or the line (weight 0.25–12 px, a #RRGGBB colour) */
export function noteFrame(f: LineOrNone | null | undefined, d: Design): null | "none" | { w: number; color: string; dash?: "dashed" | "dotted" | "dashdot" } {
  if (f === undefined) return null;
  if (f === null || f === "none") return "none";                     // (a null inside a map entry reads as "none": types.ts LineOrNone)
  if (typeof f !== "object") return null;
  const hasW = typeof f.w === "number" && Number.isFinite(f.w), hasC = typeof f.color === "string" && HEX.test(f.color);
  if (!hasW && !hasC) return null;                                   // {} draws as unset (and is not format 5: ops.ts holds)
  const w = hasW ? Math.min(12, Math.max(.25, f.w!)) : 1;
  const dash = f.dash && f.dash !== "solid" && DASH[f.dash] ? f.dash as "dashed" | "dotted" | "dashdot" : undefined;
  return { w, color: hasC ? f.color!.toUpperCase() : frameDefaultColor(d), ...(dash ? { dash } : {}) };
}
/** the display list's stroke of a resolved frame line */
export function frameStroke(l: { w: number; color: string; dash?: string }): Stroke {
  const { c } = parseColor(l.color);
  return { w: l.w, paint: { solid: c }, ...(l.dash && DASH[l.dash] ? { dash: DASH[l.dash].map(v => v * l.w) } : {}) };
}
/** the CSS border of a resolved frame (the comment dialog's preview) */
export function frameCss(f: ReturnType<typeof noteFrame>): string | undefined {
  if (!f) return undefined;
  if (f === "none") return "none";
  return `${f.w}px ${f.dash === "dotted" ? "dotted" : f.dash ? "dashed" : "solid"} ${f.color}`;
}
