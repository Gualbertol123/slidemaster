/* Excel's icon sets redrawn as vectors (S16.4, B39; 09 §3.10): every set Excel 2016 offers – arrows 3 / 4 / 5 coloured
   and grey, traffic lights unrimmed / rimmed / 4, signs, symbols circled / uncircled, flags, red to black, ratings 4 /
   5, quarters, stars, triangles, boxes. An icon is a list of filled parts on a 16 × 16 grid (y down), each in a tone;
   a design gives the tones their colours (cfTones: Excel's own, or the design's pos / neg / amber – the owner's Q15).
   Paths only (no font, no picture): the PDF, the PNG and PowerPoint (custGeom) draw them as they are. */
import type { PathCmd } from "../dl/types";

/** what a part's colour means: the set's good / middle / bad colour, grey, black, the rim, a light part, white glyphs */
export type CFTone = "pos" | "mid" | "neg" | "grey" | "dark" | "pink" | "rate" | "star" | "rim" | "light" | "white";
export interface CFPart { d: PathCmd[]; tone: CFTone }
type Pt = [number, number];

const K = 0.5523;
const poly = (pts: Pt[]): PathCmd[] => [["M", pts[0][0], pts[0][1]], ...pts.slice(1).map(([x, y]): PathCmd => ["L", x, y]), ["Z"]];
const circle = (cx: number, cy: number, r: number): PathCmd[] => [["M", cx, cy - r], ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy], ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
  ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy], ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r], ["Z"]];
const rect = (x1: number, y1: number, x2: number, y2: number): Pt[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
/** points turned by deg (clockwise) about the grid's centre */
const turn = (pts: Pt[], deg: number): Pt[] => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, y]) => [8 + (x - 8) * c - (y - 8) * s, 8 + (x - 8) * s + (y - 8) * c].map(v => Math.round(v * 100) / 100) as Pt);
};
const UP: Pt[] = [[8, 1], [15, 8], [10.6, 8], [10.6, 15], [5.4, 15], [5.4, 8], [1, 8]];
/** an arrow: 0 up, 45 up-right, 90 right, 135 down-right, 180 down */
const arrow = (deg: number, tone: CFTone): CFPart[] => [{ d: poly(turn(UP, deg)), tone }];
const STAR: Pt[] = Array.from({ length: 10 }, (_, k) => { const r = k % 2 ? 3 : 7.2, a = k * 36 * Math.PI / 180; return [Math.round((8 + r * Math.sin(a)) * 100) / 100, Math.round((8.6 - r * Math.cos(a)) * 100) / 100] as Pt; });
/** the star's left half (points 5…9 and 0: bottom to top on the left, closed along the middle) */
const HALF_STAR: Pt[] = [[8, STAR[5][1]], ...STAR.slice(6), STAR[0]];
/** a pie of k quarters from 12 o'clock, clockwise */
function pie(k: number): PathCmd[] {
  const r = 6.2, c = 8, pts: Pt[] = [[c, c - r], [c + r, c], [c, c + r], [c - r, c]];
  const d: PathCmd[] = [["M", c, c], ["L", c, c - r]];
  for (let q = 0; q < k; q++) {
    const [x0, y0] = pts[q], [x1, y1] = pts[(q + 1) % 4];
    // a quarter circle: control points along the tangents
    const t0: Pt = [x0 + (y0 < c ? K * r : y0 > c ? -K * r : 0), y0 + (x0 > c ? K * r : x0 < c ? -K * r : 0)];
    const t1: Pt = [x1 + (y1 < c ? -K * r : y1 > c ? K * r : 0), y1 + (x1 > c ? -K * r : x1 < c ? K * r : 0)];
    d.push(["C", t0[0], t0[1], t1[0], t1[1], x1, y1]);
  }
  d.push(["Z"]);
  return d;
}
/** a glyph in a circle (white on the tone) or alone (the tone): ✕, !, ✓ */
const CROSS: Pt[] = [[4.6, 3.2], [8, 6.6], [11.4, 3.2], [12.8, 4.6], [9.4, 8], [12.8, 11.4], [11.4, 12.8], [8, 9.4], [4.6, 12.8], [3.2, 11.4], [6.6, 8], [3.2, 4.6]];
const CHECK: Pt[] = [[2.6, 8.4], [4.2, 6.8], [6.6, 9.2], [11.8, 4], [13.4, 5.6], [6.6, 12.4]];
const BANG: Pt[][] = [rect(7, 3, 9, 9.6), rect(7, 11, 9, 13)];
const scaleAbout = (pts: Pt[], k: number): Pt[] => pts.map(([x, y]) => [Math.round((8 + (x - 8) * k) * 100) / 100, Math.round((8 + (y - 8) * k) * 100) / 100]);
function symbol(i: number, circled: boolean): CFPart[] {
  const tone: CFTone = i === 0 ? "neg" : i === 1 ? "mid" : "pos";
  const glyph = i === 0 ? [CROSS] : i === 1 ? BANG : [CHECK];
  if (!circled) return glyph.map(g => ({ d: poly(scaleAbout(g, 1.12)), tone }));
  return [{ d: circle(8, 8, 7), tone }, ...glyph.map(g => ({ d: poly(scaleAbout(g, .78)), tone: "white" as CFTone }))];
}
/** ratings: n bars rising left to right, the first `on` filled */
function rating(n: number, on: number): CFPart[] {
  const w = n === 4 ? 2.6 : 2.1, gap = n === 4 ? 1.1 : .9, x0 = (16 - (n * w + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, k) => {
    const h = 3 + k * (11 / (n - 1)), x = x0 + k * (w + gap);
    return { d: poly(rect(Math.round(x * 100) / 100, Math.round((14.5 - h) * 100) / 100, Math.round((x + w) * 100) / 100, 14.5)), tone: k < on ? "rate" : "light" } as CFPart;
  });
}
const light = (tone: CFTone, rim: boolean): CFPart[] => rim ? [{ d: poly(rect(1, 1, 15, 15)), tone: "rim" }, { d: circle(8, 8, 5.4), tone }] : [{ d: circle(8, 8, 6.6), tone }];
const flag = (tone: CFTone): CFPart[] => [{ d: poly(rect(3, 1.5, 4.6, 15)), tone: "dark" }, { d: poly([[4.6, 1.8], [13.6, 5.2], [4.6, 8.6]]), tone }];

/** the parts of icon i of a set (null: no such icon) */
export function cfIcon(set: string, i: number): CFPart[] | null {
  const T3: CFTone[] = ["neg", "mid", "pos"];
  switch (set) {
    case "3Arrows": return [arrow(180, "neg"), arrow(90, "mid"), arrow(0, "pos")][i] ?? null;
    case "3ArrowsGray": return [arrow(180, "grey"), arrow(90, "grey"), arrow(0, "grey")][i] ?? null;
    case "4Arrows": return [arrow(180, "neg"), arrow(135, "mid"), arrow(45, "mid"), arrow(0, "pos")][i] ?? null;
    case "4ArrowsGray": return [arrow(180, "grey"), arrow(135, "grey"), arrow(45, "grey"), arrow(0, "grey")][i] ?? null;
    case "5Arrows": return [arrow(180, "neg"), arrow(135, "mid"), arrow(90, "mid"), arrow(45, "mid"), arrow(0, "pos")][i] ?? null;
    case "5ArrowsGray": return [arrow(180, "grey"), arrow(135, "grey"), arrow(90, "grey"), arrow(45, "grey"), arrow(0, "grey")][i] ?? null;
    case "3Flags": return i >= 0 && i < 3 ? flag(T3[i]) : null;
    case "3TrafficLights1": return i >= 0 && i < 3 ? light(T3[i], false) : null;
    case "3TrafficLights2": return i >= 0 && i < 3 ? light(T3[i], true) : null;
    case "4TrafficLights": return i >= 0 && i < 4 ? light((["dark", "neg", "mid", "pos"] as CFTone[])[i], false) : null;
    case "4RedToBlack": return i >= 0 && i < 4 ? light((["dark", "grey", "pink", "neg"] as CFTone[])[i], false) : null;
    case "3Signs": return [[{ d: poly([[8, 1.2], [14.8, 8], [8, 14.8], [1.2, 8]]), tone: "neg" }], [{ d: poly([[8, 1.6], [15, 14], [1, 14]]), tone: "mid" }], [{ d: circle(8, 8, 6.6), tone: "pos" }]][i] as CFPart[] ?? null;
    case "3Symbols": return i >= 0 && i < 3 ? symbol(i, true) : null;
    case "3Symbols2": return i >= 0 && i < 3 ? symbol(i, false) : null;
    case "4Rating": return i >= 0 && i < 4 ? rating(4, i + 1) : null;
    case "5Rating": return i >= 0 && i < 5 ? rating(4, i) : null;
    case "5Quarters": return i >= 0 && i < 5 ? [{ d: circle(8, 8, 7), tone: "dark" }, { d: circle(8, 8, 6.2), tone: "white" }, ...(i ? [{ d: pie(i), tone: "dark" as CFTone }] : [])] : null;
    case "3Stars": return i === 0 ? [{ d: poly(STAR), tone: "light" }] : i === 1 ? [{ d: poly(STAR), tone: "light" }, { d: poly(HALF_STAR), tone: "star" }] : i === 2 ? [{ d: poly(STAR), tone: "star" }] : null;
    case "3Triangles": return [[{ d: poly([[1.5, 4.5], [14.5, 4.5], [8, 12.5]]), tone: "neg" }], [{ d: poly(rect(2, 6.6, 14, 9.4)), tone: "mid" }], [{ d: poly([[1.5, 11.5], [14.5, 11.5], [8, 3.5]]), tone: "pos" }]][i] as CFPart[] ?? null;
    case "5Boxes": return i >= 0 && i < 5 ? [[1.5, 1.5], [8.5, 1.5], [1.5, 8.5], [8.5, 8.5]].map(([x, y], k) => ({ d: poly(rect(x, y, x + 6, y + 6)), tone: k < i ? "rate" : "light" } as CFPart)) : null;
  }
  return null;
}

/** Excel 16's own colours of the tones (the green / amber / red family of 09 §3.10; to be checked against Excel on the
    owner's PC, S16.4 owner steps) */
export const EXCEL_TONES: Record<CFTone, string> = {
  pos: "#00B050", mid: "#FFC000", neg: "#C00000", grey: "#808080", dark: "#262626", pink: "#F4A6A6", rate: "#2F6EBA", star: "#FFC000",
  rim: "#262626", light: "#D9D9D9", white: "#FFFFFF",
};
/** a design's tones: its good / bad / middle colours over Excel's (Q15: icon sets in each design's colours) */
export const cfTones = (o: { pos?: string; neg?: string; mid?: string; rate?: string }): Record<CFTone, string> => ({
  ...EXCEL_TONES, ...(o.pos ? { pos: o.pos } : {}), ...(o.neg ? { neg: o.neg } : {}), ...(o.mid ? { mid: o.mid, star: o.mid } : {}), ...(o.rate ? { rate: o.rate } : {}),
});
