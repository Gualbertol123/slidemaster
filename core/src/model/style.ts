/* Deck style = built-in defaults ← shared defaults (config.json) ← this workbook's style. */
import type { ColorKey, Design, Look, Footer, PageNumbers, Style, StylePatch, TextFmt, TextRole, Theme } from "./types";
import { cleanConsult, isConsult, isDesign } from "./designs";
import { isIsp, ISP_THEME, ISP_THEME_IDS } from "./isp";

export const BUILTIN_PN: PageNumbers = { on: false, start: 1, pos: "br", font: "auto", size: 16, format: "n", style: "capsule", cover: false };
export const BUILTIN_FOOTER: Footer = { on: false, text: "", pos: "bl", size: 14, style: "plain", cover: false };
export const BUILTIN_STYLE: Style = { design: "glass", glass: "subtle", color: 35, logo: "logo.png", pn: BUILTIN_PN, radius: 100, contrast: 50, logoBubble: true, footer: BUILTIN_FOOTER, theme: { id: "aurora", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" }, text: {}, colors: {} };
export const TEXT_ROLES: TextRole[] = ["title", "subtitle", "table", "note", "index", "pageno"];

/** the "look" of a deck – theme, colours, text styles – from one layer (shared, or one design's own) */
function applyLook(s: Style, l: Look) {
  if (l.theme) for (const [k, v] of Object.entries(l.theme)) if (v !== undefined && v !== null) (s.theme as unknown as Record<string, unknown>)[k] = v;
  if (l.colors && typeof l.colors === "object") for (const k of COLOR_KEYS.map(x => x.key)) { const v = l.colors[k]; if (typeof v === "string" && HEXC.test(v)) s.colors[k] = v.toUpperCase(); }
  // text styles: an entry for a kind of text replaces the earlier layer's entry as a whole
  if (l.text && typeof l.text === "object") for (const r of TEXT_ROLES) { const f = l.text[r]; if (f && typeof f === "object") s.text[r] = cleanFmt(f); }
}
/** the design style layers resolve to – resolveStyle's, without the rest (a narrow subscription of the page's, B48) */
export function designOf(...layers: (StylePatch | null | undefined)[]): Design {
  let d: unknown = BUILTIN_STYLE.design;
  for (const l of layers) if (l && l.design !== undefined && l.design !== null) d = l.design;
  return isDesign(d) ? d : "glass";
}
export function resolveStyle(...layers: (StylePatch | null | undefined)[]): Style {
  const s: Style = { ...BUILTIN_STYLE, pn: { ...BUILTIN_PN }, footer: { ...BUILTIN_FOOTER }, theme: { ...BUILTIN_STYLE.theme }, text: {}, colors: {} };
  for (const l of layers) {
    if (!l) continue;
    for (const k of ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const) if (l[k] !== undefined && l[k] !== null) (s as unknown as Record<string, unknown>)[k] = l[k];
    if (l.pn) for (const [k, v] of Object.entries(l.pn)) if (v !== undefined && v !== null) (s.pn as unknown as Record<string, unknown>)[k] = v;
    if (l.footer) for (const [k, v] of Object.entries(l.footer)) if (v !== undefined && v !== null) (s.footer as unknown as Record<string, unknown>)[k] = v;
    applyLook(s, l);
  }
  if (!isDesign(s.design)) s.design = "glass";                          // an unknown design (a newer page's) shows as Liquid Glass
  // Excel and Excel Refined (the Intesa Sanpaolo template, B48): the page number is on by default, as on the template
  // (top right: render/pagenumbers.ts pageNoGeom; not on the cover, pn.cover's default) – unless a layer set it, on or off
  if (isIsp(s.design) && !layers.some(l => l && l.pn && l.pn.on !== undefined && l.pn.on !== null)) s.pn.on = true;
  // the consulting designs keep their own palette: the shared colour theme is not theirs (08 §6 Q4); a theme set for
  // the design itself (Design… › "This design") still applies below
  if (isConsult(s.design)) s.theme = { ...CONSULT_THEME_REF[s.design] };
  // settings made for one design only (Design… › "This design") sit on top of the shared ones
  for (const l of layers) {
    const d = l?.designs?.[s.design];
    if (d && typeof d === "object") { applyLook(s, d); if (isConsult(s.design) && d.consult) s.consult = { ...(s.consult || {}), ...cleanConsult(d.consult) }; }
  }
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
/** the consulting designs' own palettes (08 §2.1, §2.2): not in the theme list, the default of their design only */
export const CONSULT_THEMES: ThemeDef[] = [
  { id: "consult-navy", name: "Consulting Navy", c1: "#051C2C", c2: "#2251FF", c3: "#00A9F4", c4: "#99E6FF", a1: "#2251FF", a2: "#00A9F4", x: "#2251FF" },
  { id: "consult-red", name: "Consulting Red", c1: "#CC0000", c2: "#981A1E", c3: "#F16666", c4: "#A4A4A3", a1: "#CC0000", a2: "#981A1E", x: "#CC0000" },
];
const CONSULT_THEME_REF: Record<"mckinsey" | "bain", Theme> = {
  mckinsey: { id: "consult-navy", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" }, bain: { id: "consult-red", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" } };
export const BUILTIN_THEME: Theme = { id: "aurora", c1: "", c2: "", c3: "", c4: "", a1: "", a2: "" };
const HEX = /^#[0-9A-Fa-f]{6}$/;
/** the theme's colours: a built-in theme by id, or "custom" with the stored colours (missing ones from Aurora) */
export function themeOf(s: Pick<Style, "theme"> & Partial<Pick<Style, "design">>): ThemeDef {
  const t = s.theme || BUILTIN_THEME, base = THEMES.find(x => x.id === t.id) || CONSULT_THEMES.find(x => x.id === t.id);
  // Excel and Excel Refined follow the Intesa Sanpaolo template (B48): the default theme and "Intesa Sanpaolo" are its
  // colours there (model/isp.ts); the theme keeps its id and name (the Design… menu still shows it chosen)
  if (base && isIsp(s.design) && ISP_THEME_IDS.includes(base.id)) return { ...base, ...ISP_THEME };
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

const HEXC = /^#[0-9A-Fa-f]{6}$/;
/** only valid values of a text format survive (documents are shared and may come from older pages) */
export function cleanFmt(f: TextFmt): TextFmt {
  const o: TextFmt = {};
  if (typeof f.font === "string" && f.font.trim()) o.font = f.font.trim().slice(0, 80);
  if (isFinite(+(f.size as number)) && +(f.size as number) > 0) o.size = Math.max(6, Math.min(200, +(f.size as number)));
  if (typeof f.b === "boolean") o.b = f.b;
  if (typeof f.i === "boolean") o.i = f.i;
  if (typeof f.color === "string" && HEXC.test(f.color)) o.color = f.color;
  if (f.align === "left" || f.align === "center" || f.align === "right") o.align = f.align;
  if (isFinite(+(f.lh as number)) && +(f.lh as number) > 0) o.lh = Math.max(.8, Math.min(3, +(f.lh as number)));
  return o;
}

/* ---- colours: theme preset + overrides, the same for every design ----
   Every colour a slide uses comes from palette(): the theme gives the defaults, Style.colors overrides any
   of them. "Pure" Excel keeps the workbook's own colours and uses only the overrides that were set. */
/** colours that can be overridden in Design… (Excel and Excel Refined keep the workbook's table colours) */
export const COLOR_KEYS: { key: ColorKey; name: string; hint: string; designs: Design[] }[] = [
  { key: "accent", name: "Accent", hint: "titles, cover, contents numbers, rules", designs: ["glass", "excel", "clean", "mckinsey", "bain"] },
  { key: "bg", name: "Slide background", hint: "behind everything (Liquid Glass: Colour theme)", designs: ["excel", "clean", "mckinsey", "bain"] },
  { key: "ink", name: "Table text", hint: "numbers and labels", designs: ["glass", "mckinsey", "bain"] },
  { key: "pos", name: "Positive", hint: "green values / cells", designs: ["glass", "mckinsey", "bain"] },
  { key: "neg", name: "Negative", hint: "red values / cells", designs: ["glass", "mckinsey", "bain"] },
];
export type Palette = Record<ColorKey, string>;
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), ch = (p: number, s: number) => (p >> s) & 255;
  const f = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t).toString(16).padStart(2, "0");
  return ("#" + f(16) + f(8) + f(0)).toUpperCase();
}
/** the colours of the deck: theme defaults, then the user's overrides */
export function palette(s: Style): Palette {
  const t = themeOf(s), x = t.x;
  const base: Palette = { accent: x, bg: "#FFFFFF", head: x, headInk: "#FFFFFF", total: mix(x, "#FFFFFF", .88), totalInk: darkAccent(mix(x, "#000000", .25)),
    ink: isConsult(s.design) ? "#000000" : "#1F2430", pos: "#1E8E3E", neg: "#D93025", stripe: mix(x, "#FFFFFF", .965), rule: mix(x, "#FFFFFF", .86) };
  return { ...base, ...(s.colors || {}) };
}
