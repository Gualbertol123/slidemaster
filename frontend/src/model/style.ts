/* Deck style = built-in defaults ← shared defaults (config.json) ← this workbook's style. */
import type { Footer, PageNumbers, Style, StylePatch } from "./types";

export const BUILTIN_PN: PageNumbers = { on: false, start: 1, pos: "br", font: "auto", size: 16, format: "n", style: "capsule", cover: false };
export const BUILTIN_FOOTER: Footer = { on: false, text: "", pos: "bl", size: 14, style: "plain", cover: false };
export const BUILTIN_STYLE: Style = { design: "glass", glass: "subtle", color: 35, logo: "logo.png", pn: BUILTIN_PN, radius: 100, contrast: 50, logoBubble: true, footer: BUILTIN_FOOTER };

export function resolveStyle(...layers: (StylePatch | null | undefined)[]): Style {
  const s: Style = { ...BUILTIN_STYLE, pn: { ...BUILTIN_PN }, footer: { ...BUILTIN_FOOTER } };
  for (const l of layers) {
    if (!l) continue;
    for (const k of ["design", "glass", "color", "logo", "radius", "contrast", "logoBubble"] as const) if (l[k] !== undefined && l[k] !== null) (s as unknown as Record<string, unknown>)[k] = l[k];
    if (l.pn) for (const [k, v] of Object.entries(l.pn)) if (v !== undefined && v !== null) (s.pn as unknown as Record<string, unknown>)[k] = v;
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
