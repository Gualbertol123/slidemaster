/* Which family of a CSS font draws it (S4.4): a font shorthand parsed, and the family of its list a catalog has, as the
   browser on Windows chooses – shared by the core's measurer (text/measure.ts) and the page's width(), which must
   choose alike. */
import { cssFamilies } from "./resolve";

/** a CSS font shorthand ("italic 700 14.67px Calibri, Arial, sans-serif"): its style, weight, size and families */
export function parseFont(css: string): { italic: boolean; weight: number; size: number; families: string[] } | null {
  const m = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|small-caps|\d{3})\s+)*)([\d.]+)px(?:\s*\/\s*\S+)?\s+(.+)$/i.exec(css);
  if (!m) return null;
  const words = m[1].toLowerCase().split(/\s+/).filter(Boolean);
  const num = words.find(w => /^\d{3}$/.test(w));
  return { italic: words.includes("italic") || words.includes("oblique"), weight: num ? +num : words.includes("bold") ? 700 : 400, size: +m[2], families: cssFamilies(m[3]) };
}
/** families a browser on Windows does not have (macOS's system fonts) */
const NOT_HERE = /^(-apple-system|BlinkMacSystemFont|SF Pro( (Display|Text))?)$/i;
const GENERIC: Record<string, string> = { "sans-serif": "Arial", serif: "Times New Roman", monospace: "Consolas", "system-ui": "Segoe UI", cursive: "Comic Sans MS", fantasy: "Impact" };

/** the family of a CSS list the browser draws with, of those a catalog has (`has`: by lower-case name) – the core's
    measurer and the page's width() choose alike, so both lay Liquid Glass out with the same widths */
export function catalogFamily(families: string[], has: (family: string) => boolean): string | null {
  for (const raw of families) {
    if (NOT_HERE.test(raw)) continue;
    const fam = GENERIC[raw.toLowerCase()] || raw;
    if (has(fam.toLowerCase())) return fam;
  }
  return null;
}
