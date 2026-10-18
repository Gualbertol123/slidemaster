/* The built-in icons of callouts (07 §3: arrow up / down, check, warning, info, flag, star, bank, euro, percent, calendar,
   chart, target, bell, pin, bulb, lock – 17). Each is an outline on a 24 × 24 grid made of the display list's own path commands
   (M, L, C, Z: circles as four cubics, arcs as polygons), filled with the even-odd rule so holes stay open – so no two
   filled parts overlap (an overlap would be a hole). */
import type { PathCmd } from "../dl/types";

type Sub = [number, number][] | PathCmd[];
const K = 0.5523;
const rect = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const circle = (cx: number, cy: number, r: number): PathCmd[] => [["M", cx, cy - r], ["C", cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy], ["C", cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r],
  ["C", cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy], ["C", cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r], ["Z"]];
/** a ring segment from a0 to a1 (degrees clockwise from 12 o'clock) between radii ri and ro, as a polygon */
const arc = (cx: number, cy: number, ri: number, ro: number, a0: number, a1: number): [number, number][] => {
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 10)), pt = (r: number, a: number): [number, number] => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) out.push(pt(ro, a0 + (a1 - a0) * k / n));
  for (let k = n; k >= 0; k--) out.push(pt(ri, a0 + (a1 - a0) * k / n));
  return out;
};
const star = (): [number, number][] => Array.from({ length: 10 }, (_, k) => { const r = k % 2 ? 4.4 : 10.5, a = k * 36 * Math.PI / 180; return [12 + r * Math.sin(a), 12.8 - r * Math.cos(a)] as [number, number]; });

export const ICONS: Record<string, Sub[]> = {
  "arrow-up": [[[12, 3], [20.5, 12], [15, 12], [15, 21], [9, 21], [9, 12], [3.5, 12]]],
  "arrow-down": [[[12, 21], [20.5, 12], [15, 12], [15, 3], [9, 3], [9, 12], [3.5, 12]]],
  check: [[[2.5, 13], [5.6, 9.9], [9.8, 14.1], [18.4, 5.5], [21.5, 8.6], [9.8, 20.3]]],
  warning: [[[12, 2], [23, 21.5], [1, 21.5]], rect(10.9, 8.5, 13.1, 15), rect(10.9, 16.8, 13.1, 19)],
  info: [circle(12, 12, 10), rect(10.9, 5.8, 13.1, 8), rect(10.9, 9.8, 13.1, 18.2)],
  flag: [rect(4, 2, 6, 22), [[6, 3], [20.5, 3], [16.5, 8], [20.5, 13], [6, 13]]],
  star: [star()],
  bank: [[[1.5, 8], [12, 2], [22.5, 8]], rect(3.5, 9.5, 6.5, 18), rect(8.5, 9.5, 11, 18), rect(13, 9.5, 15.5, 18), rect(17.5, 9.5, 20.5, 18), rect(2, 19, 22, 22)],
  // (the bars stop at the ring and go on inside it: an overlap would be a hole under the even-odd rule)
  euro: [arc(13, 12, 6.2, 8.8, 130, 410), rect(2, 8.6, 4.4, 10.6), rect(7.4, 8.6, 13.5, 10.6), rect(2, 13.4, 4.4, 15.4), rect(7.4, 13.4, 13.5, 15.4)],
  percent: [circle(6.8, 6.8, 3.6), circle(6.8, 6.8, 1.6), circle(17.2, 17.2, 3.6), circle(17.2, 17.2, 1.6), [[17.6, 2.5], [20.1, 3.8], [6.4, 21.5], [3.9, 20.2]]],
  calendar: [rect(3, 4.5, 21, 21.5), rect(5, 9.5, 19, 19.5), rect(6.8, 2, 9.2, 4.5), rect(14.8, 2, 17.2, 4.5), rect(7, 11.5, 10, 14.5), rect(14, 11.5, 17, 14.5), rect(7, 15.5, 10, 18)],
  chart: [rect(4, 12.5, 7.5, 19.5), rect(10.2, 7.5, 13.7, 19.5), rect(16.5, 3.5, 20, 19.5), rect(2, 20, 22, 22)],
  target: [circle(12, 12, 10.5), circle(12, 12, 7.8), circle(12, 12, 5.1), circle(12, 12, 2.4)],
  bell: [[["M", 12, 2.5], ["C", 7.6, 2.5, 5.8, 6, 5.8, 10.5], ["L", 5.8, 15.5], ["L", 3.5, 18], ["L", 20.5, 18], ["L", 18.2, 15.5], ["L", 18.2, 10.5], ["C", 18.2, 6, 16.4, 2.5, 12, 2.5], ["Z"]], circle(12, 20.2, 2)],
  pin: [[["M", 12, 1.8], ["C", 7.3, 1.8, 4.2, 5.4, 4.2, 9.6], ["C", 4.2, 14.6, 12, 22.4, 12, 22.4], ["C", 12, 22.4, 19.8, 14.6, 19.8, 9.6], ["C", 19.8, 5.4, 16.7, 1.8, 12, 1.8], ["Z"]], circle(12, 9.6, 3)],
  bulb: [[["M", 12, 1.8], ["C", 7.6, 1.8, 4.8, 5.2, 4.8, 9], ["C", 4.8, 12, 6.8, 13.6, 8, 15.3], ["L", 16, 15.3], ["C", 17.2, 13.6, 19.2, 12, 19.2, 9], ["C", 19.2, 5.2, 16.4, 1.8, 12, 1.8], ["Z"]], rect(8.2, 16.3, 15.8, 18.3), rect(9.2, 19.2, 14.8, 21.4)],
  lock: [arc(12, 10.5, 4.2, 6.4, -90, 90), rect(5.6, 10.4, 7.8, 11.5), rect(16.2, 10.4, 18.4, 11.5), rect(4, 11.5, 20, 22), rect(11, 14.5, 13, 19)],
};
export const ICON_NAMES = Object.keys(ICONS);
/** icon `name` on the slide: its outline scaled by s, its grid's top left at (x, y) */
export function iconCmds(name: string, x: number, y: number, s: number): PathCmd[] {
  const r2 = (v: number) => Math.round(v * 100) / 100 || 0, out: PathCmd[] = [];
  for (const sub of ICONS[name] || ICONS.info) {
    if (typeof sub[0][0] === "string") for (const c of sub as PathCmd[]) out.push(c[0] === "Z" ? ["Z"] : [c[0], ...c.slice(1).map((v, k) => r2((k % 2 ? y : x) + (v as number) * s))] as PathCmd);
    else { (sub as [number, number][]).forEach(([px, py], k) => out.push([k ? "L" : "M", r2(x + px * s), r2(y + py * s)])); out.push(["Z"]); }
  }
  return out;
}
