/* KPI cards (B54, 4.13): a card with a dark header bar (its title), a big current value and N delta rows – each a %
   read from a cell, or computed from a reference cell (% = (cur − ref) / |ref|, the absolute difference, or both),
   coloured by its good direction. The maths and colours here are pure; render/kpi-dl.ts draws it. */
import type { Box, DataRef, Side } from "./types";

/** a delta row's source: a cell holding the change already (e.g. a %), or computed from a reference cell */
export type KpiSource = { cell: DataRef } | { ref: DataRef; mode: "pct" | "abs" | "both" };
/** up: a positive change is good (green); down: a negative one is; neutral: always grey */
export type KpiGood = "up" | "down" | "neutral";
export interface KpiRow { src: KpiSource; /** e.g. "vs Bdg" */ label?: string; good?: KpiGood; /** a number format code; else the cell's */ num?: string }
export interface KpiItem { kind: "kpi";
  /** the title: typed text, or a cell (shown in caps) */ head?: string | DataRef;
  /** the current value's cell */ cur?: DataRef;
  /** the delta rows, in order (replaced whole by item.patch) */ rows?: KpiRow[];
  /** the value's good direction (its colour by sign; default up) */ good?: KpiGood;
  /** the value's number format; else the cell's */ num?: string;
  box: Box; attach?: { table: string; side: Side } }

/** a delta row's result: the value(s) shown, or n/a with why */
export type KpiDelta = { ok: true; pct: number | null; abs: number | null; sign: number } | { ok: false; why: string };
/** a computed delta: % uses |ref| (a negative reference keeps the change's direction); a zero ref has no % */
export function kpiDelta(cur: number, ref: number, mode: "pct" | "abs" | "both"): KpiDelta {
  const abs = cur - ref;
  if (mode !== "abs" && ref === 0) return { ok: false, why: "the reference is 0" };
  const pct = mode === "abs" ? null : abs / Math.abs(ref);
  return { ok: true, pct, abs: mode === "pct" ? null : abs, sign: Math.sign(abs) };
}
/** the colour key of a signed number under a good direction */
export function kpiTone(sign: number, good: KpiGood | undefined): "good" | "bad" | "neutral" {
  if (good === "neutral" || !sign) return "neutral";
  return (sign > 0) === (good !== "down") ? "good" : "bad";
}
export const isDataRef = (x: unknown): x is DataRef => !!x && typeof x === "object" && typeof (x as DataRef).range === "string"
  && (typeof (x as { sheet?: unknown }).sheet === "string" || typeof (x as { table?: unknown }).table === "string");
