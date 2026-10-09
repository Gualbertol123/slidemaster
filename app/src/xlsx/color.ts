/* Colours: Excel's indexed/theme/tint model and the small colour maths used by the designs. */

export const INDEXED = ["000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF","000000","FFFFFF","FF0000","00FF00","0000FF","FFFF00","FF00FF","00FFFF","800000","008000","000080","808000","800080","008080","C0C0C0","808080","9999FF","993366","FFFFCC","CCFFFF","660066","FF8080","0066CC","CCCCFF","000080","FF00FF","FFFF00","00FFFF","800080","800000","008080","0000FF","00CCFF","CCFFFF","CCFFCC","FFFF99","99CCFF","FF99CC","CC99FF","FFCC99","3366FF","33CCCC","99CC00","FFCC00","FF9900","FF6600","666699","969696","003366","339966","003300","333300","993300","993366","333399","333333"];
export const NAMED: Record<string, string> = { black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#00FF00", blue: "#0000FF", yellow: "#FFFF00", magenta: "#FF00FF", cyan: "#00FFFF" };

export function hexToHsl(h: string): [number, number, number] {
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let H = 0, S = 0; const L = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    S = L > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    H = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    H /= 6;
  }
  return [H, S, L];
}
export function hslToHex(H: number, S: number, L: number): string {
  const f = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let r: number, g: number, b: number;
  if (S === 0) { r = g = b = L; } else { const q = L < .5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q; r = f(p, q, H + 1 / 3); g = f(p, q, H); b = f(p, q, H - 1 / 3); }
  return [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const [h, s, l0] = hexToHsl(hex);
  const l = tint < 0 ? l0 * (1 + tint) : l0 * (1 - tint) + tint;
  return hslToHex(h, s, Math.max(0, Math.min(1, l)));
}
export type ColorFn = (el: Element | null | undefined, fallback: string | null) => string | null;
export function makeColor(theme: string[]): ColorFn {
  return function color(el, fallback) {
    if (!el) return fallback;
    if (el.getAttribute("auto") === "1") return fallback;
    let hex: string | null = null;
    const rgb = el.getAttribute("rgb");
    if (rgb) hex = rgb.slice(-6).toUpperCase();
    else if (el.getAttribute("theme") !== null) hex = theme[+el.getAttribute("theme")!] || null;
    else if (el.getAttribute("indexed") !== null) { const i = +el.getAttribute("indexed")!; hex = i === 64 ? null : INDEXED[i] || null; }
    if (!hex) return fallback;
    const tint = parseFloat(el.getAttribute("tint") || "0");
    return "#" + applyTint(hex, tint);
  };
}

/* ---- colour maths used by the designs ---- */
export function hexRgb(h: string | null | undefined): [number, number, number] {
  h = (h || "#FFFFFF").replace("#", "");
  if (h.length === 3) h = h.split("").map(x => x + x).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function lum(h: string): number { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export type Tone = "pos" | "neg" | "muted" | "dark" | "other" | null;
/** what a colour means: positive (green), negative (red), neutral, or another accent */
export function tone(h: string | null | undefined): Tone {
  if (!h) return null;
  const [r, g, b] = hexRgb(h); const L = lum(h);
  if (L > .93 && Math.max(r, g, b) - Math.min(r, g, b) < 18) return null;
  if (g > r + 35 && g > b + 10) return "pos";
  if (r > g + 55 && r > b + 40) return "neg";
  if (Math.max(r, g, b) - Math.min(r, g, b) < 18) return L > .7 ? "muted" : "dark";
  return "other";
}
export const rgba = (h: string, a: number) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
export function darken(h: string, k: number): string {
  const [hh, s, l] = hexToHsl(h.replace("#", ""));
  return "#" + hslToHex(hh, Math.min(1, s * 1.05), Math.max(0, l * k));
}
export function colorDist(a: string, b: string): number { const x = hexRgb(a), y = hexRgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); }
export function satOf(h: string): number { const [r, g, b] = hexRgb(h); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }
export type FillClass = "white" | "dark" | "light" | "grey" | "color";
/** fill classes: white (= page), light (pale tint), grey, color (saturated mid tone), dark */
export function fillClass(h: string | null | undefined): FillClass | null {
  if (!h) return null;
  const L = lum(h), s = satOf(h);
  if (L > .95 && s < .07) return "white";
  if (L < .45) return "dark";
  if (s < .09) return L > .8 ? "light" : "grey";
  return L > .82 ? "light" : "color";
}
export const isWhiteish = (c: string | null | undefined) => !c || (lum(c) > .93 && satOf(c) < .08);
