/* Signed changes (4.13, B54): the arithmetic and the colours the KPI cards (kpi-dl.ts) and the chart card's stats and
   momentum chips (chart-card.ts) share, so a delta reads and colours alike wherever it stands.
   * a change of `cur` against a base: d = cur − base and its % of |base| – a negative base is a level too (a deposit
     outflow of −10.1 against −10 is +1 %), a base of 0 has no % ("n/a", and the caller names it in the Issues panel);
   * its text: the absolute change in a number format with its sign (+ / − / none for 0: chart-targets.ts signed), the %
     with one decimal, or both "−1,420 (−16.9%)";
   * its colour by the "good direction": up (a rise is the design's positive colour, a fall its negative one), down (the
     other way round: a cost, an outflow), neutral (the ink; no colour). 0 is the design's grey. */
import type { GoodWay } from "../model/types";
import type { TargetLook } from "./chart-targets";
import { signed, signedPct } from "./chart-targets";

export const goodOf = (g: unknown): GoodWay => g === "down" || g === "neutral" ? g : "up";
/** the change of `cur` against `base`: absolute, and its share of |base| (null: base 0 – no %) */
export function changeOf(cur: number, base: number): { d: number; pct: number | null } {
  const d = cur - base;
  return { d, pct: base === 0 ? null : d / Math.abs(base) };
}
/** what a change shows: the absolute change, the %, or both ("+589 (+5.2%)"); "n/a" for a % of a zero base */
export function changeText(c: { d: number; pct: number | null }, show: "abs" | "pct" | "both", fmt: string): string {
  // (no change reads "+0 (+0.0%)", as the owner's picture)
  const p = c.pct === null ? "n/a" : (c.pct === 0 ? "+" : "") + signedPct(c.pct), a = (c.d === 0 ? "+" : "") + signed(c.d, fmt);
  return show === "abs" ? a : show === "pct" ? p : `${a} (${p})`;
}
/** a signed number's colour by its good direction (neutral: the ink; 0: the design's grey) */
export function goodColor(d: number, good: GoodWay, look: Pick<TargetLook, "pos" | "neg" | "zero">, ink: string): string {
  if (good === "neutral" || !Number.isFinite(d)) return ink;
  if (d === 0) return look.zero;
  return (d > 0) === (good === "up") ? look.pos : look.neg;
}
