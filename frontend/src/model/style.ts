/* Deck style = built-in defaults ← shared defaults (config.json) ← this workbook's style. */
import type { Footer, PageNumbers, Style, StylePatch, Theme } from "./types";

export const BUILTIN_PN: PageNumbers = { on: false, start: 1, pos: "br", font: "auto", size: 16, format: "n", style: "capsule", cover: false };
export const BUILTIN_FOOTER: Footer = { on: false, text: "", pos: "bl", size: 14, style: "plain", cover: false };
export const BUILTIN_STYLE: Style = { design: "glass", glass: "subtle", color: 35, logo: "logo.png", pn: BUILTIN_PN, radius: 100, contrast: 50, logoBubble: true, footer: BUILTIN_FOOTER, theme: { id: "aurora", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" } };

export function resolveStyle(...layers: (StylePatch | null | undefined)[]): Style {
  const s: Style = { ...BUILTIN_STYLE, pn: { ...BUILTIN_PN }, footer: { ...BUILTIN_FOOTER }, theme: { ...BUILTIN_STYLE.theme } };
  for (const l of layers) {
    if (!l) continue;
    for (const k of ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const) if (l[k] !== undefined && l[k] !== null) (s as unknown as Record<string, unknown>)[k] = l[k];
    if (l.pn) for (const [k, v] of Object.entries(l.pn)) if (v !== undefined && v !== null) (s.pn as unknown as Record<string, unknown>)[k] = v;
    if (l.theme) for (const [k, v] of Object.entries(l.theme)) if (v !== undefined && v !== null) (s.theme as unknown as Record<string, unknown>)[k] = v;
    if (l.footer) for (const [k, v] of Object.entries(l.footer)) if (v !== undefined && v !== null) (s.footer as unknown as Record<string, unknown>)[k] = v;
  }
  if (s.design !== "excel") s.design = "glass";
  if (!["subtle", "medium", "strong"].includes(s.glass)) s.glass = "subtle";
  s.color = Math.max(0, Math.min(100, +s.color || 0));
  s.radius = Math.max(0, Math.min(200, isFinite(+s.radius) ? +s.radius : 100));
  s.contrast = Math.max(0, Math.min(100, isFinite(+s.contrast) ? +s.contrast : 50));
  s.logoBubble = s.logoBubble !== false;
  return s;
}
export const GLASS_LEVELS = { subtle: .35, medium: .65, strong: 1 } as const;
export const glassLevel = (s: Style) => GLASS_LEVELS[s.glass] ?? GLASS_LEVELS.subtle;

/* ---- colour themes ----
   c1–c4 = wallpaper colours (blobs, ribbons, pastel gradient), a1/a2 = accents (cover bar, index numbers,
   heading rules), x = accent of the Excel design (title, cover panel, index numbers). The Intesa Sanpaolo
   colours follow the public brand (green, orange); adjust them under Custom if the brand guide differs. */
export interface ThemeDef extends Theme { name: string; x: string; grad?: [string, string, string]; extra?: [string, string]; ribbons?: [string, string, string, string] }
export const THEMES: ThemeDef[] = [
  { id: "aurora", name: "Aurora", c1: "#3A88FF", c2: "#9868FF", c3: "#FF885C", c4: "#34C8B0", a1: "#3B82F6", a2: "#8B5CF6", x: "#1C4F8C",
    grad: ["#D3E2FF", "#ECE6FF", "#FFE8D8"], extra: ["#FF5AA6", "#54C4FF"], ribbons: ["#8CBEFF", "#FFC8AA", "#BEA0FF", "#78DCFF"] },
  { id: "ocean", name: "Ocean", c1: "#2F80ED", c2: "#00B4D8", c3: "#48CAE4", c4: "#4361EE", a1: "#0077B6", a2: "#00B4D8", x: "#0B4F7C" },
  { id: "forest", name: "Forest", c1: "#2D9D5B", c2: "#8CC63F", c3: "#F2C94C", c4: "#2BB3A3", a1: "#2D9D5B", a2: "#8CC63F", x: "#1E5E3A" },
  { id: "sunset", name: "Sunset", c1: "#FF7A59", c2: "#FF4F8B", c3: "#FFC15E", c4: "#B57CFF", a1: "#F2545B", a2: "#FF9F1C", x: "#9E2A3A" },
  { id: "graphite", name: "Graphite", c1: "#8E9AAF", c2: "#5C677D", c3: "#B8C0CC", c4: "#7D8597", a1: "#33415C", a2: "#7D8597", x: "#33415C" },
  { id: "intesa", name: "Intesa Sanpaolo", c1: "#00953B", c2: "#8DC63F", c3: "#F28C00", c4: "#5B6770", a1: "#00953B", a2: "#F28C00", x: "#006A35" },
];
export const BUILTIN_THEME: Theme = { id: "aurora", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" };
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** the theme's colours: a built-in theme by id, or "custom" with the stored colours (missing ones from Aurora) */
export function themeOf(s: Style): ThemeDef {
  const t = s.theme || BUILTIN_THEME, base = THEMES.find(x => x.id === t.id);
  if (base) return base;
  const A = THEMES[0], pick = (k: "c1" | "c2" | "c3" | "c4" | "a1" | "a2") => HEX.test(t[k] || "") ? t[k].toUpperCase() : A[k];
  const a1 = pick("a1");
  return { id: "custom", name: "Custom", c1: pick("c1"), c2: pick("c2"), c3: pick("c3"), c4: pick("c4"), a1, a2: pick("a2"), x: darkAccent(a1) };
}
function darkAccent(h: string) {
  const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = L > .45 ? .45 / L : 1, f = (v: number) => Math.round(v * k).toString(16).padStart(2, "0");
  return ("#" + f(r) + f(g) + f(b)).toUpperCase();
}
