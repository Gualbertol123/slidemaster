/* What the core says of a chart for the PowerPoint export (07 §4.2, B21): render/chart-dl.ts chartSem makes it, chart.ts
   writes it as a native chart part. Its own file since S14.P, so that M14 (series charts, 09 §4.2) grows it without
   touching scene.ts, which M15 owns. */
import type { Box } from "./scene";

export interface FontSem { css: string; size: number; color: string; b: boolean; i: boolean }
export interface ChartSem {
  /** column / bar (4.7, S14.2), line / area / combo (S14.3): a series chart, written from `bars`; the pie fields then
      carry its first series */
  type: "pie" | "donut" | "column" | "bar" | "line" | "area" | "combo"; title: string; titleFont: FontSem; labelFont: FontSem; series: string;
  labels: string[]; values: number[]; colors: string[]; show: ("label" | "value" | "percent")[]; legend: "right" | "bottom" | "none";
  startAngle: number; /** the plot's frame inside the card, slide px */ box: Box; sep: { w: number; color: string } | null; fmt: string; hole: number;
  /** a series chart (09 §4.2): set exactly when type is not "pie" or "donut" */
  bars?: BarsSem;
}
/** a line of an axis or of the gridlines: colour, width px, dash */
export interface LineSem { color: string; w: number; dash?: "dash" | "sysDot" | "dashDot" }
/** the value axis exactly as drawn: fixed bounds and unit (never PowerPoint's own), its format, gridlines, line, font */
export interface ValAxisSem { min: number; max: number; step: number; num: string; grid: LineSem | null; line: LineSem | null; show: boolean; font: FontSem }
export interface CatAxisSem { line: LineSem | null; show: boolean; font: FontSem; /** a label every n categories */ skip: number }
/** a point's own label: its text ("" = hidden) and / or the colour it is drawn in (white inside a dark bar) */
export interface PointLabelSem { i: number; text?: string; hide?: boolean; color?: string; /** moved to the other side (S14.3: a line label that would overlap its neighbour) */ pos?: LabelPos }
/** where a data label stands: a bar's (outside end, inside end, centre, inside base), a line point's (t, b, l, r, ctr);
    null = the chart group's own place (an area's labels take no position in PowerPoint) */
export type LabelPos = "outEnd" | "inEnd" | "ctr" | "inBase" | "t" | "b" | "l" | "r" | null;
/** a line series' marker as PowerPoint writes it: symbol, size in points (2–72), fill, the ring (colour, px) */
export interface MarkerSem { symbol: "circle" | "square" | "diamond" | "triangle" | "none"; size: number; color: string; ring: string; w: number }
export interface BarSerSem {
  name: string; /** per category; null = no bar (a gap) */ values: (number | null)[]; color: string; fmt: string;
  /** per point colours (points[i].color); with a gradient each point's light stop and whether it is reversed (a
      negative bar: the light stop at its base end) */ points: { i: number; color: string; light?: string; rev?: boolean }[];
  /** S14.2 review 1, 5: a bar's gradient – the light stop at the outer end, the colour at the base (a:gradFill; unset =
      solid) –; per category a point's own number format ("" = `fmt`; unset = all `fmt`) */ light?: string; fmts?: string[];
  labels: { show: ("value" | "name" | "category" | "percent")[]; pos: LabelPos; num: string | null; font: FontSem; points: PointLabelSem[] } | null;
  /* 4.7, S14.3 (unset: a bar series of the one bar group, as S14.2 wrote it) */
  /** the chart group it is drawn in, and its value axis */ type?: "column" | "bar" | "line" | "area"; axis?: "y" | "y2";
  /** a line: smoothed; its stroke (width, dash) */ smooth?: boolean; stroke?: LineSem | null;
  /** a line's marker (null = none) and the points' own marker colours */ marker?: MarkerSem | null; markers?: { i: number; color: string }[];
  /** an area's fill opacity */ alpha?: number;
  /** the outlined target bars of "actual inside target" (09 §4.2): no fill, its outline in the series' (and each point's)
      colour, drawn over the actual series in the same bar group (overlap 100), never in the legend */ target?: { w: number };
}
/** one chart group of the plot area: its series (indexes into BarsSem.series), the axis pair it stands on, how it stacks */
export interface GroupSem { kind: "bar" | "line" | "area"; axis: "y" | "y2"; grouping: "clustered" | "stacked" | "percentStacked" | "standard"; gap: number; overlap: number; series: number[] }
export interface BarsSem {
  dir: "col" | "bar"; grouping: "clustered" | "stacked" | "percentStacked"; gap: number; overlap: number;
  cats: string[]; series: BarSerSem[]; val: ValAxisSem; cat: CatAxisSem; /** the title's drawn box (null = no title) */ title: Box | null;
  /** the plot rectangle (the bars' area, inside the axes' labels), slide px: c:plotArea manualLayout inner */ plot: Box;
  /** the legend's box, slide px (manual layout), its position and the entries left out (series indexes); null = none */
  legend: { pos: "r" | "l" | "t" | "b" | "tr"; box: Box; overlay: boolean; hide: number[] } | null;
  /* 4.7, S14.3 (unset: one bar group of every series on the primary axes, as S14.2) */
  /** the chart groups in the order they are written (areas, bars, lines; the primary axis's first) */ groups?: GroupSem[];
  /** the secondary value axis (right), when a series stands on it */ val2?: ValAxisSem | null;
  /** multi-level categories: each category's group label ("" but at a group's first category); null = one level */ levels?: string[] | null;
}
