/* CSS colours of the designs (the values v3 writes into its HTML) as display-list paint: #rgb, #rgba, #rrggbb,
   #rrggbbaa, rgb()/rgba() with numbers or percentages (commas or spaces, "/ alpha"), transparent and the named
   colours the code and workbooks use. Unknown values are black, as a browser draws an invalid colour's initial. */
import type { Paint, RGB } from "./types";

const NAMED: Record<string, [number, number, number, number?]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
  gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], navy: [0, 0, 128], orange: [255, 165, 0],
  purple: [128, 0, 128], maroon: [128, 0, 0], lime: [0, 255, 0], aqua: [0, 255, 255], cyan: [0, 255, 255], teal: [0, 128, 128],
  fuchsia: [255, 0, 255], magenta: [255, 0, 255], olive: [128, 128, 0], transparent: [0, 0, 0, 0],
};
const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

/** a CSS colour as [r, g, b] 0–255 and alpha 0–1 */
export function parseColor(s: string | null | undefined): { c: RGB; a: number } {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return { c: [0, 0, 0], a: 1 };
  if (v[0] === "#") {
    const h = v.slice(1);
    const full = h.length === 3 || h.length === 4 ? [...h].map(x => x + x).join("") : h;
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) {
      const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
      return { c: [n(0), n(2), n(4)], a: full.length === 8 ? n(6) / 255 : 1 };
    }
    return { c: [0, 0, 0], a: 1 };
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (p: string) => p.endsWith("%") ? clamp(parseFloat(p) * 2.55, 255) : clamp(parseFloat(p), 255);
    const al = (p: string | undefined) => p === undefined ? 1 : p.endsWith("%") ? clamp(parseFloat(p) / 100, 1) : clamp(parseFloat(p), 1);
    if (parts.length >= 3 && parts.slice(0, 3).every(p => !isNaN(parseFloat(p)))) return { c: [ch(parts[0]), ch(parts[1]), ch(parts[2])], a: al(parts[3]) };
    return { c: [0, 0, 0], a: 1 };
  }
  const n = NAMED[v];
  return n ? { c: [n[0], n[1], n[2]], a: n[3] ?? 1 } : { c: [0, 0, 0], a: 1 };
}
/** a solid paint of a CSS colour (alpha 1 is left out) */
export function solid(s: string | null | undefined): Paint {
  const { c, a } = parseColor(s);
  return a < 1 ? { solid: c, a } : { solid: c };
}
export const isTransparent = (s: string | null | undefined) => parseColor(s).a === 0;
