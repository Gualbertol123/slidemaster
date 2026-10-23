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
import { signed } from "./chart-targets";
import { tickText } from "./chart-axes";

export const goodOf = (g: unknown): GoodWay => g === "down" || g === "neutral" ? g : "up";
/** the change of `cur` against `base`: absolute, and its share of |base| (null: base 0 – no %) */
export function changeOf(cur: number, base: number): { d: number; pct: number | null } {
  const d = cur - base;
  return { d, pct: base === 0 ? null : d / Math.abs(base) };
}
/** a number that shows as zero in a format (no digit 1–9: 0, 0.0, −0.004 in "0.0") */
export const shownZero = (v: number, fmt: string) => !/[1-9]/.test(tickText(Math.abs(v), fmt));
/** what a change shows: the absolute change, the %, or both ("+589 (+5.2%)"); "n/a" for a % of a zero base. A change that
    shows as zero (a true zero, or one rounded to it) reads "+0 (+0.0%)" as the owner's sheet – never "−0" */
export function changeText(c: { d: number; pct: number | null }, show: "abs" | "pct" | "both", fmt: string): string {
  const z = (v: number, f: string) => shownZero(v, f) ? "+" + tickText(0, f) : signed(v, f);
  const p = c.pct === null ? "n/a" : z(c.pct, "0.0%"), a = z(c.d, fmt);
  return show === "abs" ? a : show === "pct" ? p : `${a} (${p})`;
}
/** the sign a change's colour takes: of what it shows (0 when the shown number is zero – the design's grey) */
export function shownSign(c: { d: number; pct: number | null }, show: "abs" | "pct" | "both", fmt: string): number {
  const zero = show === "pct" ? c.pct === null || shownZero(c.pct, "0.0%") : shownZero(c.d, fmt);
  return zero ? 0 : c.d;
}
/** a signed number's colour by its good direction (neutral: the ink; 0: the design's grey) */
export function goodColor(d: number, good: GoodWay, look: Pick<TargetLook, "pos" | "neg" | "zero">, ink: string): string {
  if (good === "neutral" || !Number.isFinite(d)) return ink;
  if (d === 0) return look.zero;
  return (d > 0) === (good === "up") ? look.pos : look.neg;
}
