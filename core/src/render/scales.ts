/* Colour scales ("variable conditional formatting"): the bigger the number, the deeper the green
   (or red), computed per row, per column or over the whole range, for the cell fill and/or the
   number colour. Rules live on the table definition (table.scales). */
import { hexRgb } from "../xlsx/color";
import { parseRange, inRange } from "../xlsx/util";
import type { Item, TableLayout } from "../xlsx/types";
import type { ScaleRule } from "../model/types";

const GREEN = "#34C759", RED = "#FF3B30";
const INK = { pos: ["#5DB777", "#0A5C24"], neg: ["#E0766E", "#8E0B12"] } as const;
const mix = (a: string, b: string, t: number) => {
  const x = hexRgb(a), y = hexRgb(b), m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, "0");
  return ("#" + m(0) + m(1) + m(2)).toUpperCase();
};
/** colours for strength t (0…1) and sign */
export function scaleColors(t: number, neg: boolean) {
  t = Math.max(0, Math.min(1, t));
  return { fill: mix("#FFFFFF", neg ? RED : GREEN, .1 + .72 * t), ink: mix(INK[neg ? "neg" : "pos"][0], INK[neg ? "neg" : "pos"][1], t) };
}
const numOf = (L: TableLayout, it: Item): number | null => {
  const c = L.sheet.get(it.b.src.r, it.b.src.c);
  return c && (c.t === "n" || c.t === "d") && typeof c.v === "number" && isFinite(c.v) ? c.v : null;
};

/** item → colours of every rule that covers it (later rules win) */
export function applyScales(L: TableLayout, rules: Record<string, ScaleRule> | undefined): Map<Item, { fill?: string; ink?: string }> {
  const out = new Map<Item, { fill?: string; ink?: string }>();
  if (!rules) return out;
  for (const rule of Object.values(rules)) {
    if (!rule || !rule.range || (!rule.fill && !rule.ink)) continue;
    const g = parseRange(rule.range.toUpperCase().replace(/\$/g, ""));
    const cells: { it: Item; v: number; key: string }[] = [];
    for (const it of L.items) {
      if (!inRange(g, it.b.src.r, it.b.src.c)) continue;
      const v = numOf(L, it); if (v === null) continue;
      cells.push({ it, v, key: rule.dir === "row" ? "r" + it.b.src.r : rule.dir === "col" ? "c" + it.b.src.c : "" });
    }
    const groups = new Map<string, number[]>();
    for (const c of cells) { if (!groups.has(c.key)) groups.set(c.key, []); groups.get(c.key)!.push(c.v); }
    const stats = new Map([...groups].map(([k, vs]) => [k, { min: Math.min(...vs), max: Math.max(...vs), pos: Math.max(0, ...vs), neg: Math.min(0, ...vs) }]));
    for (const c of cells) {
      const st = stats.get(c.key)!;
      let t: number, neg: boolean;
      if (rule.mode === "minmax") {
        const span = st.max - st.min; const u = span ? (c.v - st.min) / span : .5;
        neg = u < .5; t = Math.abs(u - .5) * 2;
      } else {                                   // around zero: positives green, negatives red
        if (c.v === 0) continue;
        neg = c.v < 0; t = neg ? (st.neg ? c.v / st.neg : 0) : (st.pos ? c.v / st.pos : 0);
      }
      if (rule.invert) neg = !neg;
      const col = scaleColors(t, neg), prev = out.get(c.it) || {};
      out.set(c.it, { fill: rule.fill ? col.fill : prev.fill, ink: rule.ink ? col.ink : prev.ink });
    }
  }
  return out;
}
